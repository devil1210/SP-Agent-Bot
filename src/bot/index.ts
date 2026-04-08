import { Bot } from 'grammy';
import { config } from '../config.js';
import { isAdmin, notifyAdmin, updateBotTag } from './helpers.js';
import { registerAdminCommands } from './commands/admin-commands.js';
import { registerConfigCommands } from './commands/config-commands.js';
import { registerPersonalityCommands } from './commands/personality-commands.js';
import { registerGroupCommands, registerUserCommands } from './commands/group-commands.js';
import { registerMiscCommands } from './commands/misc-commands.js';
import { setThreadName } from '../db/settings.js';

export const bot = new Bot(config.telegramBotToken);

/**
 * Configurar comandos visibles solo para administradores
 */
async function setBotCommands() {
  const commands = [
    { command: 'help', description: 'Muestra la guía de todos los comandos (Admin)' },
    { command: 'features', description: 'Gestiona módulos de conocimiento' },
    { command: 'persona', description: 'Configurar personalidad libre' },
    { command: 'setpersona', description: 'Cambiar a una personalidad guardada' },
    { command: 'personas', description: 'Lista de personalidades disponibles' },
    { command: 'savepersona', description: 'Guardar una nueva personalidad (Admin)' },
    { command: 'topics', description: 'Configura el rol del bot en un hilo' },
    { command: 'groups', description: 'Lista hilos y sus IDs' },
    { command: 'say', description: 'Enviar mensaje remoto' },
    { command: 'del', description: 'Borrar mensaje del bot (citar mensaje)' },
    { command: 'allowuser', description: 'Autorizar usuario (ID/Respuesta)' },
    { command: 'revokeuser', description: 'Revocar usuario (ID)' },
    { command: 'users', description: 'Lista de usuarios autorizados' },
    { command: 'autofix', description: 'Activa/Desactiva auto-corrección de Twitter' },
    { command: 'config', description: 'Configurar parámetros de personalidad (0-100)' }
  ];

  try {
    await bot.api.setMyCommands(commands, { scope: { type: 'all_chat_administrators' } });
    for (const userId of config.telegramAllowedUserIds) {
      await bot.api.setMyCommands(commands, { scope: { type: 'chat', chat_id: parseInt(userId) } });
    }
    console.log('[Bot] ✅ Comandos configurados con éxito');
  } catch (e) {
    console.error('[Bot] ❌ Error configurando comandos:', e);
  }
}

/**
 * Configurar manejadores y comandos para cualquier instancia de bot (principal o gestionada)
 */
export function setupBotHandlers(bot: Bot) {
  /**
   * Middleware: Verificar acceso privado
   */
  bot.use(async (ctx, next) => {
    if (ctx.chat?.type === 'private') {
      if (!(await isAdmin(ctx.from?.id.toString()))) {
        const userId = ctx.from?.id.toString();
        console.warn(`[Bot] Acceso privado bloqueado para: ${userId}`);
        try {
          await ctx.reply('⛔ No tienes permisos para usar SP-Agent en privado.');
        } catch (e) {}
        return;
      }
    }
    await next();
  });

  /**
   * Middleware: Logging global
   */
  bot.use(async (ctx, next) => {
    console.log(`[Bot:${bot.botInfo?.username || 'Main'}] Recibida actualización tipo: ${Object.keys(ctx.update).filter(k => k !== 'update_id')[0]}`);
    await next();
  });

  /**
   * Registrar todos los comandos
   */
  registerAdminCommands(bot);
  registerConfigCommands(bot);
  registerPersonalityCommands(bot);
  registerGroupCommands(bot);
  registerUserCommands(bot);
  registerMiscCommands(bot);

  /**
   * Manejadores de eventos de hilos
   */
  bot.on('message:forum_topic_created', async (ctx) => {
    const name = ctx.message.forum_topic_created.name;
    const threadId = ctx.message.message_thread_id;
    if (threadId) await setThreadName(ctx.chat.id.toString(), threadId, name);
  });

  bot.on('message:forum_topic_edited', async (ctx) => {
    const name = ctx.message.forum_topic_edited?.name;
    const threadId = ctx.message.message_thread_id;
    if (threadId && name) await setThreadName(ctx.chat.id.toString(), threadId, name);
  });

  /**
   * Manejador central de mensajes
   */
  import('./handlers/message-handler.js').then(({ setupMessageHandler }) => {
    setupMessageHandler(bot);
  });
}

// Aplicar a bot principal
setupBotHandlers(bot);

/**
 * Inicializar
 */
export async function initializeBot() {
  await setBotCommands();
  
  // Inicializar servicio de bots gestionados
  const { ManagedBotService } = await import('./manager.js');
  await ManagedBotService.init(bot);
}

