import 'dotenv/config';
import { db } from './src/db/index.js';

async function check() {
  const { data, error } = await db
    .from('bot_settings')
    .select('*');
  
  if (error) {
    console.error('Error:', error);
    return;
  }
  
  console.log('--- Configuración Actual ---');
  data.forEach(s => {
    console.log(`Chat: ${s.chat_id} | Thread: ${s.thread_id}`);
    console.log(`Personality: ${s.personality?.substring(0, 500)}...`);
    // console.log(`Params: ${JSON.stringify(s.params)}`);
    console.log('---');
  });
}

check();
