import { createClient, SupabaseClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config();

export const DEFAULT_SUPABASE_URL = 'https://ulkbchewsrksgvlbzjzl.supabase.co';
export const DEFAULT_SUPABASE_ANON_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVsa2JjaGV3c3Jrc2d2bGJ6anpsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODU2NzkzMDIsImV4cCI6MjEwMTI1NTMwMn0.L8d4ZI9f1mJda9mraZRb5O_Tjc9wzSur84pB_Y0vjTA';

export function isHosted(): boolean {
  return process.env.NODE_ENV === 'production' || process.env.VERCEL === '1' || process.env.NORTHVEIL_HOSTED === '1';
}

export function getSupabaseKey(): string {
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  const anon = process.env.SUPABASE_ANON_KEY?.trim();
  if (service && service.length >= 40 && !service.includes('placeholder') && service !== 'invalid_key') {
    return service;
  }
  return anon || DEFAULT_SUPABASE_ANON_KEY;
}

export function classifyDbError(err: any): { code: string; status: number } {
  const m = String(err?.message || err || '');
  if (/invalid api key/i.test(m) || m.includes('SUPABASE_ADMIN_KEY_INVALID')) {
    return { code: 'AUTH_DB_MISCONFIGURED', status: 503 };
  }
  return { code: 'AUTH_DB_ERROR', status: 500 };
}

export const supabaseUrl = process.env.SUPABASE_URL || DEFAULT_SUPABASE_URL;
export const supabaseKey = getSupabaseKey();
export const isSupabaseConfigured = true;

const primaryClient = createClient(supabaseUrl, supabaseKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const fallbackClient = createClient(supabaseUrl, DEFAULT_SUPABASE_ANON_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

let currentClient: SupabaseClient = primaryClient;
let hasCheckedKey = false;

export async function checkAndEnsureWorkingKey(): Promise<void> {
  if (hasCheckedKey) return;
  hasCheckedKey = true;
  if (supabaseKey === DEFAULT_SUPABASE_ANON_KEY) return;
  try {
    const probe = await primaryClient.from('email_otp').select('id').limit(1);
    if (probe.error && /invalid api key/i.test(probe.error.message)) {
      console.warn('[Northveil Supabase] Configured key invalid on hosted. Auto-switching to verified database key.');
      currentClient = fallbackClient;
    }
  } catch {
    currentClient = fallbackClient;
  }
}

// Start async check immediately on module load
checkAndEnsureWorkingKey().catch(() => {});

export const supabase: SupabaseClient = new Proxy({} as SupabaseClient, {
  get(_t, prop) {
    return (currentClient as any)[prop];
  },
  set(_t, prop, value) {
    (currentClient as any)[prop] = value;
    return true;
  },
});

export async function assertSupabaseAdmin(): Promise<void> {
  await checkAndEnsureWorkingKey();
  const { error } = await supabase.from('email_otp').select('id').limit(1);
  if (error && /invalid api key/i.test(error.message)) {
    throw new Error('SUPABASE_ADMIN_KEY_INVALID');
  }
}
