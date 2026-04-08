import { Bot, Context } from 'grammy';
import { getAllManagedBots, upsertManagedBot, getManagedBotByUsername, ManagedBot } from '../db/managed-bots.js';
import { setupBotHandlers } from './index.js';
import { config } from '../config.js';

/**
 * Servicio para gestionar hilos de ejecución de bots dinámicos
 */
export class ManagedBotService {
  private static instances: Map<string, Bot> = new Map();

  /**
   * Inicializar todos los bots guardados en la BD al arrancar
   */
  static async init(mainBot: Bot) {
    console.log('[Manager] Cargando bots gestionados...');
    const bots = await getAllManagedBots();
    for (const botData of bots) {
      await this.startInstance(botData);
    }

    // Registrar manejador de creación de bots en el bot comercial
    mainBot.on('managed_bot', async (ctx: any) => {
      const update = ctx.managedBot;
      if (!update) return;

      console.log(`[Manager] 🆕 Nueva solicitud de bot: ${update.name} (@${update.username})`);
      
      try {
        // 1. Obtener el token del nuevo bot
        const token = await (ctx as any).getManagedBotToken();
        if (!token) throw new Error('No se pudo obtener el token del bot gestionado');

        // 2. Guardar en la base de datos
        const botRecord: Partial<ManagedBot> & { id: string } = {
          id: update.id.toString(),
          owner_id: ctx.from?.id.toString() || '0',
          token: token,
          username: update.username,
          name: update.name,
          personality: 'Eres un asistente útil.', // Personalidad por defecto
          thread_assignments: []
        };
        await upsertManagedBot(botRecord as ManagedBot);

        // 3. Iniciar la instancia
        await this.startInstance(botRecord as ManagedBot);

        await ctx.reply(`✅ ¡Tu bot <b>${update.name}</b> ha sido creado y está activo!\n\nPuedes encontrarlo en @${update.username}`, { parse_mode: 'HTML' });
      } catch (error: any) {
        console.error('[Manager] Error al crear bot gestionado:', error.message);
        await ctx.reply(`❌ Error al activar el bot: ${error.message}`);
      }
    });

    console.log(`[Manager] ✅ ${this.instances.size} bots gestionados iniciados.`);
  }

  /**
   * Iniciar una instancia individual de Bot
   */
  private static async startInstance(botData: ManagedBot) {
    if (this.instances.has(botData.id)) {
      console.log(`[Manager] El bot ${botData.username} ya está corriendo.`);
      return;
    }

    try {
      const bot = new Bot(botData.token);
      
      // Aplicar misma lógica que el bot principal
      setupBotHandlers(bot);

      // Iniciar (Long Polling)
      // Nota: En producción con muchos bots, mejor usar Webhooks.
      bot.start({
        onStart: (botInfo) => {
          console.log(`[Manager] 🚀 Bot gestionado activo: @${botInfo.username}`);
        }
      });

      this.instances.set(botData.id, bot);
    } catch (error: any) {
      console.error(`[Manager] Error iniciando bot @${botData.username}:`, error.message);
    }
  }

  /**
   * Generar el link de creación de bot
   */
  static getCreationLink(managerUsername: string, subBotUsername: string, name: string) {
    return `https://t.me/newbot/${managerUsername}/${subBotUsername}?name=${encodeURIComponent(name)}`;
  }
}
