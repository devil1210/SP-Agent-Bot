import { Bot, Context } from 'grammy';
import { notifyAdmin, isAdmin } from '../helpers.js';
import { getUserPreferences, setTwitterAutoFix, clearMemory } from '../../db/index.js';

export function registerAdminCommands(bot: Bot) {
  const isAdminMiddleware = async (ctx: Context, next: () => Promise<void>) => {
    if (await isAdmin(ctx.from?.id.toString())) {
      await next();
    }
  };

  bot.command('help', isAdminMiddleware, async (ctx) => {
    const helpMsg = `<b>🛠️ Guía de Comandos del SP-Agent</b>

<b>Básicos:</b>
• /start - Saludo inicial
• /help - Muestra esta lista de ayuda (Solo Admin)
• /id - Ver ID de chat e hilo (Solo Admin / Privado)
• /clear - Borra la memoria del chat o hilo actual (Solo Admin)

<b>Configuración de IA:</b>
• /model [nombre] - Cambia el modelo de IA (ej: gemini-1.5-pro)
• /intr [0-100] - Ajusta la frecuencia de intervención (%)
• /persona [instrucciones] - Configura una personalidad libre
• /setpersona [nombre] - Carga una personalidad guardada
• /personas - Lista y gestiona personalidades guardadas
• /savepersona [nombre] [prompt] - Guarda una personalidad

<b>Gestión de Grupos y Usuarios:</b>
• /groups - Lista los grupos e hilos donde estoy activo
• /topics [rol] - Configura mi rol (miembro/consultor/asistente)
• /allowgroup - Autoriza un nuevo grupo
• /revokegroup - Revoca autorización de un grupo
• /allowuser - Autoriza a un usuario
• /revokeuser - Revoca a un usuario
• /users - Lista usuarios autorizados

<b>Utilidades:</b>
• /say [chatId] [msj] - Envía un mensaje remoto
• /del - Borra un mensaje mío (citándolo)
• /edit [instrucciones] - Edita un mensaje mío con IA (citándolo)
• /autofix [si/no] - Activa/Desactiva auto-corrección de Twitter
• /features - Gestiona módulos de conocimiento (ej: library)
• /config [param] [valor] - Ajusta rasgos (sarcasmo, interés, etc.) 0-100

<i>Nota: Todos los comandos de configuración se envían a tu chat privado por seguridad.</i>`;

    await notifyAdmin(ctx, helpMsg);
  });

  bot.command('start', async (ctx) => {
    await ctx.reply("¡Hola! Soy SP-Agent avanzado. Ahora tengo visión, búsqueda en internet y memoria total.", { parse_mode: 'HTML' });
  });

  bot.command('autofix', async (ctx) => {
    const userId = ctx.from?.id.toString();
    if (!userId) return;

    const arg = ctx.match.trim().toLowerCase();
    let enabled = false;

    if (arg === 'si' || arg === 'on' || arg === 'true' || arg === 'activar') {
      enabled = true;
    } else if (arg === 'no' || arg === 'off' || arg === 'false' || arg === 'desactivar') {
      enabled = false;
    } else {
      const prefs = await getUserPreferences(userId);
      return await ctx.reply(`🔧 <b>Preferencia de Twitter Auto-Fix:</b>\n\nEstado actual: ${prefs.twitter_auto_fix ? '✅ ACTIVADO' : '❌ DESACTIVADO'}\n\nPara cambiarlo usa:\n<code>/autofix si</code> o <code>/autofix no</code>`, { parse_mode: 'HTML' });
    }

    await setTwitterAutoFix(userId, enabled);
    await ctx.reply(`✅ <b>Preferencia actualizada:</b> La corrección automática de Twitter ha sido ${enabled ? 'ACTIVADA' : 'DESACTIVADA'}.`, { parse_mode: 'HTML' });
  });

  bot.command('id', isAdminMiddleware, async (ctx) => {
    if (ctx.chat.type !== 'private') {
      // Silencio en grupos
      return;
    }
    const chatId = ctx.chat.id;
    const threadId = ctx.message?.message_thread_id;
    let msg = `🆔 <b>Tu Chat ID:</b> <code>${chatId}</code>`;
    if (threadId) msg += `\n🧵 <b>Thread ID:</b> <code>${threadId}</code>`;
    await ctx.reply(msg, { parse_mode: 'HTML' });
  });

  bot.command('clear', isAdminMiddleware, async (ctx) => {
    const chatId = ctx.chat.id.toString();
    const threadId = ctx.message?.message_thread_id?.toString();
    await clearMemory(chatId, threadId);
    await notifyAdmin(ctx, `✅ Memoria de este ${threadId ? 'hilo' : 'chat'} borrada.`);
  });

  bot.command('del', isAdminMiddleware, async (ctx) => {
    const replyTo = ctx.message?.reply_to_message;
    if (!replyTo) {
      return await notifyAdmin(ctx, "💡 <b>Uso:</b> Cita un mensaje del bot con <code>/del</code> para eliminarlo.");
    }

    const me = await ctx.api.getMe();
    if (replyTo.from?.id !== me.id) {
      return await notifyAdmin(ctx, "❌ Solo puedo eliminar mis propios mensajes.");
    }

    try {
      await ctx.api.deleteMessage(ctx.chat.id, replyTo.message_id);
      await ctx.api.deleteMessage(ctx.chat.id, ctx.message!.message_id);
      await notifyAdmin(ctx, `✅ Mensaje eliminado en <b>${ctx.chat.title || 'Grupo'}</b>.`);
    } catch (e: any) {
      await notifyAdmin(ctx, `❌ Error eliminando mensaje: ${e.message}`);
    }
  });

  bot.command('edit', isAdminMiddleware, async (ctx) => {
    const reply = ctx.message?.reply_to_message;
    if (!reply) {
      return await notifyAdmin(ctx, "❌ Debes citar un mensaje del bot para editarlo.");
    }

    const me = await ctx.api.getMe();
    if (reply.from?.id !== me.id) {
      return await notifyAdmin(ctx, "❌ Solo puedo editar mis propios mensajes.");
    }

    const instructions = ctx.match.trim();
    if (!instructions) {
      return await notifyAdmin(ctx, "❌ Por favor, proporciona las instrucciones de edición.");
    }

    const originalText = reply.text || reply.caption || "";
    if (!originalText) {
      return await notifyAdmin(ctx, "❌ El mensaje citado no tiene texto para editar.");
    }

    try {
      const { processEditRequest } = await import('../../agent/loop.js');
      
      const threadId = ctx.chat.type === 'private' ? undefined : ctx.message?.message_thread_id?.toString();
      const editedText = await processEditRequest(ctx.chat.id.toString(), originalText, instructions, threadId);

      if (!editedText) {
        return await notifyAdmin(ctx, "⚠️ La IA no generó texto para la edición.");
      }

      await ctx.api.editMessageText(ctx.chat.id, reply.message_id, editedText, {
        parse_mode: 'HTML'
      });

      await notifyAdmin(ctx, `✅ Mensaje editado correctamente.`);
    } catch (e: any) {
      console.error(`[Edit Command Error]`, e);
      await notifyAdmin(ctx, `❌ Error al editar: ${e.message}`);
    }
  });
}
