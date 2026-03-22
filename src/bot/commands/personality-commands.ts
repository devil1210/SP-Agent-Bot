import { Bot, Context } from 'grammy';
import { notifyAdmin, isAdmin } from '../helpers.js';
import { getPersonality, setPersonality, getSavedPersonalities, savePersonality } from '../../db/settings.js';

export function registerPersonalityCommands(bot: Bot) {
  const isAdminMiddleware = async (ctx: Context, next: () => Promise<void>) => {
    if (await isAdmin(ctx.from?.id.toString())) {
      await next();
    }
  };

  bot.command('persona', isAdminMiddleware, async (ctx) => {
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

  bot.command('savepersona', isAdminMiddleware, async (ctx) => {
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

  bot.command('personas', isAdminMiddleware, async (ctx) => {
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
    list += "\n<i>Para ver el prompt completo:</i>\n<code>/personas [nombre]</code>\n\n<i>Para usar una:</i>\n<code>/setpersona [nombre]</code>";

    await notifyAdmin(ctx, list);
  });

  bot.command('setpersona', isAdminMiddleware, async (ctx) => {
    const name = ctx.match.trim();
    if (!name) {
      return await notifyAdmin(ctx, "❌ Especifica el nombre de la personalidad.");
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
}
