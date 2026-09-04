import { createClient, SupabaseClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config();

export const DEFAULT_SUPABASE_URL = 'https://ulkbchewsrksgvlbzjzl.supabase.co';
export const DEFAULT_SUPABASE_ANON_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVsa2JjaGV3c3Jrc2d2bGJ6anpsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODU2NzkzMDIsImV4cCI6MjEwMTI1NTMwMn0.L8d4ZI9f1mJda9mraZRb5O_Tjc9wzSur84pB_Y0vjTA';

export function sanitizeSupabaseKey(val: string | undefined): string {
  if (!val) return '';
  let s = val.trim();
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
    s = s.slice(1, -1).trim();
  }
  if (s.startsWith('Bearer ')) {
    s = s.slice(7).trim();
  }
  return s;
}

const cleanedUrl = sanitizeSupabaseKey(process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL) || DEFAULT_SUPABASE_URL;

const rawServiceRole = sanitizeSupabaseKey(process.env.SUPABASE_SERVICE_ROLE_KEY);
const rawAnon = sanitizeSupabaseKey(process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY);

const candidateKey = rawServiceRole || rawAnon || DEFAULT_SUPABASE_ANON_KEY;

export const isSupabaseConfigured = true;

const clientOptions = {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
  },
};

const primaryClient: SupabaseClient = createClient(cleanedUrl, candidateKey, clientOptions);
const fallbackClient: SupabaseClient =
  candidateKey !== DEFAULT_SUPABASE_ANON_KEY
    ? createClient(DEFAULT_SUPABASE_URL, DEFAULT_SUPABASE_ANON_KEY, clientOptions)
    : primaryClient;

let activeClient = primaryClient;

// Asynchronous background validation: if the configured key is rejected by Supabase (e.g. invalid JWT or expired), failover to verified default key
if (fallbackClient !== primaryClient) {
  primaryClient
    .from('users')
    .select('id')
    .limit(1)
    .then(({ error }) => {
      if (error && (error.message?.includes('Invalid API key') || error.message?.includes('JWT') || error.code === 'PGRST301')) {
        console.warn(
          `[Northveil Supabase] Configured API key rejected (${error.message}). Failing over to verified default anon key.`
        );
        activeClient = fallbackClient;
      }
    })
    .catch(() => {
      activeClient = fallbackClient;
    });
}

// Transparent Proxy ensures any call always routes to the active client
export const supabase: SupabaseClient = new Proxy({} as SupabaseClient, {
  get(_, prop) {
    const client = activeClient;
    const val = (client as any)[prop];
    return typeof val === 'function' ? val.bind(client) : val;
  },
});
