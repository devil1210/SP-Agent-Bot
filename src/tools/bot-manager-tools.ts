import { bot } from '../bot/index.js';
import { ManagedBotService } from '../bot/manager.js';
import { getManagedBotsByOwner } from '../db/managed-bots.js';

/**
 * 🤖 HERRAMIENTAS DE GESTIÓN DE BOTS (Mejora #10)
 * Permite al agente facilitar la creación de sub-bots para los usuarios.
 */
export const botManagerTools = [
  {
    name: 'get_bot_creation_link',
    description: 'Genera el enlace especial de Telegram para que un usuario cree su propio bot basado en la tecnología de SP-Agent.',
    parameters: {
      type: 'object',
      properties: {
        subBotUsername: { 
          type: 'string', 
          description: 'Username deseado para el nuevo bot (sin @, ej: MiAsistenteBot).' 
        },
        name: { 
          type: 'string', 
          description: 'Nombre descriptivo para el bot (ej: Asistente de Juan).' 
        }
      },
      required: ['subBotUsername', 'name']
    },
    execute: async ({ subBotUsername, name }: { subBotUsername: string; name: string }) => {
       try {
         // Intentar obtener el username del manager
         const managerUsername = bot.botInfo?.username || 'SP_Agent_Bot';
         const link = ManagedBotService.getCreationLink(managerUsername, subBotUsername, name);
         
         return `✅ Enlace de creación generado: ${link}\n\nINSTRUCCIONES PARA EL USUARIO:\n1. Haz clic en el enlace superior.\n2. Telegram te pedirá autorizar la creación del bot (vía @BotFather internamente).\n3. Una vez aceptado, SP-Agent detectará el nuevo bot y lo activará automáticamente con tu configuración actual.\n\nNOTA: El usuario debe ser el dueño del bot o tener permisos en BotFather para ese username.`;
       } catch (error: any) {
         return `❌ Error al generar el enlace: ${error.message}`;
       }
    }
  },
  {
    name: 'list_my_managed_bots',
    description: 'Lista todos los bots que el usuario actual ha creado y están bajo la gestión de SP-Agent.',
    parameters: { type: 'object', properties: {} },
    execute: async (_: any, context: { userId: string }) => {
      try {
        const bots = await getManagedBotsByOwner(context.userId);
        if (bots.length === 0) {
          return "No tienes ningún bot gestionado actualmente. ¡Puedes crear uno nuevo usando 'get_bot_creation_link'!";
        }
        
        const list = bots.map(b => `• <b>${b.name}</b> (@${b.username}) - Estado: Activo`).join('\n');
        return `🤖 TUS BOTS GESTIONADOS:\n${list}\n\nEstos bots comparten tu tecnología y pueden ser invitados a otros grupos o canales.`;
      } catch (error: any) {
        return `❌ Error al listar bots: ${error.message}`;
      }
    }
  }
];
