# Northveil Model Context Protocol (MCP) Server

[![MCP Protocol](https://img.shields.io/badge/MCP-2024--11--05-blueviolet.svg?style=flat-square)](https://modelcontextprotocol.io/)
[![Docker](https://img.shields.io/badge/Docker-Ready-blue.svg?style=flat-square)](https://hub.docker.com/)
[![Claude Desktop](https://img.shields.io/badge/Claude%20Desktop-Compatible-orange.svg?style=flat-square)](https://claude.ai)
[![Cursor IDE](https://img.shields.io/badge/Cursor%20IDE-Compatible-purple.svg?style=flat-square)](https://cursor.sh)

> **Enterprise Universal Model Context Protocol (MCP) Server exposing 38 autonomous Web3 tools, real-time airline flight search, luxury hotel booking, multi-chain custodial signing, and static AST smart contract audits to Claude Desktop, Cursor IDE, ChatGPT Actions, and autonomous AI agent frameworks.**

---

## 📑 Table of Contents

1. [Overview & Supported Transports](#-overview--supported-transports)
2. [Claude Desktop Configuration](#-claude-desktop-configuration)
3. [Cursor IDE Setup](#-cursor-ide-setup)
4. [ChatGPT Actions & Custom GPTs OpenAPI 3.0 Schema](#-chatgpt-actions--custom-gpts)
5. [LangChain, LlamaIndex & CrewAI Agent Integration](#-langchain-llamaindex--crewai-integration)
6. [Docker Deployment & Production Hosting](#-docker-deployment)
7. [MCP Tool Signatures & Parameter Schemas](#-mcp-tool-signatures)
8. [Multi-Tenant Scoped Authentication](#-multi-tenant-scoped-authentication)

---

## ⚡ Overview & Supported Transports

The Northveil MCP Server supports all 3 official MCP transport protocols:

1. **HTTP JSON-RPC 2.0 (`POST /mcp`)**: Universal endpoint compatible with remote AI agents, Web applications, and LangChain.
2. **Server-Sent Events (`GET /sse` & `POST /message`)**: Real-time streaming transport for Claude Desktop and interactive IDEs.
3. **OpenAPI 3.0.3 Specification (`GET /openapi.json` & `GET /mcp`)**: Direct one-click import into ChatGPT Actions and custom GPTs.

---

## 🤖 Claude Desktop Configuration

Add Northveil to your Claude Desktop configuration file:

- **macOS**: `~/Library/Application Support/Claude/claude_desktop_config.json`
- **Windows**: `%APPDATA%\Claude\claude_desktop_config.json`
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

Or connect directly to the hosted SSE stream:

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

## 💻 Cursor IDE Setup

To enable Northveil AI tools across your codebase in Cursor:
1. Open Cursor Settings ➔ **Features** ➔ **MCP Servers**.
2. Click **+ Add New MCP Server**.
3. Fill in the fields:
   - **Name**: `Northveil`
   - **Type**: `command`
   - **Command**: `npx -y northveil-cli mcp`
4. Cursor Composer and Chat will immediately have access to all 38 tools!

---

## 🌐 ChatGPT Actions & Custom GPTs

Northveil automatically serves a compliant **OpenAPI 3.0.3 Schema**:

1. In ChatGPT GPT Builder, go to **Configure** ➔ **Create new action**.
2. Paste the Schema URL: `https://mcp.northveil.xyz/openapi.json` (or import directly from `https://mcp.northveil.xyz/mcp`).
3. Set Authentication to **API Key** (Header: `X-API-Key`).
4. ChatGPT can now natively query live crypto flight fares, check wallet balances, and audit smart contracts during conversation!

---

## 🦜 LangChain, LlamaIndex & CrewAI Integration

### Python LangChain Example
```python
import os
import requests
from langchain.agents import initialize_agent, AgentType
from langchain.tools import Tool
from langchain_openai import ChatOpenAI
import northveil

client = northveil.Northveil(api_key=os.getenv("NORTHVEIL_API_KEY"))

def search_crypto_flights(query: str) -> str:
    origin, dest = query.split(",")
    res = client.search_flights(origin=origin.strip(), destination=dest.strip())
    return res.get("formattedMarkdown", str(res))

tools = [
    Tool(
        name="SearchFlights",
        func=search_crypto_flights,
        description="Search real-time airline flights with live crypto pricing. Input: 'LHR, JFK'"
    )
]

llm = ChatOpenAI(model="gpt-4o", temperature=0)
agent = initialize_agent(tools, llm, agent=AgentType.ZERO_SHOT_REACT_DESCRIPTION, verbose=True)
agent.run("Find me business class flights from London Heathrow to New York JFK in ETH")
```

---

## 🐳 Docker Deployment

Run the complete Northveil MCP Server locally in an isolated container:

```bash
# Build container
docker build -t northveil-mcp-server .

# Run with environment variables
docker run -d -p 3001:3001   -e PORT=3001   -e SUPABASE_URL=https://ulkbchewsrksgvlbzjzl.supabase.co   -e SUPABASE_SERVICE_ROLE_KEY=your_key   --name northveil-mcp northveil-mcp-server
```

---

## 📄 License
MIT License © 2026 Northveil Protocol.
