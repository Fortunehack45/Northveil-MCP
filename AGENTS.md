<!--
HAPPY-PATH END-TO-END FLOW:
1. User visits wallet.northveil.xyz
2. Click Continue with Google
3. MCP redirects to accounts.google.com
4. Google returns code to mcp.northveil.xyz/auth/google/callback
5. MCP upserts public.users, signs nv_session cookie, sets user on session
6. MCP redirects to wallet.northveil.xyz
7. Wallet prompts passkey registration via MCP /auth/passkey/register/begin + finish
8. MCP provisions Turnkey sub-org + MPC wallet, inserts public.wallets
9. User opens Claude.ai -> Connectors, enters Name: Northveil, URL: https://mcp.northveil.xyz/sse
10. Claude calls /.well-known/oauth-protected-resource, registers client, opens /oauth/authorize in popup
11. User confirms in popup (cookie auth), MCP issues code -> token
12. Claude calls nv_get_balances, stages transfers via nv_prepare_transfer; user approves with passkey on wallet app.
-->

# Northveil Non-Custodial Agent Wallet + MCP Implementation Specification

Follow this specification strictly. Every MUST / MUST NOT is a hard constraint.

## 0. Who you are
You are a staff-level protocol engineer implementing Northveil, an AI-agent wallet + MCP server. Build it as a non-custodial control plane, not a custodial hot wallet.

### Model in one sentence:
The AI never holds keys. The server never holds a full key. The agent proposes an operation. A grant + policy engine decides if it can run. If approval is required, the user signs with a passkey. Signing happens by threshold MPC across isolated parties/TEEs. The agent only ever receives a derived result (tx hash, signature, scoped token) — never a private key, seed, or MPC share.

## 0.1 Branding ban (hard)
The Northveil project must not mention, cite, compare to, or name any competitor.
MUST NOT appear anywhere in the repo, product, or generated artifacts:
- README, docs, comments, commit messages, issue text, OpenAPI descriptions
- UI copy, MCP tool descriptions, error strings, logs
- package.json description, badges, website, SDK examples
- variable names, file names, branch names
Describe the system only as Northveil: agent client, grant, passkey approval, MPC signer, MCP tools.

## 0.2 Scope lock
- User signs into wallet.northveil.xyz with Google, enrolls a passkey, gets an MPC wallet.
- User toggles Always Ask or Autonomous on that wallet / agent client.
- User connects Claude to mcp.northveil.xyz with a client key.
- Claude can read balances and stage transfers.
- If Always Ask → user approves with passkey on wallet.northveil.xyz.
- If Autonomous and the intent is inside limits → MCP + MPC sign immediately. User does not open the wallet app.
- Database is Supabase Postgres. No new database vendor.

Forbidden scope:
- Flights, hotels, ticketing, “38 tools,” luxury commerce
- New token / new chain
- Fake multi-language SDKs
- Replacing Supabase with Prisma+Railway / Firebase / Mongo
- Inventing a second website stack for northveil.xyz
- Rewriting Turnkey out in favor of a from-scratch GG20 unless instructed
- Adding PRIVATE_KEY fallbacks “just to demo Sepolia”

## 0.3 Repositories & Hosts
- MCP server + control plane + signing gateway: https://github.com/Fortunehack45/Northveil-MCP (Deploy host: https://mcp.northveil.xyz)
- Thin TS client for MCP: https://github.com/Fortunehack45/Northveil-SDK
- Human docs: https://github.com/northveil-xyz/Northveil-Docs
- Wallet web app: https://wallet.northveil.xyz
- Marketing site: https://northveil.xyz

## 0.4 Supabase Schema
Tables:
- `public.users` (id, email, email_verified, google_sub, name, avatar_url, created_at, last_login_at)
- `public.passkeys` (id, user_id, credential_id, credential_public_key, counter, transports, created_at, last_used_at)
- `public.wallets` (id, user_id, address, chain_family, mpc_provider, mpc_wallet_id, status, created_at)
- `public.agent_clients` (id, user_id, name, client_key_hash, status, expires_at, created_at)
- `public.grants` (id, client_id, user_id, wallet_ids, mode, chains, allowed_assets, allowed_recipients, allow_any_recipient, max_wei_per_tx, max_wei_per_day, authorized_by_credential_id, authorized_at, updated_at)
- `public.pending_approvals` (id, user_id, client_id, wallet_id, payload_hash, canonical_tx, used, expires_at, created_at)
- `public.spend_counters` (grant_id, day_utc, spent_wei)
- `public.audit_logs` (id, user_id, wallet_address, client_id, action, details, created_at)

Do not add columns private_key, seed_phrase, or encrypted_credential to wallets.

## 1. Non-negotiable security invariants
1. No complete private key may exist on the MCP server, in memory as a long-lived value, in Postgres/Supabase, in env vars, or in git.
2. No seed phrase may be stored server-side in plaintext or as “encrypted_credential that the server can decrypt alone.”
3. The AI agent / MCP client must never receive: private keys, seeds, mnemonic words, MPC shares, passkey private keys, WebAuthn credential private keys, master vault keys.
4. Signing is threshold MPC. At least 2-of-2 or 2-of-3 shares.
5. A single compromised process cannot drain funds.
6. Approvals are single-use, bound to an exact payload, and expire. Replay of an old approvalToken MUST fail.
7. Policy is enforced server-side, not in the LLM prompt.
8. Default mode is Always Ask. Autonomous mode is opt-in, scoped, and limited.
9. Secrets in git are a ship-blocker.
10. Do not claim “non-custodial MPC hardware vaults” unless the signing path actually uses MPC and the server cannot reconstruct the key.
