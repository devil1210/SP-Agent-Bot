import { config } from '../config.js';

export const searchTools = {
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
    execute: async ({ query }: any, _context: any) => {
      try {
        const response = await fetch('https://api.tavily.com/search', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ api_key: config.tavilyApiKey, query, search_depth: 'basic' })
        });
        const data = await response.json();
        return JSON.stringify(data.results);
      } catch (err: any) { 
        return `Error: ${err.message}`;
      }
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
    execute: async ({ query }: any, { chatId, threadId, isAdmin }: any) => {
      if (!isAdmin) {
        const { getPersonalityParams } = await import('../db/settings.js');
        const params = await getPersonalityParams(chatId, threadId);
        if (!params.can_search_images) return 'Error: La búsqueda de imágenes no está habilitada en este hilo.';
      }
      try {
        const response = await fetch('https://api.tavily.com/search', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ api_key: config.tavilyApiKey, query, search_depth: 'advanced', include_images: true, max_results: 5 })
        });
        const data = await response.json();
        const images = data.images || [];
        const filteredImages = images.map((img: any) => {
          const url = typeof img === 'string' ? img : (img.url || img.image);
          if (!url) return null;
          const oldYears = ['2019','2020','2021','2022','2023','2024'];
          if (oldYears.some(year => url.includes(year))) return null;
          if (url.includes('instagram.com/seo') || url.includes('crawler')) return null;
          return url;
        }).filter(Boolean);

        if (filteredImages.length > 0) {
          return filteredImages.map((url: string) => `- Opción: ${url}`).join('\n');
        }
        return 'No se encontraron imágenes ACTUALES (2025-2026).';
      } catch (err: any) { return `Error en búsqueda de imágenes: ${err.message}`; }
    }
  },

  radar_de_tendencias: {
    name: 'radar_de_tendencias',
    description: 'Analiza temas candentes, tendencias actuales y noticias de última hora.',
    parameters: {
      type: 'object',
      properties: {
        contexto: { type: 'string', description: 'Región o tema específico (ej: "Chile", "Tecnología", "Global")' },
      },
      required: ['contexto'],
    },
    execute: async ({ contexto }: any, _context: any) => {
      try {
        const query = `últimas noticias tendencias hoy ${contexto} breaking news top stories`;
        const response = await fetch('https://api.tavily.com/search', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ api_key: config.tavilyApiKey, query, search_depth: 'advanced', include_answer: true, max_results: 10 })
        });
        const data = await response.json();
        const results = data.results || [];

        let report = `REPORTE DE TENDENCIAS: ${contexto}\n`;
        report += `RESUMEN GENERAL: ${data.answer || 'No hay resumen disponible.'}\n\n`;
        report += results.map((r: any, i: number) => `NOTICIA ${i+1}:\n- TÍTULO: ${r.title}\n- URL: ${r.url}\n- INFO: ${r.content?.substring(0,200) || ''}`).join('\n\n');
        return report;
      } catch (err: any) {
        return `Error en el radar: ${err.message}`;
      }
    }
  }
};