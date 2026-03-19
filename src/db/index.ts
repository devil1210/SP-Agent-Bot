import { createClient } from '@supabase/supabase-js';
import { config } from '../config.js';
import { generateEmbedding } from '../agent/llm.js';

// Inicializar cliente PostgREST
export const db = createClient(config.postgrestUrl, config.postgrestAnonKey || 'public-anon-key');

export interface MemoryEntry {
  id: number;
  user_id: string; // chatId
  thread_id?: string | null;
  msg_id?: number | null;
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string;
  created_at: string;
}

/**
 * MEMORIA DE CORTO PLAZO (Contexto inmediato)
 */
export const getHistory = async (chatId: string, limit: number = 20, threadId?: string): Promise<MemoryEntry[]> => {
  let query = db
    .from('memory')
    .select('*')
    .eq('user_id', chatId)
    .order('id', { ascending: false })
    .limit(limit);

  if (threadId) {
    query = query.eq('thread_id', threadId);
  } else {
    query = query.is('thread_id', null);
  }

  const { data, error } = await query;
  if (error) {
    console.error('[DB Error] getHistory:', error.message);
    return [];
  }
  return (data as MemoryEntry[] || []).reverse();
};

export const addMemory = async (chatId: string, role: string, content: string, threadId?: string, msgId?: number, senderName?: string, isAdmin: boolean = false): Promise<void> => {
  let finalContent = content;
  if (role === 'user' && senderName) {
    const roleTag = isAdmin ? '[ADMIN]' : '[USER]';
    finalContent = `${senderName} ${roleTag}: ${content}`;
  }

  const { error } = await db
    .from('memory')
    .insert([{ 
      user_id: chatId, 
      role, 
      content: finalContent, 
      thread_id: threadId || null,
      msg_id: msgId || null
    }]);

  if (error) {
    console.error('[DB Error] addMemory:', error.message);
  }
};

export const clearMemory = async (chatId: string, threadId?: string): Promise<void> => {
  let query = db.from('memory').delete().eq('user_id', chatId);
  if (threadId) query = query.eq('thread_id', threadId);
  const { error } = await query;
  if (error) console.error('[DB Error] clearMemory:', error.message);
};

/**
 * 🐘 MEMORIA DE LARGO PLAZO (RAG / Vector Database)
 */

export const addLongTermMemory = async (chatId: string, content: string, metadata: any = {}) => {
  try {
    const embedding = await generateEmbedding(content);
    const { error } = await db
      .from('long_term_memory')
      .insert({
        chat_id: chatId,
        content,
        metadata,
        embedding
      });
    
    if (error) throw error;
    console.log(`[LTM] Memoria guardada para: ${chatId}`);
  } catch (err: any) {
    console.error('[DB Error] addLongTermMemory:', err.message);
  }
};

export const searchLongTermMemory = async (chatId: string, query: string, count: number = 3) => {
  try {
    const queryEmbedding = await generateEmbedding(query);
    const { data, error } = await db.rpc('match_long_term_memory', {
      query_embedding: queryEmbedding,
      match_threshold: 0.65, // Solo lo que sea relevante
      match_count: count,
      p_chat_id: chatId
    });

    if (error) throw error;
    return data || [];
  } catch (err: any) {
    console.error('[DB Error] searchLongTermMemory:', err.message);
    return [];
  }
};

/**
 * 🛠️ PREFERENCIAS DE USUARIO (Twitter Auto-Fix, etc.)
 */

export interface UserPreferences {
  user_id: string;
  twitter_fix_count: number;
  twitter_auto_fix: boolean;
}

export const getUserPreferences = async (userId: string): Promise<UserPreferences> => {
  const { data, error } = await db
    .from('user_preferences')
    .select('*')
    .eq('user_id', userId)
    .maybeSingle();

  if (error) {
    console.error('[DB Error] getUserPreferences:', error.message);
  }

  return data || { user_id: userId, twitter_fix_count: 0, twitter_auto_fix: false };
};

export const incrementTwitterFixCount = async (userId: string): Promise<number> => {
  const prefs = await getUserPreferences(userId);
  const newCount = (prefs.twitter_fix_count || 0) + 1;

  const { error } = await db
    .from('user_preferences')
    .upsert({ 
      user_id: userId, 
      twitter_fix_count: newCount,
      twitter_auto_fix: prefs.twitter_auto_fix,
      updated_at: new Date().toISOString()
    });

  if (error) {
    console.error('[DB Error] incrementTwitterFixCount:', error.message);
  }

  return newCount;
};

export const setTwitterAutoFix = async (userId: string, enabled: boolean): Promise<void> => {
  const prefs = await getUserPreferences(userId);
  const { error } = await db
    .from('user_preferences')
    .upsert({ 
      user_id: userId, 
      twitter_fix_count: prefs.twitter_fix_count,
      twitter_auto_fix: enabled,
      updated_at: new Date().toISOString()
    });

  if (error) {
    console.error('[DB Error] setTwitterAutoFix:', error.message);
  }
};
