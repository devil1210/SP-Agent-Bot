import { Bot, Context } from 'grammy';
import { notifyAdmin, isAdmin } from '../helpers.js';
import {
  getAuthorizedGroups,
  authorizeGroup,
  revokeGroup,
  getAllowedThreads,
  getPassiveThreads,
  setAllowedThreads,
  setPassiveThreads,
  getKnownThreads,
  getAuthorizedUsers,
  authorizeUser,
  revokeUser
} from '../../db/settings.js';

export function registerGroupCommands(bot: Bot) {
  const isAdminMiddleware = async (ctx: Context, next: () => Promise<void>) => {
    if (await isAdmin(ctx.from?.id.toString())) {
      await next();
    }
  };

  bot.command('allowgroup', isAdminMiddleware, async (ctx) => {
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

  bot.command('revokegroup', isAdminMiddleware, async (ctx) => {
    const chatId = ctx.match.trim() || ctx.chat.id.toString();
    await revokeGroup(chatId);
    await notifyAdmin(ctx, `❌ Grupo <code>${chatId}</code> revocado.`);
  });

  bot.command('purgegroup', isAdminMiddleware, async (ctx) => {
    const chatId = ctx.match.trim();
    if (!chatId) return await notifyAdmin(ctx, "💡 <b>Uso:</b> <code>/purgegroup [chatId]</code>");
    
    await revokeGroup(chatId);
    
    // Borrar de bot_settings
    const { db } = await import('../../db/index.js');
    await db.from('bot_settings').delete().eq('chat_id', chatId);
    
    await notifyAdmin(ctx, `✅ Grupo <code>${chatId}</code> y su configuración purgados.`);
  });

  bot.command('purgethread', isAdminMiddleware, async (ctx) => {
    const input = ctx.match.trim();
    const parts = input.split(/\s+/);
    if (parts.length < 2) return await notifyAdmin(ctx, "💡 <b>Uso:</b> <code>/purgethread [chatId] [threadId]</code>");
    
    const chatId = parts[0];
    const threadId = parts[1];
    
    const { db } = await import('../../db/index.js');
    await db.from('bot_settings')
      .delete()
      .eq('chat_id', chatId)
      .eq('thread_id', threadId);
      
    await notifyAdmin(ctx, `✅ Hilo <code>${threadId}</code> del grupo <code>${chatId}</code> purgado.`);
  });

  bot.command('groups', isAdminMiddleware, async (ctx) => {
    const authorized = await getAuthorizedGroups();
    if (authorized.length === 0) return await notifyAdmin(ctx, "No hay grupos autorizados.");
    
    let msg = "<b>🏰 Tus Dominios (Grupos e Hilos):</b>\n\n";
    for (const group of authorized) {
      let displayName = group.name;
      if (group.name === 'Grupo' || group.name === 'Grupo Desconocido') {
        try {
          const { bot } = await import('../index.js');
          const chat = await bot.api.getChat(group.id);
          displayName = (chat as any).title || (chat as any).first_name || group.name;
          if (displayName !== group.name) await authorizeGroup(group.id, displayName);
        } catch (e) {
          console.warn(`[Groups] No se pudo actualizar nombre para ${group.id}`);
        }
      }

      msg += `📁 <b>Grupo:</b> ${displayName} <code>${group.id}</code>\n`;
      const knownThreads = await getKnownThreads(group.id);
      const activeThreads = await getAllowedThreads(group.id);
      const passiveThreads = await getPassiveThreads(group.id);

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
    msg += "<i>Leyenda: 🎭 Miembro | 🧐 Consultor | 🤖 Asistente\n\nComandos: /purgegroup [id] | /purgethread [id] [thread]</i>";
    await notifyAdmin(ctx, msg);
  });

  bot.command('topics', isAdminMiddleware, async (ctx) => {
    const input = ctx.match.trim();
    const parts = input.split(/\s+/);
    
    let targetChatId = ctx.chat.id.toString();
    let action = "";
    let targetThreadId: number | undefined = ctx.message?.message_thread_id;

    if (parts[0].startsWith('-')) {
      targetChatId = parts[0];
      if (parts.length === 2) {
        action = parts[1].toLowerCase();
        targetThreadId = 1;
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
}

export function registerUserCommands(bot: Bot) {
  const isAdminMiddleware = async (ctx: Context, next: () => Promise<void>) => {
    if (await isAdmin(ctx.from?.id.toString())) {
      await next();
    }
  };

  bot.command('allowuser', isAdminMiddleware, async (ctx) => {
    const userId = ctx.match.trim();
    if (!userId) return await notifyAdmin(ctx, "💡 <b>Uso:</b> <code>/allowuser [userId]</code>");
    
    await authorizeUser(userId);
    await notifyAdmin(ctx, `✅ Usuario <code>${userId}</code> autorizado.`);
  });

  bot.command('revokeuser', isAdminMiddleware, async (ctx) => {
    const userId = ctx.match.trim();
    if (!userId) return await notifyAdmin(ctx, "💡 <b>Uso:</b> <code>/revokeuser [userId]</code>");
    
    await revokeUser(userId);
    await notifyAdmin(ctx, `❌ Usuario <code>${userId}</code> revocado.`);
  });

  bot.command('users', isAdminMiddleware, async (ctx) => {
    const users = await getAuthorizedUsers();
    if (users.length === 0) return await notifyAdmin(ctx, "No hay usuarios autorizados dinámicamente.");
    
    let msg = "<b>👥 Usuarios Autorizados:</b>\n\n";
    users.forEach(u => {
      msg += `• <code>${u.id}</code>\n`;
    });
    
    await notifyAdmin(ctx, msg);
  });
}
