import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config();

const url = process.env.POSTGREST_URL!;
const key = process.env.POSTGREST_ANON_KEY!;

const supabase = createClient(url, key);

async function search() {
  console.log('Searching "memory" table for "tuxis"...');
  const { data: memoryData, error: memoryError } = await supabase
    .from('memory')
    .select('*')
    .ilike('content', '%tuxis%');
  
  if (memoryError) {
    console.error('Error searching memory:', memoryError.message);
  } else {
    console.log(`Found ${memoryData?.length || 0} entries in "memory":`);
    memoryData?.forEach(row => {
      console.log(`- [${row.created_at || row.id}] Chat ID ${row.user_id}, Role ${row.role}: ${row.content}`);
    });
  }

  console.log('\nSearching "long_term_memory" table for "tuxis"...');
  const { data: ltmData, error: ltmError } = await supabase
    .from('long_term_memory')
    .select('*')
    .ilike('content', '%tuxis%');

  if (ltmError) {
    console.error('Error searching long_term_memory:', ltmError.message);
  } else {
    console.log(`Found ${ltmData?.length || 0} entries in "long_term_memory":`);
    ltmData?.forEach(row => {
      console.log(`- [${row.created_at || row.id}] Chat ID ${row.chat_id}: ${row.content}`);
    });
  }
}

search();
