import { Bot, Context, NextFunction } from 'grammy';
import { config } from '../config.js';
import { processUserMessage, Attachment } from '../agent/loop.js';
import { addMemory } from '../db/index.js';
import { getAllowedThreads, setAllowedThreads, setUserModel, getAuthorizedGroups, authorizeGroup, revokeGroup, setPersonality, getPassiveThreads, setPassiveThreads } from '../db/settings.js';

export const bot = new Bot(config.telegramBotToken);

/**
 * Middleware para asegurar que solo usuarios autorizados puedan cambiar configuraciones
 */
const adminOnly = async (ctx: Context, next: NextFunction) => {
  const userId = ctx.from?.id.toString();
  if (!userId || !config.telegramAllowedUserIds.includes(userId)) return;
  await next();
};

bot.use(async (ctx, next) => {
  if (ctx.chat?.type === 'private') {
    const userId = ctx.from?.id.toString();
    if (!userId || !config.telegramAllowedUserIds.includes(userId)) {
      console.warn(`[Bot] Acceso privado bloqueado para: ${userId}`);
      try {
        await ctx.reply("⛔ No tienes permisos para usar SP-Agent en privado. Esta conversación ha sido cerrada automáticamente.");
      } catch (e) {}
      return;
    }
  }
  await next();
});

// Comandos básicos
bot.command('start', (ctx) => ctx.reply("¡Hola! Soy SP-Agent avanzado. Ahora tengo visión, búsqueda en internet y memoria total.", { parse_mode: 'HTML' }));

bot.command('clear', adminOnly, async (ctx) => {
  const { clearMemory } = await import('../db/index.js');
  const chatId = ctx.chat.id.toString();
  const threadId = ctx.message?.message_thread_id?.toString();
  await clearMemory(chatId, threadId);
  await ctx.reply(`Memoria de este ${threadId ? 'hilo' : 'chat'} borrada.`, { parse_mode: 'HTML' });
});

bot.command('model', adminOnly, async (ctx) => {
  const model = ctx.match || 'gemini-3.1-flash-lite-preview';
  await setUserModel(ctx.chat.id.toString(), model);
  await ctx.reply(`Modelo cambiado a: \`${model}\``, { parse_mode: 'Markdown' });
});

bot.command('persona', adminOnly, async (ctx) => {
  const instructions = ctx.match.trim();
  const chatId = ctx.chat.id.toString();
  if (!instructions) return await ctx.reply("Uso: `/persona eres un pirata`", { parse_mode: 'Markdown' });
  if (instructions.toLowerCase() === 'default') {
    await setPersonality(chatId, "");
    return await ctx.reply("✅ Personalidad restablecida.", { parse_mode: 'Markdown' });
  }
  await setPersonality(chatId, instructions);
  await ctx.reply(`✅ Personalidad actualizada para este chat.`, { parse_mode: 'Markdown' });
});

/**
 * Gestión de Grupos Autorizados (Whitelisting)
 */
bot.command('allowgroup', adminOnly, async (ctx) => {
  const chatId = ctx.match.trim() || ctx.chat.id.toString();
  await authorizeGroup(chatId);
  await ctx.reply(`✅ Grupo \`${chatId}\` autorizado.`, { parse_mode: 'Markdown' });
});

bot.command('revokegroup', adminOnly, async (ctx) => {
  const chatId = ctx.match.trim() || ctx.chat.id.toString();
  await revokeGroup(chatId);
  await ctx.reply(`❌ Grupo \`${chatId}\` revocado.`, { parse_mode: 'Markdown' });
});

/**
 * Gestión de Topics (Hilos de Foro)
 */
bot.command('topics', adminOnly, async (ctx) => {
  const chatId = ctx.chat.id.toString();
  const threadId = ctx.message?.message_thread_id;
  const action = ctx.match.trim().toLowerCase();
  
  let active = await getAllowedThreads(chatId);
  let consultor = await getPassiveThreads(chatId);

  const idToToggle = threadId !== undefined ? threadId : 1;
  const label = idToToggle === 1 && threadId === undefined ? 'General' : `#${idToToggle}`;

  if (action === 'miembro') {
    active.push(idToToggle);
    active = [...new Set(active)];
    consultor = consultor.filter((id: number) => id !== idToToggle);
    await setAllowedThreads(chatId, active);
    await setPassiveThreads(chatId, consultor);
    await ctx.reply(`🎭 <b>Hilo ${label}: Modo MIEMBRO</b>\nParticipación activa. Leo todo y respondo cuando sea relevante.`, { parse_mode: 'HTML' });
  } 
  else if (action === 'consultor') {
    consultor.push(idToToggle);
    consultor = [...new Set(consultor)];
    active = active.filter((id: number) => id !== idToToggle);
    await setAllowedThreads(chatId, active);
    await setPassiveThreads(chatId, consultor);
    await ctx.reply(`🧐 <b>Hilo ${label}: Modo CONSULTOR</b>\nLeo todo para tener contexto, pero solo respondo si me mencionas o citas.`, { parse_mode: 'HTML' });
  }
  else if (action === 'asistente' || action === 'disable') {
    active = active.filter((id: number) => id !== idToToggle);
    consultor = consultor.filter((id: number) => id !== idToToggle);
    await setAllowedThreads(chatId, active);
    await setPassiveThreads(chatId, consultor);
    const msg = action === 'disable' ? `❌ <b>Hilo ${label}</b>: Deshabilitado.` : `🤖 <b>Hilo ${label}: Modo ASISTENTE</b>\nSolo respondo si me mencionas directamente. Sin memoria de charla ajena.`;
    await ctx.reply(msg, { parse_mode: 'HTML' });
  }
  else if (action === 'all') {
    await setAllowedThreads(chatId, []);
    await setPassiveThreads(chatId, []);
    await ctx.reply(`🌐 <b>Modo GLOBAL</b>: Activo en todos los hilos (Modo Consultor por defecto).`, { parse_mode: 'HTML' });
  }
  else {
    await ctx.reply("💡 <b>Uso:</b>\n- <code>/topics miembro</code>\n- <code>/topics consultor</code>\n- <code>/topics asistente</code>\n- <code>/topics disable</code>", { parse_mode: 'HTML' });
  }
});

/**
 * Función central de procesamiento de mensajes (Texto y Multimedia)
 */
const handleIncomingMessage = async (ctx: Context) => {
  const chatId = ctx.chat?.id.toString();
  if (!chatId) return;

  console.log(`[Bot] 📥 Mensaje recibido en: ${ctx.chat?.type} (${chatId})`);

  const isGroup = ctx.chat?.type === 'group' || ctx.chat?.type === 'supergroup';
  const threadIdInt = ctx.message?.message_thread_id;
  const threadId = threadIdInt?.toString();
  
    // 1. Verificación de Seguridad para Grupos
    if (isGroup) {
        const authorized = await getAuthorizedGroups();
        if (!authorized.includes(chatId)) {
            await ctx.leaveChat();
            return;
        }

        // 2. Obtener configuraciones de hilos
        const allowedThreads = await getAllowedThreads(chatId);
        const passiveThreads = await getPassiveThreads(chatId);
        
        const currentThread = threadIdInt !== undefined ? threadIdInt : 1;
        const isActiveThread = allowedThreads.includes(currentThread);
        const isPassiveThread = passiveThreads.includes(currentThread);
        const isAllMode = allowedThreads.length === 0 && passiveThreads.length === 0;
        const isNoneMode = allowedThreads.includes(-1);

        // 3. Verificar mención/cita
        const text = ctx.message?.text || ctx.message?.caption || "";
        const isMentioned = text.includes(`@${ctx.me.username}`);
        const isReplyToBot = ctx.message?.reply_to_message?.from?.id === ctx.me.id;

        // LÓGICA DE DECISIÓN
        const shouldRespond = isMentioned || isReplyToBot || isActiveThread;
        const shouldSaveMemory = shouldRespond || isPassiveThread || isAllMode;

        if (!shouldRespond) {
            if (shouldSaveMemory && !isNoneMode) {
                const senderName = ctx.from?.first_name || "Usuario";
                console.log(`[Bot] 🤐 Guardando contexto en memoria (Hilo ${isPassiveThread ? 'Pasivo' : 'Global'}): ${senderName}`);
                await addMemory(chatId, 'user', `${senderName}: ${text}`, threadId);
            }
            return;
        }

        console.log(`[Bot] 🎯 Respondiendo (Mención: ${isMentioned}, Reply: ${isReplyToBot}, Hilo Activo: ${isActiveThread})`);
    }

    // 4. Responder
    console.log(`[Bot] 🧠 Iniciando procesamiento para el chat: ${chatId}`);
    await ctx.replyWithChatAction('typing');
  try {
    const senderName = ctx.from?.first_name || "Usuario";
    const text = ctx.message?.text || ctx.message?.caption || "(Sin texto)";
    
    // Capturar texto del mensaje citado para dar contexto al agente
    let quoteContext = "";
    if (ctx.message?.reply_to_message) {
        const quoteSender = ctx.message.reply_to_message.from?.first_name || "Alguien";
        const quoteText = ctx.message.reply_to_message.text || ctx.message.reply_to_message.caption || "";
        if (quoteText) {
            quoteContext = `\n[CITADO DE ${quoteSender}]: ${quoteText}`;
        }
    }

    const attachments: Attachment[] = [];

    // Procesar Fotos si existen (en el mensaje actual o en el citado)
    const photoMsg = ctx.message?.photo || ctx.message?.reply_to_message?.photo;
    if (photoMsg) {
        const photo = Array.isArray(photoMsg) ? photoMsg[photoMsg.length - 1] : photoMsg; 
        if (photo) {
            const file = await ctx.api.getFile(photo.file_id);
            const url = `https://api.telegram.org/file/bot${config.telegramBotToken}/${file.file_path}`;
            const res = await fetch(url);
            const buffer = await res.arrayBuffer();
            attachments.push({
                type: 'image',
                mimeType: 'image/jpeg',
                data: Buffer.from(buffer).toString('base64')
            });
            console.log(`[Bot] 📸 Imagen detectada (${ctx.message?.photo ? 'directa' : 'citada'}) para procesar.`);
        }
    }

    const formattedText = isGroup ? `${senderName}: ${text}${quoteContext}` : `${text}${quoteContext}`;
    const { text: responseText, photoUrl } = await processUserMessage(chatId, formattedText, threadId, attachments);
    
    if (responseText || photoUrl) {
      if (photoUrl) {
          try {
              await ctx.replyWithPhoto(photoUrl, {
                  caption: responseText,
                  parse_mode: 'HTML',
                  message_thread_id: threadIdInt
              });
              return;
          } catch (err) {
              console.error("[Bot] Error enviando foto, enviando solo texto.", err);
          }
      }
      
      await ctx.reply(responseText, { 
        parse_mode: 'HTML',
        message_thread_id: threadIdInt 
      });
    }
  } catch (error: any) {
    console.error(`[Bot Error]`, error);
    await ctx.reply(`<b>Error:</b> <code>${error.message}</code>`, { 
      parse_mode: 'HTML',
      message_thread_id: threadIdInt 
    });
  }
};

// Listeners
bot.on('message:text', handleIncomingMessage);
bot.on('message:photo', handleIncomingMessage); 

// Manejo de errores global para evitar que el bot se caiga
bot.catch((err) => {
  const ctx = err.ctx;
  console.error(`[Bot Error] Error handling update ${ctx.update.update_id}:`);
  const e = err.error;
  if (e instanceof Error) {
    console.error(`  - Name: ${e.name}`);
    console.error(`  - Message: ${e.message}`);
    console.error(`  - Stack: ${e.stack}`);
  } else {
    console.error(`  - Unknown error:`, e);
  }
});

bot.on('my_chat_member', async (ctx) => {
  if (ctx.myChatMember.new_chat_member.status === 'member') {
    const authorized = await getAuthorizedGroups();
    const chatId = ctx.chat.id.toString();
    
    if (!authorized.includes(chatId)) {
        console.warn(`[Bot] Intento de entrada en grupo no autorizado: ${ctx.chat.title} (${chatId})`);
        try {
            // Intentamos avisar, pero si falla (ej: topic cerrado), ignoramos el error para poder salir
            await ctx.reply("⛔ Este grupo no está autorizado para usar SP-Agent. Contacta con mi dueño.");
        } catch (e) {
            console.error("[Bot] No se pudo enviar mensaje de advertencia al grupo (posible forum topic cerrado).");
        }
        await ctx.leaveChat();
    }
  }
});
