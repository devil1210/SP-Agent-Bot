import { db, getHistory, addMemory, MemoryEntry } from './index.js';

/**
 * Acceso a configuraciones globales (usando un ID reservado en la DB)
 */
const GLOBAL_CONFIG_ID = 'system_global_config';

/**
 * Helper para obtener o migrar configuración de historial a la tabla bot_settings
 */
async function getOrMigrate<T>(
    chatId: string,
    threadId: string | undefined,
    column: 'personality' | 'params' | 'model' | 'features' | 'intervention',
    defaultValue: T,
    parseFn: (history: MemoryEntry[]) => T | null
): Promise<T> {
    const thread = threadId || 'general';
    
    // 1. Intentar leer desde la tabla optimizada
    const { data } = await db
        .from('bot_settings')
        .select(column)
        .eq('chat_id', chatId)
        .eq('thread_id', thread)
        .maybeSingle();

    if (data) {
        return (data as any)[column] as T;
    }


    // 2. Si no existe, intentar leer del historial y migrar
    const history = await getSettingsHistory(chatId, threadId);
    const migratedValue = parseFn(history);
    
    const value = migratedValue !== null ? migratedValue : defaultValue;

    // 3. Migrar a la tabla
    await db.from('bot_settings').upsert({
        chat_id: chatId,
        thread_id: thread,
        [column]: value,
        updated_at: new Date().toISOString()
    });

    return value;
}

/**
 * Helper para guardar configuración en bot_settings
 */
async function saveSetting(chatId: string, threadId: string | undefined, data: any): Promise<void> {
    await db.from('bot_settings').upsert({
        chat_id: chatId,
        thread_id: threadId || 'general',
        ...data,
        updated_at: new Date().toISOString()
    });
}

// --- Historial (Legacy) ---
const getSettingsHistory = async (chatId: string, threadId?: string, limit: number = 100): Promise<MemoryEntry[]> => {
    let query = db.from('memory').select('*').eq('user_id', chatId);
    if (threadId) query = query.eq('thread_id', threadId);
    else query = query.is('thread_id', null);

    const { data, error } = await query.order('id', { ascending: false }).limit(limit);
    if (error) return [];
    return (data as MemoryEntry[] || []).reverse();
};

// --- API Refactorizada ---

export const getUserModel = async (chatId: string, threadId?: string): Promise<string> => {
    return await getOrMigrate(chatId, threadId, 'model', 'gemini-3.1-flash-lite-preview', (history) => {
        const modelSetMsg = history.filter(m => m.role === 'assistant' && m.content.includes('Modelo cambiado a:')).pop();
        if (modelSetMsg) {
            const match = modelSetMsg.content.match(/Modelo cambiado a: ([\w.-]+)/);
            return match ? match[1] : null;
        }
        return null;
    });
};

export const setUserModel = async (chatId: string, model: string, threadId?: string): Promise<void> => {
    await saveSetting(chatId, threadId, { model });
    await addMemory(chatId, 'assistant', `Modelo cambiado a: ${model}`, threadId);
};

export const getPersonality = async (chatId: string, threadId?: string): Promise<string | null> => {
    return await getOrMigrate(chatId, threadId, 'personality', null, (history) => {
        const persMsg = history.filter(m => m.role === 'assistant' && (m.content.includes('Personalidad definida:') || m.content.includes('personalidad ha sido restablecida'))).pop();
        if (persMsg && persMsg.content.includes('Personalidad definida:')) {
            const match = persMsg.content.match(/Personalidad definida: (.*)/s);
            return match ? match[1].trim() : null;
        }
        return null;
    });
};

export const setPersonality = async (chatId: string, persona: string, threadId?: string): Promise<void> => {
    if (!persona || persona.trim() === "" || persona.toLowerCase() === 'default') {
        // Marcamos como null en bot_settings para evitar que getOrMigrate traiga valores antiguos del historial
        await saveSetting(chatId, threadId, { personality: null });
        // Añadimos una entrada en memoria para "limpiar" el estilo de la conversación para el LLM
        await addMemory(chatId, 'assistant', `🛠️ La personalidad ha sido restablecida al valor por defecto (Asistente Estándar).`, threadId);
        return;
    }
    await saveSetting(chatId, threadId, { personality: persona });
    await addMemory(chatId, 'assistant', `Personalidad definida: ${persona}`, threadId);
};

export const getPersonalityParams = async (chatId: string, threadId?: string): Promise<Record<string, number>> => {
    return await getOrMigrate(chatId, threadId, 'params', {}, (history) => {
        const params: Record<string, number> = {};
        history.filter(m => m.role === 'assistant' && m.content.includes('PersonalityParam [')).forEach(m => {
            const match = m.content.match(/PersonalityParam \[(.*?)\]: (\d+)/);
            if (match) params[match[1].toLowerCase()] = parseInt(match[2]);
        });
        return Object.keys(params).length > 0 ? params : null;
    });
};

export const setPersonalityParam = async (chatId: string, param: string, value: number, threadId?: string): Promise<void> => {
    const currentParams = await getPersonalityParams(chatId, threadId);
    const newParams = { ...currentParams, [param.toLowerCase()]: Math.min(100, Math.max(0, value)) };
    await saveSetting(chatId, threadId, { params: newParams });
    await addMemory(chatId, 'assistant', `PersonalityParam [${param.toLowerCase()}]: ${newParams[param.toLowerCase()]}`, threadId);
};

export interface EmotionalState {
    humor: number;
    animo: number;
    reactividad: number;
}

export const getEmotionalState = async (chatId: string, threadId?: string): Promise<{ humor: number; animo: number; reactividad: number }> => {
    const params = await getPersonalityParams(chatId, threadId);
    return {
        humor: params.humor ?? 50,
        animo: params.animo ?? 50,
        reactividad: params.reactividad ?? 50
    };
};

export const setEmotionalState = async (chatId: string, state: Partial<{ humor: number; animo: number; reactividad: number }>, threadId?: string): Promise<void> => {
    const currentParams = await getPersonalityParams(chatId, threadId);
    const newParams = { ...currentParams, ...state };
    await saveSetting(chatId, threadId, { params: newParams });
    for (const [key, value] of Object.entries(state)) {
        if (value !== undefined) await addMemory(chatId, 'assistant', `PersonalityParam [${key.toLowerCase()}]: ${value}`, threadId);
    }
};

// ... Mantenemos las funciones de Features, Threads y Autorización igual por ahora (sin migración masiva) ...

export const getChatFeatures = async (chatId: string): Promise<string[]> => {
    try {
        const history = await getSettingsHistory(chatId);
        const msg = history.filter(m => m.role === 'assistant' && m.content.includes('Features habilitadas:')).pop();
        if (msg) {
            const match = msg.content.match(/Features habilitadas: \[(.*)\]/);
            return match ? match[1].split(',').map((s: string) => s.trim()).filter(s => s.length > 0) : ['library'];
        }
        return ['library'];
    } catch (e) { return ['library']; }
};

export const setChatFeatures = async (chatId: string, features: string[]): Promise<void> => {
    await addMemory(chatId, 'assistant', `Features habilitadas: [${features.join(', ')}]`);
};

export const getAllowedThreads = async (chatId: string): Promise<number[]> => {
    try {
        const history = await getSettingsHistory(chatId);
        const msg = history.filter(m => m.role === 'assistant' && m.content.includes('Topics permitidos:')).pop();
        if (msg) {
            const match = msg.content.match(/Topics permitidos: \[(.*)\]/);
            return match ? match[1].split(',').map((s: string) => parseInt(s.trim())).filter(n => !isNaN(n)) : [];
        }
        return [];
    } catch (e) { return []; }
};

export const setAllowedThreads = async (chatId: string, threadIds: number[]): Promise<void> => {
    await addMemory(chatId, 'assistant', `Topics permitidos: [${threadIds.join(', ')}]`);
};

export const getPassiveThreads = async (chatId: string): Promise<number[]> => {
    try {
        const history = await getSettingsHistory(chatId);
        const msg = history.filter(m => m.role === 'assistant' && m.content.includes('Topics pasivos:')).pop();
        if (msg) {
            const match = msg.content.match(/Topics pasivos: \[(.*)\]/);
            return match ? match[1].split(',').map((s: string) => parseInt(s.trim())).filter(n => !isNaN(n)) : [];
        }
        return [];
    } catch (e) { return []; }
};

export const setPassiveThreads = async (chatId: string, threadIds: number[]): Promise<void> => {
    await addMemory(chatId, 'assistant', `Topics pasivos: [${threadIds.join(', ')}]`);
};

export const getAuthorizedGroups = async (): Promise<{id: string, name: string}[]> => {
    try {
        const history = await getHistory(GLOBAL_CONFIG_ID, 100);
        const lastConfig = history.filter(m => m.role === 'assistant' && m.content.includes('Grupos autorizados:')).pop();
        if (lastConfig) {
            const match = lastConfig.content.match(/Grupos autorizados: \[(.*)\]/);
            if (match && match[1]) {
                return match[1].split(',').map((s: string) => {
                    const part = s.trim();
                    const nameMatch = part.match(/^(.+?)\s*\(((-?\d+))\)$/);
                    return nameMatch ? { name: nameMatch[1], id: nameMatch[2] } : { id: part, name: 'Desconocido' };
                }).filter((g: any) => g.id);
            }
        }
        return [];
    } catch (e) { return []; }
};

export const authorizeGroup = async (chatId: string, name: string = 'Grupo'): Promise<void> => {
    let current = await getAuthorizedGroups();
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

export const setThreadName = async (chatId: string, threadId: number, name: string): Promise<void> => {
    await addMemory(chatId, 'assistant', `ThreadName [${threadId}]: ${name}`);
};

export const getKnownThreads = async (chatId: string): Promise<{id: number, name: string}[]> => {
    try {
        const history = await getSettingsHistory(chatId);
        const threadMap: Record<number, string> = { 1: 'General' };
        history.filter(m => m.role === 'assistant' && m.content.includes('ThreadName [')).forEach(m => {
            const match = m.content.match(/ThreadName \[(\d+)\]: (.*)/);
            if (match) threadMap[parseInt(match[1])] = match[2];
        });
        return Object.entries(threadMap).map(([id, name]) => ({ id: parseInt(id), name }));
    } catch (e) { return [{ id: 1, name: 'General' }]; }
};

export const getSavedPersonalities = async (): Promise<{name: string, content: string}[]> => {
    try {
        const history = await getHistory(GLOBAL_CONFIG_ID, 200);
        const personas: {name: string, content: string}[] = [];
        history.filter(m => m.role === 'assistant' && m.content.startsWith('SavedPersona [')).forEach(m => {
            const match = m.content.match(/^SavedPersona \[(.*?)\]: (.*)/s);
            if (match) {
                const name = match[1].trim();
                const content = match[2].trim();
                const existingIdx = personas.findIndex(p => p.name.toLowerCase() === name.toLowerCase());
                if (existingIdx >= 0) personas[existingIdx].content = content;
                else personas.push({ name, content });
            }
        });
        return personas;
    } catch (e) { return []; }
};

export const savePersonality = async (name: string, content: string): Promise<void> => {
    await addMemory(GLOBAL_CONFIG_ID, 'assistant', `SavedPersona [${name}]: ${content}`);
};

export const getAuthorizedUsers = async (): Promise<{id: string, name: string}[]> => {
    try {
        const history = await getHistory(GLOBAL_CONFIG_ID, 100);
        const lastConfig = history.filter(m => m.role === 'assistant' && m.content.includes('Usuarios autorizados:')).pop();
        if (lastConfig) {
            const match = lastConfig.content.match(/Usuarios autorizados: \[(.*)\]/);
            if (match && match[1]) {
                return match[1].split(',').map((s: string) => {
                    const part = s.trim();
                    const nameMatch = part.match(/^(.+?)\s*\(((-?\d+))\)$/);
                    return nameMatch ? { name: nameMatch[1], id: nameMatch[2] } : { id: part, name: 'Desconocido' };
                }).filter((u: any) => u.id);
            }
        }
        return [];
    } catch (e) { return []; }
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

export const getInterventionLevel = async (chatId: string, threadId?: string): Promise<number> => {
    return await getOrMigrate(chatId, threadId, 'intervention', 100, (history) => {
        const msg = history.filter(m => m.role === 'assistant' && m.content.includes('Intervention level set:')).pop();
        if (msg) {
            const match = msg.content.match(/Intervention level set: (\d+)/);
            return match ? parseInt(match[1]) : null;
        }
        return null;
    });
};

export const setInterventionLevel = async (chatId: string, level: number, threadId?: string): Promise<void> => {
    await saveSetting(chatId, threadId, { intervention: level });
    await addMemory(chatId, 'assistant', `Intervention level set: ${level}%`, threadId);
};
