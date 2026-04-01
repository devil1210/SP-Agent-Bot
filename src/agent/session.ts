import { db } from '../db/index.js';
import { Message } from './llm.js';

/**
 * 💾 SESSION PERSISTENCE (Patrón SPcore-Nexus / Manifest)
 * Permite guardar y recuperar el estado completo del agente por hilo/chat.
 */

export interface AgentSession {
  session_id: string;
  chat_id: string;
  thread_id?: string;
  messages: Message[];
  tools_used: string[];
  last_turn: number;
  metadata?: any;
  updated_at: string;
}

/**
 * Guarda el estado actual de la sesión en la base de datos
 */
export async function saveAgentSession(session: Omit<AgentSession, 'updated_at'>): Promise<void> {
  const { error } = await db
    .from('agent_sessions')
    .upsert({
      ...session,
      updated_at: new Date().toISOString()
    }, { onConflict: 'chat_id,thread_id' });

  if (error) {
    console.error(`[Agent:Session] ❌ Error saving session: ${error.message}`);
  } else {
    console.log(`[Agent:Session] 💾 Session saved for chat ${session.chat_id} (Turn ${session.last_turn})`);
  }
}

/**
 * Carga una sesión previa para un chat/hilo
 */
export async function loadAgentSession(chatId: string, threadId?: string): Promise<AgentSession | null> {
  let query = db
    .from('agent_sessions')
    .select('*')
    .eq('chat_id', chatId);

  if (threadId) {
    query = query.eq('thread_id', threadId);
  } else {
    query = query.is('thread_id', null);
  }

  const { data, error } = await query.maybeSingle();

  if (error) {
    console.error(`[Agent:Session] ❌ Error loading session: ${error.message}`);
    return null;
  }

  return data as AgentSession;
}

/**
 * Limpia la sesión actual
 */
export async function clearAgentSession(chatId: string, threadId?: string): Promise<void> {
  let query = db.from('agent_sessions').delete().eq('chat_id', chatId);
  if (threadId) query = query.eq('thread_id', threadId);
  const { error } = await query;
  if (error) console.error(`[Agent:Session] ❌ Error clearing session: ${error.message}`);
}
