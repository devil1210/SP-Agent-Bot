import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config();

const url = process.env.POSTGREST_URL;
const key = process.env.POSTGREST_ANON_KEY;

console.log('Testing connection to:', url);

const supabase = createClient(url, key);

async function test() {
  const { data, error } = await supabase.from('memory').select('*').limit(1);
  if (error) {
    console.error('Connection failed:', error.message);
  } else {
    console.log('Connection successful!');
  }
}

test();
