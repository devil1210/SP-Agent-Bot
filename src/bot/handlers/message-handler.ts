import { Bot, Context } from 'grammy';
import { addMemory, getUserPreferences, incrementTwitterFixCount, setTwitterAutoFix, purgeExpiredContext } from '../../db/index.js';
import { getAllowedThreads, getPassiveThreads, getPersonality, getInterventionLevel } from '../../db/settings.js';
import { processUserMessage } from '../../agent/loop.js';
import { isAdmin, updateBotTag, notifyAdmin } from '../helpers.js';

/**
 * Configura el manejador central de mensajes para el bot
 */
export function setupMessageHandler(bot: Bot) {
  bot.on(['message:text', 'message:caption'], handleIncomingMessage);
  bot.on('edited_message', handleIncomingMessage);
}

/**
 * Procesador central de mensajes (800+ líneas extraídas)
 * Maneja: decisión de respuesta, filtrado, conversión Twitter, etc.
 */
async function handleIncomingMessage(ctx: Context) {
  const chatId = ctx.chat?.id.toString();
  if (!chatId) return;
  // Purga eliminada: No se borran datos de la base de datos.

  // Actualizar etiqueta si estamos en un grupo
  if (ctx.chat?.type === 'group' || ctx.chat?.type === 'supergroup') {
    await updateBotTag(ctx, chatId, ctx.message?.message_thread_id?.toString());
  }

  console.log(`[Bot] 🕵️ Mensaje recibido en el chat ${chatId}.`);
  
  const text = ctx.message?.text || ctx.message?.caption || "";
  const isGroup = ctx.chat?.type === 'group' || ctx.chat?.type === 'supergroup';
  const threadIdInt = ctx.message?.message_thread_id;
  const threadId = threadIdInt?.toString();
  const isPrivate = ctx.chat?.type === 'private';
  const userId = ctx.from?.id.toString();
  
  if (!userId) {
    console.warn("[Bot] ⚠️ No se pudo determinar ID del usuario.");
    return;
  }

  // Obtener configuración del bot
  let botUsername = ctx.me?.username;
  if (!botUsername) {
    const me = await ctx.api.getMe();
    botUsername = me.username;
  }

  // Verificar si es respuesta al bot
  let isReplyToBot = ctx.message?.reply_to_message?.from?.username === botUsername;
  
  // Verificar admin
  const isSAdmin = await isAdmin(userId);
  const senderName = `${ctx.from?.first_name || "Usuario"} (ID: ${userId})`;

  console.log(`[Bot] 📥 De ${senderName}: "${text.substring(0, 30)}..."`);

  // LÓGICA DE DECISIÓN BASE
  let isMentioned = isPrivate; 
  let isActiveThread = isPrivate;
  let isPassiveThread = false;
  let isAllMode = isPrivate;

  // Verificaciones por grupo
  if (isGroup) {
    const { getAuthorizedGroups } = await import('../../db/settings.js');
    const authorized = await getAuthorizedGroups();
    if (!authorized.some(g => g.id === chatId)) {
      console.warn(`[Bot] 🛑 Chat no autorizado.`);
      try { await ctx.leaveChat(); } catch (e) {}
      return;
    }

    const allowedThreads = await getAllowedThreads(chatId);
    const passiveThreads = await getPassiveThreads(chatId);
    
    const currentThread = threadIdInt !== undefined ? threadIdInt : 1;
    isActiveThread = allowedThreads.includes(currentThread);
    isPassiveThread = passiveThreads.includes(currentThread);
    isAllMode = allowedThreads.length === 0 && passiveThreads.length === 0;

    // Verificar mención
    const mentionRegex = new RegExp(`@${botUsername}\\b`, 'i');
    isMentioned = mentionRegex.test(text);

    // Filtro fxtwitter
    if (isReplyToBot && ctx.message?.reply_to_message?.text?.includes('fxtwitter.com')) {
      isReplyToBot = false;
    }
  }

  // AUTO-CONVERSIÓN TWITTER
  if (text.includes('x.com') || text.includes('twitter.com')) {
    const prefs = await getUserPreferences(userId);
    const isAutoFixEnabled = prefs.twitter_auto_fix;
    const shouldConvert = isPrivate || isReplyToBot || isMentioned || isAutoFixEnabled;
    
    if (shouldConvert) {
      const mentionRegex = new RegExp(`@${botUsername}\\s*`, 'gi');
      const fxText = text
        .replace(mentionRegex, '')
        .replace(/(https?:\/\/)(www\.)?x\.com/g, '$1fxtwitter.com')
        .replace(/(https?:\/\/)(www\.)?twitter\.com/g, '$1fxtwitter.com')
        .trim();
      
      if (fxText !== text.trim() && fxText !== '') {
        console.log(`[Bot] 🔄 Convirtiendo link de Twitter...`);
        const senderLink = `<a href="tg://user?id=${ctx.from?.id}">${ctx.from?.first_name || "Usuario"}</a>`;
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

        if (!isAutoFixEnabled && (isReplyToBot || isMentioned)) {
          const count = await incrementTwitterFixCount(userId);
          if (count === 3) {
            await ctx.reply(`💡 ¿Quieres que corrija tus enlaces de Twitter automáticamente?`, { 
              parse_mode: 'HTML',
              message_thread_id: threadIdInt
            });
          }
        }

        const cleanText = text.replace(new RegExp(`@${botUsername}\\b`, 'gi'), '').trim();
        const isUrlOnly = cleanText.match(/^https?:\/\/[^\s]+$/);
        
        if (isUrlOnly) {
          console.log("[Bot] 🤐Link solo, sin texto adicional.");
          return; 
        }
      }
    }
  }

  // FILTRADO DE TRIVIALIDADES
  const isTrivial = text.length < 15 && /^(jaj|jej|lol|xd|ok|si|no|gracias|thanks)(.*)?$/i.test(text.trim());

  // DECISIÓN FINAL PARA IA
  if (isGroup) {
    const substantiveReply = isReplyToBot && !isTrivial;
    const interventionLevel = await getInterventionLevel(chatId, threadId);
    const randomDice = Math.random() * 100;
    const isRandomIntervention = isActiveThread && !isTrivial && (randomDice <= interventionLevel);
    
    // En modo consultor, responde si es mención directa O es reply directo.
    // Trivialidad se ignora en menciones directas (siempre responde), 
    // pero se respeta en replies directos (si no es trivial).
    const shouldRespond = isMentioned || (isReplyToBot && (isPassiveThread ? !isTrivial : true)) || (!isPassiveThread && isRandomIntervention);
    const shouldSaveMemory = shouldRespond || isPassiveThread || isAllMode;

    if (!shouldRespond) {
      if (shouldSaveMemory) {
        const contentToSave = isGroup ? `${senderName}: ${text}` : text;
        console.log(`[Bot] 🤐 Guardando en memoria...`);
        await addMemory(chatId, 'user', contentToSave, threadId, ctx.message?.message_id, undefined, false, 'general');
      }
      return;
    }

    console.log(`[Bot] 🤖 Procesando con IA...`);
  } else if (!isMentioned && !isReplyToBot) {
    return; // No responder en privado sin mención/reply
  }

  // PROCESAR CON IA
  try {
    const response = await processUserMessage(
      chatId,
      userId,
      text,
      threadId,
      [],
      ctx.message?.message_id,
      ctx.message?.reply_to_message?.message_id,
      ctx.message?.reply_to_message?.from?.is_bot,
      senderName,
      isSAdmin
    );

    if (response.text.trim()) {
      if (response.photoUrl) {
        await ctx.replyWithPhoto(response.photoUrl, {
          caption: response.text,
          parse_mode: 'HTML',
          message_thread_id: threadIdInt
        });
      } else {
        await ctx.reply(response.text, {
          parse_mode: 'HTML',
          message_thread_id: threadIdInt
        });
      }
    }
  } catch (e: any) {
    console.error(`[Bot] Error procesando mensaje:`, e);
    await ctx.reply(`❌ Error procesando tu mensaje: ${e.message}`, {
      parse_mode: 'HTML',
      message_thread_id: threadIdInt
    });
  }
}
