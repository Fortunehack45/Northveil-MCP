# Northveil Universal Model Context Protocol (MCP) Server

[![MCP Protocol](https://img.shields.io/badge/MCP-2024--11--05-blueviolet.svg?style=flat-square)](https://modelcontextprotocol.io/)
[![Claude Desktop](https://img.shields.io/badge/Claude%20Desktop-Ready-orange.svg?style=flat-square)](https://claude.ai)
[![Cursor IDE](https://img.shields.io/badge/Cursor%20IDE-Ready-purple.svg?style=flat-square)](https://cursor.sh)
[![OpenAPI 3.0](https://img.shields.io/badge/OpenAPI-3.0.3-emerald.svg?style=flat-square)](https://swagger.io/specification/)

Non-custodial AI-agent wallet and Model Context Protocol (MCP) control plane.

### Security Architecture in Brief
The AI never holds keys. The server never holds a full key. The agent proposes an operation via MCP. A server-side grant and policy engine evaluates permissions.
- **Always Ask (Default)**: State-changing operations stage a `PendingApproval`. The human user verifies and signs via WebAuthn passkey at `https://wallet.northveil.xyz/approve/<id>`.
- **Autonomous Mode (Opt-in)**: Transactions within pre-authorized spending caps, chain permissions, and recipient allowlists execute directly via threshold MPC enclaves.

---

## ⚡ Transports Supported

1. **HTTP JSON-RPC 2.0 (`POST /mcp`)**: Standard JSON-RPC tool router for AI agents and developer clients.
2. **Server-Sent Events (`GET /sse` & `POST /message`)**: Bidirectional streaming transport for Claude Desktop and remote agents.
3. **OpenAPI 3.0.3 Schema (`GET /openapi.json`)**: Direct integration for ChatGPT Actions and REST tooling.
4. **Local stdio (`northveil-cli mcp`)**: Local subprocess transport for Claude Desktop and Cursor.

---

## 🤖 1. Claude Desktop Setup

Edit your Claude Desktop configuration file:
- **Windows**: `%APPDATA%\Claude\claude_desktop_config.json`
- **macOS**: `~/Library/Application Support/Claude/claude_desktop_config.json`
- **Linux**: `~/.config/Claude/claude_desktop_config.json`

```json
{
  "mcpServers": {
    "northveil": {
      "command": "npx",
      "args": ["-y", "northveil-cli", "mcp"],
      "env": {
        "NORTHVEIL_API_KEY": "YOUR_NORTHVEIL_CLIENT_KEY",
        "NORTHVEIL_API_URL": "https://mcp.northveil.xyz"
      }
    }
  }
}
```

Or connect via Hosted SSE:
```json
{
  "mcpServers": {
    "northveil-remote": {
      "url": "https://mcp.northveil.xyz/sse",
      "headers": {
        "Authorization": "Bearer YOUR_NORTHVEIL_CLIENT_KEY",
        "X-API-Key": "YOUR_NORTHVEIL_CLIENT_KEY"
      }
    }
  }
}
```

---

## 💻 2. Cursor IDE Configuration

1. In Cursor, open **Settings** ➔ **Features** ➔ **MCP Servers**.
2. Click **+ Add New MCP Server**.
3. Set **Type** to `command` and enter:
   ```bash
   npx -y northveil-cli mcp
   ```
4. Set environment variables:
   - `NORTHVEIL_API_KEY`: `YOUR_NORTHVEIL_CLIENT_KEY`
   - `NORTHVEIL_API_URL`: `https://mcp.northveil.xyz`

---

## 🌐 3. ChatGPT Actions & Custom GPTs Setup

1. In ChatGPT GPT Builder, navigate to **Configure** ➔ **Actions** ➔ **Create new action**.
2. Paste Schema URL: `https://mcp.northveil.xyz/openapi.json`.
3. Set Authentication: **API Key** (Header: `X-API-Key`).
4. Enter your Northveil client key. Approvals are completed by the human via WebAuthn passkey at `https://wallet.northveil.xyz`.

---

## 🐳 4. Deployment

```bash
git clone https://github.com/Fortunehack45/Northveil-MCP.git
cd Northveil-MCP
npm install
npm run build
npm start
```

### Environment Variables
```ini
PORT=3001
SUPABASE_URL=https://YOUR_PROJECT.supabase.co
SUPABASE_SERVICE_ROLE_KEY=YOUR_SERVICE_ROLE_KEY
TURNKEY_API_PUBLIC_KEY=
TURNKEY_API_PRIVATE_KEY=
TURNKEY_ORGANIZATION_ID=
WEBAUTHN_RP_ID=wallet.northveil.xyz
WEBAUTHN_ORIGIN=https://wallet.northveil.xyz
```

> **Security Note**: The server will refuse to start in production if `PRIVATE_KEY`, `SEPOLIA_PRIVATE_KEY`, or `ETH_PRIVATE_KEY` is set.

---

## 🔒 Non-Custodial Invariants

- No private keys or seed phrases exist on the server or database.
- Agent client keys (`nv_live_...`) are capability tokens stored as Argon2/cryptographic hashes.
- All spending policies are enforced server-side.
- Approvals are single-use and bound to `sha256(canonicalUnsignedTx)`.

---

## 📄 License
MIT License © 2026 Northveil Protocol.
