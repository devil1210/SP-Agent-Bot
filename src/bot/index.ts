import { Bot, Context, NextFunction, GrammyError, HttpError } from 'grammy';
import { config } from '../config.js';
import { processUserMessage, Attachment } from '../agent/loop.js';
import { addMemory } from '../db/index.js';
import { getAllowedThreads, setAllowedThreads, setUserModel, getAuthorizedGroups, authorizeGroup, revokeGroup, getPersonality, setPersonality, getPassiveThreads, setPassiveThreads, setThreadName, getKnownThreads, getChatFeatures, setChatFeatures, getSavedPersonalities, savePersonality, getInterventionLevel, setInterventionLevel } from '../db/settings.js';

export const bot = new Bot(config.telegramBotToken);

// Configurar comandos visibles solo para administradores
async function setBotCommands() {
    const commands = [
        { command: "features", description: "Gestiona módulos de conocimiento" },
        { command: "persona", description: "Configurar personalidad libre" },
        { command: "setpersona", description: "Cambiar a una personalidad guardada" },
        { command: "personas", description: "Lista de personalidades disponibles" },
        { command: "savepersona", description: "Guardar una nueva personalidad (Admin)" },
        { command: "topics", description: "Configura el rol del bot en un hilo" },
        { command: "groups", description: "Lista hilos y sus IDs" },
        { command: "say", description: "Enviar mensaje remoto" },
        { command: "del", description: "Borrar mensaje del bot (citar mensaje)" },
        { command: "manual", description: "Guía completa de comandos" }
    ];

    try {
        // Opción A: Visible para todos los administradores en todos los grupos
        await bot.api.setMyCommands(commands, {
            scope: { type: "all_chat_administrators" }
        });

        // Opción B: Específico para tu ID (esto hace que solo TÚ los veas en cualquier chat)
        for (const userId of config.telegramAllowedUserIds) {
            await bot.api.setMyCommands(commands, {
                scope: { type: "chat", chat_id: parseInt(userId) }
            });
        }
        
        console.log("[Bot] ✅ Comandos configurados con éxito");
    } catch (e) {
        console.error("[Bot] ❌ Error configurando comandos:", e);
    }
}

/**
 * Función para enviar notificaciones al chat privado del administrador
 */
async function notifyAdmin(ctx: Context, text: string) {
  const userId = ctx.from?.id;
  if (!userId) return;
  
  try {
    // Si ya estamos en privado, respondemos normalmente
    if (ctx.chat?.type === 'private') {
      await ctx.reply(text, { parse_mode: 'HTML' });
      return;
    }

    // Si estamos en un grupo, enviamos al privado
    await ctx.api.sendMessage(userId, text, { parse_mode: 'HTML' });
    
    // Intentar borrar el comando del usuario en el grupo para mantenerlo limpio
    try {
      await ctx.deleteMessage();
    } catch (e) {}
  } catch (e) {
    console.error(`[Bot] No se pudo enviar notificación privada a ${userId}:`, e);
    // Fallback: responder en el grupo solo si falla la comunicación privada
    await ctx.reply(`⚠️ [Privado fallido] ${text}`, { 
      parse_mode: 'HTML', 
      message_thread_id: ctx.message?.message_thread_id 
    });
  }
}

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

// Middleware de logging global
bot.use(async (ctx, next) => {
    console.log(`[Bot:Update] Recibida actualización tipo: ${Object.keys(ctx.update).filter(k => k !== 'update_id')[0]}`);
    await next();
});

// Comandos básicos
bot.command('start', async (ctx) => {
    await ctx.reply("¡Hola! Soy SP-Agent avanzado. Ahora tengo visión, búsqueda en internet y memoria total.", { parse_mode: 'HTML' });
});

bot.command('id', adminOnly, async (ctx) => {
  if (ctx.chat.type !== 'private') {
    // Silencio en grupos como pidió el usuario
    return;
  }
  const chatId = ctx.chat.id;
  const threadId = ctx.message?.message_thread_id;
  let msg = `🆔 <b>Tu Chat ID:</b> <code>${chatId}</code>`;
  if (threadId) msg += `\n🧵 <b>Thread ID:</b> <code>${threadId}</code>`;
  await ctx.reply(msg, { parse_mode: 'HTML' });
});

bot.command('clear', adminOnly, async (ctx) => {
  const { clearMemory } = await import('../db/index.js');
  const chatId = ctx.chat.id.toString();
  const threadId = ctx.message?.message_thread_id?.toString();
  await clearMemory(chatId, threadId);
  await notifyAdmin(ctx, `✅ Memoria de este ${threadId ? 'hilo' : 'chat'} borrada.`);
});

bot.command('say', adminOnly, async (ctx) => {
    const input = ctx.match.trim();
    const parts = input.split(/\s+/);
    if (parts.length < 2) return ctx.reply("💡 <b>Uso:</b>\n- <code>/say [chatId] [mensaje]</code>\n- <code>/say [chatId] [threadId] [mensaje]</code>", { parse_mode: 'HTML' });

    const targetChatId = parts[0];
    const authorized = await getAuthorizedGroups();
    if (!authorized.some(g => g.id === targetChatId)) return ctx.reply("❌ Ese grupo no está autorizado.");

    let threadId: number | undefined = undefined;
    let message = "";

    if (!isNaN(parseInt(parts[1])) && parts.length > 2) {
        threadId = parseInt(parts[1]);
        message = parts.slice(2).join(' ');
    } else {
        message = parts.slice(1).join(' ');
    }

    try {
        await ctx.api.sendMessage(targetChatId, message, {
            message_thread_id: threadId,
            parse_mode: 'HTML'
        });
        await ctx.reply("✅ Mensaje enviado.");
    } catch (e: any) {
        await ctx.reply(`❌ Error: ${e.message}`);
    }
});

bot.command('model', adminOnly, async (ctx) => {
  const model = ctx.match || 'gemini-3.1-flash-lite-preview';
  const threadId = ctx.message?.message_thread_id?.toString();
  await setUserModel(ctx.chat.id.toString(), model, threadId);
  await notifyAdmin(ctx, `✅ Modelo cambiado a: <code>${model}</code>`);
});

bot.command('intr', adminOnly, async (ctx) => {
  const input = ctx.match.trim();
  const threadId = ctx.message?.message_thread_id?.toString();
  const chatId = ctx.chat.id.toString();

  if (!input) {
    const current = await getInterventionLevel(chatId, threadId);
    return await notifyAdmin(ctx, `📊 <b>Nivel de intervención actual:</b> <code>${current}%</code>`);
  }

  const level = parseInt(input);
  if (isNaN(level) || level < 0 || level > 100) {
    return await notifyAdmin(ctx, "❌ Por favor, indica un número entre 0 y 100.");
  }

  await setInterventionLevel(chatId, level, threadId);
  await notifyAdmin(ctx, `🎯 <b>Frecuencia de intervención establecida al ${level}%</b> para este hilo.`);
});

bot.command('del', adminOnly, async (ctx) => {
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

/**
 * Comando /edit: Edita un mensaje del bot mediante IA
 */
bot.command('edit', adminOnly, async (ctx) => {
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
        return await notifyAdmin(ctx, "❌ Por favor, proporciona las instrucciones de edición.\nEjemplo: <code>/edit hazlo más breve y quita las etiquetas p</code>");
    }

    const originalText = reply.text || reply.caption || "";
    if (!originalText) {
        return await notifyAdmin(ctx, "❌ El mensaje citado no tiene texto para editar.");
    }

    try {
        // Importación dinámica para evitar ciclos si fuera necesario, aunque loop -> index es común
        const { processEditRequest } = await import('../agent/loop.js');
        
        const threadId = ctx.chat.type === 'private' ? undefined : ctx.message?.message_thread_id?.toString();
        const editedText = await processEditRequest(ctx.chat.id.toString(), originalText, instructions, threadId);

        if (!editedText) {
            return await notifyAdmin(ctx, "⚠️ La IA no generó texto para la edición.");
        }

        await ctx.api.editMessageText(ctx.chat.id, reply.message_id, editedText, {
            parse_mode: 'HTML'
        });

        await notifyAdmin(ctx, `✅ Mensaje editado correctamente.`);
        
        // Limpiar el comando del grupo
        if (ctx.chat.type !== 'private') {
            try { await ctx.deleteMessage(); } catch (e) {}
        }
    } catch (e: any) {
        console.error(`[Edit Command Error]`, e);
        await notifyAdmin(ctx, `❌ Error al editar: ${e.message}`);
    }
});

bot.command('persona', adminOnly, async (ctx) => {
  const input = ctx.match.trim();
  const parts = input.split(/\s+/);
  let targetChatId = ctx.chat.id.toString();
  let instructions = input;
  const currentThreadId = ctx.message?.message_thread_id?.toString();

  // Caso 1: /persona -100... (Solo el ID para ver la personalidad actual)
  if (parts.length === 1 && parts[0].startsWith('-')) {
    targetChatId = parts[0];
    const current = await getPersonality(targetChatId, currentThreadId);
    return await notifyAdmin(ctx, `🎭 <b>Personalidad actual [ID: ${targetChatId}]:</b>\n\n<code>${current || "Por defecto"}</code>`);
  }

  // Caso 2: /persona [ID] [instrucciones]
  if (parts.length > 1 && parts[0].startsWith('-')) {
    targetChatId = parts[0];
    instructions = parts.slice(1).join(' ');
  } 
  // Caso 3: /persona (sin nada, ver personalidad del chat actual)
  else if (!input) {
    const current = await getPersonality(targetChatId, currentThreadId);
    return await notifyAdmin(ctx, `🎭 <b>Tu personalidad en este hilo:</b>\n\n<code>${current || "Por defecto"}</code>`);
  }

  if (instructions.toLowerCase() === 'default') {
    await setPersonality(targetChatId, "", currentThreadId);
    return await notifyAdmin(ctx, `✅ Personalidad restablecida en este hilo.`);
  }

  await setPersonality(targetChatId, instructions, currentThreadId);
  await notifyAdmin(ctx, `✅ Personalidad actualizada para este hilo.`);
});

bot.command('savepersona', adminOnly, async (ctx) => {
  const input = ctx.match.trim();
  const parts = input.split(/\s+/);
  if (parts.length < 2) {
    return await notifyAdmin(ctx, "❌ Uso: <code>/savepersona [nombre] [prompt...]</code>");
  }

  const name = parts[0];
  const prompt = parts.slice(1).join(' ');
  
  await savePersonality(name, prompt);
  await notifyAdmin(ctx, `✅ Personalidad <b>${name}</b> guardada en la biblioteca.`);
});

bot.command('personas', adminOnly, async (ctx) => {
  const input = ctx.match.trim();
  const saved = await getSavedPersonalities();
  
  if (input) {
    const persona = saved.find(p => p.name.toLowerCase() === input.toLowerCase());
    if (persona) {
      return await notifyAdmin(ctx, `📜 <b>Prompt de "${persona.name}":</b>\n\n<code>${persona.content}</code>`);
    }
    return await notifyAdmin(ctx, `❌ No encontré la personalidad "<b>${input}</b>".`);
  }

  if (saved.length === 0) {
    return await notifyAdmin(ctx, "📚 La biblioteca de personalidades está vacía.\nUsa `/savepersona [nombre] [prompt]` para agregar una.");
  }

  let list = "📚 <b>Personalidades Disponibles:</b>\n\n";
  saved.forEach(p => {
    list += `• <b>${p.name}</b>: <i>${p.content.substring(0, 50)}${p.content.length > 50 ? '...' : ''}</i>\n`;
  });
  list += "\n<i>Para ver el prompt completo:</i>\n<code>/personas [nombre]</code>\n\n<i>Para usar una:</i>\n<code>/setpersona [nombre]</code>\n\n<i>Para editar:</i>\nUsa <code>/savepersona</code> con el mismo nombre.";

  await notifyAdmin(ctx, list);
});

bot.command('setpersona', adminOnly, async (ctx) => {
  const name = ctx.match.trim();
  if (!name) {
    return await notifyAdmin(ctx, "❌ Especifica el nombre de la personalidad.\nEj: `/setpersona Tanya` aprovechando la cita o el texto.");
  }

  const saved = await getSavedPersonalities();
  const persona = saved.find(p => p.name.toLowerCase() === name.toLowerCase());

  if (!persona) {
    return await notifyAdmin(ctx, `❌ No encontré la personalidad "<b>${name}</b>" en la biblioteca.`);
  }

  const threadId = ctx.message?.message_thread_id?.toString();
  await setPersonality(ctx.chat.id.toString(), persona.content, threadId);
  
  await notifyAdmin(ctx, `✅ Personalidad cambiada a: <b>${persona.name}</b> en este hilo.`);
});

bot.command('groups', adminOnly, async (ctx) => {
    const authorized = await getAuthorizedGroups();
    if (authorized.length === 0) return await notifyAdmin(ctx, "No hay grupos autorizados.");
    
    let msg = "<b>🏰 Tus Dominios (Grupos e Hilos):</b>\n\n";
    for (const group of authorized) {
        msg += `📁 <b>Grupo:</b> ${group.name} <code>${group.id}</code>\n`;
        const knownThreads = await getKnownThreads(group.id);
        const activeThreads = await getAllowedThreads(group.id);
        const passiveThreads = await getPassiveThreads(group.id);

        // Consolidar IDs únicos de todas las fuentes
        const allThreadIds = [...new Set([
            ...knownThreads.map(t => t.id),
            ...activeThreads,
            ...passiveThreads
        ])].sort((a, b) => a - b);

        for (const threadId of allThreadIds) {
            const known = knownThreads.find(t => t.id === threadId);
            const isMember = activeThreads.includes(threadId);
            const isConsultor = passiveThreads.includes(threadId);
            const role = isMember ? '🎭' : (isConsultor ? '🧐' : '🤖');
            const threadName = known ? known.name : (threadId === 1 ? 'General' : 'Hilo Desconocido');
            
            msg += `  ${role} #${threadId} - <i>${threadName}</i>\n`;
        }
        msg += "\n";
    }
    msg += "<i>Leyenda: 🎭 Miembro | 🧐 Consultor | 🤖 Asistente</i>";
    await notifyAdmin(ctx, msg);
});

// Registrar hilos nuevos o modificados
bot.on('message:forum_topic_created', async (ctx) => {
    const name = ctx.message.forum_topic_created.name;
    const threadId = ctx.message.message_thread_id;
    if (threadId) await setThreadName(ctx.chat.id.toString(), threadId, name);
});

bot.on('message:forum_topic_edited', async (ctx) => {
    const name = ctx.message.forum_topic_edited.name;
    const threadId = ctx.message.message_thread_id;
    if (threadId && name) await setThreadName(ctx.chat.id.toString(), threadId, name);
});

/**
 * Gestión de Grupos Autorizados (Whitelisting)
 */
bot.command('allowgroup', adminOnly, async (ctx) => {
  const chatId = ctx.match.trim() || ctx.chat.id.toString();
  let name = 'Grupo';
  try {
      if (ctx.match.trim() && ctx.match.trim() !== ctx.chat.id.toString()) {
          const chat = await ctx.api.getChat(chatId);
          name = (chat as any).title || (chat as any).first_name || 'Grupo';
      } else {
          name = (ctx.chat as any).title || (ctx.chat as any).first_name || 'Grupo';
      }
  } catch (e) {}

  await authorizeGroup(chatId, name);
  await notifyAdmin(ctx, `✅ Grupo <b>${name}</b> (<code>${chatId}</code>) autorizado.`);
});

bot.command('revokegroup', adminOnly, async (ctx) => {
  const chatId = ctx.match.trim() || ctx.chat.id.toString();
  await revokeGroup(chatId);
  await notifyAdmin(ctx, `❌ Grupo <code>${chatId}</code> revocado.`);
});

/**
 * Gestión de Topics (Hilos de Foro)
 */
bot.command('features', adminOnly, async (ctx) => {
    const input = ctx.match.trim();
    const parts = input.split(/\s+/);
    let targetChatId = ctx.chat.id.toString();
    let actionParts = parts;

    if (parts[0].startsWith('-')) {
        targetChatId = parts[0];
        actionParts = parts.slice(1);
    }

    const current = await getChatFeatures(targetChatId);

    if (actionParts.length === 0) {
        return await notifyAdmin(ctx, `🧩 <b>Módulos de conocimiento en <code>${targetChatId}</code>:</b>\n\n` +
            `• 📚 <code>library</code>: ${current.includes('library') ? '✅ Activo' : '❌ Inactivo'}\n` +
            `• 🏭 <code>dev_prod</code> (Main): ${current.includes('dev_prod') ? '✅ Activo' : '❌ Inactivo'}\n` +
            `• 🧪 <code>dev_test</code> (V4): ${current.includes('dev_test') ? '✅ Activo' : '❌ Inactivo'}\n\n` +
            `<i>Para activar/desactivar uno, escribe:</i>\n<code>/features ${targetChatId.startsWith('-') ? targetChatId + ' ' : ''}[modulo]</code>`);
    }

    const feature = actionParts[0].toLowerCase();
    const valid = ['library', 'dev_prod', 'dev_test'];

    if (!valid.includes(feature)) {
        return await notifyAdmin(ctx, `❌ Módulo no válido. Opciones: <code>${valid.join(', ')}</code>`);
    }

    let newList: string[];
    if (current.includes(feature)) {
        newList = current.filter(f => f !== feature);
        await setChatFeatures(targetChatId, newList);
        await notifyAdmin(ctx, `❌ Módulo <code>${feature}</code> desactivado para <code>${targetChatId}</code>.`);
    } else {
        newList = [...current, feature];
        await setChatFeatures(targetChatId, newList);
        await notifyAdmin(ctx, `✅ Módulo <code>${feature}</code> activado para <code>${targetChatId}</code>.`);
    }
});

/**
 * Gestión de Topics (Hilos de Foro)
 */
bot.command('topics', adminOnly, async (ctx) => {
  const input = ctx.match.trim();
  const parts = input.split(/\s+/);
  
  let targetChatId = ctx.chat.id.toString();
  let action = "";
  let targetThreadId: number | undefined = ctx.message?.message_thread_id;

  if (parts[0].startsWith('-')) {
    targetChatId = parts[0];
    if (parts.length === 2) {
      action = parts[1].toLowerCase();
      targetThreadId = 1; // General por defecto si se da group_id
    } else if (parts.length >= 3) {
      targetThreadId = parseInt(parts[1]);
      action = parts[2].toLowerCase();
    }
  } else {
    action = parts[0].toLowerCase();
  }

  if (!action) {
     return await notifyAdmin(ctx, "💡 <b>Uso:</b>\n- En el grupo: <code>/topics miembro/consultor/asistente</code>\n- En privado: <code>/topics [group_id] [thread_id] [rol]</code>");
  }

  let active = await getAllowedThreads(targetChatId);
  let consultor = await getPassiveThreads(targetChatId);

  const finalThreadId = targetThreadId !== undefined ? targetThreadId : 1;
  const label = `en <code>${targetChatId}</code> (Hilo ${finalThreadId === 1 && targetThreadId === undefined ? 'General' : '#' + finalThreadId})`;

  if (action === 'miembro') {
    active.push(finalThreadId);
    active = [...new Set(active)];
    consultor = consultor.filter((id: number) => id !== finalThreadId);
    await setAllowedThreads(targetChatId, active);
    await setPassiveThreads(targetChatId, consultor);
    await notifyAdmin(ctx, `🎭 <b>Modo MIEMBRO</b> configurado ${label}.`);
  } 
  else if (action === 'consultor') {
    consultor.push(finalThreadId);
    consultor = [...new Set(consultor)];
    active = active.filter((id: number) => id !== finalThreadId);
    await setAllowedThreads(targetChatId, active);
    await setPassiveThreads(targetChatId, consultor);
    await notifyAdmin(ctx, `🧐 <b>Modo CONSULTOR</b> configurado ${label}.`);
  }
  else if (action === 'asistente' || action === 'disable') {
    active = active.filter((id: number) => id !== finalThreadId);
    consultor = consultor.filter((id: number) => id !== finalThreadId);
    await setAllowedThreads(targetChatId, active);
    await setPassiveThreads(targetChatId, consultor);
    const msg = action === 'disable' ? `❌ <b>Deshabilitado</b>` : `🤖 <b>Modo ASISTENTE</b>`;
    await notifyAdmin(ctx, `${msg} ${label}.`);
  }
  else if (action === 'all') {
    await setAllowedThreads(targetChatId, []);
    await setPassiveThreads(targetChatId, []);
    await notifyAdmin(ctx, `🌐 <b>Modo GLOBAL</b> configurado para <code>${targetChatId}</code>.`);
  }
  else {
    await notifyAdmin(ctx, "❌ Acción no reconocida. Usa: miembro, consultor, asistente, disable o all.");
  }
});

/**
 * Función central de procesamiento de mensajes (Texto y Multimedia)
 */
const handleIncomingMessage = async (ctx: Context) => {
  const chatId = ctx.chat?.id.toString();
  if (!chatId) return;

  console.log(`[Bot] 🕵️ Mensaje recibido en el chat ${chatId}. Tipo: ${ctx.chat?.type}`);
  
  let text = ctx.message?.text || ctx.message?.caption || "";
  const isGroup = ctx.chat?.type === 'group' || ctx.chat?.type === 'supergroup';
  const threadIdInt = ctx.message?.message_thread_id;
  const threadId = threadIdInt?.toString();
  const isPrivate = ctx.chat?.type === 'private';

  let botUsername = ctx.me?.username;
  if (!botUsername) {
      console.log("[Bot] 🔄 ctx.me no disponible, obteniendo via API...");
      const me = await ctx.api.getMe();
      botUsername = me.username;
  }
  
  const isReplyToBot = ctx.message?.reply_to_message?.from?.username === botUsername;
  const fromUsername = ctx.from?.username || ctx.from?.id || "Desconocido";
  const userId = ctx.from?.id.toString();
  const isAdmin = userId && config.telegramAllowedUserIds.includes(userId);
  const senderRole = isAdmin ? "[ADMIN]" : "[USER]";
  const senderName = `${ctx.from?.first_name || "Usuario"} ${senderRole}`;
  
  // Capturar texto del mensaje citado para dar contexto (Importante para hilos pasivos)
  let quoteContext = "";
  if (ctx.message?.reply_to_message) {
      const qUserId = ctx.message.reply_to_message.from?.id.toString();
      const qIsAdmin = qUserId && config.telegramAllowedUserIds.includes(qUserId);
      const qRole = qIsAdmin ? "[ADMIN]" : "[USER]";
      const quoteSender = `${ctx.message.reply_to_message.from?.first_name || "Alguien"} ${qRole}`;
      const quoteText = ctx.message.reply_to_message.text || ctx.message.reply_to_message.caption || "";
      if (quoteText) {
          quoteContext = `\n[CITADO DE ${quoteSender}]: ${quoteText}`;
      }
  }

  console.log(`[Bot] 📥 [${ctx.chat?.type}] De @${fromUsername}: "${text.substring(0, 30)}..."`);

  // LÓGICA DE DECISIÓN BASE
  let isMentioned = isPrivate; 
  let isActiveThread = isPrivate;
  let isPassiveThread = false;
  let isAllMode = isPrivate;
  let isNoneMode = false;

  // 1. Verificación de Seguridad para Grupos
  if (isGroup) {
      const authorized = await getAuthorizedGroups();
      if (!authorized.some(g => g.id === chatId)) {
          console.warn(`[Bot] 🛑 Chat ${chatId} NO autorizado. Saliendo...`);
          try { await ctx.leaveChat(); } catch (e) {}
          return;
      }

      // 2. Obtener configuraciones de hilos
      const allowedThreads = await getAllowedThreads(chatId);
      const passiveThreads = await getPassiveThreads(chatId);
      
      const currentThread = threadIdInt !== undefined ? threadIdInt : 1;
      isActiveThread = allowedThreads.includes(currentThread);
      isPassiveThread = passiveThreads.includes(currentThread);
      isAllMode = allowedThreads.length === 0 && passiveThreads.length === 0;
      isNoneMode = allowedThreads.includes(-1);

      // 3. Verificar mención/cita (Permisivo con límites de palabra)
      const mentionRegex = new RegExp(`@${botUsername}\\b`, 'i');
      isMentioned = mentionRegex.test(text);
  }

  // --- AUTO-CONVERSIÓN FXTWITTER (Global) ---
  if (text.includes('x.com') || text.includes('twitter.com')) {
      const shouldConvert = isPrivate || isReplyToBot || isMentioned;
      
      if (shouldConvert) {
          const fxText = text
              .replace(/(https?:\/\/)(www\.)?x\.com/g, '$1fxtwitter.com')
              .replace(/(https?:\/\/)(www\.)?twitter\.com/g, '$1fxtwitter.com');
          
          if (fxText !== text) {
              console.log("[Bot] 🔄 Convirtiendo link de Twitter...");
              const senderName = ctx.from?.first_name || "Usuario";
              const senderLink = `<a href="tg://user?id=${ctx.from?.id}">${senderName}</a>`;
              const finalMsg = `<b>${senderLink}</b>:\n\n${fxText}`;

              await ctx.reply(finalMsg, { 
                  parse_mode: 'HTML',
                  message_thread_id: threadIdInt
              });

              try {
                  await ctx.deleteMessage();
              } catch (e) {
                  console.warn("[Bot] No se pudo borrar el mensaje original");
              }
              
              // Verificamos si SOLO hay un link después de quitar la mención
              const cleanText = text.replace(new RegExp(`@${botUsername}\\b`, 'gi'), '').trim();
              const isUrlOnly = cleanText.match(/^https?:\/\/[^\s]+$/);
              
              if (isUrlOnly) {
                  console.log("[Bot] 🤐 Link convertido y sin texto adicional. Silenciando IA.");
                  return; 
              }
              console.log("[Bot] 🗣️ El mensaje contiene texto adicional. Procesando con IA...");
          }
      }
  }

  // LÓGICA DE FILTRADO (Evitar procesar risas, agradecimientos cortos o mensajes vacíos)
  const isTrivial = text.length < 15 && /^(jaj|jej|lol|xd|buu|bu|ah|ok|sip|no|si|pos|pos no|jeje|jajaja|buuu|buuuuu|buuuuuuu|jajajaj|😂|🤣|👍|🫡|🤔|🙄|a|gracias|gracia|ty|thx|visto|okey|okay|vale|entendido|perfecto|listo|nwn|uwu|owo)(jaj|jej|lol|xd|!|\.|\?|u|a|e|k|\s|s)*$/i.test(text.trim());

  // LÓGICA DE DECISIÓN FINAL PARA IA
  if (isGroup) {
      const substantiveReply = isReplyToBot && !isTrivial;
      
      const interventionLevel = await getInterventionLevel(chatId, threadId);
      const randomDice = Math.random() * 100;

      // MIEMBRO: Participación activa (isActiveThread). 
      // Si NO hay mención ni respuesta, aplicamos el "dado" de intervención.
      const isRandomIntervention = isActiveThread && !isTrivial && (randomDice <= interventionLevel);
      
      const shouldRespond = isMentioned || isReplyToBot || (isPassiveThread ? substantiveReply : isRandomIntervention);
      
      const shouldSaveMemory = shouldRespond || isPassiveThread || isAllMode;

      if (!shouldRespond) {
          if (shouldSaveMemory && !isNoneMode) {
              const contentToSave = isGroup ? `${senderName}: ${text}${quoteContext}` : `${text}${quoteContext}`;
              console.log(`[Bot] 🤐 Guardando contexto en memoria (Hilo ${isPassiveThread ? 'Pasivo' : 'Global'}): ${senderName}`);
              await addMemory(chatId, 'user', contentToSave, threadId, ctx.message?.message_id);
          }
          return;
      }

      console.log(`[Bot] Decision (Chat: ${chatId}): Action=RESPOND (Mention=${isMentioned}, Msg=${text.substring(0, 15)}...)`);
  }

  console.log(`[Bot] 🎯 Respondiendo (Mención: ${isMentioned}, Reply: ${isReplyToBot}, Hilo Activo: ${isGroup ? (isActiveThread ? 'Sí' : 'No') : 'Privado'})`);

    // 4. Responder
    console.log(`[Bot] 🧠 Iniciando procesamiento para el chat: ${chatId}`);
    await ctx.replyWithChatAction('typing');
  try {
    // EL TEXTO Y EL QUOTE CONTEXT YA FUERON CAPTURADOS ARRIBA

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

    const formattedText = `${text}${quoteContext}`;
    
    // Identificar si la cita es hacia el bot
    const quotedMsgId = ctx.message?.reply_to_message?.message_id;
    const qIsAssistant = isReplyToBot;

    const isAdmin = config.telegramAllowedUserIds.includes(ctx.from?.id?.toString() || "");
    const finalSenderName = senderName;

    const { text: responseText, photoUrl } = await processUserMessage(
        chatId, 
        formattedText, 
        threadId, 
        attachments, 
        ctx.message?.message_id,
        quotedMsgId,
        qIsAssistant,
        finalSenderName,
        isAdmin
    );
    
    // PROTECCIÓN: Truncado de seguridad para límites de Telegram (4096)
    let safeResponse = responseText;
    if (safeResponse.length > 4000) {
      console.log(`[Bot] ⚠️ Mensaje demasiado largo (${safeResponse.length}). Truncando...`);
      safeResponse = safeResponse.substring(0, 3900) + "... (mensaje truncado por longitud)";
    }

    if (safeResponse || photoUrl) {
      if (photoUrl) {
          try {
              console.log(`[Bot:Send] 📤 Enviando foto al chat ${chatId}`);
              const sent = await ctx.replyWithPhoto(photoUrl, {
                  caption: safeResponse,
                  parse_mode: 'HTML',
                  message_thread_id: threadIdInt
              });
              await addMemory(chatId, 'assistant', safeResponse, threadId, sent.message_id);
              return;
          } catch (err) {
              console.error("[Bot] Error enviando foto, enviando solo texto.", err);
          }
      }
      
      console.log(`[Bot:Send] 📤 Enviando texto al chat ${chatId} (${safeResponse.length} chars)`);
      const sent = await ctx.reply(safeResponse, { 
        parse_mode: 'HTML',
        message_thread_id: threadIdInt 
      });
      await addMemory(chatId, 'assistant', safeResponse, threadId, sent.message_id);
    }
  } catch (error: any) {
    console.error(`[Bot Error]`, error);
    await ctx.reply(`⚠️ <b>Ha ocurrido un error inesperado.</b> Inténtalo de nuevo más tarde.`, { 
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
  const e = err.error;
  console.error(`[Bot Error] Error en update ${ctx?.update?.update_id}:`, e);
  
  if (e instanceof GrammyError) {
      console.error("[Bot Error] Error de Telegram:", e.description);
  } else if (e instanceof HttpError) {
      console.error("[Bot Error] Error de red (HttpError)");
  }
});

bot.on('my_chat_member', async (ctx) => {
  if (ctx.myChatMember.new_chat_member.status === 'member') {
    const authorized = await getAuthorizedGroups();
    const chatId = ctx.chat.id.toString();
    
    if (!authorized.some(g => g.id === chatId)) {
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

setBotCommands();
bot.start({
    onStart: (me) => console.log(`[Telegram] Bot iniciado como @${me.username}`)
});
