import { Request, Response } from 'express';
import { toolCatalog } from './toolCatalog.js';
import { listMcpAppResources, getMcpAppHtml } from '../ui/mcpApps.js';
import { resolveContext, HttpError } from '../auth/resolveContext.js';
import { dispatch } from '../tools/dispatch.js';

export { dispatch };

/**
 * Universal JSON-RPC Handler for Northveil MCP Control Plane.
 * Shared across canonical POST /mcp and backward-compatible POST /sse & POST /message.
 */
export async function handleMcpJsonRpc(req: Request, res: Response, body: any) {
  const { jsonrpc, id, method, params } = body || {};

  const isSseStream = Boolean(req.headers.accept && req.headers.accept.includes('text/event-stream'));

  const sendResponse = (statusCode: number, payload: any) => {
    if (isSseStream) {
      res.status(statusCode);
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
      res.setHeader('Access-Control-Allow-Origin', req.headers.origin || '*');
      res.flushHeaders();
      res.write(`event: message\ndata: ${JSON.stringify(payload)}\n\n`);
      return res.end();
    }
    return res.status(statusCode).json(payload);
  };

  if (method === 'initialize') {
    const requestedVersion = params?.protocolVersion;
    const protocolVersion = ['2024-11-05', '2025-03-26', '2025-06-18'].includes(requestedVersion)
      ? requestedVersion
      : '2025-03-26';

    return sendResponse(200, {
      jsonrpc: '2.0',
      id,
      result: {
        protocolVersion,
        capabilities: {
          tools: { listChanged: false },
          resources: { listChanged: false },
          extensions: { 'io.modelcontextprotocol/ui': {} },
        },
        serverInfo: {
          name: 'northveil',
          version: '1.0.0',
          iconUrl: 'https://iili.io/CDS9fvn.png',
          logoUrl: 'https://iili.io/CDS9fvn.png',
        },
      },
    });
  }

  if (method === 'notifications/initialized') {
    return res.status(202).json({ status: 'accepted' });
  }

  if (method === 'ping') {
    return sendResponse(200, {
      jsonrpc: '2.0',
      id,
      result: {},
    });
  }

  if (method === 'tools/list') {
    return sendResponse(200, {
      jsonrpc: '2.0',
      id,
      result: {
        tools: toolCatalog(),
      },
    });
  }

  if (method === 'resources/list') {
    return sendResponse(200, {
      jsonrpc: '2.0',
      id,
      result: {
        resources: listMcpAppResources(),
      },
    });
  }

  if (method === 'resources/read') {
    const uri = params?.uri || '';
    const html = getMcpAppHtml(uri);
    return sendResponse(200, {
      jsonrpc: '2.0',
      id,
      result: {
        contents: [
          {
            uri,
            mimeType: 'text/html;profile=mcp-app',
            text: html,
          },
        ],
      },
    });
  }

  if (method === 'tools/call') {
    try {
      const ctx = await resolveContext(req, params?.arguments || {});
      const out = await dispatch(params?.name, params?.arguments || {}, ctx, req);
      return sendResponse(200, {
        jsonrpc: '2.0',
        id,
        result: out,
      });
    } catch (e: any) {
      if (e.code === 'NO_WALLET' || e.message === 'NO_WALLET' || e.message?.includes('NO_WALLET')) {
        return sendResponse(200, {
          jsonrpc: '2.0',
          id,
          result: {
            content: [{
              type: 'text',
              text: 'No vault found for this account. Visit https://wallet.northveil.xyz to create one with a passkey.',
            }],
            isError: true,
            structuredContent: {
              kind: 'no_wallet',
              error: 'NO_WALLET',
              message: 'No vault found for this account. Visit https://wallet.northveil.xyz to create one with a passkey.',
              createVaultUrl: 'https://wallet.northveil.xyz',
            },
          },
        });
      }

      const statusCode = e instanceof HttpError ? e.statusCode : (e.status || e.statusCode);
      if (statusCode === 401 || e.wwwAuthenticate) {
        const authHeaderValue = typeof e.wwwAuthenticate === 'string'
          ? e.wwwAuthenticate
          : `Bearer realm="mcp", resource_metadata="https://mcp.northveil.xyz/.well-known/oauth-protected-resource"`;
        res.setHeader('WWW-Authenticate', authHeaderValue);
        const msg = e.code && !e.message?.includes(e.code) ? `${e.code}: ${e.message}` : (e.message || 'Unauthorized');
        return sendResponse(401, {
          jsonrpc: '2.0',
          id,
          error: {
            code: -32001,
            message: msg,
          },
        });
      }

      if (statusCode === 403) {
        const msg = e.code && !e.message?.includes(e.code) ? `${e.code}: ${e.message}` : (e.message || 'Forbidden');
        return sendResponse(403, {
          jsonrpc: '2.0',
          id,
          error: {
            code: -32003,
            message: msg,
          },
        });
      }

      if (statusCode && statusCode >= 400 && statusCode < 500) {
        const msg = e.code && !e.message?.includes(e.code) ? `${e.code}: ${e.message}` : (e.message || 'Client error');
        return sendResponse(statusCode, {
          jsonrpc: '2.0',
          id,
          error: {
            code: -32602,
            message: msg,
          },
        });
      }

      return sendResponse(200, {
        jsonrpc: '2.0',
        id,
        result: {
          content: [{ type: 'text', text: `${e.code || 'TOOL_ERROR'}: ${e.message || String(e)}` }],
          isError: true,
          structuredContent: {
            kind: 'error',
            error: e.code || 'TOOL_ERROR',
            message: e.message || String(e),
          },
        },
      });
    }
  }

  return sendResponse(404, {
    jsonrpc: '2.0',
    id,
    error: {
      code: -32601,
      message: `Method "${method}" not found`,
    },
  });
}
