import { getHistory } from '../db/index.js';
import { getPersonalityParams, getEmotionalState, savePersonalityParams, saveEmotionalState, getPersonality } from '../db/settings.js';
import { callLLM, Message } from './llm.js';

export type RefinementType = 'instant' | 'short' | 'deep';

export async function checkAndRefine(chatId: string, threadId?: string) {
  try {
    const params = await getPersonalityParams(chatId, threadId);
    const now = Date.now();
    const metadata = (params as any)._refinement || {};

    // 1. Instant (1h = 3600000ms)
    if (!metadata.last_instant || now - metadata.last_instant > 3600000) {
      await runRefinement(chatId, threadId, 'instant');
      metadata.last_instant = now;
    }

    // 2. Short (6h = 21600000ms)
    if (!metadata.last_short || now - metadata.last_short > 21600000) {
      await runRefinement(chatId, threadId, 'short');
      metadata.last_short = now;
    }

    // 3. Deep (24h = 86400000ms)
    if (!metadata.last_deep || now - metadata.last_deep > 86400000) {
      await runRefinement(chatId, threadId, 'deep');
      metadata.last_deep = now;
    }

    // Actualizar metadata silenciosamente en params
    (params as any)._refinement = metadata;
    await savePersonalityParams(chatId, threadId, params);

  } catch (e) {
    console.error(`[Refiner Error] Error during checkAndRefine:`, e);
  }
}

async function runRefinement(chatId: string, threadId: string | undefined, type: RefinementType) {
  console.log(`[Refiner] 🔄 Ejecutando refinamiento de tipo: ${type.toUpperCase()}`);
  
  // 1. Obtener historial relevante
  const limitMap = { instant: 10, short: 30, deep: 60 };
  const history = await getHistory(chatId, limitMap[type], threadId);
  if (history.length < 3) return; // No hay suficiente contexto para refinar

  const personality = await getPersonality(chatId, threadId);
  const currentParams = await getPersonalityParams(chatId, threadId);
  const currentState = await getEmotionalState(chatId, threadId);

  // 2. Construir Prompt del Refinador
  let objective = "";
  let targetFields = "";

  if (type === 'instant') {
    objective = "Analizar el tono de la última hora de charla (mensajes recientes).";
    targetFields = "SARCASMO, AGRESIVIDAD, REACTIVIDAD (solo estos 3).";
  } else if (type === 'short') {
    objective = "Analizar la atmósfera de las últimas 6 horas de charla.";
    targetFields = "HUMOR, ANIMO, INTERES (solo estos 3).";
  } else {
    objective = "Analizar la evolución de la relación con los usuarios en las últimas 24 horas.";
    targetFields = "EMPATIA, FRIALDAD, CREATIVIDAD, EMOCION (solo estos 4).";
  }

  const systemPrompt = `Eres el NÚCLEO PSICOLÓGICO del bot SP-Agent.
TU TAREA: ${objective}
PERSONALIDAD BASE: ${personality || 'Estándar'}

REGLAS DE AJUSTE (Escala 0-100):
- Analiza qué tan receptivos, hostiles o técnicos están los usuarios.
- Ajusta los parámetros indicados para que el bot resuene con el entorno.
- El cambio debe ser PROGRESIVO (no más de 15 puntos de diferencia respecto al valor actual).

CAMPOS A AJUSTAR: ${targetFields}

Responde ÚNICAMENTE con un objeto JSON plano con las claves en minúsculas y sus valores (0-100).
Ejemplo: {"sarcasmo": 45, "agresividad": 20}`;

  const messages: Message[] = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: `HISTORIAL PARA ANÁLISIS:\n${history.map(m => `${m.role === 'assistant' ? '🤖' : '👤'}: ${m.content}`).join('\n')}\n\nESTADO ACTUAL:\nParams: ${JSON.stringify(currentParams)}\nEmoción: ${JSON.stringify(currentState)}` }
  ];

  // 3. Llamar LLM (usamos lite para eficiencia)
  const llmRes = await callLLM(messages, [], 'gemini-3.1-flash-lite-preview', personality, [], 100, 'lite');
  
  try {
    const rawContent = typeof llmRes.message.content === 'string' ? llmRes.message.content : JSON.stringify(llmRes.message.content);
    // Limpiar posibles bloques de código markdown
    const jsonStr = rawContent.replace(/```json|```/g, '').trim();
    const result = JSON.parse(jsonStr);

    if (type === 'instant') {
      const newParams = { ...currentParams, ...result };
      delete (newParams as any)._refinement; // No guardar metadata en el objeto principal de DB si es complejo
      await savePersonalityParams(chatId, threadId, newParams);
    } else if (type === 'short') {
      const newState = { ...currentState, ...result };
      await saveEmotionalState(chatId, threadId, newState);
    } else {
      const newParams = { ...currentParams, ...result };
      await savePersonalityParams(chatId, threadId, newParams);
    }
    
    console.log(`[Refiner] ✅ Refinamiento ${type} completado:`, result);
  } catch (error) {
    console.error(`[Refiner] Error parseando JSON de refinamiento:`, error);
  }
}
