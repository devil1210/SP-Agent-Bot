import { config } from '../config.js';

export interface Message {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | any[] | null; 
  name?: string;
  tool_calls?: any[];
  tool_call_id?: string;
}

export interface LLMResponse {
  message: Message;
  provider: string;
}

const GEMINI_API_URL = 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions';
const OPENROUTER_API_URL = 'https://openrouter.ai/api/v1/chat/completions';
const GROQ_API_URL = 'https://api.groq.com/openai/v1/chat/completions';

function buildSystemPrompt(activeProvider: string, personality: string | null) {
    const now = new Date();
    const dateStr = now.toLocaleDateString('es-ES', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
    
const base = `Eres SP-Agent. Hoy es ${dateStr}.
REGLAS CRÍTICAS:
1. ID: Tu motor es ${activeProvider}.
2. SIN SALUDOS: PROHIBIDO saludar (Hola, Hola de nuevo) o hacer introducciones formales. Ve directo al grano.
3. SIN MARKDOWN: PROHIBIDO usar asteriscos (**), almohadillas (###) o backticks (\`). 
   - SI QUIERES NEGRITA: Usa solo <b>texto</b>.
4. FORMATO HTML: Usa ÚNICAMENTE etiquetas HTML permitidas (<b>, <i>, <a>).
5. NOTICIAS EN LISTA: Cada punto de una lista de noticias DEBE ser un link HTML.
   - EJEMPLO: "• <b><a href='URL'>Título</a></b>: descripción."
6. IMÁGENES: Solo si es relevante. Máximo 1.
   - REGLA: Filtra URLs con años antiguos (2019-2024). Solo 2025/2026.
   - FORMATO: Envía "IMAGE_URL_DETECTED: URL" al final del mensaje.
7. ESTILO: Muy breve, directo y usa muchos emojis. Eres un integrante más de la conversación.
8. SILENCIO INTELIGENTE: Si estás en un hilo habilitado y el mensaje no es una pregunta, una petición directa o algo relevante donde puedas aportar valor real, responde ÚNICAMENTE con la palabra [SILENCE]. No digas nada más.`;
    
    return personality ? `${base}\nPERSONALIDAD:\n${personality}` : base;
}

function cleanMessages(messages: Message[]): any[] {
  return messages
    .filter(m => m.role !== 'system')
    .map(m => {
        const cleaned: any = { role: m.role, content: m.content };
        if (m.name) cleaned.name = m.name;
        if (m.tool_calls) cleaned.tool_calls = m.tool_calls;
        if (m.tool_call_id) cleaned.tool_call_id = m.tool_call_id;
        return cleaned;
    });
}

async function fetchWithTimeout(url: string, options: any, timeout = 10000) {
    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), timeout);
    try {
        const response = await fetch(url, { ...options, signal: controller.signal });
        clearTimeout(id);
        return response;
    } catch (e) {
        clearTimeout(id);
        throw e;
    }
}

async function callProvider(url: string, key: string, body: any, providerLabel: string) {
    if (!key || key.includes('SUTITUYE') || key === '') return null;
    try {
        const headers: any = {
            'Authorization': `Bearer ${key}`,
            'Content-Type': 'application/json'
        };
        if (url.includes('openrouter')) {
            headers['HTTP-Referer'] = 'http://localhost:3000';
            headers['X-Title'] = 'SP-Agent';
        }

        const res = await fetchWithTimeout(url, {
            method: 'POST',
            headers,
            body: JSON.stringify(body)
        });

        if (!res.ok) {
            const err = await res.text();
            console.error(`[LLM Chain] ${providerLabel} error (${res.status}): ${err}`);
            return null;
        }

        const json = await res.json();
        if (!json.choices || !json.choices[0] || !json.choices[0].message) {
            return null;
        }
        return json.choices[0].message;
    } catch (e: any) {
        console.error(`[LLM Chain] ${providerLabel} exception: ${e.message}`);
        return null;
    }
}

export const callLLM = async (
    messages: Message[], 
    toolsDefinition: any[], 
    model: string = 'gemini-3.1-flash-lite-preview',
    personality: string | null = null
): Promise<LLMResponse> => {
  
  const baseMessages = cleanMessages(messages);
  console.log(`[LLM Chain] Seleccionando motor primario...`);

  // Solo enviamos herramientas si hay alguna definida
  const tools = (toolsDefinition && toolsDefinition.length > 0) ? toolsDefinition : undefined;

  // 1. Gemini (Primario - 3.1 Flash Lite Preview)
  // Mapeo inteligente para evitar errores de nombres comunes
  const modelMap: Record<string, string> = {
    'gemini-3.1-flash-lite': 'gemini-3.1-flash-lite-preview',
    'gemini-flash-lite': 'gemini-3.1-flash-lite-preview',
    'gemini-3.1-flash': 'gemini-3.1-flash-12b-latest', // O el que prefieras
  };
  
  const targetModel = modelMap[model] || model;
  const geminiProvider = `Gemini (${targetModel})`;
  const geminiModelId = targetModel.startsWith('models/') ? targetModel : `models/${targetModel}`;
  const geminiBody: any = {
    model: geminiModelId,
    messages: [{ role: 'system', content: buildSystemPrompt(geminiProvider, personality) }, ...baseMessages],
    temperature: 0.1
  };
  if (tools) geminiBody.tools = tools;
  
  const geminiRes = await callProvider(GEMINI_API_URL, config.geminiApiKey, geminiBody, 'Gemini');
  if (geminiRes) {
      console.log(`[LLM Chain] ✅ Respondido por Gemini (Primario)`);
      return { message: geminiRes, provider: geminiProvider };
  } else {
      console.log(`[LLM Chain] ⏭️ Gemini no disponible, intentando Groq...`);
  }

  // 2. Groq (Secundario)
  const groqProvider = `Groq (${config.groqModel})`;
  const groqBody: any = {
    model: config.groqModel,
    messages: [{ role: 'system', content: buildSystemPrompt(groqProvider, personality) }, ...baseMessages],
    temperature: 0.1
  };
  if (tools) {
      groqBody.tools = tools;
      groqBody.tool_choice = 'auto';
  }
  
  const groqRes = await callProvider(GROQ_API_URL, config.groqApiKey, groqBody, 'Groq');
  if (groqRes) {
      console.log(`[LLM Chain] ✅ Respondido por Groq`);
      return { message: groqRes, provider: groqProvider };
  } else {
      console.log(`[LLM Chain] ⏭️ Groq no disponible, saltando a OpenRouter...`);
  }

  // 3. OpenRouter (Último recurso)
  const orProvider = `OpenRouter (${config.openRouterModel})`;
  const orBody: any = {
    model: config.openRouterModel,
    messages: [{ role: 'system', content: buildSystemPrompt(orProvider, personality) }, ...baseMessages],
    temperature: 0.1
  };
  if (tools) orBody.tools = tools;

  const orRes = await callProvider(OPENROUTER_API_URL, config.openRouterApiKey, orBody, 'OpenRouter');
  if (orRes) {
      console.log(`[LLM Chain] ✅ Respondido por OpenRouter`);
      return { message: orRes, provider: orProvider };
  }

  throw new Error("Servicio no disponible (LLM Overload).");
};

export const generateEmbedding = async (text: string): Promise<number[]> => {
  // Volvemos a v1beta que es más flexible con los modelos de embeddings actuales
  const url = `https://generativelanguage.googleapis.com/v1beta/models/text-embedding-004:embedContent?key=${config.geminiApiKey}`;
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: "models/text-embedding-004", // Algunos endpoints lo requieren también en el body
        content: { parts: [{ text }] }
      })
    });
    
    // Si falla el text-embedding-004 (404), intentamos con el modelo universal embedding-001
    if (res.status === 404) {
        console.warn('[Embeddings] text-embedding-004 no disponible, probando con v1beta/embedding-001...');
        const fallbackUrl = `https://generativelanguage.googleapis.com/v1beta/models/embedding-001:embedContent?key=${config.geminiApiKey}`;
        const fallbackRes = await fetch(fallbackUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                model: "models/embedding-001",
                content: { parts: [{ text }] }
            })
        });
        if (!fallbackRes.ok) throw new Error(`Embedding API fallback error: ${fallbackRes.status}`);
        const data = await fallbackRes.json();
        return data.embedding.values;
    }

    if (!res.ok) throw new Error(`Embedding API error: ${res.status}`);
    const data = await res.json();
    return data.embedding.values;
  } catch (error) {
    console.error('Error generating embedding:', error);
    return new Array(768).fill(0); // Colchón de seguridad
  }
};
