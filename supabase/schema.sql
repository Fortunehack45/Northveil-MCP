-- Northveil Non-Custodial Agent Wallet + MCP Control Plane Schema
-- Supabase PostgreSQL DDL

create extension if not exists "pgcrypto";

-- 1. Users authenticated via Google OAuth or Email OTP
create table if not exists public.users (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  email_verified boolean not null default false,
  email_verified_at timestamptz,
  google_sub text unique,
  name text,
  avatar_url text,
  created_at timestamptz not null default now(),
  last_login_at timestamptz
);

-- 1b. Email One-Time Passcodes (5-minute TTL, single-use, rate-limited)
create table if not exists public.email_otp (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  code_hash text not null,
  expires_at timestamptz not null,
  consumed_at timestamptz,
  attempt_count int not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists email_otp_email_idx on public.email_otp (email, created_at desc);

-- 2. WebAuthn Passkeys enrolled for user verification and transaction step-up
create table if not exists public.passkeys (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  credential_id text not null unique,
  credential_public_key bytea not null,
  counter bigint not null default 0,
  transports text[],
  wallet_ids uuid[] not null default '{}',
  created_at timestamptz not null default now(),
  last_used_at timestamptz
);

-- 3. MPC Wallets (Address and vendor partition handle ONLY - NO private keys or seeds)
create table if not exists public.wallets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  address text not null,
  chain_family text not null default 'evm',
  mpc_provider text not null default 'turnkey',
  mpc_wallet_id text not null,
  status text not null default 'active',
  created_at timestamptz not null default now(),
  unique (address)
);

-- 4. Agent Clients (Scoped assistant credentials Claude/Cursor use)
create table if not exists public.agent_clients (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  name text not null default 'Claude',
  client_key_hash text not null,
  status text not null default 'active', -- active | paused | revoked
  expires_at timestamptz,
  created_at timestamptz not null default now()
);

-- 5. Grants (Strict permission policies attached 1:1 to agent clients)
create table if not exists public.grants (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null unique references public.agent_clients(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  wallet_ids uuid[] not null,
  mode text not null default 'always_ask', -- always_ask | autonomous
  chains text[] not null default array['eip155:8453'],
  allowed_assets text[] not null default array['ETH','USDC'],
  allowed_recipients text[] not null default array[]::text[], -- empty = new recipients need ask
  allow_any_recipient boolean not null default false,
  max_wei_per_tx numeric not null default 0,
  max_wei_per_day numeric not null default 0,
  authorized_by_credential_id text,
  authorized_at timestamptz,
  updated_at timestamptz not null default now()
);

-- 6. Pending Approvals (Single-use, hash-bound tickets with 10m expiry)
create table if not exists public.pending_approvals (
  id text primary key,
  user_id uuid not null references public.users(id) on delete cascade,
  client_id uuid not null references public.agent_clients(id),
  wallet_id uuid not null references public.wallets(id),
  payload_hash text not null,
  canonical_tx jsonb not null,
  used boolean not null default false,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

-- 7. Spend Counters (Atomic daily volume tracking per grant)
create table if not exists public.spend_counters (
  grant_id uuid not null references public.grants(id) on delete cascade,
  day_utc date not null default current_date,
  spent_wei numeric not null default 0,
  primary key (grant_id, day_utc)
);

-- 8. Audit Logs (Sanitized, immutable audit events)
create table if not exists public.audit_logs (
  id bigint generated always as identity primary key,
  user_id uuid,
  wallet_address text,
  client_id uuid,
  action text not null,
  details jsonb not null default '{}',
  created_at timestamptz not null default now()
);

-- Indexes for high-performance context resolution
create index if not exists idx_agent_clients_user on public.agent_clients (user_id);
create index if not exists idx_agent_clients_hash on public.agent_clients (client_key_hash);
create index if not exists idx_wallets_user on public.wallets (user_id);
create index if not exists idx_pending_approvals_user_used on public.pending_approvals (user_id, used);
create index if not exists idx_grants_client on public.grants (client_id);
create index if not exists idx_audit_logs_user on public.audit_logs (user_id);

-- 9. Positions (Take-Profit, Stop-Loss, and Limit Orders - Section 23)
create table if not exists public.positions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  client_id uuid not null references public.agent_clients(id),
  wallet_id uuid not null references public.wallets(id),
  network text not null,
  base_asset text not null,
  quote_asset text not null,
  side text not null,              -- take_profit | stop_loss | limit_buy | limit_sell
  size_base text,
  trigger_price_usd numeric,
  limit_price_usd numeric,
  slippage_bps int not null default 50,
  status text not null default 'open', -- open | triggered | executed | cancelled | failed
  last_error text,
  created_at timestamptz default now()
);

create index if not exists idx_positions_user_status on public.positions (user_id, status);

-- 10. Extended Grant Permission Flags (Section 24)
alter table public.grants add column if not exists allow_swaps boolean default false;
alter table public.grants add column if not exists allow_deploys boolean default false;
alter table public.grants add column if not exists allow_mints boolean default false;
alter table public.grants add column if not exists allow_positions boolean default false;
alter table public.grants add column if not exists allow_deploys_autonomous boolean default false;
alter table public.grants add column if not exists max_usd_per_tx numeric;

-- 11. OAuth Clients (e.g. Claude.ai, Claude Desktop, Cursor)
create table if not exists public.oauth_clients (
  id text primary key,
  name text not null,
  redirect_uri_prefixes text[] not null,
  created_at timestamptz not null default now()
);

-- 12. OAuth Authorization Codes (S256 PKCE with short TTL)
create table if not exists public.oauth_codes (
  code_hash text primary key,
  client_id text not null references public.oauth_clients(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  redirect_uri text not null,
  code_challenge text not null,
  code_challenge_method text not null default 'S256',
  scope text not null default 'mcp',
  used boolean not null default false,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

-- 13. OAuth Access Tokens (Bearer tokens issued to Claude/agents)
create table if not exists public.oauth_tokens (
  id uuid primary key default gen_random_uuid(),
  token_hash text not null unique,
  user_id uuid not null references public.users(id) on delete cascade,
  client_id text not null references public.oauth_clients(id) on delete cascade,
  scope text not null default 'mcp',
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

create index if not exists idx_oauth_tokens_hash on public.oauth_tokens (token_hash);
create index if not exists idx_oauth_tokens_user on public.oauth_tokens (user_id);
create index if not exists idx_oauth_codes_hash on public.oauth_codes (code_hash);

-- Seed Claude OAuth client
insert into public.oauth_clients (id, name, redirect_uri_prefixes)
values ('claude', 'Claude', array['https://claude.ai/', 'https://claude.com/'])
on conflict (id) do nothing;

