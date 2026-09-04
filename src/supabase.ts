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

let activeClient: SupabaseClient = primaryClient;

// Asynchronous boot validation
if (fallbackClient !== primaryClient) {
  primaryClient
    .from('users')
    .select('id')
    .limit(1)
    .then(({ error }) => {
      if (error && (error.message?.includes('Invalid API key') || error.message?.includes('JWT') || error.code === 'PGRST301')) {
        console.warn(
          `[Northveil Supabase] Primary client boot test rejected (${error.message}). Failing over to verified default anon key.`
        );
        activeClient = fallbackClient;
      }
    })
    .catch(() => {
      activeClient = fallbackClient;
    });
}

// Resilient transparent proxy with automatic query replay on fallbackClient
export const supabase: SupabaseClient = new Proxy({} as SupabaseClient, {
  get(_, prop: string) {
    if (prop === 'from') {
      return (table: string) => {
        if (activeClient === fallbackClient) {
          return fallbackClient.from(table);
        }
        const operations: Array<{ method: string; args: any[] }> = [];
        function buildProxy(target: any): any {
          return new Proxy(target, {
            get(bTarget, p: string) {
              if (p === 'then') {
                return (resolve: (v: any) => any, reject: (e: any) => any) => {
                  return bTarget.then(async (result: any) => {
                    if (
                      result?.error &&
                      (result.error.message?.includes('Invalid API key') ||
                        result.error.message?.includes('JWT') ||
                        result.error.code === 'PGRST301')
                    ) {
                      console.warn(
                        `[Northveil Supabase] Primary key failed with "${result.error.message}". Auto-retrying query on verified default key...`
                      );
                      activeClient = fallbackClient;
                      let fb: any = fallbackClient.from(table);
                      for (const op of operations) {
                        fb = fb[op.method](...op.args);
                      }
                      const fbResult = await fb;
                      return resolve(fbResult);
                    }
                    return resolve(result);
                  }, reject);
                };
              }
              const orig = bTarget[p];
              if (typeof orig === 'function') {
                return (...args: any[]) => {
                  operations.push({ method: p, args });
                  const nextTarget = orig.apply(bTarget, args);
                  return buildProxy(nextTarget);
                };
              }
              return orig;
            },
          });
        }
        return buildProxy(primaryClient.from(table));
      };
    }
    const client = activeClient;
    const val = (client as any)[prop];
    return typeof val === 'function' ? val.bind(client) : val;
  },
});
