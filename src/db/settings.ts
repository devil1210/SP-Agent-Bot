import { getHistory, addMemory } from './index.js';

/**
 * Acceso a configuraciones globales (usando un ID reservado en la DB)
 */
const GLOBAL_CONFIG_ID = 'system_global_config';

/**
 * Obtiene el modelo configurado para un usuario/chat.
 */
export const getUserModel = async (chatId: string): Promise<string> => {
  try {
    const history = await getHistory(chatId, 100); 
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

export const setUserModel = async (chatId: string, model: string): Promise<void> => {
  await addMemory(chatId, 'assistant', `Modelo cambiado a: ${model}`);
};

/**
 * Gestión de la Personalidad (/persona) por chat/grupo
 */
export const getPersonality = async (chatId: string): Promise<string | null> => {
  try {
    const history = await getHistory(chatId, 100);
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

export const setPersonality = async (chatId: string, persona: string): Promise<void> => {
  await addMemory(chatId, 'assistant', `Personalidad definida: ${persona}`);
};

/**
 * Obtiene los hilos (Forum Topics) permitidos para un chat.
 */
export const getAllowedThreads = async (chatId: string): Promise<number[]> => {
  try {
    const history = await getHistory(chatId, 100);
    const threadsMsg = history
      .filter(m => m.role === 'assistant' && m.content.includes('Topics permitidos:'))
      .pop();

    if (threadsMsg) {
      const match = threadsMsg.content.match(/Topics permitidos: \[(.*)\]/);
      if (match && match[1]) {
        return match[1].split(',').map(s => parseInt(s.trim())).filter(n => !isNaN(n));
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
    const history = await getHistory(chatId, 100);
    const threadsMsg = history
      .filter(m => m.role === 'assistant' && m.content.includes('Topics pasivos:'))
      .pop();

    if (threadsMsg) {
      const match = threadsMsg.content.match(/Topics pasivos: \[(.*)\]/);
      if (match && match[1]) {
        return match[1].split(',').map(s => parseInt(s.trim())).filter(n => !isNaN(n));
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
export const getAuthorizedGroups = async (): Promise<string[]> => {
  try {
    const history = await getHistory(GLOBAL_CONFIG_ID, 100);
    const lastConfig = history
      .filter(m => m.role === 'assistant' && m.content.includes('Grupos autorizados:'))
      .pop();

    if (lastConfig) {
      const match = lastConfig.content.match(/Grupos autorizados: \[(.*)\]/);
      if (match && match[1]) {
        return match[1].split(',').map(s => s.trim()).filter(s => s.length > 0);
      }
    }
    return [];
  } catch (e) {
    return [];
  }
};

export const authorizeGroup = async (chatId: string): Promise<void> => {
  const current = await getAuthorizedGroups();
  if (!current.includes(chatId)) {
    current.push(chatId);
    await addMemory(GLOBAL_CONFIG_ID, 'assistant', `Grupos autorizados: [${current.join(', ')}]`);
  }
};

export const revokeGroup = async (chatId: string): Promise<void> => {
  let current = await getAuthorizedGroups();
  current = current.filter(id => id !== chatId);
  await addMemory(GLOBAL_CONFIG_ID, 'assistant', `Grupos autorizados: [${current.join(', ')}]`);
};
