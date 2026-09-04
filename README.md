
# Northveil — Non-Custodial Agent Wallet & MCP Control Plane

[![Live dApp](https://img.shields.io/badge/Live%20Wallet-wallet.northveil.xyz-blue.svg?style=flat-square)](https://wallet.northveil.xyz)
[![MCP Gateway](https://img.shields.io/badge/MCP%20Gateway-mcp.northveil.xyz-purple.svg?style=flat-square)](https://mcp.northveil.xyz)
[![npm SDK](https://img.shields.io/npm/v/northveil-sdk.svg?style=flat-square&color=blue)](https://www.npmjs.com/package/northveil-sdk)
[![Developer CLI](https://img.shields.io/npm/v/northveil-cli.svg?style=flat-square&color=emerald)](https://www.npmjs.com/package/northveil-cli)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg?style=flat-square)](https://opensource.org/licenses/MIT)

Northveil is a strictly non-custodial control plane and Model Context Protocol (MCP) server for AI agents (Claude Desktop, Cursor, custom autonomous agents).

### Core Invariant
> **The AI never holds keys. The server never holds a full key.**
> The agent proposes an operation. A grant + policy engine decides if it can run. If approval is required, the user signs with a passkey. Signing happens by threshold MPC across isolated parties/TEEs. The agent only ever receives a derived result (tx hash, signature, scoped token) — never a private key, seed, or MPC share.

---

## 🔌 Official MCP Gateway Endpoints

| Client | Role | URL / Command | Transport & Auth |
| :--- | :--- | :--- | :--- |
| **Claude.ai / Claude Desktop** | **Primary Connector** | `https://mcp.northveil.xyz/mcp` | Streamable HTTP • OAuth 2.0 (RFC 8414) |
| **ChatGPT Apps (Developer mode)** | **Primary Connector** | `https://mcp.northveil.xyz/mcp` | Streamable HTTP • OAuth 2.0 (RFC 8414) |
| **Cursor / Windsurf / Claude Code** | **Primary Remote** | `https://mcp.northveil.xyz/mcp` | Streamable HTTP • Bearer Token |
| **Legacy SSE Clients** | Optional Compatibility | `https://mcp.northveil.xyz/sse` | Server-Sent Events (SSE) |
| **Local Stdio Transport** | CLI Bridge | `npx -y northveil-cli mcp` | stdio (JSON-RPC 2.0) |

> **Single Universal URL**: `https://mcp.northveil.xyz/mcp` is the universal endpoint for every user. User authentication (OAuth 2.0 / Bearer token) binds directly to the user's primary vault. No `?wallet_address=` query parameter is needed in the URL.

---

## 🛡️ Interactive In-Chat UI (MCP Apps)
Northveil serves interactive cards conforming to the MCP Apps specification (`text/html;profile=mcp-app`):
- `ui://northveil/send` — In-chat transfer approval card
- `ui://northveil/swap` — In-chat token swap staging card
- `ui://northveil/deploy` — In-chat smart contract deployment & execution card
- `ui://northveil/status` — Live spend request polling & transaction confirmation card
- `ui://northveil/read` — Vault balances and multi-chain portfolio rollups

Tool responses return `_meta.ui.resourceUri` so supporting clients render cards directly in the conversation. pure-text clients cleanly fallback to standard markdown text.

## 🏛️ Ecosystem Monorepo Architecture

```
Northveil/
├── mcp-server/                   # Non-custodial MCP Gateway (HTTP, SSE, OpenAPI, stdio)
│   ├── src/                      # Modular control plane (grantEngine, approvals, passkey, mpcAdapter)
│   ├── test/                     # Security and policy invariant test suites
│   └── supabase/                 # Non-custodial PostgreSQL schema & RLS policies
├── sdk/                          # Official TypeScript / JavaScript Client (npm: northveil-sdk)
├── wallet/                       # Next.js App Router biometric passkey control plane (wallet.northveil.xyz)
├── docs/                         # Protocol architecture specifications & database schemas
└── supabase/                     # Supabase migrations & row-level security
```

---

## 🔐 Non-Custodial MPC Control-Plane Architecture

1. **Zero Server-Side Private Key Storage**: Northveil does not store your seed; Turnkey holds key material. No private keys, seed phrases, or MPC secret shares exist on the server, in memory as long-lived secrets, in Postgres, in environment variables, or in git.
2. **WebAuthn Biometric Passkey Gating**: Operations under *Always Ask* mode generate single-use approval tickets with 10-minute TTL. The challenge commits cryptographically to `sha256(canonicalUnsignedTx)`.
3. **Autonomous Agent Spending Scopes**: Users grant AI agents scoped operational budgets with maximum per-transaction caps, rolling 24-hour daily limits, and recipient allowlists. Non-zero calldata is forbidden in autonomous mode.
4. **Isolated Threshold MPC**: Signing occurs inside hardware-isolated enclaves (Turnkey TEE partitions) upon validation of policy and cryptographic passkey assertion evidence. On hosted environments, Northveil cannot sign with the operator key alone; the code throws `ORG_ROOT_SIGN_FORBIDDEN` unless stamped by the user or scoped delegate (see [SECURITY.md](file:///c:/Users/USER%20PC/Desktop/Northveil/SECURITY.md)).

---

## 📄 License
MIT License © 2026 Northveil Protocol.
