import { config } from '../config.js';
import { db, addLongTermMemory, searchLongTermMemory } from '../db/index.js';

export interface Tool {
  name: string;
  description: string;
  parameters: any;
  execute: (args: any, context: { chatId: string, userId: string, quotedMsgId?: number, qIsAssistant?: boolean, isAdmin: boolean }) => Promise<string>;
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
    execute: async ({ chatId, accion }, { isAdmin }) => {
      if (!isAdmin) return "Error: No tienes permisos para configurar el acceso de grupos.";
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
    execute: async ({ query }, _context) => {
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
    execute: async ({ query }, { isAdmin }) => {
      if (!isAdmin) return "Error: La búsqueda de imágenes está reservada para el administrador.";
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
    execute: async ({ contexto }, _context) => {
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
    description: 'Envía un mensaje a un grupo/hilo autorizado específico. IMPORTANTE: No asumas que el grupo tiene las mismas funciones (biblioteca, dev, etc.) que este chat privado. Sé profesional y evita mencionar herramientas específicas a menos que el usuario te lo pida.',
    parameters: {
      type: 'object',
      properties: {
        chatId: { type: 'string', description: 'ID del grupo (empieza con -)' },
        threadId: { type: 'number', description: 'Opcional: ID del hilo (topic)' },
        mensaje: { type: 'string', description: 'Contenido del mensaje a enviar' }
      },
      required: ['chatId', 'mensaje']
    },
    execute: async ({ chatId, threadId, mensaje }, { isAdmin }) => {
      if (!isAdmin) return "Error: Solo el administrador puede enviar mensajes remotos.";
      try {
        const { getAuthorizedGroups } = await import('../db/settings.js');
        const { bot } = await import('../bot/index.js');
        const authorized = await getAuthorizedGroups();
        if (!authorized.includes(chatId)) return "Error: El grupo no está autorizado para que yo hable allí.";
        const sent = await bot.api.sendMessage(chatId, mensaje, { 
            message_thread_id: threadId,
            parse_mode: 'HTML'
        });
        const { addMemory } = await import('../db/index.js');
        await addMemory(chatId, 'assistant', mensaje, threadId?.toString(), sent.message_id);
        return `✅ Mensaje enviado con éxito al grupo ${chatId}.`;
      } catch (e: any) {
        return `❌ Error al enviar mensaje: ${e.message}`;
      }
    }
  },

  editar_mensaje_propio: {
    name: 'editar_mensaje_propio',
    description: 'Edita el contenido de tu último mensaje enviado en este chat o hilo. Úsalo si el usuario te pide corregir algo que acabas de decir.',
    parameters: {
      type: 'object',
      properties: {
        nuevo_texto: { type: 'string', description: 'El nuevo contenido corregido para el mensaje.' },
        chatId: { type: 'string', description: 'Opcional: El ID del chat donde está el mensaje (ej: -100...). Si no se especifica, se usará el chat actual.' }
      },
      required: ['nuevo_texto']
    },
    execute: async ({ nuevo_texto, chatId: targetChatId }, { chatId: currentChatId, isAdmin }) => {
      if (!isAdmin) return "Error: Solo el administrador puede editar mensajes.";
      try {
        const finalChatId = targetChatId || currentChatId;
        const { getHistory } = await import('../db/index.js');
        const { bot } = await import('../bot/index.js');
        const history = await getHistory(finalChatId, 10);
        const lastAssistantMsg = history
          .filter(m => m.role === 'assistant' && m.msg_id)
          .pop();
        if (!lastAssistantMsg || !lastAssistantMsg.msg_id) {
          return `No encontré ningún mensaje reciente tuyo en ${finalChatId} que pueda editar.`;
        }
        await bot.api.editMessageText(finalChatId, Number(lastAssistantMsg.msg_id), nuevo_texto, {
          parse_mode: 'HTML'
        });
        return "✅ Mensaje editado correctamente.";
      } catch (e: any) {
        return `❌ Error al editar mensaje: ${e.message}`;
      }
    }
  },

  listar_entidades_biblioteca: {
    name: 'listar_entidades_biblioteca',
    description: 'Muestra la lista completa de todos los maquetadores o traductores registrados en la biblioteca, ordenados por actividad.',
    parameters: {
      type: 'object',
      properties: {
        entidad: { type: 'string', enum: ['maquetador', 'traductor'], description: 'El tipo de entidad a listar.' }
      },
      required: ['entidad']
    },
    execute: async ({ entidad }, { chatId }) => {
      try {
        const { getChatFeatures } = await import('../db/settings.js');
        const features = await getChatFeatures(chatId);
        if (!features.includes('library')) return "Error: La función de biblioteca no está habilitada.";

        const column = entidad === 'maquetador' ? 'layout_by' : 'translator';
        
        // Usamos una query RPC o una selección manual ya que Supabase no tiene "DISTINCT COUNT" directo fácilmente vía JS sin wrappers
        // Pero podemos obtener los datos y procesarlos
        const { data, error } = await db
          .from('books')
          .select(column)
          .not(column, 'is', null)
          .neq(column, '');

        if (error) return `Error al consultar entidades: ${error.message}`;
        if (!data || data.length === 0) return `No hay ${entidad}es registrados en la biblioteca.`;

        // Contar ocurrencias
        const counts: Record<string, number> = {};
        data.forEach((item: any) => {
          const name = item[column].trim();
          counts[name] = (counts[name] || 0) + 1;
        });

        // Ordenar y formatear
        const sorted = Object.entries(counts)
          .sort(([, a], [, b]) => b - a);

        const list = sorted.map(([name, count]) => `• <b>${name}</b> (${count} libros)`).join('\n');
        return `📋 <b>Lista de ${entidad === 'maquetador' ? 'Maquetadores' : 'Traductores'}:</b>\n\n${list}`;
      } catch (err: any) {
        return `Error: ${err.message}`;
      }
    }
  },

  borrar_mensaje_propio: {
    name: 'borrar_mensaje_propio',
    description: 'Elimina tu último mensaje enviado (o uno específico por ID) en este chat. Úsalo si el [ADMIN] te ordena borrar lo que dijiste.',
    parameters: {
      type: 'object',
      properties: {
        chatId: { type: 'string', description: 'Opcional: ID del chat.' },
        messageId: { type: 'number', description: 'Opcional: ID del mensaje específico a borrar. Si no se da, borra el último tuyo.' }
      }
    },
    execute: async ({ chatId: targetChatId, messageId }, { chatId: currentChatId, isAdmin }) => {
      if (!isAdmin) return "Error: Solo el administrador puede borrar mensajes.";
      try {
        const finalChatId = targetChatId || currentChatId;
        const { bot } = await import('../bot/index.js');
        const { getHistory } = await import('../db/index.js');
        
        let msgToDelete = messageId;
        if (!msgToDelete) {
          const history = await getHistory(finalChatId, 10);
          const lastAssistantMsg = history.filter(m => m.role === 'assistant' && m.msg_id).pop();
          if (!lastAssistantMsg || !lastAssistantMsg.msg_id) return "No encontré mensajes tuyos para borrar.";
          msgToDelete = Number(lastAssistantMsg.msg_id);
        }

        await bot.api.deleteMessage(finalChatId, msgToDelete);
        return "[SILENCE]";
      } catch (e: any) {
        return `❌ Error al borrar: ${e.message}`;
      }
    }
  },

  limpiar_ultimo_seguimiento: {
    name: 'limpiar_ultimo_seguimiento',
    description: 'Borra los últimos N mensajes que tú (el bot) has enviado en este hilo. Úsalo para limpiar "estupideces" o errores en cadena.',
    parameters: {
      type: 'object',
      properties: {
        cantidad: { type: 'number', description: 'Número de mensajes tuyos a borrar (máx 5).' }
      },
      required: ['cantidad']
    },
    execute: async ({ cantidad }, { chatId, isAdmin }) => {
      if (!isAdmin) return "Error: Solo el administrador puede limpiar hilos.";
      try {
        const { bot } = await import('../bot/index.js');
        const { getHistory } = await import('../db/index.js');
        const history = await getHistory(chatId, 50);
        const assistantMsgs = history
          .filter(m => m.role === 'assistant' && m.msg_id)
          .reverse()
          .slice(0, Math.min(cantidad, 5));

        if (assistantMsgs.length === 0) return "No encontré mensajes recientes para limpiar.";

        for (const msg of assistantMsgs) {
          try {
            await bot.api.deleteMessage(chatId, Number(msg.msg_id));
          } catch (e) {}
        }
        return "[SILENCE]";
      } catch (e: any) {
        return `❌ Error en limpieza: ${e.message}`;
      }
    }
  },

  borrar_este_mensaje: {
    name: 'borrar_este_mensaje',
    description: 'Elimina el mensaje que el usuario está CITANDO (respondiendo). Úsalo solo si el usuario te cita y te pide borrarlo.',
    parameters: { type: 'object', properties: {} },
    execute: async (_, { chatId, quotedMsgId, qIsAssistant }) => {
      try {
        if (!quotedMsgId) return "No estás citando ningún mensaje para borrar.";
        if (!qIsAssistant) return "Ese mensaje no es mío, no puedo borrarlo. Solo puedo borrar mis propios mensajes.";
        
        const { bot } = await import('../bot/index.js');
        await bot.api.deleteMessage(chatId, quotedMsgId);
        return "[SILENCE]";
      } catch (e: any) {
        return `❌ Error al borrar el mensaje citado: ${e.message}`;
      }
    }
  },
  
  configurar_autofix_twitter: {
    name: 'configurar_autofix_twitter',
    description: 'Activa o desactiva la corrección automática de enlaces de Twitter/X. Los ADMINISTRADORES pueden aplicarlo a otros si conocen su ID.',
    parameters: {
      type: 'object',
      properties: {
        activar: { type: 'boolean', description: 'Si es true, se activa el auto-fix; si es false, se desactiva.' },
        targetUserId: { type: 'string', description: 'Opcional. ID del usuario a configurar (solo para ADMINISTRADORES).' }
      },
      required: ['activar']
    },
    execute: async ({ activar, targetUserId }, { userId, isAdmin }) => {
        const finalUserId = (isAdmin && targetUserId) ? targetUserId : userId;
        try {
            const { setTwitterAutoFix } = await import('../db/index.js');
            await setTwitterAutoFix(finalUserId, activar);
            return `✅ La corrección automática de enlaces de Twitter/X ha sido ${activar ? 'ACTIVADA' : 'DESACTIVADA'} para ${finalUserId === userId ? 'ti' : 'el usuario ' + finalUserId}.`;
        } catch (e: any) {
            return `Error: ${e.message}`;
        }
    }
  },
  set_state: {
    name: 'set_state',
    description: 'Establece el estado emocional (humor, animo, reactividad) para un hilo específico. Solo para ADMINISTRADORES.',
    parameters: {
      type: 'object',
      properties: {
        chatId: { type: 'string', description: 'ID del chat' },
        threadId: { type: 'string', description: 'ID del hilo' },
        humor: { type: 'number', description: 'Humor (0-100)' },
        animo: { type: 'number', description: 'Animo (0-100)' },
        reactividad: { type: 'number', description: 'Reactividad (0-100)' }
      },
      required: ['chatId']
    },
    execute: async ({ chatId, threadId, humor, animo, reactividad }, { isAdmin }) => {
      if (!isAdmin) return "Error: No autorizado.";
      const { setEmotionalState } = await import('../db/settings.js');
      await setEmotionalState(chatId, { humor, animo, reactividad }, threadId);
      return `✅ Estado emocional actualizado en ${chatId} (${threadId || 'Global'}).`;
    }
  },
  set_personality: {
    name: 'set_personality',
    description: 'Establece la personalidad base para un hilo específico. Solo para ADMINISTRADORES.',
    parameters: {
      type: 'object',
      properties: {
        chatId: { type: 'string', description: 'ID del chat' },
        threadId: { type: 'string', description: 'ID del hilo' },
        persona: { type: 'string', description: 'Instrucciones de personalidad' }
      },
      required: ['chatId', 'persona']
    },
    execute: async ({ chatId, threadId, persona }, { isAdmin }) => {
      if (!isAdmin) return "Error: No autorizado.";
      const { setPersonality } = await import('../db/settings.js');
      await setPersonality(chatId, persona, threadId);
      return `✅ Personalidad actualizada en ${chatId} (${threadId || 'Global'}).`;
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

export const executeTool = async (name: string, args: any, context: { chatId: string, userId: string, quotedMsgId?: number, qIsAssistant?: boolean, isAdmin: boolean }) => {
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
