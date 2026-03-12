import { config } from '../config.js';
import { db, addLongTermMemory, searchLongTermMemory } from '../db/index.js';

export interface Tool {
  name: string;
  description: string;
  parameters: any;
  execute: (args: any, context: { chatId: string }) => Promise<string>;
}

export const tools: Record<string, Tool> = {
  consultar_biblioteca: {
    name: 'consultar_biblioteca',
    description: 'Busca libros o series en tu biblioteca personal de ZeePub.',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Título del libro o nombre de la serie' },
      },
      required: ['query'],
    },
    execute: async ({ query }, { chatId }) => {
      try {
        const { getChatFeatures } = await import('../db/settings.js');
        const features = await getChatFeatures(chatId);
        if (!features.includes('library')) return "Error: La función de consulta de biblioteca no está habilitada en este chat.";

        // Buscamos en la tabla de series usando los nombres de columna REALES de la DB
        const { data: seriesData, error: seriesError } = await db
          .from('series')
          .select('name, series_spanish, series_english, author, description, book_count')
          .or(`name.ilike.%${query}%,series_spanish.ilike.%${query}%,series_english.ilike.%${query}%`)
          .limit(3);

        if (seriesError) return `Error al consultar series: ${seriesError.message}`;
        
        if (seriesData && seriesData.length > 0) {
          return seriesData.map(s => {
            const nombre = s.series_spanish || s.series_english || s.name;
            const desc = s.description ? `\n\n<b>Sinopsis:</b> ${s.description}` : '\n(Sin sinopsis disponible)';
            return `✅ <b>${nombre}</b> de ${s.author || 'Autor desconocido'}.\n📚 Disponibles: ${s.book_count || 0} volúmenes.${desc}`;
          }).join('\n\n---\n\n');
        }

        // Si no hay serie clara, buscamos libros individuales pero solo para confirmar existencia
        const { data: bookData, error: bookError } = await db
          .from('books')
          .select('title')
          .ilike('title', `%${query}%`)
          .limit(1);

        if (bookError) return `Error al consultar libros: ${bookError.message}`;
        if (!bookData || bookData.length === 0) return "No encontré ese título o serie en tu biblioteca.";

        return `Sí, tengo algo de "<b>${query}</b>" en la biblioteca, pero no tengo la sinopsis detallada en la base de datos de series.`;
      } catch (err: any) {
        return `Error en biblioteca: ${err.message}`;
      }
    }
  },

  estadisticas_biblioteca: {
    name: 'estadisticas_biblioteca',
    description: 'Obtiene el número total de series y libros en la biblioteca de ZeePub.',
    parameters: { type: 'object', properties: {} },
    execute: async () => {
      try {
        const { count: seriesCount, error: seriesError } = await db
          .from('series')
          .select('*', { count: 'exact', head: true });
        
        const { count: booksCount, error: booksError } = await db
          .from('books')
          .select('*', { count: 'exact', head: true });

        if (seriesError || booksError) return "Error consultando estadísticas.";

        return `📊 <b>Estado de la Biblioteca ZeePub:</b>\n\n` +
               `📚 <b>Series:</b> ${seriesCount || 0}\n` +
               `📄 <b>Archivos (EPUB/PDF):</b> ${booksCount || 0}\n\n` +
               `¡Una colección legendaria! 🔥`;
      } catch (err: any) {
        return `Error: ${err.message}`;
      }
    }
  },

  configurar_acceso_grupo: {
    name: 'configurar_acceso_grupo',
    description: 'Autoriza o revoca el acceso del bot a un grupo de Telegram usando su ID.',
    parameters: {
      type: 'object',
      properties: {
        chatId: { type: 'string', description: 'El ID del grupo (ej: -100123456789)' },
        accion: { type: 'string', enum: ['autorizar', 'revocar'], description: 'La acción a realizar' }
      },
      required: ['chatId', 'accion']
    },
    execute: async ({ chatId, accion }) => {
      try {
        const { authorizeGroup, revokeGroup } = await import('../db/settings.js');
        if (accion === 'autorizar') {
          await authorizeGroup(chatId);
          return `✅ Grupo ${chatId} autorizado exitosamente.`;
        } else {
          await revokeGroup(chatId);
          return `❌ Acceso revocado para el grupo ${chatId}.`;
        }
      } catch (err: any) {
        return `Error al configurar acceso: ${err.message}`;
      }
    }
  },

  busqueda_avanzada_biblioteca: {
    name: 'busqueda_avanzada_biblioteca',
    description: 'Realiza búsquedas filtradas por maquetador, traductor, autor o libros recientes.',
    parameters: {
      type: 'object',
      properties: {
        maquetador: { type: 'string', description: 'Nombre del maquetador (layout_by).' },
        traductor: { type: 'string', description: 'Nombre del traductor.' },
        autor: { type: 'string', description: 'Nombre del autor.' },
        recientes: { type: 'boolean', description: 'Si es true, busca libros añadidos en los últimos 7 días.' }
      }
    },
    execute: async ({ maquetador, traductor, autor, recientes }, { chatId }) => {
      try {
        const { getChatFeatures } = await import('../db/settings.js');
        const features = await getChatFeatures(chatId);
        if (!features.includes('library')) return "Error: La función de búsqueda avanzada no está habilitada en este chat.";

        let queryBuilder = db.from('books').select('title, layout_by, translator, author, indexed_at', { count: 'exact' });

        if (maquetador) queryBuilder = queryBuilder.ilike('layout_by', `%${maquetador}%`);
        if (traductor) queryBuilder = queryBuilder.ilike('translator', `%${traductor}%`);
        if (autor) queryBuilder = queryBuilder.ilike('author', `%${autor}%`);
        if (recientes) {
          const weekAgo = new Date();
          weekAgo.setDate(weekAgo.getDate() - 7);
          queryBuilder = queryBuilder.gte('indexed_at', weekAgo.toISOString());
        }

        const { data, error, count } = await queryBuilder.limit(20);

        if (error) return `Error en búsqueda avanzada: ${error.message}`;
        if (!data || data.length === 0) return "No se encontraron resultados para esos filtros.";

        const lista = data.map(b => `• <b>${b.title}</b>`).join('\n');

        let summary = `🔍 <b>Resultados:</b> Se encontraron <b>${count}</b> libros.\n\n${lista}`;
        if (count && count > 20) summary += `\n\n<i>...y ${count - 20} más.</i>`;
        
        return summary;
      } catch (err: any) {
        return `Error: ${err.message}`;
      }
    }
  },

  search_via_internet: {
    name: 'search_via_internet',
    description: 'Busca información actualizada en internet sobre noticias, precios o hechos.',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'La búsqueda a realizar' },
      },
      required: ['query'],
    },
    execute: async ({ query }) => {
      try {
        const response = await fetch('https://api.tavily.com/search', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ 
            api_key: config.tavilyApiKey, 
            query, 
            search_depth: "basic" 
          })
        });
        const data = await response.json();
        return JSON.stringify(data.results);
      } catch (err: any) { return `Error: ${err.message}`; }
    }
  },

  buscar_imagenes: {
    name: 'buscar_imagenes',
    description: 'Busca fotos en internet y devuelve la URL para enviarla directamente.',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Descripción de la imagen a buscar' },
      },
      required: ['query'],
    },
    execute: async ({ query }) => {
      try {
        const response = await fetch('https://api.tavily.com/search', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ 
            api_key: config.tavilyApiKey, 
            query, 
            search_depth: "advanced",
            include_images: true,
            max_results: 5 
          })
        });
        const data = await response.json();
        const images = data.images || [];
        console.log(`[Tool:buscar_imagenes] Tavily devolvió ${images.length} imágenes.`);
        
        if (images.length > 0) {
            const filteredImages = images.map((img: any) => {
                const url = typeof img === 'string' ? img : (img.url || img.image);
                if (!url) return null;
                
                // Bloqueamos explícitamente contenido de años pasados si el link lo delata (2019-2024)
                const oldYears = ['2019', '2020', '2021', '2022', '2023', '2024'];
                if (oldYears.some(year => url.includes(year))) {
                    console.log(`[Tool:buscar_imagenes] Imagen rechazada por año antiguo: ${url}`);
                    return null;
                }

                if (url.includes('instagram.com/seo') || url.includes('crawler')) return null;
                
                return url;
            }).filter(Boolean);

            if (filteredImages.length > 0) {
                return filteredImages.map((url: string) => `- Opción: ${url}`).join('\n');
            }
        }
        
        return "No se encontraron imágenes ACTUALES (2025-2026). Dile al usuario que no hay fotos recientes disponibles aún y no mandes fotos viejas.";
        
        return "No se encontraron imágenes en la galería de Tavily. Dile al usuario que no pudiste encontrar nada visual.";
      } catch (err: any) { return `Error en búsqueda de imágenes: ${err.message}`; }
    }
  },

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
    execute: async ({ action, text }, { chatId }) => {
      if (action === 'save') {
        await addLongTermMemory(chatId, text);
        return "Información guardada en memoria de largo plazo.";
      } else {
        const results = await searchLongTermMemory(chatId, text);
        return results.length > 0 
          ? `Resultados de memoria:\n${results.map((r: any) => `- ${r.content}`).join('\n')}`
          : "No se encontraron recuerdos relevantes.";
      }
    }
  },

  radar_de_tendencias: {
    name: 'radar_de_tendencias',
    description: 'Analiza temas candentes, tendencias actuales y noticias de última hora ("hot topics").',
    parameters: {
      type: 'object',
      properties: {
        contexto: { type: 'string', description: 'Región o tema específico (ej: "Chile", "Tecnología", "Global")' },
      },
      required: ['contexto'],
    },
    execute: async ({ contexto }) => {
      try {
        const query = `últimas noticias tendencias hoy ${contexto} breaking news top stories`;
        const response = await fetch('https://api.tavily.com/search', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ 
            api_key: config.tavilyApiKey, 
            query, 
            search_depth: "advanced",
            include_answer: true,
            max_results: 10
          })
        });
        const data = await response.json();
        const results = data.results || [];
        
        let report = `REPORTE DE TENDENCIAS: ${contexto}\n`;
        report += `RESUMEN GENERAL: ${data.answer || 'No hay resumen disponible.'}\n\n`;
        report += results.map((r: any, i: number) => `NOTICIA ${i+1}:\n- TÍTULO: ${r.title}\n- URL: ${r.url}\n- INFO: ${r.content.substring(0, 200)}`).join('\n\n');
        
        return report;
      } catch (err: any) { return `Error en el radar: ${err.message}`; }
    }
  },

  enviar_mensaje_grupo: {
    name: 'enviar_mensaje_grupo',
    description: 'Envía un mensaje a un grupo/hilo autorizado específico. Ideal para saludar o dar avisos.',
    parameters: {
      type: 'object',
      properties: {
        chatId: { type: 'string', description: 'ID del grupo (empieza con -)' },
        threadId: { type: 'number', description: 'Opcional: ID del hilo (topic)' },
        mensaje: { type: 'string', description: 'Contenido del mensaje a enviar' }
      },
      required: ['chatId', 'mensaje']
    },
    execute: async ({ chatId, threadId, mensaje }) => {
      try {
        const { getAuthorizedGroups } = await import('../db/settings.js');
        const { bot } = await import('../bot/index.js');
        
        const authorized = await getAuthorizedGroups();
        if (!authorized.includes(chatId)) return "Error: El grupo no está autorizado para que yo hable allí.";
        
        await bot.api.sendMessage(chatId, mensaje, { 
            message_thread_id: threadId,
            parse_mode: 'HTML'
        });
        return `✅ Mensaje enviado con éxito al grupo ${chatId}.`;
      } catch (e: any) {
        return `❌ Error al enviar mensaje: ${e.message}`;
      }
    }
  }
};

export const getToolsDefinition = () => {
  return Object.values(tools).map(t => ({
    type: 'function',
    function: {
      name: t.name,
      description: t.description,
      parameters: t.parameters,
    }
  }));
};

export const executeTool = async (name: string, args: any, context: { chatId: string }) => {
  const tool = tools[name];
  if (!tool) throw new Error(`Tool ${name} not found`);
  
  let parsedArgs = args;
  if (typeof args === 'string') {
    try {
      parsedArgs = JSON.parse(args);
    } catch {
      parsedArgs = { query: args };
    }
  }
  
  return await tool.execute(parsedArgs, context);
};
