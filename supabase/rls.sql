-- Northveil Row-Level Security (RLS) Policies
-- The MCP Server accesses database via SERVICE ROLE (bypassing RLS).
-- The Wallet web frontend interacts using Supabase Auth or session-isolated endpoints.

alter table public.users enable row level security;
alter table public.passkeys enable row level security;
alter table public.wallets enable row level security;
alter table public.agent_clients enable row level security;
alter table public.grants enable row level security;
alter table public.pending_approvals enable row level security;
alter table public.spend_counters enable row level security;
alter table public.audit_logs enable row level security;

-- Users policies
create policy "Users can view their own profile"
  on public.users for select
  using (auth.uid() = id);

create policy "Users can update their own profile"
  on public.users for update
  using (auth.uid() = id);

-- Passkeys policies
create policy "Users can view their own passkeys"
  on public.passkeys for select
  using (auth.uid() = user_id);

create policy "Users can insert their own passkeys"
  on public.passkeys for insert
  with check (auth.uid() = user_id);

create policy "Users can delete their own passkeys"
  on public.passkeys for delete
  using (auth.uid() = user_id);

-- Wallets policies (Public addresses & MPC handles only)
create policy "Users can view their own wallets"
  on public.wallets for select
  using (auth.uid() = user_id);

-- Agent Clients policies
create policy "Users can view their own agent clients"
  on public.agent_clients for select
  using (auth.uid() = user_id);

create policy "Users can modify their own agent clients"
  on public.agent_clients for all
  using (auth.uid() = user_id);

-- Grants policies
create policy "Users can view their own grants"
  on public.grants for select
  using (auth.uid() = user_id);

create policy "Users can update their own grants"
  on public.grants for update
  using (auth.uid() = user_id);

-- Pending Approvals policies
create policy "Users can view their pending approvals"
  on public.pending_approvals for select
  using (auth.uid() = user_id);

create policy "Users can update their pending approvals"
  on public.pending_approvals for update
  using (auth.uid() = user_id);

-- Audit Logs policies
create policy "Users can view their own audit logs"
  on public.audit_logs for select
  using (auth.uid() = user_id);
