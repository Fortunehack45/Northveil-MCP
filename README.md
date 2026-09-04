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

1. **Universal Primary Connector (`POST /mcp`)**: Streamable HTTP JSON-RPC 2.0 gateway for Claude.ai, Claude Desktop, ChatGPT Apps (Developer mode), Cursor, Windsurf, and Claude Code (`https://mcp.northveil.xyz/mcp`).
2. **Interactive In-Chat UI (MCP Apps)**: Built-in UI card resources (`ui://northveil/send`, `ui://northveil/swap`, `ui://northveil/deploy`, `ui://northveil/status`, `ui://northveil/read`) with MIME type `text/html;profile=mcp-app`.
3. **Legacy Server-Sent Events (`GET /sse` & `POST /message`)**: Compatibility alias for legacy SSE clients (`https://mcp.northveil.xyz/sse`).
4. **OpenAPI 3.0.3 Schema (`GET /openapi.json`)**: Schema integration for ChatGPT Actions and REST tooling.
5. **Local stdio (`northveil-cli mcp`)**: Local subprocess transport for CLI workflows.

---

## 🤖 1. Primary MCP Remote Connection

### Universal Connection URL
```
https://mcp.northveil.xyz/mcp
```
> **Single Universal URL**: Same URL for every user. Authentication (OAuth 2.0 / Bearer token) binds directly to the user's primary vault. No `?wallet_address=` query parameter is needed.

### Claude Desktop Configuration
Edit `%APPDATA%\Claude\claude_desktop_config.json` (Windows) or `~/Library/Application Support/Claude/claude_desktop_config.json` (macOS):
```json
{
  "mcpServers": {
    "northveil": {
      "url": "https://mcp.northveil.xyz/mcp"
    }
  }
}
```

Or connect via Legacy SSE:
```json
{
  "mcpServers": {
    "northveil-legacy-sse": {
      "url": "https://mcp.northveil.xyz/sse"
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
