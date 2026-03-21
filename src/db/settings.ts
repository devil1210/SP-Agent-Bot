import { db, getHistory, addMemory, MemoryEntry } from './index.js';

/**
 * Acceso a configuraciones globales (usando un ID reservado en la DB)
 */
const GLOBAL_CONFIG_ID = 'system_global_config';

/**
 * Obtiene el historial de un chat filtrando por hilos si se proporciona.
 */
const getSettingsHistory = async (chatId: string, threadId?: string, limit: number = 100): Promise<MemoryEntry[]> => {
  let query = db
    .from('memory')
    .select('*')
    .eq('user_id', chatId);
  
  if (threadId) {
    query = query.eq('thread_id', threadId);
  } else {
    // Si no hay threadId, buscamos los que no tengan thread_id (configuraciones globales del chat)
    query = query.is('thread_id', null);
  }

  const { data, error } = await query
    .order('id', { ascending: false })
    .limit(limit);

  if (error) return [];
  return (data as MemoryEntry[] || []).reverse();
};

/**
 * Obtiene el modelo configurado para un usuario/chat.
 */
export const getUserModel = async (chatId: string, threadId?: string): Promise<string> => {
  try {
    const history = await getSettingsHistory(chatId, threadId); 
    const modelSetMsg = history
      .filter(m => m.role === 'assistant' && m.content.includes('Modelo cambiado a:'))
      .pop();

    if (modelSetMsg) {
      const match = modelSetMsg.content.match(/Modelo cambiado a: ([\w.-]+)/);
      if (match && match[1]) return match[1];
    }
    return 'gemini-3.1-flash-lite-preview'; 
  } catch (e) {
    return 'gemini-3.1-flash-lite-preview';
  }
};

/**
 * Gestión de Funcionalidades (Features) por chat/grupo
 * Posibles: 'library', 'dev_prod', 'dev_test'
 */
export const getChatFeatures = async (chatId: string): Promise<string[]> => {
  try {
    const history = await getSettingsHistory(chatId);
    const msg = history
      .filter(m => m.role === 'assistant' && m.content.includes('Features habilitadas:'))
      .pop();

    if (msg) {
      const match = msg.content.match(/Features habilitadas: \[(.*)\]/);
      if (match && match[1]) {
        return match[1].split(',').map((s: string) => s.trim()).filter((s: string) => s.length > 0);
      }
    }
    // Por defecto, habilitamos 'library' en todos los chats autorizados para evitar confusiones,
    // a menos que se deshabilite explícitamente (lo cual no está implementado aún pero se podría).
    return ['library'];
  } catch (e) {
    return ['library'];
  }
};

export const setChatFeatures = async (chatId: string, features: string[]): Promise<void> => {
  await addMemory(chatId, 'assistant', `Features habilitadas: [${features.join(', ')}]`);
};

export const setUserModel = async (chatId: string, model: string, threadId?: string): Promise<void> => {
  await addMemory(chatId, 'assistant', `Modelo cambiado a: ${model}`, threadId);
};

/**
 * Gestión de la Personalidad (/persona) por chat/grupo
 */
export const getPersonality = async (chatId: string, threadId?: string): Promise<string | null> => {
  try {
    const history = await getSettingsHistory(chatId, threadId);
    const persMsg = history
      .filter(m => m.role === 'assistant' && m.content.includes('Personalidad definida:'))
      .pop();

    if (persMsg) {
      const match = persMsg.content.match(/Personalidad definida: (.*)/s);
      if (match && match[1]) return match[1].trim();
    }
    return null;
  } catch (e) {
    return null;
  }
};

export const setPersonality = async (chatId: string, persona: string, threadId?: string): Promise<void> => {
  await addMemory(chatId, 'assistant', `Personalidad definida: ${persona}`, threadId);
};

/**
 * Gestión del Nivel de Intervención (0-100%)
 */
export const getInterventionLevel = async (chatId: string, threadId?: string): Promise<number> => {
  try {
    const history = await getSettingsHistory(chatId, threadId);
    const msg = history
      .filter(m => m.role === 'assistant' && m.content.includes('Intervention level set:'))
      .pop();

    if (msg) {
      const match = msg.content.match(/Intervention level set: (\d+)/);
      if (match && match[1]) return Math.min(100, Math.max(0, parseInt(match[1])));
    }
    // Por defecto 100% (comportamiento actual)
    return 100;
  } catch (e) {
    return 100;
  }
};

export const setInterventionLevel = async (chatId: string, level: number, threadId?: string): Promise<void> => {
  await addMemory(chatId, 'assistant', `Intervention level set: ${level}%`, threadId);
};

/**
 * Obtiene los hilos (Forum Topics) permitidos para un chat.
 */
export const getAllowedThreads = async (chatId: string): Promise<number[]> => {
  try {
    const history = await getSettingsHistory(chatId);
    const threadsMsg = history
      .filter(m => m.role === 'assistant' && m.content.includes('Topics permitidos:'))
      .pop();

    if (threadsMsg) {
      const match = threadsMsg.content.match(/Topics permitidos: \[(.*)\]/);
      if (match && match[1]) {
        return match[1].split(',').map((s: string) => parseInt(s.trim())).filter((n: number) => !isNaN(n));
      }
    }
    return [];
  } catch (e) {
    return [];
  }
};

export const setAllowedThreads = async (chatId: string, threadIds: number[]): Promise<void> => {
  await addMemory(chatId, 'assistant', `Topics permitidos: [${threadIds.join(', ')}]`);
};

export const getPassiveThreads = async (chatId: string): Promise<number[]> => {
  try {
    const history = await getSettingsHistory(chatId);
    const threadsMsg = history
      .filter(m => m.role === 'assistant' && m.content.includes('Topics pasivos:'))
      .pop();

    if (threadsMsg) {
      const match = threadsMsg.content.match(/Topics pasivos: \[(.*)\]/);
      if (match && match[1]) {
        return match[1].split(',').map((s: string) => parseInt(s.trim())).filter((n: number) => !isNaN(n));
      }
    }
    return [];
  } catch (e) {
    return [];
  }
};

export const setPassiveThreads = async (chatId: string, threadIds: number[]): Promise<void> => {
  await addMemory(chatId, 'assistant', `Topics pasivos: [${threadIds.join(', ')}]`);
};

/**
 * Gestión de Grupos Autorizados (Global)
 */
export const getAuthorizedGroups = async (): Promise<{id: string, name: string}[]> => {
  try {
    const history = await getHistory(GLOBAL_CONFIG_ID, 100);
    const lastConfig = history
      .filter(m => m.role === 'assistant' && m.content.includes('Grupos autorizados:'))
      .pop();

    if (lastConfig) {
      const match = lastConfig.content.match(/Grupos autorizados: \[(.*)\]/);
      if (match && match[1]) {
        return match[1].split(',').map((s: string) => {
          const part = s.trim();
          // Regex mejorada: Nombre (ID) -> Soporta espacios y signos
          const nameMatch = part.match(/^(.+?)\s*\(((-?\d+))\)$/);
          if (nameMatch) {
              return { name: nameMatch[1], id: nameMatch[2] };
          }
          // Fallback para formato viejo: solo ID
          if (/^-?\d+$/.test(part)) {
              return { id: part, name: 'Grupo Desconocido' };
          }
          return { id: part, name: 'Formato Inválido' };
        }).filter((g: any) => g.name !== 'Formato Inválido');
      }
    }
    return [];
  } catch (e) {
    return [];
  }
};

export const authorizeGroup = async (chatId: string, name: string = 'Grupo'): Promise<void> => {
  let current = await getAuthorizedGroups();
  // Filtramos el ID si ya existe para actualizar el nombre
  current = current.filter(g => g.id !== chatId);
  const newList = [...current, { id: chatId, name }];
  const serialized = newList.map(g => `${g.name} (${g.id})`).join(', ');
  await addMemory(GLOBAL_CONFIG_ID, 'assistant', `Grupos autorizados: [${serialized}]`);
};

export const revokeGroup = async (chatId: string): Promise<void> => {
  let current = await getAuthorizedGroups();
  current = current.filter(g => g.id !== chatId);
  const serialized = current.map(g => `${g.name} (${g.id})`).join(', ');
  await addMemory(GLOBAL_CONFIG_ID, 'assistant', `Grupos autorizados: [${serialized}]`);
};

/**
 * Mapeo de Nombres de Hilos (Discovery)
 */
export const setThreadName = async (chatId: string, threadId: number, name: string): Promise<void> => {
  await addMemory(chatId, 'assistant', `ThreadName [${threadId}]: ${name}`);
};

export const getKnownThreads = async (chatId: string): Promise<{id: number, name: string}[]> => {
  try {
    const history = await getSettingsHistory(chatId);
    const threadMap: Record<number, string> = { 1: 'General' };
    
    history
      .filter(m => m.role === 'assistant' && m.content.includes('ThreadName ['))
      .forEach(m => {
        const match = m.content.match(/ThreadName \[(\d+)\]: (.*)/);
        if (match) {
          threadMap[parseInt(match[1])] = match[2];
        }
      });

    return Object.entries(threadMap).map(([id, name]) => ({ id: parseInt(id), name }));
  } catch (e) {
    return [{ id: 1, name: 'General' }];
  }
};
/**
 * BIBLIOTECA DE PERSONALIDADES (/savepersona, /personas, /setpersona)
 * Estas se guardan de forma global para que estén disponibles en cualquier chat.
 */
export const getSavedPersonalities = async (): Promise<{name: string, content: string}[]> => {
  try {
    const history = await getHistory(GLOBAL_CONFIG_ID, 200);
    const personas: {name: string, content: string}[] = [];
    
    history
      .filter(m => m.role === 'assistant' && m.content.startsWith('SavedPersona ['))
      .forEach(m => {
        const match = m.content.match(/^SavedPersona \[(.*?)\]: (.*)/s);
        if (match) {
          // Si el nombre ya existe, lo actualizamos (quedándonos con el último)
          const name = match[1].trim();
          const content = match[2].trim();
          const existingIdx = personas.findIndex(p => p.name.toLowerCase() === name.toLowerCase());
          if (existingIdx >= 0) {
            personas[existingIdx].content = content;
          } else {
            personas.push({ name, content });
          }
        }
      });
    return personas;
  } catch (e) {
    return [];
  }
};

export const savePersonality = async (name: string, content: string): Promise<void> => {
  await addMemory(GLOBAL_CONFIG_ID, 'assistant', `SavedPersona [${name}]: ${content}`);
};

/**
 * Nota: El borrado físico no está implementado en addMemory (solo inserts), 
 * pero al usar el último encontrado en getSavedPersonalities podemos "sobreescribir".
 * Para un borrado real necesitaríamos modificar la DB directamente.
 */

/**
 * Gestión de Usuarios Autorizados (Dinámica)
 */
export const getAuthorizedUsers = async (): Promise<{id: string, name: string}[]> => {
  try {
    const history = await getHistory(GLOBAL_CONFIG_ID, 100);
    const lastConfig = history
      .filter(m => m.role === 'assistant' && m.content.includes('Usuarios autorizados:'))
      .pop();

    if (lastConfig) {
      const match = lastConfig.content.match(/Usuarios autorizados: \[(.*)\]/);
      if (match && match[1]) {
        return match[1].split(',').map((s: string) => {
          const part = s.trim();
          const nameMatch = part.match(/^(.+?)\s*\(((-?\d+))\)$/);
          if (nameMatch) {
              return { name: nameMatch[1], id: nameMatch[2] };
          }
          return { id: part, name: 'Desconocido' };
        }).filter((u: any) => u.id);
      }
    }
    return [];
  } catch (e) {
    return [];
  }
};

export const authorizeUser = async (userId: string, name: string = 'Usuario'): Promise<void> => {
  let current = await getAuthorizedUsers();
  current = current.filter(u => u.id !== userId);
  const newList = [...current, { id: userId, name }];
  const serialized = newList.map(u => `${u.name} (${u.id})`).join(', ');
  await addMemory(GLOBAL_CONFIG_ID, 'assistant', `Usuarios autorizados: [${serialized}]`);
};

export const revokeUser = async (userId: string): Promise<void> => {
  let current = await getAuthorizedUsers();
  current = current.filter(u => u.id !== userId);
  const serialized = current.map(u => `${u.name} (${u.id})`).join(', ');
  await addMemory(GLOBAL_CONFIG_ID, 'assistant', `Usuarios autorizados: [${serialized}]`);
};

/**
 * Gestión de Parámetros de Personalidad (0-100)
 */
export const getPersonalityParams = async (chatId: string, threadId?: string): Promise<Record<string, number>> => {
  try {
    const history = await getSettingsHistory(chatId, threadId);
    const params: Record<string, number> = {};
    
    // Procesamos de más antiguo a más nuevo para que el último prevalezca
    history
      .filter(m => m.role === 'assistant' && m.content.includes('PersonalityParam ['))
      .forEach(m => {
        const match = m.content.match(/PersonalityParam \[(.*?)\]: (\d+)/);
        if (match) {
          const param = match[1].toLowerCase();
          const value = parseInt(match[2]);
          if (!isNaN(value)) {
            params[param] = Math.min(100, Math.max(0, value));
          }
        }
      });
    
    return params;
  } catch (e) {
    return {};
  }
};

export const setPersonalityParam = async (chatId: string, param: string, value: number, threadId?: string): Promise<void> => {
  const safeValue = Math.min(100, Math.max(0, value));
  await addMemory(chatId, 'assistant', `PersonalityParam [${param.toLowerCase()}]: ${safeValue}`, threadId);
};

/**
 * Gestión de Estado Emocional (0-100)
 */
export interface EmotionalState {
    humor: number;
    animo: number;
    reactividad: number;
}

export const getEmotionalState = async (chatId: string, threadId?: string): Promise<EmotionalState> => {
    try {
        const params = await getPersonalityParams(chatId, threadId);
        return {
            humor: params.humor ?? 50,
            animo: params.animo ?? 50,
            reactividad: params.reactividad ?? 50
        };
    } catch (e) {
        return { humor: 50, animo: 50, reactividad: 50 };
    }
};

export const setEmotionalState = async (chatId: string, state: Partial<EmotionalState>, threadId?: string): Promise<void> => {
    for (const [key, value] of Object.entries(state)) {
        if (value !== undefined) {
            await setPersonalityParam(chatId, key, value, threadId);
        }
    }
};
