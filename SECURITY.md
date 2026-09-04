# Northveil Security Policy & Threat Model

## Security Architecture & Invariants

Northveil is an AI-agent non-custodial wallet and MCP server control plane. Security is enforced through strict cryptographic separation, server-side policy evaluation, WebAuthn passkey step-up authorization, and threshold MPC hardware enclaves.

### 10 Non-Negotiable Security Invariants

1. **No Complete Private Keys**: No complete private key may exist on the MCP server, in memory as a long-lived value, in Postgres/Supabase, in environment variables, or in version control.
2. **No Seed Phrase Storage**: No seed phrase may be stored server-side in plaintext or as an encrypted credential that the server can decrypt alone. Server-side AES encryption of a full key where the server holds the master secret is custody and is strictly prohibited.
3. **No Key Exfiltration to Agents**: The AI agent / MCP client must never receive private keys, seeds, mnemonic phrases, MPC shares, passkey private keys, WebAuthn credential private keys, or master vault secrets. Only derived results (transaction hashes, signatures, public addresses, scoped capability tokens) are returned.
4. **Threshold MPC Signing**: Signing is executed exclusively via threshold MPC across isolated parties/TEEs (Turnkey nitro enclaves and user-bound authenticators). No single party holds a full private key.
5. **No Single Point of Compromise**: A single compromised process (e.g. compromised MCP process, LLM prompt injection, or rogue subagent) cannot produce a valid on-chain signature without satisfying verified grant policies or passkey authorization.
6. **Single-Use, Hash-Bound Approvals**: Approvals are single-use, bound cryptographically to the exact payload hash (`sha256(canonicalUnsignedTx)`), and enforce a strict 10-minute time-to-live (TTL). Replay of any approval ticket or token is rejected.
7. **Server-Side Policy Enforcement**: All spending caps, chain permissions, asset allowlists, and recipient filters are strictly evaluated server-side in code (`grantEngine.ts`). The model/LLM is untrusted.
8. **Always Ask by Default**: The default permission mode is `always_ask`. Every state-changing transaction requires human passkey verification. `autonomous` mode is strictly opt-in, pre-authorized with explicit spending limits and recipient scopes.
9. **Zero Secrets in Source Control**: No live API keys, private keys, database service-role secrets, or production credentials may be committed to git.
10. **Zero Custodial Claims Without MPC**: The system does not claim non-custodial MPC guarantees unless the signing path actively employs threshold MPC where the server cannot reconstruct key material.

---

## Non-Custodial Architecture & Cryptographic Boundaries

```
┌───────────────────────────┐         ┌───────────────────────────────┐
│     User Browser / SPA    │         │     AI Agent / Claude MCP     │
│   (wallet.northveil.xyz)  │         │       (mcp.northveil.xyz)     │
└─────────────┬─────────────┘         └───────────────┬───────────────┘
              │ WebAuthn Passkey (P-256)             │ JSON-RPC Intent
              │ In-browser TEK Encrypted Bundle       │ (to, amount, chain)
              ▼                                       ▼
┌─────────────────────────────────────────────────────────────────────┐
│                      Northveil Control Plane                        │
│                 (Stateless Node.js / TypeScript)                    │
│                                                                     │
│  - No complete private keys in memory, env, or database             │
│  - Supabase Postgres: stores only public address + mpc_wallet_id    │
│  - Evaluates grant limits, daily velocity, allowlists               │
│  - Rejects plaintext import: RAW_MATERIAL_FORBIDDEN                 │
│  - Emits single-use permits (assertSignPermit)                      │
└──────────────────────────────────┬──────────────────────────────────┘
                                   │ Stamped Request
                                   │ (Root key CANNOT sign alone)
                                   ▼
┌─────────────────────────────────────────────────────────────────────┐
│                 Turnkey Threshold MPC Enclaves                      │
│             (FIPS 140-2 Level 3 HSM / AWS Nitro TEE)                │
│                                                                     │
│  - Key material generated inside enclave, never exported            │
│  - Evaluates Turnkey Enclave Policy: DENY root signing              │
│  - Requires User WebAuthn assertion OR user-scoped autonomous grant │
│  - Returns derived signature only (txHash, rawSignature)            │
└─────────────────────────────────────────────────────────────────────┘
```

### Key Custody Model
1. **Enclave-Bound Keys**: Private keys and MPC shares exist solely inside Turnkey secure enclaves.
2. **Database Storage**: Northveil's database (`wallets` table) stores strictly public addresses, chain families (`evm`, `solana`), and external identifiers (`mpc_wallet_id`). Columns for `private_key`, `seed_phrase`, or `encrypted_credential` are permanently prohibited.
3. **Agent Isolation**: Agents only submit transfer or contract call intents and receive `requestId`, `status`, and `txHash`. No agent process ever touches or sees key material.
4. **Device-Encrypted Import**:
   - Wallet import never transmits plaintext mnemonics or private keys to the server.
   - The user's browser requests an enclave Target Encryption Key (`importBundle`) via `POST /wallet/import/begin`.
   - The browser performs client-side HPKE encryption (`encryptWalletToBundle` / `encryptPrivateKeyToBundle`) using `@turnkey/crypto`.
   - The server only receives an `encryptedBundle` via `POST /wallet/import/finish` and forwards it directly to the Turnkey enclave.
   - Direct plaintext submission to `POST /wallet/import` is rejected with `400 RAW_MATERIAL_FORBIDDEN`.

---

## Turnkey Enclave Policy Specification

To guarantee non-custodial operation, Turnkey organizations enforce policies that strip operator root API keys of autonomous transaction signing privileges. The MCP server's API credentials alone cannot produce signatures.

### Policy 1: Deny Root Signing Without User Authorization
```json
{
  "policyName": "DenyRootSignWithoutUserAuthorization",
  "effect": "EFFECT_DENY",
  "consensus": "true",
  "condition": "activity.type == 'ACTIVITY_TYPE_SIGN_TRANSACTION_V2' && !hasUserAuthorization(activity)",
  "notes": "Denies raw SIGN_TRANSACTION requests from operator root API keys unless accompanied by user-authenticated WebAuthn assertion or validated user-bound grant permit."
}
```

### Policy 2: Allow User Passkey Signing
```json
{
  "policyName": "AllowUserPasskeySigning",
  "effect": "EFFECT_ALLOW",
  "consensus": "approvers.any(user, user.hasCredentialType('CREDENTIAL_TYPE_WEBAUTHN_AUTHENTICATOR'))",
  "condition": "activity.type == 'ACTIVITY_TYPE_SIGN_TRANSACTION_V2'",
  "notes": "Allows transaction signing when authenticated by user passkey assertion matching payload hash."
}
```

### Policy 3: Allow Autonomous Signing Scoped to Velocity & Allowlist
```json
{
  "policyName": "AllowScopedAutonomousExecution",
  "effect": "EFFECT_ALLOW",
  "consensus": "approvers.any(agent, agent.hasTag('autonomous_delegate'))",
  "condition": "activity.type == 'ACTIVITY_TYPE_SIGN_TRANSACTION_V2' && activity.parameters.value <= grant.maxWeiPerTx && isAllowedRecipient(activity.parameters.to)",
  "notes": "Allows automated signing only within server-side verified spending caps and recipient allowlists."
}
```

### Turnkey Console Operator Checklist (100% Non-Custodial Verification)

To guarantee that the operator's Turnkey API root key cannot sign transactions alone, the organization operator applies the following policy rules in the Turnkey Console (`app.turnkey.com`):

- [ ] Org root API key (`TURNKEY_API_PUBLIC_KEY`) policies:
      - `DENY activity.type == ACTIVITY_TYPE_SIGN_TRANSACTION_V2`
      - `ALLOW ACTIVITY_TYPE_CREATE_WALLET`
      - `ALLOW ACTIVITY_TYPE_INIT_IMPORT_WALLET`
      - `ALLOW ACTIVITY_TYPE_IMPORT_WALLET`
      - `ALLOW ACTIVITY_TYPE_CREATE_API_KEYS` (users only)
- [ ] User / WebAuthn / delegate key:
      - `ALLOW ACTIVITY_TYPE_SIGN_TRANSACTION_V2`
- [ ] `TURNKEY_API_PRIVATE_KEY` is not used in signAndBroadcast on Vercel
- [ ] `ALLOW_ORG_ROOT_SIGN` is unset on Vercel
- [ ] Hosted autonomous either uses delegate key or is disabled (`AUTONOMOUS_REQUIRES_DELEGATE_KEY`)

> [!IMPORTANT]
> Northveil's code fails closed: on hosted environments, any call attempting to sign with the organization root key immediately throws `ORG_ROOT_SIGN_FORBIDDEN`. Applying the Turnkey Console deny-policy in the enclave completes cryptographic non-custody.


---

## Threat Model & Attack Surface Mitigation

| Threat Vector | Potential Impact | Northveil Defense |
|---|---|---|
| **Prompt Injection** | Malicious prompt instructs agent to drain wallet to attacker address. | Server-side policy engine (`grantEngine.ts`) rejects unapproved recipients and forces human passkey step-up (`APPROVAL_REQUIRED`). |
| **Compromised MCP Process** | Attacker gains code execution on the MCP server. | Server holds no private keys or seed phrases. Signing is refused by Turnkey unless accompanied by user passkey assertion or within pre-committed policy. |
| **Approval Replay Attack** | Attacker intercepts valid approval and replays it to send duplicate transactions. | Tickets are marked `used = true` atomically upon consumption and have a 10-minute expiry. Replay throws `REPLAY_REJECTED`. |
| **Payload Mutation Attack** | Agent modifies recipient or amount between prepare and execute steps. | Passkey challenge is cryptographically bound to `sha256(canonicalUnsignedTx)`. Any byte change invalidates the WebAuthn signature. |
| **Stolen Agent Client Key** | Rogue actor gets `nv_live_...` client key. | Operations are bounded by the grant (daily spend limit, allowed chains/assets). The human can immediately revoke the key via the wallet dashboard. |
| **Production Server Misconfiguration** | Operator accidentally sets `PRIVATE_KEY` in environment. | Server boot script performs security assertions (`assertProductionSecurity()`) and immediately terminates (`process.exit(1)`) if raw private key environment variables are detected. |

---

## Reporting Security Vulnerabilities

If you discover a potential security vulnerability in Northveil, please disclose it responsibly via security@northveil.xyz.
