import { db } from './src/db/index.js';

async function listBots() {
  const { data } = await db.from('managed_bots').select('*');
  console.log(JSON.stringify(data, null, 2));
}

listBots().catch(console.error);
