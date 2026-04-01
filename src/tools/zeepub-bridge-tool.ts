/**
 * zeepub-bridge-tool.ts
 * 
 * Herramienta MCP que conecta SPbot (Telegram) con el backend Zeepub-bot (FastAPI/Python).
 * Permite al agente consultar la API REST de Zeepub directamente desde el Turn Loop.
 * 
 * Arquitectura: SPbot Agent → zeepub_* tools → Zeepub FastAPI → PostgreSQL
 * 
 * Configuración requerida en .env:
 *   ZEEPUB_API_URL=http://localhost:8000   (URL del servidor Zeepub)
 *   ZEEPUB_API_KEY=tu_api_key              (Token de acceso interno)
 */

import { config } from '../config.js';

// ── Cliente HTTP interno para Zeepub ──────────────────────────────────────────

async function zeepubFetch(path: string, options: RequestInit = {}): Promise<any> {
  const baseUrl = (config as any).zeepubApiUrl || 'http://localhost:8000';
  const apiKey = (config as any).zeepubApiKey || '';

  const headers: any = {
    'Content-Type': 'application/json',
    ...(apiKey ? { 'X-API-Key': apiKey } : {}),
    ...(options.headers || {})
  };

  const url = `${baseUrl}${path}`;
  console.log(`[Zeepub:Bridge] 🌉 → ${url}`);

  try {
    const res = await fetch(url, { ...options, headers, signal: AbortSignal.timeout(8000) });
    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Zeepub API error (${res.status}): ${errText.substring(0, 200)}`);
    }
    return await res.json();
  } catch (e: any) {
    throw new Error(`No se pudo conectar con el servidor Zeepub: ${e.message}`);
  }
}

// ── Herramientas del puente ───────────────────────────────────────────────────

export const zeepubBridgeTools = {

  // ── Búsqueda en tiempo real en el catálogo de Zeepub ──────────────────────
  zeepub_buscar: {
    name: 'zeepub_buscar',
    description: 'Busca libros, series, autores o traductores en la base de datos de Zeepub-bot en tiempo real. Usa esta herramienta para responder preguntas sobre el catálogo de la biblioteca.',
    parameters: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Término de búsqueda: título, autor, serie o traductor'
        },
        tipo: {
          type: 'string',
          enum: ['libro', 'serie', 'autor', 'maquetador', 'traductor'],
          description: 'Tipo de búsqueda (por defecto: serie)'
        },
        limite: {
          type: 'number',
          description: 'Número máximo de resultados (por defecto: 5)'
        }
      },
      required: ['query']
    },
    execute: async ({ query, tipo = 'serie', limite = 5 }: any) => {
      try {
        const params = new URLSearchParams({
          q: query,
          type: tipo,
          limit: String(limite)
        });
        const data = await zeepubFetch(`/api/search?${params}`);

        if (!data || (!data.results && !data.items && !Array.isArray(data))) {
          return `No encontré resultados para "${query}" en el catálogo de Zeepub.`;
        }

        const results = data.results || data.items || data;
        if (!Array.isArray(results) || results.length === 0) {
          return `No hay resultados para "${query}" en la biblioteca.`;
        }

        const formatted = results.slice(0, limite).map((item: any) => {
          const name = item.name || item.title || item.series_spanish || item.series_english || 'Sin título';
          const author = item.author ? ` — <i>${item.author}</i>` : '';
          const count = item.book_count ? ` (${item.book_count} vol.)` : '';
          const desc = item.description ? `\n   <i>${item.description.substring(0, 120)}...</i>` : '';
          return `• <b>${name}</b>${author}${count}${desc}`;
        }).join('\n\n');

        return `📚 <b>Resultados en Zeepub para "${query}":</b>\n\n${formatted}`;
      } catch (e: any) {
        return `⚠️ Error consultando Zeepub: ${e.message}`;
      }
    }
  },

  // ── Estadísticas globales del catálogo ────────────────────────────────────
  zeepub_estadisticas: {
    name: 'zeepub_estadisticas',
    description: 'Obtiene estadísticas globales de la biblioteca Zeepub: total de libros, series, maquetadores, etc.',
    parameters: {
      type: 'object',
      properties: {}
    },
    execute: async () => {
      try {
        const data = await zeepubFetch('/api/stats');

        const series = data.total_series ?? data.series ?? '?';
        const books = data.total_books ?? data.books ?? '?';
        const maquetadores = data.total_maquetadores ?? data.maquetadores ?? '?';
        const traductores = data.total_traductores ?? data.traductores ?? '?';

        return `📊 <b>Estado de la Biblioteca Zeepub:</b>\n\n` +
               `📚 <b>Series:</b> ${series}\n` +
               `📄 <b>Libros (EPUB/PDF):</b> ${books}\n` +
               `🎨 <b>Maquetadores:</b> ${maquetadores}\n` +
               `🌐 <b>Traductores:</b> ${traductores}`;
      } catch (e: any) {
        return `⚠️ No se pudo obtener estadísticas de Zeepub: ${e.message}`;
      }
    }
  },

  // ── Health check del servidor Zeepub ──────────────────────────────────────
  zeepub_estado: {
    name: 'zeepub_estado',
    description: 'Verifica si el servidor Zeepub-bot está online y operativo.',
    parameters: {
      type: 'object',
      properties: {}
    },
    execute: async () => {
      try {
        const start = Date.now();
        const data = await zeepubFetch('/health');
        const ms = Date.now() - start;
        const status = data.status || 'ok';
        return `✅ <b>Zeepub-bot online</b> — Estado: <code>${status}</code> | Latencia: <code>${ms}ms</code>`;
      } catch (e: any) {
        return `❌ <b>Zeepub-bot offline</b> — ${e.message}`;
      }
    }
  }

};
