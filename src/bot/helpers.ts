import { Context } from 'grammy';
import { config } from '../config.js';
import { getAuthorizedUsers } from '../db/settings.js';

/**
 * Middleware para asegurar que solo usuarios autorizados puedan cambiar configuraciones
 */
export const isAdmin = async (userId: string | undefined): Promise<boolean> => {
  if (!userId) return false;
  const sUserId = userId.toString();
  if (config.telegramAllowedUserIds.includes(sUserId)) return true;
  
  const dynamicUsers = await getAuthorizedUsers();
  return dynamicUsers.some(u => u.id === sUserId);
};

/**
 * Función para enviar notificaciones al chat privado del administrador
 */
export async function notifyAdmin(ctx: Context, text: string) {
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
 * Función auxiliar para intentar cambiar el título del bot
 */
export async function updateBotTag(ctx: Context, chatId: string, threadId?: string) {
    try {
        const { getPersonality } = await import('../db/settings.js');
        const personality = await getPersonality(chatId, threadId);
        
        // Extraer nombre de la personalidad (ej: "Eres Tanya" -> "Tanya")
        let title = "SP-Agent";
        if (personality) {
            const nameMatch = personality.match(/(?:eres|soy|llamas|como|personaje|asumes el rol de)\s+([A-Z][A-Za-zÁÉÍÓÚñáéíóú\s]+?)(?:[\.!,;]|\n|$)/i);
            if (nameMatch) title = nameMatch[1].trim();
        }

        // Obtener el ID del bot
        const me = await ctx.api.getMe();
        
        // Intentar cambiar la etiqueta (solo funciona si el bot es Admin)
        await ctx.api.setChatAdministratorCustomTitle(chatId, me.id, title);
        console.log(`[Bot] ✅ Etiqueta actualizada a: ${title}`);
    } catch (e: any) {
        // Fallará silenciosamente si no es admin, no bloqueamos el flujo
        console.error(`[Bot] ⚠️ ERROR AL ACTUALIZAR ETIQUETA. ¿Soy admin? ¿Tengo permiso? Error: ${e.message}`);
    }
}
