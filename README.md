# Northveil Universal Model Context Protocol (MCP) Server

[![MCP Protocol](https://img.shields.io/badge/MCP-2024--11--05-blueviolet.svg?style=flat-square)](https://modelcontextprotocol.io/)
[![Claude Desktop](https://img.shields.io/badge/Claude%20Desktop-Ready-orange.svg?style=flat-square)](https://claude.ai)
[![Cursor IDE](https://img.shields.io/badge/Cursor%20IDE-Ready-purple.svg?style=flat-square)](https://cursor.sh)
[![OpenAPI 3.0](https://img.shields.io/badge/OpenAPI-3.0.3-emerald.svg?style=flat-square)](https://swagger.io/specification/)
[![Docker](https://img.shields.io/badge/Docker-Ready-blue.svg?style=flat-square)](https://hub.docker.com/)

An enterprise **Model Context Protocol (MCP)** server providing Claude Desktop, Cursor IDE, Windsurf, Continue.dev, ChatGPT Actions, and autonomous agent frameworks with 38 specialized tools for multi-chain Web3 interaction, cryptographic airline ticketing, luxury hotel reservations, and static smart contract security audits.

---

## ⚡ Transports Supported

1. **HTTP JSON-RPC 2.0 (`POST /mcp`)**: Standard JSON-RPC tool router for AI agents and client libraries.
2. **Server-Sent Events (`GET /sse` & `POST /message`)**: Real-time bidirectional streaming for Claude Desktop.
3. **OpenAPI 3.0.3 Schema (`GET /openapi.json` & `GET /mcp`)**: Direct one-click import into ChatGPT Actions.
4. **Interactive Wallet UI Widget (`GET /ui/widget`)**: Visual portfolio widget embedded into agent webviews.

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
        "NORTHVEIL_API_KEY": "nv_live_9f82a17b09c82415d8a9",
        "NORTHVEIL_WALLET_ADDRESS": "0x56f0fdbe1b09c0f65da1cb73ef878c07ec645417",
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
        "Authorization": "Bearer nv_live_9f82a17b09c82415d8a9",
        "X-API-Key": "nv_live_9f82a17b09c82415d8a9"
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
4. All 38 tools are now accessible to Cursor Composer and Agent mode!

---

## 🌐 3. ChatGPT Actions & Custom GPTs Setup

1. In ChatGPT GPT Builder, go to **Configure** ➔ **Actions** ➔ **Create new action**.
2. Paste Schema URL: `https://mcp.northveil.xyz/openapi.json`.
3. Set Authentication: **API Key** (Header: `X-API-Key`).
4. ChatGPT will automatically discover endpoints for searching flights in crypto, querying portfolios, and auditing smart contracts!

---

## 🦜 4. AI Agent Frameworks (LangChain & CrewAI)

### LangChain Python Agent
```python
from langchain.agents import initialize_agent, AgentType
from langchain.tools import Tool
from langchain_openai import ChatOpenAI
import northveil

client = northveil.Northveil()

def search_crypto_flights(route: str):
    orig, dest = route.split(",")
    return client.search_flights(origin=orig.strip(), destination=dest.strip())

tools = [
    Tool(
        name="search_flights",
        func=search_crypto_flights,
        description="Search airline flights with live crypto pricing. Input format: 'LHR, JFK'"
    )
]

agent = initialize_agent(tools, ChatOpenAI(model="gpt-4o"), agent=AgentType.ZERO_SHOT_REACT_DESCRIPTION, verbose=True)
agent.run("Find business class flights from London Heathrow to New York JFK in ETH")
```

---

## 🐳 5. Self-Hosting & Docker Deployment

```bash
# Clone and build container
git clone https://github.com/Fortunehack45/Northveil-MCP.git
cd Northveil-MCP
docker build -t northveil-mcp .

# Run on port 3001
docker run -d -p 3001:3001 \
  -e PORT=3001 \
  -e SUPABASE_URL=https://ulkbchewsrksgvlbzjzl.supabase.co \
  -e SUPABASE_SERVICE_ROLE_KEY=your_key \
  --name northveil-server northveil-mcp
```

---

## 🔒 Multi-Tenant Auth & Tool Permission Rules

The server enforces strict multi-tenant authorization:
- **Public Discovery Tools** (`search_flights`, `search_hotels`, `audit_smart_contract`, `get_realtime_prices`) require no wallet binding.
- **Private Data Tools** (`get_portfolio`, `get_wallet_info`, `send_transfer`, `mint_tokens`) verify caller ownership against Supabase DB `mcp_api_keys`. If an unauthorized wallet is requested, the server responds with `403 Forbidden`.

---

## 📄 License
MIT License © 2026 Northveil Protocol.
