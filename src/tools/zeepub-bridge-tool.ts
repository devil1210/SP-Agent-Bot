/**
 * zeepub-bridge-tool.ts
 * 
 * Herramienta MCP que conecta SPbot (Telegram) con el backend Zeepub-bot (FastAPI/Python).
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

  const cleanBase = baseUrl.replace(/\/+$/, ''); // Eliminar slashes al final
  const cleanPath = path.startsWith('/') ? path : `/${path}`; // Asegurar slash al inicio
  const url = `${cleanBase}${cleanPath}`;
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
  zeepub_buscar: {
    name: 'zeepub_buscar',
    description: 'Busca libros, series, autores o traductores en la base de datos de Zeepub-bot en tiempo real.',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Término de búsqueda' },
        tipo: { type: 'string', enum: ['libro', 'serie', 'autor', 'maquetador', 'traductor'] },
        limite: { type: 'number' }
      },
      required: ['query']
    },
    execute: async ({ query, tipo = 'serie', limite = 5 }: any) => {
      try {
        const params = new URLSearchParams({ q: query, limit: String(limite) });
        const results = await zeepubFetch(`/bridge/books?${params}`);
        if (!results || !Array.isArray(results) || results.length === 0) return `No encontré resultados.`;
        const formatted = results.slice(0, limite).map((item: any) => `• <b>${item.title || 'Sin título'}</b> (v${item.volume || '?'})`).join('\n');
        return `📚 <b>Resultados:</b>\n${formatted}`;
      } catch (e: any) {
        return `⚠️ Error: ${e.message}`;
      }
    }
  },
  zeepub_estadisticas: {
    name: 'zeepub_estadisticas',
    description: 'Obtiene estadísticas globales de la biblioteca Zeepub.',
    parameters: { type: 'object', properties: {} },
    execute: async () => {
      try {
        const data = await zeepubFetch('/api/status/');
        return `📊 <b>Stats:</b> Books: ${data.library.total_books}, Uptime: ${data.uptime}`;
      } catch (e: any) {
        return `⚠️ Error: ${e.message}`;
      }
    }
  },
  zeepub_estado: {
    name: 'zeepub_estado',
    description: 'Estado del servidor Zeepub.',
    parameters: { type: 'object', properties: {} },
    execute: async () => {
      try {
        const data = await zeepubFetch('/bridge/status');
        return `✅ Online - Bridge v${data.bridge_version}`;
      } catch (e: any) {
        return `❌ Offline - ${e.message}`;
      }
    }
  }
};
