import { Bot, Context, NextFunction } from 'grammy';
import { config } from '../config.js';
import { processUserMessage, Attachment } from '../agent/loop.js';
import { addMemory } from '../db/index.js';
import { getAllowedThreads, setAllowedThreads, setUserModel, getAuthorizedGroups, authorizeGroup, revokeGroup, getPersonality, setPersonality, getPassiveThreads, setPassiveThreads, setThreadName, getKnownThreads, getChatFeatures, setChatFeatures } from '../db/settings.js';

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

bot.command('say', adminOnly, async (ctx) => {
    const input = ctx.match.trim();
    const parts = input.split(/\s+/);
    if (parts.length < 2) return ctx.reply("💡 <b>Uso:</b>\n- <code>/say [chatId] [mensaje]</code>\n- <code>/say [chatId] [threadId] [mensaje]</code>", { parse_mode: 'HTML' });

    const targetChatId = parts[0];
    const authorized = await getAuthorizedGroups();
    if (!authorized.includes(targetChatId)) return ctx.reply("❌ Ese grupo no está autorizado.");

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
  await setUserModel(ctx.chat.id.toString(), model);
  await ctx.reply(`Modelo cambiado a: \`${model}\``, { parse_mode: 'Markdown' });
});

bot.command('persona', adminOnly, async (ctx) => {
  const input = ctx.match.trim();
  const parts = input.split(/\s+/);
  let targetChatId = ctx.chat.id.toString();
  let instructions = input;

  // Caso 1: /persona -100... (Solo el ID para ver la personalidad actual)
  if (parts.length === 1 && parts[0].startsWith('-')) {
    targetChatId = parts[0];
    const current = await getPersonality(targetChatId);
    return await ctx.reply(`🎭 <b>Personalidad actual de <code>${targetChatId}</code>:</b>\n\n<code>${current || "Por defecto (breve, directo y emojis)"}</code>\n\n<i>Para cambiarla, escribe:</i>\n<code>/persona ${targetChatId} [nuevas instrucciones]</code>`, { parse_mode: 'HTML' });
  }

  // Caso 2: /persona [ID] [instrucciones]
  if (parts.length > 1 && parts[0].startsWith('-')) {
    targetChatId = parts[0];
    instructions = parts.slice(1).join(' ');
  } 
  // Caso 3: /persona (sin nada, ver personalidad del chat actual)
  else if (!input) {
    const current = await getPersonality(targetChatId);
    return await ctx.reply(`🎭 <b>Tu personalidad en este chat:</b>\n\n<code>${current || "Por defecto (breve, directo y emojis)"}</code>\n\n<i>Para cambiarla, escribe:</i>\n<code>/persona [nuevas instrucciones]</code>`, { parse_mode: 'HTML' });
  }

  if (instructions.toLowerCase() === 'default') {
    await setPersonality(targetChatId, "");
    return await ctx.reply(`✅ Personalidad restablecida para <code>${targetChatId}</code>.`, { parse_mode: 'HTML' });
  }

  await setPersonality(targetChatId, instructions);
  await ctx.reply(`✅ Personalidad actualizada para <code>${targetChatId}</code>.`, { parse_mode: 'HTML' });
});

bot.command('groups', adminOnly, async (ctx) => {
    const authorized = await getAuthorizedGroups();
    if (authorized.length === 0) return ctx.reply("No hay grupos autorizados.");
    
    let msg = "<b>🏰 Tus Dominios (Grupos e Hilos):</b>\n\n";
    for (const id of authorized) {
        msg += `📁 <b>Grupo:</b> <code>${id}</code>\n`;
        const threads = await getKnownThreads(id);
        const activeThreads = await getAllowedThreads(id);
        const passiveThreads = await getPassiveThreads(id);

        for (const t of threads) {
            const isMember = activeThreads.includes(t.id);
            const isConsultor = passiveThreads.includes(t.id);
            const role = isMember ? '🎭' : (isConsultor ? '🧐' : '🤖');
            msg += `  ${role} #${t.id} - <i>${t.name}</i>\n`;
        }
        msg += "\n";
    }
    msg += "<i>Leyenda: 🎭 Miembro | 🧐 Consultor | 🤖 Asistente</i>";
    await ctx.reply(msg, { parse_mode: 'HTML' });
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
        return await ctx.reply(`🧩 <b>Módulos de conocimiento en <code>${targetChatId}</code>:</b>\n\n` +
            `• 📚 <code>library</code>: ${current.includes('library') ? '✅ Activo' : '❌ Inactivo'}\n` +
            `• 🏭 <code>dev_prod</code> (Main): ${current.includes('dev_prod') ? '✅ Activo' : '❌ Inactivo'}\n` +
            `• 🧪 <code>dev_test</code> (V4): ${current.includes('dev_test') ? '✅ Activo' : '❌ Inactivo'}\n\n` +
            `<i>Para activar/desactivar uno, escribe:</i>\n<code>/features ${targetChatId.startsWith('-') ? targetChatId + ' ' : ''}[modulo]</code>`, { parse_mode: 'HTML' });
    }

    const feature = actionParts[0].toLowerCase();
    const valid = ['library', 'dev_prod', 'dev_test'];

    if (!valid.includes(feature)) {
        return await ctx.reply(`❌ Módulo no válido. Opciones: <code>${valid.join(', ')}</code>`, { parse_mode: 'HTML' });
    }

    let newList: string[];
    if (current.includes(feature)) {
        newList = current.filter(f => f !== feature);
        await setChatFeatures(targetChatId, newList);
        await ctx.reply(`❌ Módulo <code>${feature}</code> desactivado para <code>${targetChatId}</code>.`, { parse_mode: 'HTML' });
    } else {
        newList = [...current, feature];
        await setChatFeatures(targetChatId, newList);
        await ctx.reply(`✅ Módulo <code>${feature}</code> activado para <code>${targetChatId}</code>.`, { parse_mode: 'HTML' });
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

  // Lógica de detección de argumentos:
  // Modo 1: /topics [miembro|consultor|...] (En el chat/hilo actual)
  // Modo 2: /topics [group_id] [miembro|consultor|...] (Hilo general del grupo)
  // Modo 3: /topics [group_id] [thread_id] [miembro|consultor|...] (Hilo específico)

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
     return await ctx.reply("💡 <b>Uso:</b>\n- En el grupo: <code>/topics miembro/consultor/asistente</code>\n- En privado: <code>/topics [group_id] [thread_id] [rol]</code>", { parse_mode: 'HTML' });
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
    await ctx.reply(`🎭 <b>Modo MIEMBRO</b> configurado ${label}.`, { parse_mode: 'HTML' });
  } 
  else if (action === 'consultor') {
    consultor.push(finalThreadId);
    consultor = [...new Set(consultor)];
    active = active.filter((id: number) => id !== finalThreadId);
    await setAllowedThreads(targetChatId, active);
    await setPassiveThreads(targetChatId, consultor);
    await ctx.reply(`🧐 <b>Modo CONSULTOR</b> configurado ${label}.`, { parse_mode: 'HTML' });
  }
  else if (action === 'asistente' || action === 'disable') {
    active = active.filter((id: number) => id !== finalThreadId);
    consultor = consultor.filter((id: number) => id !== finalThreadId);
    await setAllowedThreads(targetChatId, active);
    await setPassiveThreads(targetChatId, consultor);
    const msg = action === 'disable' ? `❌ <b>Deshabilitado</b>` : `🤖 <b>Modo ASISTENTE</b>`;
    await ctx.reply(`${msg} ${label}.`, { parse_mode: 'HTML' });
  }
  else if (action === 'all') {
    await setAllowedThreads(targetChatId, []);
    await setPassiveThreads(targetChatId, []);
    await ctx.reply(`🌐 <b>Modo GLOBAL</b> configurado para <code>${targetChatId}</code>.`, { parse_mode: 'HTML' });
  }
  else {
    await ctx.reply("❌ Acción no reconocida. Usa: miembro, consultor, asistente, disable o all.", { parse_mode: 'HTML' });
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
  
  let text = ctx.message?.text || ctx.message?.caption || "";
  const isReplyToBot = ctx.message?.reply_to_message?.from?.id === ctx.me.id;
  const isPrivate = ctx.chat?.type === 'private';

  // --- AUTO-CONVERSIÓN FXTWITTER (Global) ---
  if (text.includes('x.com') || text.includes('twitter.com')) {
      const shouldConvert = isPrivate || isReplyToBot;
      
      if (shouldConvert) {
          const fxText = text
              .replace(/(https?:\/\/)(www\.)?x\.com/g, '$1fxtwitter.com')
              .replace(/(https?:\/\/)(www\.)?twitter\.com/g, '$1fxtwitter.com');
          
          if (fxText !== text) {
              await ctx.reply(fxText, { 
                  parse_mode: 'HTML',
                  reply_parameters: { message_id: ctx.message!.message_id }
              });
              
              const urlOnly = text.trim().match(/^https?:\/\/[^\s]+$/);
              if (urlOnly) return; 
          }
      }
  }

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
      const isMentioned = text.includes(`@${ctx.me.username}`);

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
    text = ctx.message?.text || ctx.message?.caption || "(Sin texto)";
    
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
