export interface McpToolSchema {
  type: string;
  properties?: Record<string, any>;
  required?: string[];
  additionalProperties?: boolean;
}

export interface McpToolDefinition {
  name: string;
  description: string;
  inputSchema: McpToolSchema;
  _meta?: {
    ui?: {
      resourceUri: string;
    };
  };
}

/**
 * Canonical tool catalog for Northveil MCP Control Plane.
 * Single source of truth across /mcp, /sse, and /message endpoints.
 */
export function toolCatalog(): McpToolDefinition[] {
  return [
    // 1. Health
    {
      name: 'nv_health',
      description: 'Query Northveil server health, signing fabric, and network status.',
      inputSchema: {
        type: 'object',
        properties: {},
        additionalProperties: false,
      },
      _meta: { ui: { resourceUri: 'ui://northveil/read' } },
    },
    // 2. Portfolio rollup
    {
      name: 'nv_get_portfolio',
      description: 'Retrieve real-time USD portfolio rollup across chains.',
      inputSchema: {
        type: 'object',
        properties: {
          walletId: { type: 'string', description: 'Optional vault ID override' },
        },
        additionalProperties: false,
      },
      _meta: { ui: { resourceUri: 'ui://northveil/read' } },
    },
    // 3. Balances
    {
      name: 'nv_get_balances',
      description: 'Query balances across one chain or all supported chains.',
      inputSchema: {
        type: 'object',
        properties: {
          network: { type: 'string', description: 'Chain name or "all" (e.g. "base", "sepolia", "all")' },
          walletId: { type: 'string', description: 'Optional vault ID override' },
        },
        additionalProperties: false,
      },
      _meta: { ui: { resourceUri: 'ui://northveil/read' } },
    },
    // 4. NFT balances
    {
      name: 'nv_get_nft_balances',
      description: 'Retrieve NFT collection balances on authorized chain.',
      inputSchema: {
        type: 'object',
        properties: {
          network: { type: 'string', description: 'Target network (e.g. "base", "sepolia")' },
          walletId: { type: 'string', description: 'Optional vault ID override' },
        },
        additionalProperties: false,
      },
      _meta: { ui: { resourceUri: 'ui://northveil/read' } },
    },
    // 5. Transaction history
    {
      name: 'nv_get_tx_history',
      description: 'Retrieve recent transaction history for the vault.',
      inputSchema: {
        type: 'object',
        properties: {
          network: { type: 'string', description: 'Filter by network (optional)' },
          limit: { type: 'number', description: 'Max number of transactions to return (default: 10)' },
          walletId: { type: 'string', description: 'Optional vault ID override' },
        },
        additionalProperties: false,
      },
      _meta: { ui: { resourceUri: 'ui://northveil/read' } },
    },
    // 6. Request status inspector
    {
      name: 'nv_get_request',
      description: 'Query lifecycle status of an agent spend or transaction request by ID (pending_approval, pending_signature, pending_confirmation, success, denied, error).',
      inputSchema: {
        type: 'object',
        required: ['requestId'],
        properties: {
          requestId: { type: 'string', description: 'Agent request ID' },
        },
        additionalProperties: false,
      },
      _meta: { ui: { resourceUri: 'ui://northveil/status' } },
    },
    // 7. Prepare transfer (write)
    {
      name: 'nv_prepare_transfer',
      description: 'Submit a transfer once. Poll nv_get_request. Do not retry the same intent.',
      inputSchema: {
        type: 'object',
        required: ['to', 'amount'],
        properties: {
          to: { type: 'string', description: 'Recipient EVM address (0x...)' },
          amount: { type: 'string', description: 'Human-readable amount (e.g. "0.01")' },
          asset: { type: 'string', description: 'Symbol (ETH, USDC) or token contract address' },
          network: { type: 'string', enum: ['base', 'ethereum', 'sepolia'], description: 'Network identifier (default: "base")' },
          walletId: { type: 'string', description: 'Optional vault ID override' },
        },
        additionalProperties: false,
      },
      _meta: { ui: { resourceUri: 'ui://northveil/send' } },
    },
    // 8. Prepare swap (write)
    {
      name: 'nv_prepare_swap',
      description: 'Stage a token swap on a decentralized exchange. Submits intent once and returns requestId.',
      inputSchema: {
        type: 'object',
        required: ['fromAsset', 'toAsset', 'amount'],
        properties: {
          fromAsset: { type: 'string', description: 'Source asset symbol or address' },
          toAsset: { type: 'string', description: 'Destination asset symbol or address' },
          amount: { type: 'string', description: 'Amount of source asset to swap' },
          network: { type: 'string', enum: ['base', 'ethereum', 'sepolia'], description: 'Target network (default: "base")' },
          slippage: { type: 'number', description: 'Allowed slippage percentage (e.g. 0.5)' },
          walletId: { type: 'string', description: 'Optional vault ID override' },
        },
        additionalProperties: false,
      },
      _meta: { ui: { resourceUri: 'ui://northveil/swap' } },
    },
    // 9. Prepare deploy token (write)
    {
      name: 'nv_prepare_deploy_token',
      description: 'Deploy an ERC-20 token contract. Submits intent once and returns requestId.',
      inputSchema: {
        type: 'object',
        required: ['name', 'symbol', 'initialSupply'],
        properties: {
          name: { type: 'string', description: 'Token name (e.g. "My Agent Token")' },
          symbol: { type: 'string', description: 'Token symbol (e.g. "MAT")' },
          initialSupply: { type: 'string', description: 'Initial token supply formatted as string' },
          network: { type: 'string', enum: ['base', 'ethereum', 'sepolia'], description: 'Target network (default: "base")' },
          walletId: { type: 'string', description: 'Optional vault ID override' },
        },
        additionalProperties: false,
      },
      _meta: { ui: { resourceUri: 'ui://northveil/deploy' } },
    },
    // 10. Prepare deploy NFT (write)
    {
      name: 'nv_prepare_deploy_nft',
      description: 'Deploy an ERC-721 NFT collection contract. Submits intent once and returns requestId.',
      inputSchema: {
        type: 'object',
        required: ['name', 'symbol'],
        properties: {
          name: { type: 'string', description: 'NFT Collection name' },
          symbol: { type: 'string', description: 'NFT Collection symbol' },
          baseUri: { type: 'string', description: 'Metadata base URI' },
          network: { type: 'string', enum: ['base', 'ethereum', 'sepolia'], description: 'Target network (default: "base")' },
          walletId: { type: 'string', description: 'Optional vault ID override' },
        },
        additionalProperties: false,
      },
      _meta: { ui: { resourceUri: 'ui://northveil/deploy' } },
    },
    // 11. Prepare mint NFT (write)
    {
      name: 'nv_prepare_mint_nft',
      description: 'Mint an NFT from an existing ERC-721 collection. Submits intent once and returns requestId.',
      inputSchema: {
        type: 'object',
        required: ['contractAddress', 'recipient'],
        properties: {
          contractAddress: { type: 'string', description: 'Address of the ERC-721 contract' },
          recipient: { type: 'string', description: 'Recipient EVM address' },
          tokenId: { type: 'string', description: 'Optional explicit token ID' },
          network: { type: 'string', enum: ['base', 'ethereum', 'sepolia'], description: 'Target network (default: "base")' },
          walletId: { type: 'string', description: 'Optional vault ID override' },
        },
        additionalProperties: false,
      },
      _meta: { ui: { resourceUri: 'ui://northveil/deploy' } },
    },
    // 12. Prepare mint token (write)
    {
      name: 'nv_prepare_mint_token',
      description: 'Mint additional tokens from a mintable ERC-20 contract. Submits intent once and returns requestId.',
      inputSchema: {
        type: 'object',
        required: ['contractAddress', 'recipient', 'amount'],
        properties: {
          contractAddress: { type: 'string', description: 'Address of the ERC-20 contract' },
          recipient: { type: 'string', description: 'Recipient EVM address' },
          amount: { type: 'string', description: 'Amount of tokens to mint' },
          network: { type: 'string', enum: ['base', 'ethereum', 'sepolia'], description: 'Target network (default: "base")' },
          walletId: { type: 'string', description: 'Optional vault ID override' },
        },
        additionalProperties: false,
      },
      _meta: { ui: { resourceUri: 'ui://northveil/deploy' } },
    },
    // 13. Prepare contract call (write)
    {
      name: 'nv_prepare_contract_call',
      description: 'Stage an arbitrary smart contract invocation. Submits intent once and returns requestId.',
      inputSchema: {
        type: 'object',
        required: ['contractAddress', 'abi', 'functionName'],
        properties: {
          contractAddress: { type: 'string', description: 'Destination smart contract address' },
          abi: { type: 'string', description: 'Human-readable ABI string or JSON fragment' },
          functionName: { type: 'string', description: 'Function to execute' },
          args: { type: 'array', items: { type: 'string' }, description: 'Stringified function arguments' },
          value: { type: 'string', description: 'Native value to send with call in wei or ether' },
          network: { type: 'string', enum: ['base', 'ethereum', 'sepolia'], description: 'Target network (default: "base")' },
          walletId: { type: 'string', description: 'Optional vault ID override' },
        },
        additionalProperties: false,
      },
      _meta: { ui: { resourceUri: 'ui://northveil/deploy' } },
    },
    // 14. Place position (write)
    {
      name: 'nv_place_position',
      description: 'Place an automated limit, take-profit, or stop-loss position. Submits intent once and returns requestId.',
      inputSchema: {
        type: 'object',
        required: ['tokenIn', 'tokenOut', 'amountIn', 'triggerPrice', 'positionType'],
        properties: {
          tokenIn: { type: 'string', description: 'Token to sell' },
          tokenOut: { type: 'string', description: 'Token to receive' },
          amountIn: { type: 'string', description: 'Amount to trade' },
          triggerPrice: { type: 'string', description: 'Target execution price' },
          positionType: { type: 'string', enum: ['limit', 'take_profit', 'stop_loss'] },
          network: { type: 'string', enum: ['base', 'ethereum', 'sepolia'], description: 'Target network (default: "base")' },
          walletId: { type: 'string', description: 'Optional vault ID override' },
        },
        additionalProperties: false,
      },
      _meta: { ui: { resourceUri: 'ui://northveil/deploy' } },
    },
    // 15. Cancel position (write)
    {
      name: 'nv_cancel_position',
      description: 'Cancel an active automated trading position.',
      inputSchema: {
        type: 'object',
        required: ['positionId'],
        properties: {
          positionId: { type: 'string', description: 'ID of the position to cancel' },
        },
        additionalProperties: false,
      },
      _meta: { ui: { resourceUri: 'ui://northveil/deploy' } },
    },
    // 16. List positions
    {
      name: 'nv_list_positions',
      description: 'List open take-profit, stop-loss, and limit orders.',
      inputSchema: {
        type: 'object',
        properties: {
          walletId: { type: 'string', description: 'Optional vault ID override' },
        },
        additionalProperties: false,
      },
      _meta: { ui: { resourceUri: 'ui://northveil/read' } },
    },
    // 17. Set autonomous mode (write)
    {
      name: 'nv_set_autonomous_mode',
      description: 'Configure autonomous policy limits for this agent. Note: autonomous signature execution requires a scoped delegate key in Turnkey sub-org and fails closed (AUTONOMOUS_REQUIRES_DELEGATE_KEY) until delegate provisioning is active. Always-ask with passkey remains the standard path.',
      inputSchema: {
        type: 'object',
        required: ['enabled'],
        properties: {
          enabled: { type: 'boolean', description: 'True to request autonomous, false for always_ask' },
          maxWeiPerTx: { type: 'string', description: 'Maximum wei allowed per autonomous transaction' },
          maxWeiPerDay: { type: 'string', description: 'Maximum cumulative wei allowed per UTC day' },
          allowedRecipients: { type: 'array', items: { type: 'string' }, description: 'Whitelisted recipient addresses' },
          walletId: { type: 'string', description: 'Optional vault ID override' },
        },
        additionalProperties: false,
      },
      _meta: { ui: { resourceUri: 'ui://northveil/deploy' } },
    },
    // Supporting read tools
    {
      name: 'nv_list_wallets',
      description: 'List vaults this agent may use.',
      inputSchema: { type: 'object', properties: {}, additionalProperties: false },
      _meta: { ui: { resourceUri: 'ui://northveil/read' } },
    },
    {
      name: 'nv_list_networks',
      description: 'List write-ready chains and read-only indexer chains.',
      inputSchema: { type: 'object', properties: {}, additionalProperties: false },
      _meta: { ui: { resourceUri: 'ui://northveil/read' } },
    },
    {
      name: 'nv_get_token_price',
      description: 'Fetch spot USD price for asset symbol.',
      inputSchema: {
        type: 'object',
        required: ['symbol'],
        properties: { symbol: { type: 'string', description: 'Asset symbol (e.g. "ETH", "USDC")' } },
        additionalProperties: false,
      },
      _meta: { ui: { resourceUri: 'ui://northveil/read' } },
    },
    {
      name: 'nv_get_tx',
      description: 'Query execution status and confirmation receipt by transaction hash.',
      inputSchema: {
        type: 'object',
        required: ['txHash'],
        properties: {
          txHash: { type: 'string', description: 'Transaction hash' },
          chain: { type: 'string', description: 'Network name' },
        },
        additionalProperties: false,
      },
      _meta: { ui: { resourceUri: 'ui://northveil/read' } },
    },
  ];
}
