import { Bot, Context } from 'grammy';
import { notifyAdmin, isAdmin } from '../helpers.js';
import { getInterventionLevel, setInterventionLevel, getPersonalityParams, setPersonalityParam } from '../../db/settings.js';

export function registerConfigCommands(bot: Bot) {
  bot.command('model', isAdminMiddleware, async (ctx) => {
    const model = ctx.match || 'gemini-3.1-flash-lite-preview';
    const threadId = ctx.message?.message_thread_id?.toString();
    const { setUserModel } = await import('../../db/settings.js');
    await setUserModel(ctx.chat.id.toString(), model, threadId);
    await notifyAdmin(ctx, `✅ Modelo cambiado a: <code>${model}</code>`);
  });

  bot.command('intr', isAdminMiddleware, async (ctx) => {
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

  bot.command('config', isAdminMiddleware, async (ctx) => {
    const input = ctx.match.trim();
    const parts = input.split(/\s+/);
    
    let targetChatId = ctx.chat.id.toString();
    let targetThreadId: string | undefined = ctx.message?.message_thread_id?.toString();
    let startIndex = 0;

    // 1. Detectar si el primer parte es un chatId (-100...)
    if (parts[0] && parts[0].startsWith('-')) {
      targetChatId = parts[0];
      startIndex = 1;

      // 2. ¿El siguiente es un threadId (número)?
      if (parts[1] && /^\d+$/.test(parts[1])) {
        targetThreadId = parts[1];
        startIndex = 2;
      }
    }

    const remainingInput = parts.slice(startIndex).join(' ');

    // Caso A: Solo ver configuración actual
    if (!remainingInput) {
      const { getPersonalityParams } = await import('../../db/settings.js');
      const params = await getPersonalityParams(targetChatId, targetThreadId);
      let msg = `⚙️ <b>Configuración [ID: ${targetChatId}${targetThreadId ? ' Thread: ' + targetThreadId : ''}]:</b>\n\n`;
      const entries = Object.entries(params);
      if (entries.length === 0) {
        msg += "<i>Usando valores estándar (50/100).</i>";
      } else {
        entries.forEach(([k, v]) => {
          msg += `• <b>${k}</b>: <code>${v}/100</code>\n`;
        });
      }
      msg += "\n\n<b>Uso:</b>\n<code>/config [id_grupo] [id_hilo] rasgo=valor ...</code>\n<code>/config sarcasmo=80 emocion=50</code>";
      return await notifyAdmin(ctx, msg);
    }

    // Caso B: Procesar múltiples parámetros
    const normalizedInput = remainingInput
      .replace(/([a-záéíóúñ]+)\s*[:=]\s*(\d+)/gi, '$1=$2')
      .split(/\s+/);

    const validTraits = ['sarcasmo', 'interes', 'interés', 'trivialidad', 'intervencion', 'intervención', 'emocion', 'emoción', 'frialdad', 'agresividad', 'empatia', 'empatía', 'creatividad'];
    const traitMap: Record<string, string> = { 'interés': 'interes', 'intervención': 'intervencion', 'emoción': 'emocion', 'empatía': 'empatia' };
    
    let updatedCount = 0;
    let summary = `✅ <b>Actualización de Configuración:</b>\n`;

    for (const item of normalizedInput) {
      if (item.includes('=')) {
        const [trait, valStr] = item.split('=');
        const lowerTrait = trait.toLowerCase();
        const value = parseInt(valStr);

        if (validTraits.includes(lowerTrait) && !isNaN(value) && value >= 0 && value <= 100) {
          const finalTrait = traitMap[lowerTrait] || lowerTrait;
          await setPersonalityParam(targetChatId, finalTrait, value, targetThreadId);
          summary += `• ${finalTrait}: <code>${value}/100</code>\n`;
          updatedCount++;
        }
      }
    }

    if (updatedCount === 0) {
      return await notifyAdmin(ctx, "❌ No se procesó ningún parámetro válido.\nEjemplo: <code>/config sarcasmo=80 emoción=70</code>");
    }

    summary += `\nAplicado a: <code>${targetChatId}</code>${targetThreadId ? ' (Hilo #' + targetThreadId + ')' : ''}`;
    await notifyAdmin(ctx, summary);
  });

  bot.command('set_img_search', isAdminMiddleware, async (ctx) => {
    const input = ctx.match.trim().toLowerCase();
    if (input !== 'true' && input !== 'false') {
      return await notifyAdmin(ctx, "💡 <b>Uso:</b> <code>/set_img_search [true/false]</code>");
    }

    const chatId = ctx.chat.id.toString();
    const threadId = ctx.message?.message_thread_id?.toString();
    const enabled = input === 'true';

    const { setPersonalityParam } = await import('../../db/settings.js');
    await setPersonalityParam(chatId, 'can_search_images', enabled ? 1 : 0, threadId);
    
    await notifyAdmin(ctx, `✅ Búsqueda de imágenes ${enabled ? 'ACTIVADA' : 'DESACTIVADA'} para este hilo.`);
  });
}

/**
 * Middleware para verificar admin
 */
const isAdminMiddleware = async (ctx: Context, next: () => Promise<void>) => {
  if (await isAdmin(ctx.from?.id.toString())) {
    await next();
  }
};
