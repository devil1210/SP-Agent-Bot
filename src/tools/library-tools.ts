import { db } from '../db/index.js';
import { config } from '../config.js';

export const libraryTools = {
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
    execute: async ({ query }: any, { chatId }: any) => {
      try {
        const { getChatFeatures } = await import('../db/settings.js');
        const features = await getChatFeatures(chatId);
        if (!features.includes('library')) return 'Error: La función de consulta de biblioteca no está habilitada en este chat.';

        const { data: seriesData, error: seriesError } = await db
          .from('series')
          .select('name, series_spanish, series_english, author, description, book_count')
          .or(`name.ilike.%${query}%,series_spanish.ilike.%${query}%,series_english.ilike.%${query}%`)
          .limit(3);

        if (seriesError) return `Error al consultar series: ${seriesError.message}`;

        if (seriesData && seriesData.length > 0) {
          return seriesData.map((s: any) => {
            const nombre = s.series_spanish || s.series_english || s.name;
            const desc = s.description ? `\n\n<b>Sinopsis:</b> ${s.description}` : '\n(Sin sinopsis disponible)';
            return `✅ <b>${nombre}</b> de ${s.author || 'Autor desconocido'}.\n📚 Disponibles: ${s.book_count || 0} volúmenes.${desc}`;
          }).join('\n\n---\n\n');
        }

        const { data: bookData, error: bookError } = await db
          .from('books')
          .select('title')
          .ilike('title', `%${query}%`)
          .limit(1);

        if (bookError) return `Error al consultar libros: ${bookError.message}`;
        if (!bookData || bookData.length === 0) return 'No encontré ese título o serie en tu biblioteca.';

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

        if (seriesError || booksError) return 'Error consultando estadísticas.';

        return `📊 <b>Estado de la Biblioteca ZeePub:</b>\n\n` +
               `📚 <b>Series:</b> ${seriesCount || 0}\n` +
               `📄 <b>Archivos (EPUB/PDF):</b> ${booksCount || 0}\n\n` +
               `¡Una colección legendaria! 🔥`;
      } catch (err: any) {
        return `Error: ${err.message}`;
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
    execute: async ({ maquetador, traductor, autor, recientes }: any, { chatId }: any) => {
      try {
        const { getChatFeatures } = await import('../db/settings.js');
        const features = await getChatFeatures(chatId);
        if (!features.includes('library')) return 'Error: La función de búsqueda avanzada no está habilitada en este chat.';

        let queryBuilder: any = db.from('books').select('title, layout_by, translator, author, indexed_at', { count: 'exact' });

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
        if (!data || data.length === 0) return 'No se encontraron resultados para esos filtros.';

        const lista = data.map((b: any) => `• <b>${b.title}</b>`).join('\n');
        let summary = `🔍 <b>Resultados:</b> Se encontraron <b>${count}</b> libros.\n\n${lista}`;
        if (count && count > 20) summary += `\n\n<i>...y ${count - 20} más.</i>`;
        return summary;
      } catch (err: any) {
        return `Error: ${err.message}`;
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
    execute: async ({ entidad }: any, { chatId }: any) => {
      try {
        const { getChatFeatures } = await import('../db/settings.js');
        const features = await getChatFeatures(chatId);
        if (!features.includes('library')) return 'Error: La función de biblioteca no está habilitada.';

        const column = entidad === 'maquetador' ? 'layout_by' : 'translator';
        const { data, error } = await db
          .from('books')
          .select(column)
          .not(column, 'is', null)
          .neq(column, '');

        if (error) return `Error al consultar entidades: ${error.message}`;
        if (!data || data.length === 0) return `No hay ${entidad}es registrados en la biblioteca.`;

        const counts: Record<string, number> = {};
        data.forEach((item: any) => {
          const name = item[column].trim();
          counts[name] = (counts[name] || 0) + 1;
        });

        const sorted = Object.entries(counts).sort(([, a], [, b]) => b - a);
        const list = sorted.map(([name, count]) => `• <b>${name}</b> (${count} libros)`).join('\n');
        return `📋 <b>Lista de ${entidad === 'maquetador' ? 'Maquetadores' : 'Traductores'}:</b>\n\n${list}`;
      } catch (err: any) {
        return `Error: ${err.message}`;
      }
    }
  }
};