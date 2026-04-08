import { db } from './index.js';

export interface ManagedBot {
  id: string;
  owner_id: string;
  token: string;
  username: string;
  name: string;
  personality: string | null;
  thread_assignments: { chat_id: string; thread_id: number }[];
  created_at: string;
  updated_at: string;
}

/**
 * Obtener todos los bots gestionados para iniciar el runner
 */
export async function getAllManagedBots(): Promise<ManagedBot[]> {
  const { data, error } = await db
    .from('managed_bots')
    .select('*');

  if (error) {
    console.error('[DB Error] getAllManagedBots:', error.message);
    return [];
  }
  return data || [];
}

/**
 * Guardar o actualizar un bot gestionado
 */
export async function upsertManagedBot(botData: Partial<ManagedBot> & { id: string }): Promise<void> {
  const { error } = await db
    .from('managed_bots')
    .upsert({
      ...botData,
      updated_at: new Date().toISOString()
    });

  if (error) {
    console.error('[DB Error] upsertManagedBot:', error.message);
  }
}

/**
 * Obtener un bot por su username (para mapeo rápido en handlers)
 */
export async function getManagedBotByUsername(username: string): Promise<ManagedBot | null> {
  const { data, error } = await db
    .from('managed_bots')
    .select('*')
    .eq('username', username)
    .maybeSingle();

  if (error) {
    console.error('[DB Error] getManagedBotByUsername:', error.message);
    return null;
  }
  return data;
}

/**
 * Eliminar un bot gestionado
 */
export async function deleteManagedBot(id: string): Promise<void> {
  const { error } = await db
    .from('managed_bots')
    .delete()
    .eq('id', id);

  if (error) {
    console.error('[DB Error] deleteManagedBot:', error.message);
  }
}

/**
 * Obtener bots por owner
 */
export async function getManagedBotsByOwner(ownerId: string): Promise<ManagedBot[]> {
  const { data, error } = await db
    .from('managed_bots')
    .select('*')
    .eq('owner_id', ownerId);

  if (error) {
    console.error('[DB Error] getManagedBotsByOwner:', error.message);
    return [];
  }
  return data || [];
}
