import { db } from '../src/db/index.js';
import dotenv from 'dotenv';
dotenv.config();

async function main() {
  const chatId = "133994080";
  const { data, error } = await db
    .from('memory')
    .select('*')
    .eq('user_id', chatId)
    .order('id', { ascending: false })
    .limit(100);

  if (error) {
    console.error("Error fetching memory:", error);
    return;
  }

  console.log("Memory history (newest first):");
  for (const entry of data || []) {
    console.log(`[${entry.created_at}] ${entry.role}: ${entry.content}`);
  }
}

main();
