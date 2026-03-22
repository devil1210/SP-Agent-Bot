import { addLongTermMemory, searchLongTermMemory } from '../db/index.js';

export const memoryTools = {
  memoria_largo_plazo: {
    name: 'memoria_largo_plazo',
    description: 'Guarda o busca información en la memoria persistente del usuario.',
    parameters: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['save', 'search'], description: 'Guardar o buscar' },
        text: { type: 'string', description: 'Información a guardar o términos de búsqueda' },
      },
      required: ['action', 'text'],
    },
    execute: async ({ action, text }: any, { chatId }: any) => {
      if (action === 'save') {
        await addLongTermMemory(chatId, text);
        return 'Información guardada en memoria de largo plazo.';
      } else {
        const results = await searchLongTermMemory(chatId, text);
        return results.length > 0
          ? `Resultados de memoria:\n${results.map((r: any) => `- ${r.content}`).join('\n')}`
          : 'No se encontraron recuerdos relevantes.';
      }
    }
  }
};