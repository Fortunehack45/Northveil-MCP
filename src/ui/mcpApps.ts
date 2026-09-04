export interface McpResourceDefinition {
  uri: string;
  name: string;
  description: string;
  mimeType: string;
}

export const MCP_APP_MIME_TYPE = 'text/html;profile=mcp-app';

export function listMcpAppResources(): McpResourceDefinition[] {
  return [
    {
      uri: 'ui://northveil/send',
      name: 'Northveil Transfer Card',
      description: 'In-chat UI for staging and passkey approval of asset transfers',
      mimeType: MCP_APP_MIME_TYPE,
    },
    {
      uri: 'ui://northveil/swap',
      name: 'Northveil Swap Card',
      description: 'In-chat UI for staging and approving token swaps',
      mimeType: MCP_APP_MIME_TYPE,
    },
    {
      uri: 'ui://northveil/deploy',
      name: 'Northveil Deploy & Execute Card',
      description: 'In-chat UI for token/NFT deployments and smart contract calls',
      mimeType: MCP_APP_MIME_TYPE,
    },
    {
      uri: 'ui://northveil/status',
      name: 'Northveil Request Status Card',
      description: 'In-chat UI for live request status and transaction confirmation polling',
      mimeType: MCP_APP_MIME_TYPE,
    },
    {
      uri: 'ui://northveil/read',
      name: 'Northveil Portfolio & Balances Viewer',
      description: 'In-chat UI for inspecting vault balances and multi-chain portfolio rollups',
      mimeType: MCP_APP_MIME_TYPE,
    },
  ];
}

export function getMcpAppHtml(uri: string): string {
  const baseCss = `
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      background: #09090b;
      color: #f4f4f5;
      padding: 16px;
      display: flex;
      flex-direction: column;
      gap: 12px;
      font-size: 13px;
    }
    .card {
      background: rgba(24, 24, 27, 0.7);
      border: 1px solid rgba(255, 255, 255, 0.08);
      border-radius: 16px;
      padding: 16px;
      display: flex;
      flex-direction: column;
      gap: 12px;
    }
    .header {
      display: flex;
      align-items: center;
      justify-content: space-between;
    }
    .brand {
      font-weight: 700;
      font-size: 13px;
      letter-spacing: -0.01em;
      display: flex;
      align-items: center;
      gap: 6px;
    }
    .badge {
      font-size: 10px;
      font-weight: 600;
      text-transform: uppercase;
      padding: 3px 8px;
      border-radius: 9999px;
      letter-spacing: 0.04em;
    }
    .badge-pending_approval { background: rgba(245, 158, 11, 0.15); color: #fbbf24; border: 1px solid rgba(245, 158, 11, 0.3); }
    .badge-pending_signature { background: rgba(59, 130, 246, 0.15); color: #60a5fa; border: 1px solid rgba(59, 130, 246, 0.3); }
    .badge-success { background: rgba(16, 185, 129, 0.15); color: #34d399; border: 1px solid rgba(16, 185, 129, 0.3); }
    .badge-error { background: rgba(239, 68, 68, 0.15); color: #f87171; border: 1px solid rgba(239, 68, 68, 0.3); }
    .detail-row {
      display: flex;
      justify-content: space-between;
      align-items: center;
      font-size: 12px;
      color: #a1a1aa;
    }
    .detail-val {
      color: #f4f4f5;
      font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
      font-weight: 500;
    }
    .btn {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 8px;
      background: #f4f4f5;
      color: #09090b;
      font-weight: 600;
      font-size: 12px;
      padding: 10px 16px;
      border-radius: 12px;
      text-decoration: none;
      cursor: pointer;
      transition: opacity 0.15s;
    }
    .btn:hover { opacity: 0.9; }
    .btn-secondary {
      background: rgba(255, 255, 255, 0.08);
      color: #f4f4f5;
    }
  `;

  if (uri === 'ui://northveil/send') {
    return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<style>${baseCss}</style>
</head>
<body>
  <div class="card" id="app-card">
    <div class="header">
      <span class="brand">Northveil Transfer</span>
      <span class="badge badge-pending_approval" id="badge">Pending Approval</span>
    </div>
    <div class="detail-row">
      <span>Amount</span>
      <span class="detail-val" id="amount">--</span>
    </div>
    <div class="detail-row">
      <span>To</span>
      <span class="detail-val" id="to">--</span>
    </div>
    <div class="detail-row">
      <span>Network</span>
      <span class="detail-val" id="network">Base</span>
    </div>
    <div id="action-area" style="margin-top: 4px;">
      <a href="https://wallet.northveil.xyz" target="_blank" class="btn" id="approve-btn" style="width: 100%;">
        Approve with Passkey on Northveil
      </a>
    </div>
  </div>
  <script>
    window.addEventListener('message', (e) => {
      const data = e.data?.structuredContent || e.data;
      if (!data) return;
      if (data.amount) document.getElementById('amount').innerText = data.amount + ' ' + (data.asset || 'ETH');
      if (data.toPreview || data.to) document.getElementById('to').innerText = data.toPreview || data.to;
      if (data.network) document.getElementById('network').innerText = data.network;
      if (data.status) {
        const b = document.getElementById('badge');
        b.className = 'badge badge-' + data.status;
        b.innerText = data.status.replace(/_/g, ' ');
      }
      if (data.approveUrl) {
        document.getElementById('approve-btn').href = data.approveUrl;
      }
    });
  </script>
</body>
</html>`;
  }

  if (uri === 'ui://northveil/swap') {
    return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<style>${baseCss}</style>
</head>
<body>
  <div class="card">
    <div class="header">
      <span class="brand">Northveil DEX Swap</span>
      <span class="badge badge-pending_approval" id="badge">Pending Approval</span>
    </div>
    <div class="detail-row">
      <span>Pay</span>
      <span class="detail-val" id="fromAsset">--</span>
    </div>
    <div class="detail-row">
      <span>Receive</span>
      <span class="detail-val" id="toAsset">--</span>
    </div>
    <div class="detail-row">
      <span>Network</span>
      <span class="detail-val" id="network">Base</span>
    </div>
    <div id="action-area" style="margin-top: 4px;">
      <a href="https://wallet.northveil.xyz" target="_blank" class="btn" id="approve-btn" style="width: 100%;">
        Approve Swap with Passkey
      </a>
    </div>
  </div>
</body>
</html>`;
  }

  if (uri === 'ui://northveil/deploy') {
    return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<style>${baseCss}</style>
</head>
<body>
  <div class="card">
    <div class="header">
      <span class="brand">Northveil Contract Execution</span>
      <span class="badge badge-pending_approval" id="badge">Pending Approval</span>
    </div>
    <div class="detail-row">
      <span>Action</span>
      <span class="detail-val" id="actionName">Smart Contract Operation</span>
    </div>
    <div class="detail-row">
      <span>Network</span>
      <span class="detail-val" id="network">Base</span>
    </div>
    <div id="action-area" style="margin-top: 4px;">
      <a href="https://wallet.northveil.xyz" target="_blank" class="btn" id="approve-btn" style="width: 100%;">
        Review & Authorize Intent
      </a>
    </div>
  </div>
</body>
</html>`;
  }

  if (uri === 'ui://northveil/status') {
    return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<style>${baseCss}</style>
</head>
<body>
  <div class="card">
    <div class="header">
      <span class="brand">Northveil Request Status</span>
      <span class="badge badge-success" id="badge">Active</span>
    </div>
    <div class="detail-row">
      <span>Request ID</span>
      <span class="detail-val" id="reqId">--</span>
    </div>
    <div class="detail-row">
      <span>Status</span>
      <span class="detail-val" id="statusVal">--</span>
    </div>
    <div class="detail-row">
      <span>Tx Hash</span>
      <span class="detail-val" id="txHashVal">--</span>
    </div>
  </div>
</body>
</html>`;
  }

  // ui://northveil/read
  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<style>${baseCss}</style>
</head>
<body>
  <div class="card">
    <div class="header">
      <span class="brand">Northveil Vault Query</span>
      <span class="badge badge-success">Live</span>
    </div>
    <div class="detail-row">
      <span>Vault Family</span>
      <span class="detail-val">EVM (Hardware MPC)</span>
    </div>
    <div class="detail-row">
      <span>Status</span>
      <span class="detail-val">Active & Ready</span>
    </div>
  </div>
</body>
</html>`;
}
