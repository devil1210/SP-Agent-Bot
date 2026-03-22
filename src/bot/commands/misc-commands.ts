import { Bot, Context } from 'grammy';
import { notifyAdmin, isAdmin } from '../helpers.js';
import { getAuthorizedGroups, getChatFeatures, setChatFeatures } from '../../db/settings.js';

export function registerMiscCommands(bot: Bot) {
  const isAdminMiddleware = async (ctx: Context, next: () => Promise<void>) => {
    if (await isAdmin(ctx.from?.id.toString())) {
      await next();
    }
  };

  bot.command('say', isAdminMiddleware, async (ctx) => {
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
      const { bot } = await import('../index.js');
      await bot.api.sendMessage(targetChatId, message, {
        message_thread_id: threadId,
        parse_mode: 'HTML'
      });
      await ctx.reply("✅ Mensaje enviado.");
    } catch (e: any) {
      await ctx.reply(`❌ Error: ${e.message}`);
    }
  });

  bot.command('features', isAdminMiddleware, async (ctx) => {
    const input = ctx.match.trim();
    const parts = input.split(/\s+/);
    let targetChatId = ctx.chat.id.toString();
    let actionParts = parts;

    if (parts[0] && parts[0].startsWith('-')) {
      targetChatId = parts[0];
      actionParts = parts.slice(1);
    }

    const current = await getChatFeatures(targetChatId);

    if (actionParts.length === 0) {
      return await notifyAdmin(ctx, `🧩 <b>Módulos de conocimiento en <code>${targetChatId}</code>:</b>\n\n` +
        `• 📚 <code>library</code>: ${current.includes('library') ? '✅ Activo' : '❌ Inactivo'}\n` +
        `• 🏭 <code>dev_prod</code> (Main): ${current.includes('dev_prod') ? '✅ Activo' : '❌ Inactivo'}\n` +
        `• 🧪 <code>dev_test</code> (V4): ${current.includes('dev_test') ? '✅ Activo' : '❌ Inactivo'}`);
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
      await notifyAdmin(ctx, `❌ Módulo <code>${feature}</code> desactivado.`);
    } else {
      newList = [...current, feature];
      await setChatFeatures(targetChatId, newList);
      await notifyAdmin(ctx, `✅ Módulo <code>${feature}</code> activado.`);
    }
  });
}
