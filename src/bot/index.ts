import { Bot, Context, NextFunction } from 'grammy';
import { config } from '../config.js';
import { processUserMessage, Attachment } from '../agent/loop.js';
import { addMemory } from '../db/index.js';
import { getAllowedThreads, setAllowedThreads, setUserModel, getAuthorizedGroups, authorizeGroup, revokeGroup, setPersonality } from '../db/settings.js';

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
  let allowed = await getAllowedThreads(chatId);

    if (action === 'enable') {
      // En los hilos "General", el threadId suele ser undefined o 1. Lo normalizamos a 1.
      const idToEnable = threadId !== undefined ? threadId : 1;
      if (!allowed.includes(idToEnable)) {
        allowed.push(idToEnable);
        await setAllowedThreads(chatId, allowed);
      }
      const label = idToEnable === 1 && threadId === undefined ? 'General' : `#${idToEnable}`;
      await ctx.reply(`✅ Hilo <b>${label}</b> habilitado.`, { parse_mode: 'HTML' });
    } 
    else if (action === 'disable') {
      const idToDisable = threadId !== undefined ? threadId : 1;
      allowed = allowed.filter(id => id !== idToDisable);
      await setAllowedThreads(chatId, allowed);
      await ctx.reply(`❌ Hilo deshabilitado para el bot.`, { parse_mode: 'HTML' });
    }
// ... (omitiendo el resto para el replace_file_content)
  else if (action === 'all') {
    await setAllowedThreads(chatId, []);
    await ctx.reply(`🌐 Escuchando en todos los hilos del grupo.`, { parse_mode: 'Markdown' });
  }
  else if (action === 'none') {
    await setAllowedThreads(chatId, [-1]);
    await ctx.reply(`🔇 No escuchando en ningún hilo por defecto (modo silencioso).`, { parse_mode: 'Markdown' });
  }
  else {
    await ctx.reply("Uso: `/topics enable`, `/topics disable`, `/topics all` o `/topics none`.", { parse_mode: 'Markdown' });
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
        console.log(`[Bot] Grupos autorizados actuales: ${JSON.stringify(authorized)}`);
        
        if (!authorized.includes(chatId)) {
            console.warn(`[Bot] Grupo ${chatId} NO autorizado.`);
            await ctx.reply("⛔ Este grupo no está autorizado para usar SP-Agent. Contacta con mi dueño.");
            await ctx.leaveChat();
            return;
        }

        // 2. Filtrar por Forum Topics (Threads)
        const allowedThreads = await getAllowedThreads(chatId);
        const isNoneMode = allowedThreads.length === 1 && allowedThreads[0] === -1;
        
        // 3. Verificar mención/cita
        const text = ctx.message?.text || ctx.message?.caption || "";
        const isMentioned = text.includes(`@${ctx.me.username}`);
        const isReplyToBot = ctx.message?.reply_to_message?.from?.id === ctx.me.id;

        const currentThread = threadIdInt !== undefined ? threadIdInt : 1;
        const isThreadExplicitlyAllowed = allowedThreads.includes(currentThread);
        const isAllMode = allowedThreads.length === 0;

        if (!isMentioned && !isReplyToBot && !isThreadExplicitlyAllowed) {
            // Si no hay mención ni es un hilo explícitamente habilitado, solo guardamos en memoria
            if (isNoneMode) return; 
            const senderName = ctx.from?.first_name || "Usuario";
            console.log(`[Bot] 🤐 Silencio en grupo: Mensaje de ${senderName} guardado en memoria.`);
            
            if (isAllMode || isThreadExplicitlyAllowed) {
                 await addMemory(chatId, 'user', `${senderName}: ${text}`, threadId);
            } else if (allowedThreads.length > 0 && !isThreadExplicitlyAllowed) {
                // No habilitado y no en modo "todos", ignoramos completamente
            } else {
                 await addMemory(chatId, 'user', `${senderName}: ${text}`, threadId);
            }
            return;
        } else {
            console.log(`[Bot] 🎯 Respondiendo en grupo (Mención: ${isMentioned}, Reply: ${isReplyToBot}, Hilo Habilitado: ${isThreadExplicitlyAllowed})`);
        }
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
