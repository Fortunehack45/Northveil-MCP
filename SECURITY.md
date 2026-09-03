# Northveil Security Policy & Threat Model

## Security Architecture & Invariants

Northveil is an AI-agent non-custodial wallet and MCP server control plane. Security is enforced through strict cryptographic separation, server-side policy evaluation, WebAuthn passkey step-up authorization, and threshold MPC enclaves.

### 10 Non-Negotiable Security Invariants

1. **No Complete Private Keys**: No complete private key may exist on the MCP server, in memory as a long-lived value, in Postgres/Supabase, in environment variables, or in version control.
2. **No Seed Phrase Storage**: No seed phrase may be stored server-side in plaintext or as an encrypted credential that the server can decrypt alone. Server-side AES encryption of a full key where the server holds the master secret is custody and is strictly prohibited.
3. **No Key Exfiltration to Agents**: The AI agent / MCP client must never receive private keys, seeds, mnemonic phrases, MPC shares, passkey private keys, WebAuthn credential private keys, or master vault secrets. Only derived results (transaction hashes, signatures, public addresses, scoped capability tokens) are returned.
4. **Threshold MPC Signing**: Signing is executed exclusively via threshold MPC across isolated parties/TEEs (e.g. Turnkey enclaves and user-bound authenticators). No single party holds a full private key.
5. **No Single Point of Compromise**: A single compromised process (e.g. compromised MCP process, LLM prompt injection, or rogue subagent) cannot produce a valid on-chain signature without satisfying verified grant policies or passkey authorization.
6. **Single-Use, Hash-Bound Approvals**: Approvals are single-use, bound cryptographically to the exact payload hash (`sha256(canonicalUnsignedTx)`), and enforce a strict 10-minute time-to-live (TTL). Replay of any approval ticket or token is rejected.
7. **Server-Side Policy Enforcement**: All spending caps, chain permissions, asset allowlists, and recipient filters are strictly evaluated server-side in code (`grantEngine.ts`). The model/LLM is untrusted.
8. **Always Ask by Default**: The default permission mode is `always_ask`. Every state-changing transaction requires human passkey verification. `autonomous` mode is strictly opt-in, pre-authorized with explicit spending limits and recipient scopes.
9. **Zero Secrets in Source Control**: No live API keys, private keys, database service-role secrets, or production credentials may be committed to git.
10. **Zero Custodial Claims Without MPC**: The system does not claim non-custodial MPC guarantees unless the signing path actively employs threshold MPC where the server cannot reconstruct key material.

---

## Threat Model & Attack Surface Mitigation

| Threat Vector | Potential Impact | Northveil Defense |
|---|---|---|
| **Prompt Injection** | Malicious prompt instructs agent to drain wallet to attacker address. | Server-side policy engine (`grantEngine.ts`) rejects unapproved recipients and forces human passkey step-up (`APPROVAL_REQUIRED`). |
| **Compromised MCP Process** | Attacker gains code execution on the MCP server. | Server holds no private keys or seed phrases. Signing requires Turnkey enclave authentication and/or passkey assertion matching payload hash. |
| **Approval Replay Attack** | Attacker intercepts valid approval and replays it to send duplicate transactions. | Tickets are marked `used = true` atomically upon consumption and have a 10-minute expiry. Replay throws `REPLAY_REJECTED`. |
| **Payload Mutation Attack** | Agent modifies recipient or amount between prepare and execute steps. | Passkey challenge is cryptographically bound to `sha256(canonicalUnsignedTx)`. Any byte change invalidates the WebAuthn signature. |
| **Stolen Agent Client Key** | Rogue actor gets `nv_live_...` client key. | Operations are bounded by the grant (daily spend limit, allowed chains/assets). The human can immediately revoke the key via the wallet dashboard. |
| **Production Server Misconfiguration** | Operator accidentally sets `PRIVATE_KEY` in environment. | Server boot script performs security assertions and immediately terminates (`process.exit(1)`) if raw private key environment variables are detected. |

---

## Reporting Security Vulnerabilities

If you discover a potential security vulnerability in Northveil, please disclose it responsibly via security@northveil.xyz.
