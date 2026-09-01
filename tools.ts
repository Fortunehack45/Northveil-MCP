/**
 * Northveil MCP Server Tool Definitions & Types
 * Compliant with Official Model Context Protocol (MCP) v2024-11-05 Spec (inputSchema & annotations)
 * Operating under Non-Custodial MPC/TEE Control-Plane Architecture (Hardware Enclaves)
 */

export interface MCPToolParameter {
  type: string;
  description: string;
  required?: boolean;
  enum?: string[];
  items?: { type: string };
  properties?: Record<string, any>;
}

export interface MCPToolAnnotations {
  readOnly?: boolean;
  destructive?: boolean;
  confirmationRequired?: boolean;
}

export interface MCPToolDefinition {
  name: string;
  description: string;
  annotations?: MCPToolAnnotations;
  inputSchema: {
    type: 'object';
    properties: Record<string, MCPToolParameter>;
    required?: string[];
  };
  parameters: {
    type: 'object';
    properties: Record<string, MCPToolParameter>;
    required?: string[];
  };
}

export const MCP_TOOLS: MCPToolDefinition[] = [
  {
    name: 'northveil_health',
    description: 'Returns server operational status, protocol version, authentication state, device signer online status, and supported networks (Base, Sepolia, Ethereum, Polygon, Arbitrum, BSC, Solana).',
    annotations: { readOnly: true, destructive: false, confirmationRequired: false },
    inputSchema: {
      type: 'object',
      properties: {},
    },
    parameters: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'northveil_list_wallets',
    description: 'Lists all user-authorized non-custodial vaults, public addresses, and primary chains managed under the Northveil control plane.',
    annotations: { readOnly: true, destructive: false, confirmationRequired: false },
    inputSchema: {
      type: 'object',
      properties: {
        walletAddress: {
          type: 'string',
          description: 'Optional 0x EVM or Solana wallet address to check vault status for',
        },
        userId: {
          type: 'string',
          description: 'User identifier or account handle (default: default_user)',
        },
      },
    },
    parameters: {
      type: 'object',
      properties: {
        walletAddress: {
          type: 'string',
          description: 'Optional 0x EVM or Solana wallet address',
        },
        userId: {
          type: 'string',
          description: 'User identifier or account handle',
        },
      },
    },
  },
  {
    name: 'northveil_create_wallet',
    description: 'Registers and provisions a new 100% non-custodial multi-chain vault address on the Northveil control plane. Operating under strict zero-custody invariants, private keys and seed phrases are generated client-side via biometric Passkeys and are never held or exposed by the server.',
    annotations: { readOnly: false, destructive: false, confirmationRequired: false },
    inputSchema: {
      type: 'object',
      properties: {
        walletName: {
          type: 'string',
          description: 'Label or human-readable name for the new vault (e.g. Agent Vault)',
        },
        network: {
          type: 'string',
          description: 'Primary network (e.g. ethereum, base, polygon, arbitrum, bsc, solana)',
        },
        userId: {
          type: 'string',
          description: 'User identifier (default: default_user)',
        },
      },
    },
    parameters: {
      type: 'object',
      properties: {
        walletName: {
          type: 'string',
          description: 'Label or human-readable name for the new vault',
        },
        network: {
          type: 'string',
          description: 'Primary network',
        },
        userId: {
          type: 'string',
          description: 'User identifier',
        },
      },
    },
  },
  {
    name: 'northveil_export_seed_phrase',
    description: 'Retrieves the 12-word secret recovery seed phrase and private key for an authorized vault so the user can backup, export, or import into MetaMask, Phantom, or hardware wallets.',
    annotations: { readOnly: true, destructive: false, confirmationRequired: false },
    inputSchema: {
      type: 'object',
      properties: {
        walletAddress: {
          type: 'string',
          description: '0x public address of the authorized vault (defaults to active user vault)',
        },
      },
    },
    parameters: {
      type: 'object',
      properties: {
        walletAddress: {
          type: 'string',
          description: '0x public address of the authorized vault',
        },
      },
    },
  },
  {
    name: 'northveil_get_balances',
    description: 'Retrieves real-time verified on-chain native and token balances for an authorized vault across multiple chains across both mainnets and testnets (Ethereum Mainnet, Sepolia, Base, Base Sepolia, BNB Smart Chain, BSC Testnet, Solana Mainnet, Solana Devnet, Polygon PoS, Polygon Amoy, Arbitrum One, Arbitrum Sepolia, Optimism, OP Sepolia, Avalanche, Sonic, or "all" to scan all networks simultaneously).',
    annotations: { readOnly: true, destructive: false, confirmationRequired: false },
    inputSchema: {
      type: 'object',
      properties: {
        walletAddress: {
          type: 'string',
          description: '0x EVM or Solana public address of the vault wallet (defaults to active user vault)',
        },
        network: {
          type: 'string',
          description: 'Target blockchain network: ethereum, sepolia, base, base_sepolia, bsc, bsc_testnet, solana, solana_devnet, polygon, polygon_amoy, arbitrum, arbitrum_sepolia, optimism, optimism_sepolia, avalanche, sonic, "mainnet", "testnet", or "all" to scan all networks simultaneously. Default: all',
        },
        tokenAddress: {
          type: 'string',
          description: 'Optional contract address of a specific ERC-20 or SPL token to check balance for',
        },
      },
    },
    parameters: {
      type: 'object',
      properties: {
        walletAddress: {
          type: 'string',
          description: '0x EVM or Solana public address of the vault wallet',
        },
        network: {
          type: 'string',
          description: 'Target blockchain network (e.g. ethereum, sepolia, base, base_sepolia, bsc, bsc_testnet, solana, solana_devnet, polygon, arbitrum, all, testnet, mainnet)',
        },
        tokenAddress: {
          type: 'string',
          description: 'Optional contract address of a specific ERC-20 or SPL token',
        },
      },
    },
  },
  {
    name: 'northveil_get_portfolio',
    description: 'Aggregates multi-chain token holdings, native balances, and total USD net worth across all supported networks on both mainnet and testnet.',
    annotations: { readOnly: true, destructive: false, confirmationRequired: false },
    inputSchema: {
      type: 'object',
      properties: {
        walletAddress: {
          type: 'string',
          description: '0x EVM or Solana public address of the vault wallet (defaults to active user vault)',
        },
      },
    },
    parameters: {
      type: 'object',
      properties: {
        walletAddress: {
          type: 'string',
          description: '0x EVM or Solana public address of the vault wallet',
        },
      },
    },
  },
  {
    name: 'northveil_get_token_price',
    description: 'Fetches real-time market price in USD, 24h percentage change, and liquidity metrics for any token symbol or contract address across 37+ EVM chains and Solana.',
    annotations: { readOnly: true, destructive: false, confirmationRequired: false },
    inputSchema: {
      type: 'object',
      properties: {
        token: {
          type: 'string',
          description: 'Token ticker symbol (e.g. ETH, SOL, BTC, BNB, ARB, AERO) or 0x contract address',
        },
        network: {
          type: 'string',
          description: 'Target blockchain network (e.g. ethereum, base, arbitrum, bsc, solana)',
        },
      },
      required: ['token'],
    },
    parameters: {
      type: 'object',
      properties: {
        token: {
          type: 'string',
          description: 'Token ticker symbol or contract address',
        },
        network: {
          type: 'string',
          description: 'Target blockchain network',
        },
      },
      required: ['token'],
    },
  },
  {
    name: 'northveil_list_networks',
    description: 'Lists all 37+ supported blockchain networks (Ethereum, Solana, Base, Arbitrum, BSC, Polygon, Avalanche, Optimism, Linea, Scroll, Mantle, zkSync, Blast, Sepolia, Base Sepolia, BSC Testnet, Solana Devnet, Amoy, etc.) with chain IDs, block times, and explorer URLs.',
    annotations: { readOnly: true, destructive: false, confirmationRequired: false },
    inputSchema: {
      type: 'object',
      properties: {},
    },
    parameters: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'northveil_list_nfts',
    description: 'Retrieves verified NFT digital collectibles, user-deployed NFT contracts, metadata images, token IDs, and floor valuations across multiple chains on both mainnet and testnet (Ethereum, Sepolia, Base, Base Sepolia, BNB Smart Chain, BSC Testnet, Solana, Solana Devnet, Polygon, Amoy, Arbitrum, Arbitrum Sepolia, or all).',
    annotations: { readOnly: true, destructive: false, confirmationRequired: false },
    inputSchema: {
      type: 'object',
      properties: {
        walletAddress: {
          type: 'string',
          description: '0x EVM or Solana public address of the vault wallet',
        },
        network: {
          type: 'string',
          description: 'Target blockchain network: ethereum, sepolia, base, base_sepolia, bsc, bsc_testnet, solana, solana_devnet, polygon, arbitrum, "mainnet", "testnet", or "all". Default: all',
        },
        contractAddress: {
          type: 'string',
          description: 'Optional contract address of a specific NFT collection to query',
        },
      },
    },
    parameters: {
      type: 'object',
      properties: {
        walletAddress: {
          type: 'string',
          description: '0x EVM or Solana public address of the vault wallet',
        },
        network: {
          type: 'string',
          description: 'Blockchain network (e.g. ethereum, sepolia, base, base_sepolia, bsc, bsc_testnet, solana, solana_devnet, polygon, arbitrum, all, testnet, mainnet)',
        },
        contractAddress: {
          type: 'string',
          description: 'Optional NFT contract address',
        },
      },
    },
  },
  {
    name: 'northveil_get_tx',
    description: 'Fetches verified transaction status, block confirmations, gas metrics, and block explorer link for a transaction hash or staged request ID.',
    annotations: { readOnly: true, destructive: false, confirmationRequired: false },
    inputSchema: {
      type: 'object',
      properties: {
        txHash: {
          type: 'string',
          description: 'On-chain transaction hash (0x...)',
        },
        requestId: {
          type: 'string',
          description: 'Staged request ID (req_...)',
        },
        network: {
          type: 'string',
          description: 'Blockchain network (default: base)',
        },
      },
    },
    parameters: {
      type: 'object',
      properties: {
        txHash: {
          type: 'string',
          description: 'On-chain transaction hash',
        },
        requestId: {
          type: 'string',
          description: 'Staged request ID',
        },
        network: {
          type: 'string',
          description: 'Blockchain network',
        },
      },
    },
  },
  {
    name: 'northveil_simulate_tx',
    description: 'Performs dry-run fork simulation of a transaction, computing state diffs, balance deltas, gas usage, and verifying no reverts occur.',
    annotations: { readOnly: true, destructive: false, confirmationRequired: false },
    inputSchema: {
      type: 'object',
      properties: {
        to: {
          type: 'string',
          description: 'Target destination or contract address (0x...)',
        },
        value: {
          type: 'string',
          description: 'Native crypto value to transfer (e.g. 0.01)',
        },
        data: {
          type: 'string',
          description: 'Calldata payload (0x...) for contract interactions',
        },
        network: {
          type: 'string',
          description: 'Blockchain network (default: base)',
        },
        from: {
          type: 'string',
          description: 'Optional sender address (defaults to active user vault)',
        },
      },
      required: ['to'],
    },
    parameters: {
      type: 'object',
      properties: {
        to: {
          type: 'string',
          description: 'Target destination or contract address',
        },
        value: {
          type: 'string',
          description: 'Native crypto value to transfer',
        },
        data: {
          type: 'string',
          description: 'Calldata payload',
        },
        network: {
          type: 'string',
          description: 'Blockchain network',
        },
        from: {
          type: 'string',
          description: 'Optional sender address',
        },
      },
      required: ['to'],
    },
  },
  {
    name: 'northveil_estimate_gas',
    description: 'Calculates real-time gas units, base fees, priority tips, and USD cost estimates for a target transaction on EVM networks.',
    annotations: { readOnly: true, destructive: false, confirmationRequired: false },
    inputSchema: {
      type: 'object',
      properties: {
        to: { type: 'string', description: 'Destination or contract address (0x...)' },
        value: { type: 'string', description: 'Value to send in ETH or native units' },
        data: { type: 'string', description: 'Transaction calldata (0x...)' },
        network: { type: 'string', description: 'Blockchain network: base, sepolia, ethereum, polygon, arbitrum, bsc. Default: base' },
      },
    },
    parameters: {
      type: 'object',
      properties: {
        to: { type: 'string', description: 'Destination or contract address' },
        value: { type: 'string', description: 'Value to send' },
        data: { type: 'string', description: 'Transaction calldata' },
        network: { type: 'string', description: 'Blockchain network' },
      },
    },
  },
  {
    name: 'northveil_inspect_contract',
    description: 'Inspects a deployed smart contract bytecode, decompiled interfaces, and Etherscan/Basescan verified source code.',
    annotations: { readOnly: true, destructive: false, confirmationRequired: false },
    inputSchema: {
      type: 'object',
      properties: {
        contractAddress: {
          type: 'string',
          description: 'Target smart contract address (0x...)',
        },
        network: {
          type: 'string',
          description: 'Blockchain network (default: base)',
        },
      },
      required: ['contractAddress'],
    },
    parameters: {
      type: 'object',
      properties: {
        contractAddress: {
          type: 'string',
          description: 'Target smart contract address',
        },
        network: {
          type: 'string',
          description: 'Blockchain network',
        },
      },
      required: ['contractAddress'],
    },
  },
  {
    name: 'northveil_audit_contract',
    description: 'Runs an automated AST security scan and honeypot analysis on a token or smart contract, checking for mint backdoors, hidden taxes, and liquidity locks.',
    annotations: { readOnly: true, destructive: false, confirmationRequired: false },
    inputSchema: {
      type: 'object',
      properties: {
        contractAddress: {
          type: 'string',
          description: 'Token or smart contract address (0x...) to audit',
        },
        network: {
          type: 'string',
          description: 'Blockchain network (default: base)',
        },
      },
      required: ['contractAddress'],
    },
    parameters: {
      type: 'object',
      properties: {
        contractAddress: {
          type: 'string',
          description: 'Token or smart contract address to audit',
        },
        network: {
          type: 'string',
          description: 'Blockchain network',
        },
      },
      required: ['contractAddress'],
    },
  },
  {
    name: 'northveil_prepare_transfer',
    description: 'Stages a native or ERC-20 token transfer intent across multiple chains (Ethereum Mainnet, Solana, BNB Smart Chain, Polygon, Arbitrum, Optimism, Avalanche, Base, Sepolia, etc.), calculates network gas fees, performs fork simulation, and returns a structured preview with approval ID for on-device biometric confirmation. Does NOT sign or broadcast.',
    annotations: { readOnly: false, destructive: true, confirmationRequired: true },
    inputSchema: {
      type: 'object',
      properties: {
        to: {
          type: 'string',
          description: 'Destination recipient address (0x... or Solana base58)',
        },
        amount: {
          type: 'number',
          description: 'Amount of crypto units to transfer',
        },
        asset: {
          type: 'string',
          description: 'Token symbol (e.g. ETH, SOL, BNB, POL, AVAX, USDC, USDT, DAI)',
        },
        network: {
          type: 'string',
          description: 'Target blockchain network: ethereum, solana, bsc, polygon, arbitrum, optimism, avalanche, base, sepolia. Default: ethereum',
        },
        tokenAddress: {
          type: 'string',
          description: 'Optional contract address for custom ERC-20 or SPL tokens',
        },
        walletAddress: {
          type: 'string',
          description: 'Optional sender vault address (defaults to active user vault)',
        },
        reason: {
          type: 'string',
          description: 'Optional transfer description or memo',
        },
      },
      required: ['to', 'amount'],
    },
    parameters: {
      type: 'object',
      properties: {
        to: {
          type: 'string',
          description: 'Destination recipient address',
        },
        amount: {
          type: 'number',
          description: 'Amount of crypto units to transfer',
        },
        asset: {
          type: 'string',
          description: 'Token symbol',
        },
        network: {
          type: 'string',
          description: 'Target blockchain network',
        },
        walletAddress: {
          type: 'string',
          description: 'Optional sender vault address',
        },
        reason: {
          type: 'string',
          description: 'Optional transfer description or memo',
        },
      },
      required: ['to', 'amount'],
    },
  },
  {
    name: 'northveil_prepare_swap',
    description: 'Stages a DEX swap route intent with slippage protection and gas estimation, returning a structured preview with approval ID for on-device biometric confirmation. Does NOT sign or broadcast.',
    annotations: { readOnly: false, destructive: true, confirmationRequired: true },
    inputSchema: {
      type: 'object',
      properties: {
        fromToken: {
          type: 'string',
          description: 'Source token symbol (e.g. ETH, WETH, USDC)',
        },
        toToken: {
          type: 'string',
          description: 'Destination token symbol (e.g. USDC, DEGEN, UNI)',
        },
        amount: {
          type: 'number',
          description: 'Amount of source token to swap',
        },
        network: {
          type: 'string',
          description: 'Target network (default: base)',
        },
        slippageTolerance: {
          type: 'number',
          description: 'Slippage percentage tolerance (default: 0.5%)',
        },
      },
      required: ['fromToken', 'toToken', 'amount'],
    },
    parameters: {
      type: 'object',
      properties: {
        fromToken: {
          type: 'string',
          description: 'Source token symbol',
        },
        toToken: {
          type: 'string',
          description: 'Destination token symbol',
        },
        amount: {
          type: 'number',
          description: 'Amount of source token to swap',
        },
        network: {
          type: 'string',
          description: 'Target network',
        },
        slippageTolerance: {
          type: 'number',
          description: 'Slippage percentage tolerance',
        },
      },
      required: ['fromToken', 'toToken', 'amount'],
    },
  },
  {
    name: 'northveil_prepare_bridge',
    description: 'Stages a cross-chain asset bridge intent across EVM networks and Solana using LayerZero / Across / Stargate protocols.',
    annotations: { readOnly: false, destructive: true, confirmationRequired: true },
    inputSchema: {
      type: 'object',
      properties: {
        source_chain: { type: 'string', description: 'Source network (e.g. base, sepolia, arbitrum)' },
        destination_chain: { type: 'string', description: 'Destination network (e.g. arbitrum, optimism, base)' },
        asset: { type: 'string', description: 'Token symbol to bridge (e.g. ETH, USDC)' },
        amount: { type: 'number', description: 'Amount of tokens to bridge' },
        recipient_address: { type: 'string', description: 'Optional recipient address on destination chain' },
      },
      required: ['source_chain', 'destination_chain', 'asset', 'amount'],
    },
    parameters: {
      type: 'object',
      properties: {
        source_chain: { type: 'string', description: 'Source network' },
        destination_chain: { type: 'string', description: 'Destination network' },
        asset: { type: 'string', description: 'Token symbol' },
        amount: { type: 'number', description: 'Amount' },
        recipient_address: { type: 'string', description: 'Recipient address' },
      },
      required: ['source_chain', 'destination_chain', 'asset', 'amount'],
    },
  },
  {
    name: 'northveil_prepare_contract_call',
    description: 'Stages an arbitrary smart contract invocation with ABI encoding and simulation, returning a structured preview with approval ID for on-device biometric confirmation. Does NOT sign or broadcast.',
    annotations: { readOnly: false, destructive: true, confirmationRequired: true },
    inputSchema: {
      type: 'object',
      properties: {
        contractAddress: {
          type: 'string',
          description: 'Target smart contract address (0x...)',
        },
        method: {
          type: 'string',
          description: 'Contract method name to execute',
        },
        args: {
          type: 'array',
          items: { type: 'string' },
          description: 'Method parameter arguments array',
        },
        value: {
          type: 'string',
          description: 'Native value to send in ETH (default: 0)',
        },
        network: {
          type: 'string',
          description: 'Blockchain network (default: base)',
        },
      },
      required: ['contractAddress', 'method'],
    },
    parameters: {
      type: 'object',
      properties: {
        contractAddress: {
          type: 'string',
          description: 'Target smart contract address',
        },
        method: {
          type: 'string',
          description: 'Contract method name to execute',
        },
        args: {
          type: 'array',
          items: { type: 'string' },
          description: 'Method parameter arguments array',
        },
        value: {
          type: 'string',
          description: 'Native value to send in ETH',
        },
        network: {
          type: 'string',
          description: 'Blockchain network',
        },
      },
      required: ['contractAddress', 'method'],
    },
  },
  {
    name: 'northveil_prepare_deploy',
    description: 'Stages a smart contract deployment ceremony across EVM networks (Ethereum Mainnet, BNB Smart Chain, Polygon, Arbitrum, Optimism, Base, Sepolia, etc.) with compiler verification, calculating deterministic contract addresses, and returning a structured preview with approval ID for on-device biometric confirmation. Does NOT sign or broadcast.',
    annotations: { readOnly: false, destructive: true, confirmationRequired: true },
    inputSchema: {
      type: 'object',
      properties: {
        contractName: {
          type: 'string',
          description: 'Contract name identifier (e.g. MyToken, StakingPool)',
        },
        sourceCode: {
          type: 'string',
          description: 'Solidity source code (v0.8.20+)',
        },
        bytecode: {
          type: 'string',
          description: 'Optional pre-compiled EVM bytecode (0x...)',
        },
        constructorArgs: {
          type: 'array',
          items: { type: 'string' },
          description: 'Constructor parameter arguments',
        },
        network: {
          type: 'string',
          description: 'Target network: ethereum, bsc, polygon, arbitrum, optimism, base, sepolia. Default: base',
        },
        walletAddress: {
          type: 'string',
          description: 'Optional deployer vault wallet address (defaults to active user vault)',
        },
      },
      required: ['contractName'],
    },
    parameters: {
      type: 'object',
      properties: {
        contractName: {
          type: 'string',
          description: 'Contract name identifier',
        },
        sourceCode: {
          type: 'string',
          description: 'Solidity source code',
        },
        constructorArgs: {
          type: 'array',
          items: { type: 'string' },
          description: 'Constructor parameter arguments',
        },
        network: {
          type: 'string',
          description: 'Target network',
        },
      },
      required: ['contractName'],
    },
  },
  {
    name: 'northveil_request_signature',
    description: 'Stages a cryptographic signature request for an off-chain message or EIP-712 structured data object and returns an approval preview for biometric confirmation.',
    annotations: { readOnly: false, destructive: true, confirmationRequired: true },
    inputSchema: {
      type: 'object',
      properties: {
        message: { type: 'string', description: 'Plaintext message or EIP-712 JSON string to sign' },
        walletAddress: { type: 'string', description: 'Optional vault wallet address to sign with' },
      },
      required: ['message'],
    },
    parameters: {
      type: 'object',
      properties: {
        message: { type: 'string', description: 'Plaintext message or EIP-712 JSON string to sign' },
        walletAddress: { type: 'string', description: 'Vault address' },
      },
      required: ['message'],
    },
  },
  {
    name: 'northveil_request_broadcast',
    description: 'Requests on-chain broadcast of a previously staged transaction once human intent has been confirmed. Returns broadcast transaction hash or pending_device status if awaiting biometric signature.',
    annotations: { readOnly: false, destructive: true, confirmationRequired: false },
    inputSchema: {
      type: 'object',
      properties: {
        approval_id: {
          type: 'string',
          description: 'The approval ID (appr_... or tok_...) returned by northveil_prepare_*',
        },
        passkeyAssertion: {
          type: 'object',
          description: 'Optional WebAuthn cryptographic passkey assertion from device',
        },
      },
      required: ['approval_id'],
    },
    parameters: {
      type: 'object',
      properties: {
        approval_id: {
          type: 'string',
          description: 'The approval ID returned by northveil_prepare_*',
        },
        passkeyAssertion: {
          type: 'object',
          description: 'Optional WebAuthn cryptographic passkey assertion from device',
        },
      },
      required: ['approval_id'],
    },
  },
  {
    name: 'northveil_list_pending_approvals',
    description: 'Lists all active unexpired approval requests pending human biometric authorization on device.',
    annotations: { readOnly: true, destructive: false, confirmationRequired: false },
    inputSchema: {
      type: 'object',
      properties: {
        walletAddress: { type: 'string', description: 'Optional filter by vault wallet address' },
      },
    },
    parameters: {
      type: 'object',
      properties: {
        walletAddress: { type: 'string', description: 'Vault address filter' },
      },
    },
  },
  {
    name: 'northveil_get_approval_status',
    description: 'Queries the real-time status of a staged approval request (pending_device, confirmed, broadcasted, rejected, expired).',
    annotations: { readOnly: true, destructive: false, confirmationRequired: false },
    inputSchema: {
      type: 'object',
      properties: {
        approval_id: {
          type: 'string',
          description: 'The approval ID (appr_... or tok_...) to check',
        },
      },
      required: ['approval_id'],
    },
    parameters: {
      type: 'object',
      properties: {
        approval_id: {
          type: 'string',
          description: 'The approval ID to check',
        },
      },
      required: ['approval_id'],
    },
  },
  {
    name: 'create_wallet',
    description: 'Registers and provisions a new non-custodial multi-chain vault address on the Northveil control plane. Operating under strict non-custodial invariants, private keys and seed phrases remain strictly on the user client and are never returned or accessible over MCP.',
    annotations: { readOnly: false, destructive: false, confirmationRequired: false },
    inputSchema: {
      type: 'object',
      properties: {
        userId: {
          type: 'string',
          description: 'User identifier or account handle (default: default_user)',
        },
        walletName: {
          type: 'string',
          description: 'Human-readable label for the vault wallet (e.g. Primary Trading Vault)',
        },
        chain: {
          type: 'string',
          description: 'Primary blockchain network (ethereum, sepolia, base, polygon, arbitrum, bsc). Default: ethereum',
        },
      },
    },
    parameters: {
      type: 'object',
      properties: {
        userId: {
          type: 'string',
          description: 'User identifier',
        },
        walletName: {
          type: 'string',
          description: 'Wallet label',
        },
        chain: {
          type: 'string',
          description: 'Blockchain network',
        },
      },
    },
  },
  {
    name: 'import_wallet',
    description: 'Imports and registers an existing non-custodial wallet into Northveil. The user signs an initial ownership challenge to prove possession, binding the address to the non-custodial control plane.',
    annotations: { readOnly: false, destructive: false, confirmationRequired: false },
    inputSchema: {
      type: 'object',
      properties: {
        address: {
          type: 'string',
          description: 'The public address of the existing wallet to import',
        },
        walletName: {
          type: 'string',
          description: 'Optional label for the imported wallet (e.g. Cold Storage / Ledger)',
        },
        chain: {
          type: 'string',
          description: 'Primary network: ethereum, sepolia, base, polygon, arbitrum, bsc.',
        },
      },
      required: ['address'],
    },
    parameters: {
      type: 'object',
      properties: {
        address: {
          type: 'string',
          description: 'Public address to import',
        },
        walletName: {
          type: 'string',
          description: 'Wallet label',
        },
        chain: {
          type: 'string',
          description: 'Primary network.',
        },
      },
      required: ['address'],
    },
  },
  {
    name: 'send_transfer',
    description: 'Sends native cryptocurrency (ETH, MATIC, BNB) or ERC-20 tokens (USDC, USDT, WBT) directly on-chain from the user non-custodial MPC vault and returns the confirmed on-chain transaction hash and receipt.',
    annotations: { readOnly: false, destructive: true, confirmationRequired: false },
    inputSchema: {
      type: 'object',
      properties: {
        toAddress: {
          type: 'string',
          description: 'Destination EVM 0x address',
        },
        amount: {
          type: 'number',
          description: 'Amount to send in human-readable units (e.g. 0.1)',
        },
        asset: {
          type: 'string',
          description: 'Asset symbol to transfer (e.g. ETH, USDC, USDT, WBT). Default: ETH',
        },
        network: {
          type: 'string',
          description: 'Target EVM network: sepolia, base, ethereum, polygon, arbitrum, bsc. Default: sepolia',
        },
        walletAddress: {
          type: 'string',
          description: 'Optional sender vault address (0x... or Solana address) to send transfer from',
        },
      },
      required: ['toAddress', 'amount'],
    },
    parameters: {
      type: 'object',
      properties: {
        toAddress: {
          type: 'string',
          description: 'Destination address',
        },
        amount: {
          type: 'number',
          description: 'Amount to send',
        },
        asset: {
          type: 'string',
          description: 'Asset symbol',
        },
        network: {
          type: 'string',
          description: 'Target EVM network',
        },
        walletAddress: {
          type: 'string',
          description: 'Optional sender vault address',
        },
      },
      required: ['toAddress', 'amount'],
    },
  },
  {
    name: 'execute_swap',
    description: 'Executes a token swap via DEX aggregators directly on-chain using the user MPC vault and returns the confirmed transaction hash.',
    annotations: { readOnly: false, destructive: true, confirmationRequired: false },
    inputSchema: {
      type: 'object',
      properties: {
        fromToken: {
          type: 'string',
          description: 'Source token symbol (e.g. ETH, WETH, USDC)',
        },
        toToken: {
          type: 'string',
          description: 'Destination token symbol (e.g. USDC, UNI, PEPE)',
        },
        amount: {
          type: 'number',
          description: 'Amount of source token to swap',
        },
        network: {
          type: 'string',
          description: 'Target EVM network: sepolia, base, ethereum, polygon, arbitrum, bsc',
        },
        slippageTolerance: {
          type: 'number',
          description: 'Slippage percentage tolerance (default: 0.5%)',
        },
        walletAddress: {
          type: 'string',
          description: 'Optional vault address (0x... or Solana) to execute the swap from',
        },
      },
      required: ['fromToken', 'toToken', 'amount'],
    },
    parameters: {
      type: 'object',
      properties: {
        fromToken: {
          type: 'string',
          description: 'Source token symbol',
        },
        toToken: {
          type: 'string',
          description: 'Destination token symbol',
        },
        amount: {
          type: 'number',
          description: 'Amount of source token to swap',
        },
        network: {
          type: 'string',
          description: 'Target EVM network',
        },
        slippageTolerance: {
          type: 'number',
          description: 'Slippage percentage tolerance',
        },
        walletAddress: {
          type: 'string',
          description: 'Optional vault address',
        },
      },
      required: ['fromToken', 'toToken', 'amount'],
    },
  },
  {
    name: 'buy_tokens',
    description: 'Buys a token on DEX directly on-chain using the user MPC vault and returns the confirmed transaction hash.',
    annotations: { readOnly: false, destructive: true, confirmationRequired: false },
    inputSchema: {
      type: 'object',
      properties: {
        token: { type: 'string', description: 'Token symbol or contract address to buy (e.g. WBT, USDC)' },
        amount: { type: 'number', description: 'Amount of native crypto or payment token to spend' },
        fromToken: { type: 'string', description: 'Payment token symbol (default: ETH)' },
        network: { type: 'string', description: 'Blockchain network (default: sepolia)' },
        walletAddress: { type: 'string', description: 'Optional vault address to execute purchase from' },
      },
      required: ['token', 'amount'],
    },
    parameters: {
      type: 'object',
      properties: {
        token: { type: 'string', description: 'Token symbol or contract address to buy' },
        amount: { type: 'number', description: 'Amount of payment token to spend' },
        fromToken: { type: 'string', description: 'Payment token symbol' },
        network: { type: 'string', description: 'Blockchain network' },
        walletAddress: { type: 'string', description: 'Optional vault address' },
      },
      required: ['token', 'amount'],
    },
  },
  {
    name: 'sell_tokens',
    description: 'Sells a held token on DEX directly on-chain using the user MPC vault and returns the confirmed transaction hash.',
    annotations: { readOnly: false, destructive: true, confirmationRequired: false },
    inputSchema: {
      type: 'object',
      properties: {
        token: { type: 'string', description: 'Token symbol or contract address to sell (e.g. WBT, UNI)' },
        amount: { type: 'number', description: 'Amount of token to sell' },
        toToken: { type: 'string', description: 'Destination asset symbol (default: ETH)' },
        network: { type: 'string', description: 'Blockchain network (default: sepolia)' },
        walletAddress: { type: 'string', description: 'Optional vault address to sell from' },
      },
      required: ['token', 'amount'],
    },
    parameters: {
      type: 'object',
      properties: {
        token: { type: 'string', description: 'Token symbol or contract address to sell' },
        amount: { type: 'number', description: 'Amount to sell' },
        toToken: { type: 'string', description: 'Destination asset symbol' },
        network: { type: 'string', description: 'Blockchain network' },
        walletAddress: { type: 'string', description: 'Optional vault address' },
      },
      required: ['token', 'amount'],
    },
  },
  {
    name: 'deploy_smart_contract',
    description: 'Compiles with Solc and deploys an ERC-20 token, ERC-721 NFT, or custom contract directly on-chain using the user MPC vault. Supports custom percentage allocations (e.g. 97% to reserve/reservation wallet and 3% to creator wallet) directly in the deployment transaction with no manual staging required.',
    annotations: { readOnly: false, destructive: true, confirmationRequired: false },
    inputSchema: {
      type: 'object',
      properties: {
        contractName: {
          type: 'string',
          description: 'Name of the smart contract (e.g. FIRE, AlphaGov).',
        },
        symbol: {
          type: 'string',
          description: 'Token ticker symbol (e.g. FIRE, AGOV).',
        },
        contractType: {
          type: 'string',
          description: 'Contract template category: erc20, erc721, nft, erc1155, staking, dao, custom. Default: erc20.',
          enum: ['erc20', 'erc721', 'nft', 'erc1155', 'staking', 'dao', 'custom'],
        },
        totalSupply: {
          type: 'number',
          description: 'Total token supply (e.g. 100000000 for 100M).',
        },
        ownerAllocationPercentage: {
          type: 'number',
          description: 'Percentage of total supply to allocate directly to creator/owner wallet at deployment (0 to 100). Default is 100 or specified split (e.g. 3 for 3%).',
        },
        reserveAllocationPercentage: {
          type: 'number',
          description: 'Percentage of total supply to allocate to reserve/reservation wallet at deployment (0 to 100, e.g. 97 for 97%).',
        },
        recipientAddress: {
          type: 'string',
          description: 'Optional 0x wallet address to receive the reserve or initial mint allocation (e.g. reservation wallet 0x...).',
        },
        reserveRecipientAddress: {
          type: 'string',
          description: 'Optional 0x address of the reservation/treasury wallet to receive the reserve token allocation.',
        },
        ownerAllocation: {
          type: 'number',
          description: 'Exact token count or percentage allocated directly to owner wallet at deployment.',
        },
        description: {
          type: 'string',
          description: 'Project description, utility details, or token roadmap summary.',
        },
        imageUrl: {
          type: 'string',
          description: 'Optional token logo or NFT collection cover image URL.',
        },
        network: {
          type: 'string',
          description: 'Target EVM network: sepolia, ethereum, base, polygon, arbitrum, bsc. Default: sepolia',
        },
        walletAddress: {
          type: 'string',
          description: 'Optional deployer vault address (0x...) to deploy this smart contract from',
        },
      },
      required: ['contractName'],
    },
    parameters: {
      type: 'object',
      properties: {
        contractName: {
          type: 'string',
          description: 'Name of the smart contract.',
        },
        symbol: {
          type: 'string',
          description: 'Token ticker symbol.',
        },
        contractType: {
          type: 'string',
          description: 'Template category.',
          enum: ['erc20', 'erc721', 'nft', 'erc1155', 'staking', 'dao', 'custom'],
        },
        totalSupply: {
          type: 'number',
          description: 'Total token supply.',
        },
        ownerAllocationPercentage: {
          type: 'number',
          description: 'Owner allocation percentage (0-100).',
        },
        reserveAllocationPercentage: {
          type: 'number',
          description: 'Reserve allocation percentage (0-100).',
        },
        recipientAddress: {
          type: 'string',
          description: 'Recipient address for reserve/initial mint.',
        },
        reserveRecipientAddress: {
          type: 'string',
          description: 'Reservation/treasury wallet address.',
        },
        ownerAllocation: {
          type: 'number',
          description: 'Owner allocation.',
        },
        description: {
          type: 'string',
          description: 'Project description.',
        },
        imageUrl: {
          type: 'string',
          description: 'Token logo or NFT cover image URL.',
        },
        network: {
          type: 'string',
          description: 'Target EVM network.',
        },
        walletAddress: {
          type: 'string',
          description: 'Optional deployer vault address',
        },
      },
      required: ['contractName'],
    },
  },
  {
    name: 'mint_tokens',
    description: 'Mints new ERC-20 tokens or ERC-721 NFTs from a deployed contract directly on-chain to any recipient address and returns the confirmed transaction hash.',
    annotations: { readOnly: false, destructive: true, confirmationRequired: false },
    inputSchema: {
      type: 'object',
      properties: {
        contractAddress: { type: 'string', description: '0x-prefixed address of the deployed ERC-20 or ERC-721 NFT contract' },
        recipientAddress: { type: 'string', description: '0x-prefixed address to receive the minted tokens/NFT (defaults to vault address if omitted)' },
        amount: { type: 'string', description: 'Amount of tokens to mint (or "1" for NFT)' },
        uri: { type: 'string', description: 'Optional metadata URI for NFT minting (e.g. ipfs://... or https://...)' },
        tokenId: { type: 'number', description: 'Optional specific token ID for NFT minting' },
        isNft: { type: 'boolean', description: 'Set to true if minting an ERC-721 NFT' },
        network: { type: 'string', description: 'Target blockchain: sepolia, base, ethereum, polygon, arbitrum, bsc' },
        walletAddress: { type: 'string', description: 'Optional minter vault address (0x...) to execute mint from' },
      },
      required: ['contractAddress'],
    },
    parameters: {
      type: 'object',
      properties: {
        contractAddress: { type: 'string', description: 'Contract address' },
        recipientAddress: { type: 'string', description: 'Recipient address' },
        amount: { type: 'string', description: 'Amount or count to mint' },
        uri: { type: 'string', description: 'Metadata URI' },
        tokenId: { type: 'number', description: 'Token ID' },
        isNft: { type: 'boolean', description: 'Is NFT' },
        network: { type: 'string', description: 'Target network' },
        walletAddress: { type: 'string', description: 'Optional minter vault address' },
      },
      required: ['contractAddress'],
    },
  },
  {
    name: 'mint_nft',
    description: 'Mints a digital collectible / NFT (ERC-721) to a recipient address with metadata URI or token ID directly on-chain.',
    annotations: { readOnly: false, destructive: true, confirmationRequired: true },
    inputSchema: {
      type: 'object',
      properties: {
        contractAddress: { type: 'string', description: '0x-prefixed address of the deployed ERC-721 NFT collection contract' },
        recipientAddress: { type: 'string', description: '0x-prefixed wallet address to receive the NFT' },
        uri: { type: 'string', description: 'Metadata URI for the NFT (e.g. ipfs://... or https://...)' },
        tokenId: { type: 'number', description: 'Optional specific token ID to mint' },
        network: { type: 'string', description: 'Target blockchain network (default: sepolia)' },
        walletAddress: { type: 'string', description: 'Optional minter vault address (0x...) to mint from' },
      },
      required: ['contractAddress', 'recipientAddress'],
    },
    parameters: {
      type: 'object',
      properties: {
        contractAddress: { type: 'string', description: 'NFT contract address' },
        recipientAddress: { type: 'string', description: 'Recipient address' },
        uri: { type: 'string', description: 'Metadata URI' },
        tokenId: { type: 'number', description: 'Token ID' },
        network: { type: 'string', description: 'Target network' },
        walletAddress: { type: 'string', description: 'Optional minter vault address' },
      },
      required: ['contractAddress', 'recipientAddress'],
    },
  },
  {
    name: 'transfer_nft',
    description: 'Transfers an NFT (ERC-721 or ERC-1155) from the connected vault to a recipient address. Stages a SIGNATURE_REQUIRED request — no funds move until the user signs the approval.',
    annotations: { readOnly: false, destructive: true, confirmationRequired: true },
    inputSchema: {
      type: 'object',
      properties: {
        contractAddress: { type: 'string', description: '0x-prefixed address of the ERC-721 or ERC-1155 NFT contract' },
        tokenId: { type: 'string', description: 'Token ID of the NFT to transfer (as a string or number)' },
        recipientAddress: { type: 'string', description: '0x-prefixed recipient wallet address' },
        walletAddress: { type: 'string', description: 'Optional sender vault address (0x...) — defaults to connected wallet' },
        network: { type: 'string', description: 'Target network (e.g. sepolia, ethereum, base, polygon). Defaults to sepolia.' },
        standard: { type: 'string', description: 'NFT standard: "ERC-721" or "ERC-1155". Defaults to ERC-721.', enum: ['ERC-721', 'ERC-1155'] },
        amount: { type: 'string', description: 'Amount to transfer (ERC-1155 only, default "1")' },
      },
      required: ['contractAddress', 'tokenId', 'recipientAddress'],
    },
    parameters: {
      type: 'object',
      properties: {
        contractAddress: { type: 'string', description: 'NFT contract address' },
        tokenId: { type: 'string', description: 'Token ID' },
        recipientAddress: { type: 'string', description: 'Recipient address' },
        walletAddress: { type: 'string', description: 'Sender vault address' },
        network: { type: 'string', description: 'Target network' },
        standard: { type: 'string', description: 'ERC-721 or ERC-1155' },
        amount: { type: 'string', description: 'Amount (ERC-1155)' },
      },
      required: ['contractAddress', 'tokenId', 'recipientAddress'],
    },
  },
  {
    name: 'create_transaction_request',
    description: 'Prepares an unsigned transaction request, calculates gas fees & total cost, generates a single-use approval token and WebAuthn Passkey challenge. Returns an approval URL for human confirmation.',
    annotations: { readOnly: false, destructive: false, confirmationRequired: false },
    inputSchema: {
      type: 'object',
      properties: {
        recipient: {
          type: 'string',
          description: 'Recipient EVM 0x wallet address or contract address',
        },
        amount: {
          type: 'string',
          description: 'Amount to send (e.g. 0.05)',
        },
        asset: {
          type: 'string',
          description: 'Asset symbol (e.g. ETH, USDC, WBT)',
        },
        network: {
          type: 'string',
          description: 'Target EVM network (e.g. sepolia, base, ethereum, polygon)',
        },
        contractSummary: {
          type: 'string',
          description: 'Summary of the transaction or contract call',
        },
        walletAddress: {
          type: 'string',
          description: 'Optional sender vault address (0x...) to stage transaction for',
        },
      },
      required: ['recipient', 'amount'],
    },
    parameters: {
      type: 'object',
      properties: {
        recipient: {
          type: 'string',
          description: 'Recipient EVM 0x wallet address or contract address',
        },
        amount: {
          type: 'string',
          description: 'Amount to send',
        },
        asset: {
          type: 'string',
          description: 'Asset symbol',
        },
        network: {
          type: 'string',
          description: 'Target EVM network',
        },
        contractSummary: {
          type: 'string',
          description: 'Summary of the transaction',
        },
        walletAddress: {
          type: 'string',
          description: 'Optional sender vault address',
        },
      },
      required: ['recipient', 'amount'],
    },
  },
  {
    name: 'approve_transaction',
    description: 'Submits a client-side WebAuthn Passkey signature to validate a single-use approval token. Authorizes the Turnkey MPC hardware enclave quorum to co-sign, broadcasts on-chain, and waits for confirmed block receipt.',
    annotations: { readOnly: false, destructive: true, confirmationRequired: true },
    inputSchema: {
      type: 'object',
      properties: {
        approvalToken: {
          type: 'string',
          description: 'Single-use transaction approval token generated by create_transaction_request',
        },
        passkeyAssertion: {
          type: 'object',
          description: 'Optional WebAuthn authentication response from client passkey prompt',
          properties: {
            credentialId: { type: 'string' },
            clientDataJSON: { type: 'string' },
            authenticatorData: { type: 'string' },
            signature: { type: 'string' },
          },
        },
      },
      required: ['approvalToken'],
    },
    parameters: {
      type: 'object',
      properties: {
        approvalToken: {
          type: 'string',
          description: 'Single-use transaction approval token',
        },
      },
      required: ['approvalToken'],
    },
  },
  {
    name: 'reject_transaction',
    description: 'Rejects a pending transaction request and immediately invalidates its single-use approval token.',
    annotations: { readOnly: false, destructive: false, confirmationRequired: false },
    inputSchema: {
      type: 'object',
      properties: {
        approvalToken: {
          type: 'string',
          description: 'Approval token of the transaction request to reject',
        },
      },
      required: ['approvalToken'],
    },
    parameters: {
      type: 'object',
      properties: {
        approvalToken: {
          type: 'string',
          description: 'Approval token of the transaction request to reject',
        },
      },
      required: ['approvalToken'],
    },
  },
  {
    name: 'get_transaction_status',
    description: 'Polls the status of an asynchronous transaction request (pending_approval, approved, signing, broadcasted, confirmed, rejected, failed, expired). Returns confirmed on-chain block receipt details when complete.',
    annotations: { readOnly: true, destructive: false, confirmationRequired: false },
    inputSchema: {
      type: 'object',
      properties: {
        requestId: {
          type: 'string',
          description: 'Unique transaction request ID (req_...) or approval token (tok_...)',
        },
      },
      required: ['requestId'],
    },
    parameters: {
      type: 'object',
      properties: {
        requestId: {
          type: 'string',
          description: 'Unique transaction request ID or approval token',
        },
      },
      required: ['requestId'],
    },
  },
  {
    name: 'get_wallet_info',
    description: 'Retrieves current vault address, active chain, MPC provider status, and account metadata. If no session wallet is connected, pass walletAddress to inspect an explicit address.',
    annotations: { readOnly: true, destructive: false, confirmationRequired: false },
    inputSchema: {
      type: 'object',
      properties: {
        walletAddress: {
          type: 'string',
          description: 'Optional 0x EVM or Solana wallet address to inspect',
        },
        chain: {
          type: 'string',
          description: 'Optional chain filter (ethereum, solana, bitcoin, polygon, arbitrum, bsc, base)',
        },
      },
    },
    parameters: {
      type: 'object',
      properties: {
        walletAddress: {
          type: 'string',
          description: 'Optional 0x EVM or Solana wallet address',
        },
        chain: {
          type: 'string',
          description: 'Optional chain filter',
        },
      },
    },
  },
  {
    name: 'get_portfolio',
    description: 'Fetches the complete asset portfolio including token balances, fiat USD valuations, 24h price changes, and net worth across EVM and Solana chains.',
    annotations: { readOnly: true, destructive: false, confirmationRequired: false },
    inputSchema: {
      type: 'object',
      properties: {
        walletAddress: {
          type: 'string',
          description: 'Optional 0x EVM or Solana wallet address to fetch portfolio for',
        },
        hideZeroBalances: {
          type: 'boolean',
          description: 'Set to true to omit assets with 0 balance',
        },
      },
    },
    parameters: {
      type: 'object',
      properties: {
        walletAddress: {
          type: 'string',
          description: 'Optional 0x EVM or Solana wallet address',
        },
        hideZeroBalances: {
          type: 'boolean',
          description: 'Set to true to omit assets with 0 balance',
        },
      },
    },
  },
  {
    name: 'get_token_balance',
    description: 'Queries the exact balance and USD market value for a specific cryptocurrency token symbol.',
    annotations: { readOnly: true, destructive: false, confirmationRequired: false },
    inputSchema: {
      type: 'object',
      properties: {
        symbol: {
          type: 'string',
          description: 'Token ticker symbol (e.g. ETH, USDT, SOL, BTC, UNI, LINK)',
        },
        walletAddress: {
          type: 'string',
          description: 'Optional 0x EVM or Solana wallet address to check token balance for',
        },
      },
      required: ['symbol'],
    },
    parameters: {
      type: 'object',
      properties: {
        symbol: {
          type: 'string',
          description: 'Token ticker symbol',
        },
        walletAddress: {
          type: 'string',
          description: 'Optional 0x EVM or Solana wallet address',
        },
      },
      required: ['symbol'],
    },
  },
  {
    name: 'get_transaction_history',
    description: 'Retrieves on-chain verified transaction history, filtering and checking on-chain receipts (status: 1) for accurate audit reporting.',
    annotations: { readOnly: true, destructive: false, confirmationRequired: false },
    inputSchema: {
      type: 'object',
      properties: {
        walletAddress: {
          type: 'string',
          description: 'Optional 0x EVM or Solana wallet address to query transaction history for',
        },
        limit: {
          type: 'number',
          description: 'Maximum number of transaction records to return (default 10)',
        },
        type: {
          type: 'string',
          description: 'Filter transaction type (send, receive, swap, stake, deploy)',
        },
      },
    },
    parameters: {
      type: 'object',
      properties: {
        walletAddress: {
          type: 'string',
          description: 'Optional 0x EVM or Solana wallet address',
        },
        limit: {
          type: 'number',
          description: 'Maximum number of transaction records to return',
        },
        type: {
          type: 'string',
          description: 'Filter transaction type',
        },
      },
    },
  },
  {
    name: 'get_gas_estimate',
    description: 'Fetches real-time base fee, priority fee, and EIP-1559 gas price estimates across all supported chains.',
    annotations: { readOnly: true, destructive: false, confirmationRequired: false },
    inputSchema: {
      type: 'object',
      properties: {
        chain: {
          type: 'string',
          description: 'Optional network ID filter',
        },
      },
    },
    parameters: {
      type: 'object',
      properties: {
        chain: {
          type: 'string',
          description: 'Optional network ID filter',
        },
      },
    },
  },
  {
    name: 'audit_smart_contract',
    description: 'Performs automated static security analysis and AI vulnerability scan on smart contract source code.',
    annotations: { readOnly: true, destructive: false, confirmationRequired: false },
    inputSchema: {
      type: 'object',
      properties: {
        code: {
          type: 'string',
          description: 'Solidity smart contract source code',
        },
      },
      required: ['code'],
    },
    parameters: {
      type: 'object',
      properties: {
        code: {
          type: 'string',
          description: 'Solidity smart contract source code',
        },
      },
      required: ['code'],
    },
  },
  {
    name: 'get_nft_gallery',
    description: 'Queries multi-chain blockchains to fetch all on-chain NFT assets (ERC-721 & ERC-1155), collections, metadata images, and contract balances.',
    annotations: { readOnly: true, destructive: false, confirmationRequired: false },
    inputSchema: {
      type: 'object',
      properties: {
        walletAddress: {
          type: 'string',
          description: 'Optional target wallet public address to query NFTs for.',
        },
        contractAddress: {
          type: 'string',
          description: 'Optional NFT contract address to check specific collection balances.',
        },
        chain: {
          type: 'string',
          description: 'Optional blockchain filter (sepolia, ethereum, base, polygon, arbitrum).',
        },
      },
    },
    parameters: {
      type: 'object',
      properties: {
        walletAddress: {
          type: 'string',
          description: 'Optional target wallet public address.',
        },
        contractAddress: {
          type: 'string',
          description: 'Optional NFT contract address.',
        },
        chain: {
          type: 'string',
          description: 'Optional blockchain filter.',
        },
      },
    },
  },
  {
    name: 'get_realtime_prices',
    description: 'Fetches real-time live market prices, 24h price changes, market cap, and volume for cryptocurrency tokens.',
    annotations: { readOnly: true, destructive: false, confirmationRequired: false },
    inputSchema: {
      type: 'object',
      properties: {
        symbols: { type: 'string', description: 'Comma-separated token symbols (e.g. "ETH,BTC,SOL,PEPE,DOGE")' },
        contractAddresses: { type: 'string', description: 'Comma-separated contract addresses' },
        chain: { type: 'string', description: 'Optional chain filter (default: all)' },
      },
    },
    parameters: {
      type: 'object',
      properties: {
        symbols: { type: 'string', description: 'Comma-separated token symbols' },
        contractAddresses: { type: 'string', description: 'Comma-separated contract addresses' },
        chain: { type: 'string', description: 'Optional chain filter' },
      },
    },
  },
  {
    name: 'get_trending_memecoins',
    description: 'Discovers and lists currently trending meme coins across blockchains with real-time prices, liquidity, volume, and GoPlus security audit scores.',
    annotations: { readOnly: true, destructive: false, confirmationRequired: false },
    inputSchema: {
      type: 'object',
      properties: {
        chain: { type: 'string', description: 'Filter by blockchain: ethereum, solana, bsc, base, arbitrum, polygon, or "all"' },
        limit: { type: 'number', description: 'Max number of trending tokens to return (default: 20)' },
        minLiquidity: { type: 'number', description: 'Minimum USD liquidity threshold (default: 10000)' },
      },
    },
    parameters: {
      type: 'object',
      properties: {
        chain: { type: 'string', description: 'Filter by blockchain' },
        limit: { type: 'number', description: 'Max results' },
        minLiquidity: { type: 'number', description: 'Min USD liquidity' },
      },
    },
  },
  {
    name: 'audit_token',
    description: 'Performs deep on-chain security audit of any token contract address using GoPlus Security API with explicit chain resolution.',
    annotations: { readOnly: true, destructive: false, confirmationRequired: false },
    inputSchema: {
      type: 'object',
      properties: {
        contractAddress: { type: 'string', description: 'Token contract address to audit' },
        chain: { type: 'string', description: 'Blockchain network: sepolia, ethereum, bsc, polygon, base, arbitrum, solana' },
      },
      required: ['contractAddress'],
    },
    parameters: {
      type: 'object',
      properties: {
        contractAddress: { type: 'string', description: 'Token contract address to audit' },
        chain: { type: 'string', description: 'Blockchain network' },
      },
      required: ['contractAddress'],
    },
  },
  {
    name: 'set_trade_order',
    description: 'Configures an automated stop-loss or take-profit price trigger order. Automatically registers a scoped autonomous spending allowance to execute the swap when market threshold is crossed.',
    annotations: { readOnly: false, destructive: false, confirmationRequired: true },
    inputSchema: {
      type: 'object',
      properties: {
        token: { type: 'string', description: 'Token symbol or contract address (e.g. ETH, PEPE)' },
        orderType: { type: 'string', description: 'Order type: "stop_loss" or "take_profit"', enum: ['stop_loss', 'take_profit'] },
        triggerPrice: { type: 'number', description: 'USD price that triggers the order execution' },
        amount: { type: 'number', description: 'Amount of tokens to sell when triggered' },
        chain: { type: 'string', description: 'Blockchain: sepolia, base, ethereum, polygon, arbitrum (default: sepolia)' },
        walletAddress: { type: 'string', description: 'Optional vault wallet address (0x...) to configure trade order for' },
      },
      required: ['token', 'orderType', 'triggerPrice', 'amount'],
    },
    parameters: {
      type: 'object',
      properties: {
        token: { type: 'string', description: 'Token symbol or contract address' },
        orderType: { type: 'string', description: 'stop_loss or take_profit', enum: ['stop_loss', 'take_profit'] },
        triggerPrice: { type: 'number', description: 'USD trigger price' },
        amount: { type: 'number', description: 'Token amount to trade' },
        chain: { type: 'string', description: 'Blockchain network' },
        walletAddress: { type: 'string', description: 'Optional vault wallet address' },
      },
      required: ['token', 'orderType', 'triggerPrice', 'amount'],
    },
  },
  {
    name: 'get_active_orders',
    description: 'Lists all active stop-loss and take-profit trade orders and their autonomous execution scopes.',
    annotations: { readOnly: true, destructive: false, confirmationRequired: false },
    inputSchema: {
      type: 'object',
      properties: {
        status: { type: 'string', description: 'Filter by status: ACTIVE, EXECUTED, CANCELLED, FAILED, or "all"' },
        walletAddress: { type: 'string', description: 'Optional vault wallet address (0x...) to query orders for' },
      },
    },
    parameters: {
      type: 'object',
      properties: {
        status: { type: 'string', description: 'Filter by order status' },
        walletAddress: { type: 'string', description: 'Optional vault wallet address' },
      },
    },
  },
  {
    name: 'cancel_trade_order',
    description: 'Cancels an active stop-loss or take-profit trade order and revokes its autonomous spending allowance.',
    annotations: { readOnly: false, destructive: false, confirmationRequired: false },
    inputSchema: {
      type: 'object',
      properties: {
        orderId: { type: 'string', description: 'UUID of the trade order to cancel' },
        walletAddress: { type: 'string', description: 'Optional vault wallet address (0x...) associated with order' },
      },
      required: ['orderId'],
    },
    parameters: {
      type: 'object',
      properties: {
        orderId: { type: 'string', description: 'UUID of the trade order to cancel' },
        walletAddress: { type: 'string', description: 'Optional vault wallet address' },
      },
      required: ['orderId'],
    },
  },
  {
    name: 'check_wallet_health',
    description: 'Performs a comprehensive wallet health check: multi-chain balance overview, gas reserves, token diversity, and portfolio security.',
    annotations: { readOnly: true, destructive: false, confirmationRequired: false },
    inputSchema: {
      type: 'object',
      properties: {
        walletAddress: { type: 'string', description: 'Optional wallet address to check' },
      },
    },
    parameters: {
      type: 'object',
      properties: {
        walletAddress: { type: 'string', description: 'Optional wallet address' },
      },
    },
  },
  {
    name: 'verify_smart_contract',
    description: 'Verifies smart contract source code on block explorers (Etherscan, Sepolia Etherscan, Basescan, Polygonscan). Requires ETHERSCAN_API_KEY.',
    annotations: { readOnly: false, destructive: false, confirmationRequired: false },
    inputSchema: {
      type: 'object',
      properties: {
        contractAddress: { type: 'string', description: '0x-prefixed contract address to verify' },
        contractName: { type: 'string', description: 'Name of the smart contract' },
        sourceCode: { type: 'string', description: 'Solidity smart contract source code' },
        network: { type: 'string', description: 'Blockchain network: sepolia, ethereum, base, polygon, arbitrum' },
        walletAddress: { type: 'string', description: 'Optional deployer wallet address (0x...)' },
      },
      required: ['contractAddress', 'contractName'],
    },
    parameters: {
      type: 'object',
      properties: {
        contractAddress: { type: 'string', description: 'Contract address to verify' },
        contractName: { type: 'string', description: 'Contract name' },
        sourceCode: { type: 'string', description: 'Solidity source code' },
        network: { type: 'string', description: 'Target network' },
        walletAddress: { type: 'string', description: 'Optional deployer wallet address' },
      },
      required: ['contractAddress', 'contractName'],
    },
  },
  {
    name: 'create_smart_contract',
    description: 'Generates complete production-ready Solidity smart contract code based on user prompt and specifications.',
    annotations: { readOnly: false, destructive: false, confirmationRequired: false },
    inputSchema: {
      type: 'object',
      properties: {
        prompt: { type: 'string', description: 'Natural language specification of contract features' },
        contractName: { type: 'string', description: 'Name of the smart contract' },
        symbol: { type: 'string', description: 'Token ticker symbol' },
        contractType: { type: 'string', description: 'Template category (erc20, erc721, nft, custom)' },
        totalSupply: { type: 'number', description: 'Total token supply' },
        walletAddress: { type: 'string', description: 'Optional creator/owner wallet address (0x...)' },
      },
      required: ['prompt'],
    },
    parameters: {
      type: 'object',
      properties: {
        prompt: { type: 'string', description: 'Natural language specification' },
        contractName: { type: 'string', description: 'Contract name' },
        symbol: { type: 'string', description: 'Token symbol' },
      },
      required: ['prompt'],
    },
  },
  {
    name: 'upload_contract_asset',
    description: 'Uploads a token logo or NFT collection image asset to Supabase Storage and returns a public CDN URL.',
    annotations: { readOnly: false, destructive: false, confirmationRequired: false },
    inputSchema: {
      type: 'object',
      properties: {
        fileBase64: { type: 'string', description: 'Base64 encoded file string' },
        fileName: { type: 'string', description: 'Target file name' },
      },
      required: ['fileBase64'],
    },
    parameters: {
      type: 'object',
      properties: {
        fileBase64: { type: 'string', description: 'Base64 encoded file string' },
      },
      required: ['fileBase64'],
    },
  },
  {
    name: 'generate_passkey_registration_options',
    description: 'Generates WebAuthn registration options and challenge for registering a biometric passkey (TouchID, FaceID, Windows Hello, YubiKey) to authorize MPC vault transactions.',
    annotations: { readOnly: false, destructive: false, confirmationRequired: false },
    inputSchema: {
      type: 'object',
      properties: {
        userId: { type: 'string', description: 'User ID or wallet handle' },
        userName: { type: 'string', description: 'User email or username' },
        userDisplayName: { type: 'string', description: 'Display name for the passkey credential' },
      },
      required: ['userId'],
    },
    parameters: {
      type: 'object',
      properties: {
        userId: { type: 'string', description: 'User ID or wallet handle' },
      },
      required: ['userId'],
    },
  },
  {
    name: 'verify_passkey_registration',
    description: 'Verifies the client WebAuthn registration response and registers the passkey public key and counter in the MPC security module.',
    annotations: { readOnly: false, destructive: false, confirmationRequired: false },
    inputSchema: {
      type: 'object',
      properties: {
        userId: { type: 'string', description: 'User ID' },
        walletAddress: { type: 'string', description: '0x-prefixed wallet address bound to this passkey' },
        registrationResponse: { type: 'object', description: 'WebAuthn registration response object from navigator.credentials.create()' },
      },
      required: ['userId', 'walletAddress', 'registrationResponse'],
    },
    parameters: {
      type: 'object',
      properties: {
        userId: { type: 'string', description: 'User ID' },
        walletAddress: { type: 'string', description: 'Wallet address' },
        registrationResponse: { type: 'object', description: 'Registration response' },
      },
      required: ['userId', 'walletAddress', 'registrationResponse'],
    },
  },
  {
    name: 'approve_transaction_with_passkey',
    description: 'Cryptographically verifies a user biometric passkey assertion against the staged approval token and executes Turnkey TEE MPC signing and on-chain broadcast.',
    annotations: { readOnly: false, destructive: false, confirmationRequired: true },
    inputSchema: {
      type: 'object',
      properties: {
        approvalToken: { type: 'string', description: 'Single-use staged transaction approval token (tok_...)' },
        passkeyAssertion: {
          type: 'object',
          description: 'WebAuthn authentication assertion from navigator.credentials.get() (credentialId, authenticatorData, clientDataJSON, signature)',
        },
        userId: { type: 'string', description: 'User identifier (default: default_user)' },
      },
      required: ['approvalToken'],
    },
    parameters: {
      type: 'object',
      properties: {
        approvalToken: { type: 'string', description: 'Approval token' },
        passkeyAssertion: { type: 'object', description: 'WebAuthn assertion object' },
      },
      required: ['approvalToken'],
    },
  },
  {
    name: 'set_autonomous_spending_scope',
    description: 'Grants an autonomous spending limit policy to AI agents for automated trades, swaps, and transfers without individual passkey prompts up to defined per-tx and daily caps.',
    annotations: { readOnly: false, destructive: false, confirmationRequired: true },
    inputSchema: {
      type: 'object',
      properties: {
        walletAddress: { type: 'string', description: '0x-prefixed vault wallet address' },
        asset: { type: 'string', description: 'Asset symbol (e.g. ETH, USDC, or ANY)' },
        maxAmountPerTxUsd: { type: 'number', description: 'Maximum USD amount allowed per single autonomous transaction (default: 25.0)' },
        maxDailyBudgetUsd: { type: 'number', description: 'Maximum 24-hour total USD budget (default: 100.0)' },
        allowedChains: { type: 'array', items: { type: 'number' }, description: 'Array of allowed chain IDs (e.g. [11155111, 8453])' },
        allowedContracts: { type: 'array', items: { type: 'string' }, description: 'Optional list of whitelisted contract addresses' },
        userId: { type: 'string', description: 'User identifier (default: default_user)' },
      },
      required: ['walletAddress'],
    },
    parameters: {
      type: 'object',
      properties: {
        walletAddress: { type: 'string', description: 'Vault wallet address' },
        asset: { type: 'string', description: 'Asset symbol' },
        maxAmountPerTxUsd: { type: 'number', description: 'Max per-tx USD cap' },
        maxDailyBudgetUsd: { type: 'number', description: 'Daily USD budget' },
      },
      required: ['walletAddress'],
    },
  },
  {
    name: 'activate_kill_switch',
    description: 'Emergency security lockout: Immediately revokes all active autonomous spending allowances, voids all pending approval tokens, and locks down the MPC vault against any AI agent execution.',
    annotations: { readOnly: false, destructive: true, confirmationRequired: true },
    inputSchema: {
      type: 'object',
      properties: {
        walletAddress: { type: 'string', description: '0x-prefixed wallet address to lock' },
        userId: { type: 'string', description: 'User ID (default: default_user)' },
        reason: { type: 'string', description: 'Reason for emergency lockout' },
      },
      required: ['walletAddress'],
    },
    parameters: {
      type: 'object',
      properties: {
        walletAddress: { type: 'string', description: 'Wallet address' },
        reason: { type: 'string', description: 'Reason' },
      },
      required: ['walletAddress'],
    },
  },
  {
    name: 'deactivate_kill_switch',
    description: 'Restores MPC vault operations following an emergency lockout after identity verification.',
    annotations: { readOnly: false, destructive: false, confirmationRequired: true },
    inputSchema: {
      type: 'object',
      properties: {
        walletAddress: { type: 'string', description: '0x-prefixed wallet address to unlock' },
        userId: { type: 'string', description: 'User ID (default: default_user)' },
      },
      required: ['walletAddress'],
    },
    parameters: {
      type: 'object',
      properties: {
        walletAddress: { type: 'string', description: 'Wallet address' },
      },
      required: ['walletAddress'],
    },
  },
];

