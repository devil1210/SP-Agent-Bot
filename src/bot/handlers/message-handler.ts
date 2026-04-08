import { Bot, Context } from 'grammy';
import { addMemory, getUserPreferences, incrementTwitterFixCount, setTwitterAutoFix, getHistory } from '../../db/index.js';
import { getAllowedThreads, getPassiveThreads, getPersonality, getInterventionLevel, getPersonalityParams, getKnownThreads } from '../../db/settings.js';
import { processUserMessage, TurnResult } from '../../agent/loop.js';
import { isAdmin, updateBotTag, notifyAdmin } from '../helpers.js';

/**
 * Sanitiza HTML para Telegram — movido aquí desde agent/loop.ts
 * El agente es ahora "puro" y no maneja presentación visual.
 */
function sanitizeTelegramHTML(text: string): string {
  let s = text.replace(/&/g, '&amp;');
  const allowedTags = /<\/?(b|i|u|s|a|code|pre|blockquote|details|summary|strong|em|ins|strike|del|span)(\s+[^>]*)?>/ ;
  const placeholders: string[] = [];
  s = s.replace(new RegExp(allowedTags.source, 'gi'), (match) => {
    placeholders.push(match);
    return `__VTAG_${placeholders.length - 1}__`;
  });
  s = s.replace(/</g, '&lt;').replace(/>/g, '&gt;');
  s = s.replace(/__VTAG_(\d+)__/g, (_, id) => placeholders[parseInt(id)]);
  return s;
}

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
    
    // --- LÓGICA DE MANAGED BOTS ---
    const { getManagedBotByUsername } = await import('../../db/managed-bots.js');
    const managedBot = await getManagedBotByUsername(botUsername || '');
    if (managedBot) {
        const assignments = managedBot.thread_assignments || [];
        const isAssigned = assignments.some(a => a.chat_id === chatId && (Number(a.thread_id) === threadIdInt || (!a.thread_id && !threadIdInt)));
        const mentionRegexManaged = new RegExp(`@${botUsername}\\b`, 'i');
        const isMentionedManaged = mentionRegexManaged.test(text);
        if (!isAssigned && !isMentionedManaged && !ctx.message?.reply_to_message?.from?.username?.includes(botUsername || '')) {
            await addMemory(chatId, 'user', `${senderName}: ${text}`, threadId, ctx.message?.message_id);
            return;
        }
        if (managedBot.personality) {
            const result = await processUserMessage(chatId, userId, text, threadId, [], ctx.message?.message_id, ctx.message?.reply_to_message?.message_id, ctx.message?.reply_to_message?.from?.is_bot, senderName, isSAdmin, managedBot.personality);
            const output = result?.output ?? '';
            if (output) {
                const safeOutput = sanitizeTelegramHTML(output);
                if (result.photoUrl) {
                    try { await ctx.replyWithPhoto(result.photoUrl, { caption: safeOutput, parse_mode: 'HTML', message_thread_id: threadIdInt }); } 
                    catch { await ctx.reply(safeOutput, { parse_mode: 'HTML', message_thread_id: threadIdInt }); }
                } else { await ctx.reply(safeOutput, { parse_mode: 'HTML', message_thread_id: threadIdInt }); }
            }
            return;
        }
    }

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
    const interventionLevel = await getInterventionLevel(chatId, threadId);
    const params = await getPersonalityParams(chatId, threadId);
    const randomDice = Math.random() * 100;

    // --- MEJORA DE LÓGICA DE MIEMBRO (Intervención Inteligente Restringida) ---
    const lastMsgs = await getHistory(chatId, 1, threadId);
    const isContinuingThread = lastMsgs[0]?.role === 'assistant';
    
    // Obtener nombre del hilo para validación de tópico
    const knownThreads = await getKnownThreads(chatId);
    const currentThreadIdNum = threadIdInt !== undefined ? threadIdInt : 1;
    const threadName = knownThreads.find(t => t.id === currentThreadIdNum)?.name?.toLowerCase() || '';
    
    // Tópicos aprobados para intervención proactiva
    const approvedTopics = ['biblioteca', 'libro', 'búsqueda', 'busqueda', 'bug', 'servidor', 'ia'];
    const isApprovedThread = approvedTopics.some(topic => threadName.includes(topic));
    
    // Sensibilidad a palabras clave (temas en los que el bot es experto)
    const keywords = ['biblioteca', 'libro', 'busco', 'buscando', 'zeepub', 'bot', 'agente', 'error', 'bug', 'v4', 'flash', 'llm', 'ia', 'inteligencia', 'serpent', 'puedes', 'quien', 'configuracion', 'servidor', 'bibliotecario'];
    const hasKeyword = keywords.some(k => text.toLowerCase().includes(k));
    
    // Cálculo de probabilidad dinámica basada en contexto e hilo
    let dynamicP = interventionLevel;
    
    if (isApprovedThread) {
      // En hilos aprobados, activamos la lógica "Smart" completa
      if (hasKeyword) dynamicP = Math.max(dynamicP, 40); 
      if (isContinuingThread) dynamicP += 25;           
      if (text.length > 120) dynamicP += 15;            
      
      // Bonus por parámetros de personalidad
      if ((params.interes ?? 50) > 70) dynamicP += 15;
      if (isTrivial && (params.trivialidad ?? 50) < 30) dynamicP -= 30; // Si no soporta trivialidades, calla más
    } else {
      // En hilos NO aprobados, somos mucho más discretos (sin boosts)
      dynamicP = Math.min(dynamicP, 30); // Capamos la intervención espontánea en hilos irrelevantes
    }

    const isRandomIntervention = isActiveThread && !isTrivial && (randomDice <= dynamicP);
    const substantiveReply = isReplyToBot && !isTrivial;
    const shouldRespond = isMentioned || isReplyToBot || (isPassiveThread ? substantiveReply : isRandomIntervention);
    const shouldSaveMemory = shouldRespond || isPassiveThread || isActiveThread || isAllMode;

    if (!shouldRespond) {
      if (shouldSaveMemory) {
        const contentToSave = isGroup ? `${senderName}: ${text}` : text;
        console.log(`[Bot] 🤐 Guardando en memoria...`);
        await addMemory(chatId, 'user', contentToSave, threadId, ctx.message?.message_id);
      }
      return;
    }

    console.log(`[Bot] 🤖 Procesando con IA...`);
  } else if (!isMentioned && !isReplyToBot) {
    return; // No responder en privado sin mención/reply
  }

  // PROCESAR CON IA
  try {
    const result = await processUserMessage(
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

    // Adaptar TurnResult al formato de respuesta de Telegram
    const output = result?.output ?? '';
    if (output) {
      // Sanitizar HTML aquí (capa de presentación), no en el agente
      const safeOutput = sanitizeTelegramHTML(output);
      console.log(`[Bot] 📤 Enviando respuesta (stop_reason: ${result.stop_reason}, turns: ${result.turns_used})`);

      if (result.photoUrl) {
          try {
              await ctx.replyWithPhoto(result.photoUrl, {
                  caption: safeOutput,
                  parse_mode: 'HTML',
                  message_thread_id: threadIdInt
              });
          } catch (e) {
              await ctx.reply(safeOutput, {
                  parse_mode: 'HTML',
                  message_thread_id: threadIdInt
              });
          }
      } else {
          await ctx.reply(safeOutput, {
              parse_mode: 'HTML',
              message_thread_id: threadIdInt
          });
      }
    }
  } catch (error) {
    console.error(`[Message Handler Error]`, error);
  } finally {
    // 🧠 Refinamiento psicológico en segundo plano (no bloqueante)
    import('../../agent/refiner.js').then(m => {
      m.checkAndRefine(chatId, threadId).catch(err => console.error(`[Refiner Trigger Error]`, err));
    });
  }
}
