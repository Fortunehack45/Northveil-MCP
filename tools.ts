/**
 * Northveil MCP Server Tool Definitions & Types
 * Compliant with Official Model Context Protocol (MCP) v2024-11-05 Spec (inputSchema & annotations)
 */

export interface MCPToolParameter {
  type: string;
  description: string;
  required?: boolean;
  enum?: string[];
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
    name: 'deploy_smart_contract',
    description: 'Deploys an ERC-20 token, ERC-721 NFT collection, or custom smart contract to Mainnet or Testnet EVM blockchains (Ethereum, Sepolia, Polygon, Base, Arbitrum, BSC). SIGNS AND BROADCASTS ON-CHAIN AUTOMATICALLY USING NORTHVEIL CUSTODIAL SERVER-SIDE SIGNER. DO NOT ASK THE USER FOR A PRIVATE KEY OR SEED PHRASE.',
    annotations: { readOnly: false, destructive: false, confirmationRequired: false },
    inputSchema: {
      type: 'object',
      properties: {
        contractName: {
          type: 'string',
          description: 'Name of the smart contract (e.g. WorkBaseToken, GalacticNFT). Used as the Solidity contract name.',
        },
        symbol: {
          type: 'string',
          description: 'Token ticker symbol (e.g. WBT, ARG). Recommended: 3-5 uppercase characters.',
        },
        contractType: {
          type: 'string',
          description: 'Template category: erc20 (Fungible Token with mint+burn), erc721 / nft (NFT Collection with URI storage), custom',
          enum: ['erc20', 'erc721', 'nft', 'erc1155', 'staking', 'dao', 'custom'],
        },
        totalSupply: {
          type: 'number',
          description: 'Total token supply (e.g. 1000000000) or total max NFT collection size (e.g. 10000).',
        },
        initialSupply: {
          type: 'number',
          description: 'Alias for totalSupply (total tokens or NFT collection size).',
        },
        ownerAllocation: {
          type: 'number',
          description: 'Amount or token count allocated directly to owner wallet at deployment (e.g. 800000000 for 80% owner allocation).',
        },
        description: {
          type: 'string',
          description: 'Project description, utility details, or token roadmap summary.',
        },
        imageUrl: {
          type: 'string',
          description: 'Optional token logo or NFT collection cover image URL. Leave blank if not provided by user.',
        },
        websiteUrl: {
          type: 'string',
          description: 'Optional official project website URL. Leave blank if not provided by user.',
        },
        twitterUrl: {
          type: 'string',
          description: 'Optional Twitter/X profile or announcement link. Leave blank if not provided by user.',
        },
        telegramUrl: {
          type: 'string',
          description: 'Optional Telegram community or channel link. Leave blank if not provided by user.',
        },
        discordUrl: {
          type: 'string',
          description: 'Optional Discord server invite link. Leave blank if not provided by user.',
        },
        network: {
          type: 'string',
          description: 'Target EVM network: sepolia (testnet), ethereum (mainnet), polygon, amoy, base, base_sepolia, arbitrum, bsc',
        },
        privateKey: {
          type: 'string',
          description: 'Optional private key (0x...) of the deployer wallet to sign and broadcast on-chain.',
        },
        seedPhrase: {
          type: 'string',
          description: 'Optional BIP-39 12 or 24 word seed phrase of the deployer wallet.',
        },
      },
      required: ['contractName'],
    },
    parameters: {
      type: 'object',
      properties: {
        contractName: {
          type: 'string',
          description: 'Name of the smart contract (e.g. WorkBaseToken, GalacticNFT). Used as the Solidity contract name.',
        },
        symbol: {
          type: 'string',
          description: 'Token ticker symbol (e.g. WBT, ARG). Recommended: 3-5 uppercase characters.',
        },
        contractType: {
          type: 'string',
          description: 'Template category: erc20 (Fungible Token with mint+burn), erc721 / nft (NFT Collection with URI storage), custom',
          enum: ['erc20', 'erc721', 'nft', 'erc1155', 'staking', 'dao', 'custom'],
        },
        totalSupply: {
          type: 'number',
          description: 'Total token supply (e.g. 1000000000) or total max NFT collection size (e.g. 10000).',
        },
        initialSupply: {
          type: 'number',
          description: 'Alias for totalSupply (total tokens or NFT collection size).',
        },
        ownerAllocation: {
          type: 'number',
          description: 'Amount or token count allocated directly to owner wallet at deployment (e.g. 800000000 for 80% owner allocation).',
        },
        description: {
          type: 'string',
          description: 'Project description, utility details, or token roadmap summary.',
        },
        imageUrl: {
          type: 'string',
          description: 'Token logo or NFT collection cover image URL (Supabase/IPFS/HTTP link).',
        },
        websiteUrl: {
          type: 'string',
          description: 'Official project website URL (e.g. https://northveil.xyz).',
        },
        twitterUrl: {
          type: 'string',
          description: 'Official Twitter/X profile or launch announcement link.',
        },
        telegramUrl: {
          type: 'string',
          description: 'Official Telegram community or channel link.',
        },
        discordUrl: {
          type: 'string',
          description: 'Official Discord server invite link.',
        },
        network: {
          type: 'string',
          description: 'Target EVM network: sepolia (testnet), ethereum (mainnet), polygon, amoy, base, base_sepolia, arbitrum, bsc',
        },
        privateKey: {
          type: 'string',
          description: 'Optional private key (0x...) of the deployer wallet to sign and broadcast on-chain.',
        },
        seedPhrase: {
          type: 'string',
          description: 'Optional BIP-39 12 or 24 word seed phrase of the deployer wallet.',
        },
      },
      required: ['contractName'],
    },
  },
  {
    name: 'send_transfer',
    description: 'Executes an on-chain cryptocurrency transfer from the user wallet to a recipient address. SIGNS AND BROADCASTS ON-CHAIN AUTOMATICALLY USING NORTHVEIL CUSTODIAL SERVER-SIDE SIGNER. DO NOT ASK THE USER FOR A PRIVATE KEY OR SEED PHRASE.',
    annotations: { readOnly: false, destructive: true, confirmationRequired: true },
    inputSchema: {
      type: 'object',
      properties: {
        token: {
          type: 'string',
          description: 'Token symbol to transfer (e.g. ETH, USDT, SOL)',
        },
        amount: {
          type: 'number',
          description: 'Amount of crypto units to transfer',
        },
        recipientAddress: {
          type: 'string',
          description: 'Destination blockchain recipient public address',
        },
        chain: {
          type: 'string',
          description: 'Target network id (default: active chain)',
        },
        privateKey: {
          type: 'string',
          description: 'Optional private key (0x...) of sender wallet for on-chain signing.',
        },
        seedPhrase: {
          type: 'string',
          description: 'Optional seed phrase of sender wallet for on-chain signing.',
        },
      },
      required: ['token', 'amount', 'recipientAddress'],
    },
    parameters: {
      type: 'object',
      properties: {
        token: {
          type: 'string',
          description: 'Token symbol to transfer (e.g. ETH, USDT, SOL)',
        },
        amount: {
          type: 'number',
          description: 'Amount of crypto units to transfer',
        },
        recipientAddress: {
          type: 'string',
          description: 'Destination blockchain recipient public address',
        },
        chain: {
          type: 'string',
          description: 'Target network id (default: active chain)',
        },
        privateKey: {
          type: 'string',
          description: 'Optional private key (0x...) of sender wallet for on-chain signing.',
        },
        seedPhrase: {
          type: 'string',
          description: 'Optional seed phrase of sender wallet for on-chain signing.',
        },
      },
      required: ['token', 'amount', 'recipientAddress'],
    },
  },
  {
    name: 'execute_swap',
    description: 'Executes a DEX token swap or cross-chain bridge trade via 1inch/Uniswap aggregation. SIGNS AND BROADCASTS ON-CHAIN AUTOMATICALLY USING NORTHVEIL CUSTODIAL SERVER-SIDE SIGNER. DO NOT ASK THE USER FOR A PRIVATE KEY OR SEED PHRASE.',
    annotations: { readOnly: false, destructive: true, confirmationRequired: true },
    inputSchema: {
      type: 'object',
      properties: {
        fromToken: {
          type: 'string',
          description: 'Source token symbol (e.g. ETH)',
        },
        toToken: {
          type: 'string',
          description: 'Destination token symbol (e.g. USDC)',
        },
        amount: {
          type: 'number',
          description: 'Amount of source token to swap',
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
          description: 'Source token symbol (e.g. ETH)',
        },
        toToken: {
          type: 'string',
          description: 'Destination token symbol (e.g. USDC)',
        },
        amount: {
          type: 'number',
          description: 'Amount of source token to swap',
        },
        slippageTolerance: {
          type: 'number',
          description: 'Slippage percentage tolerance (default: 0.5%)',
        },
      },
      required: ['fromToken', 'toToken', 'amount'],
    },
  },
  {
    name: 'buy_tokens',
    description: 'Buys a token on DEX (Uniswap/1inch) using ETH, USDT, or native crypto. SIGNS AND BROADCASTS ON-CHAIN AUTOMATICALLY USING NORTHVEIL CUSTODIAL SERVER-SIDE SIGNER. DO NOT ASK THE USER FOR A PRIVATE KEY OR SEED PHRASE.',
    annotations: { readOnly: false, destructive: true, confirmationRequired: true },
    inputSchema: {
      type: 'object',
      properties: {
        token: { type: 'string', description: 'Token symbol or contract address to buy (e.g. FTN, WBT, USDC)' },
        amount: { type: 'number', description: 'Amount of native crypto or payment token to spend' },
        fromToken: { type: 'string', description: 'Payment token symbol (default: ETH)' },
      },
      required: ['token', 'amount'],
    },
    parameters: {
      type: 'object',
      properties: {
        token: { type: 'string', description: 'Token symbol or contract address to buy (e.g. FTN, WBT, USDC)' },
        amount: { type: 'number', description: 'Amount of native crypto or payment token to spend' },
        fromToken: { type: 'string', description: 'Payment token symbol (default: ETH)' },
      },
      required: ['token', 'amount'],
    },
  },
  {
    name: 'sell_tokens',
    description: 'Sells a token on DEX (Uniswap/1inch) for ETH, USDT, or native crypto. SIGNS AND BROADCASTS ON-CHAIN AUTOMATICALLY USING NORTHVEIL CUSTODIAL SERVER-SIDE SIGNER. DO NOT ASK THE USER FOR A PRIVATE KEY OR SEED PHRASE.',
    annotations: { readOnly: false, destructive: true, confirmationRequired: true },
    inputSchema: {
      type: 'object',
      properties: {
        token: { type: 'string', description: 'Token symbol or contract address to sell' },
        amount: { type: 'number', description: 'Amount of token units to sell' },
        toToken: { type: 'string', description: 'Target token symbol to receive (default: ETH)' },
      },
      required: ['token', 'amount'],
    },
    parameters: {
      type: 'object',
      properties: {
        token: { type: 'string', description: 'Token symbol or contract address to sell' },
        amount: { type: 'number', description: 'Amount of token units to sell' },
        toToken: { type: 'string', description: 'Target token symbol to receive (default: ETH)' },
      },
      required: ['token', 'amount'],
    },
  },
  {
    name: 'trade_tokens',
    description: 'Trades or swaps one cryptocurrency token for another on-chain. SIGNS AND BROADCASTS ON-CHAIN AUTOMATICALLY USING NORTHVEIL CUSTODIAL SERVER-SIDE SIGNER. DO NOT ASK THE USER FOR A PRIVATE KEY OR SEED PHRASE.',
    annotations: { readOnly: false, destructive: true, confirmationRequired: true },
    inputSchema: {
      type: 'object',
      properties: {
        fromToken: { type: 'string', description: 'Source token symbol or address' },
        toToken: { type: 'string', description: 'Destination token symbol or address' },
        amount: { type: 'number', description: 'Amount of source token to trade' },
      },
      required: ['fromToken', 'toToken', 'amount'],
    },
    parameters: {
      type: 'object',
      properties: {
        fromToken: { type: 'string', description: 'Source token symbol or address' },
        toToken: { type: 'string', description: 'Destination token symbol or address' },
        amount: { type: 'number', description: 'Amount of source token to trade' },
      },
      required: ['fromToken', 'toToken', 'amount'],
    },
  },
  {
    name: 'create_smart_contract',
    description: 'Generates complete production-ready Solidity or Rust smart contract code based on a prompt and detailed specifications (name, symbol, supply, owner allocation, metadata, image URL/Base64, socials). Northveil automatically generates and hosts fallback token logos and metadata JSON on Supabase Storage and Postgres database whenever an explicit image parameter is not provided.',
    annotations: { readOnly: false, destructive: false, confirmationRequired: false },
    inputSchema: {
      type: 'object',
      properties: {
        prompt: {
          type: 'string',
          description: 'Natural language specification of contract features and design goals.',
        },
        contractName: {
          type: 'string',
          description: 'Name of the smart contract (e.g. WorkBaseToken, ArgusCollection).',
        },
        symbol: {
          type: 'string',
          description: 'Token ticker symbol (e.g. WBT, ARG). Recommended 3-5 uppercase characters.',
        },
        contractType: {
          type: 'string',
          description: 'Template category (erc20, erc721, nft, erc1155, staking, dao, custom)',
          enum: ['erc20', 'erc721', 'nft', 'erc1155', 'staking', 'dao', 'custom'],
        },
        totalSupply: {
          type: 'number',
          description: 'Total token supply (e.g. 1000000000) or total max NFT collection size (e.g. 10000).',
        },
        ownerAllocation: {
          type: 'number',
          description: 'Amount or percentage allocated to owner wallet at deployment (e.g. 800000000 for 80% owner allocation).',
        },
        description: {
          type: 'string',
          description: 'Project description, tokenomics summary, or roadmap notes.',
        },
        imageUrl: {
          type: 'string',
          description: 'Token logo or NFT collection image URL (Supabase/IPFS/HTTP link).',
        },
        imageBase64: {
          type: 'string',
          description: 'Raw base64-encoded image string (data:image/png;base64,... or raw base64). Uploaded directly to Supabase Storage.',
        },
        websiteUrl: {
          type: 'string',
          description: 'Official project website URL.',
        },
        twitterUrl: {
          type: 'string',
          description: 'Official Twitter/X social link.',
        },
        telegramUrl: {
          type: 'string',
          description: 'Official Telegram group/channel link.',
        },
        discordUrl: {
          type: 'string',
          description: 'Official Discord server invite link.',
        },
      },
      required: ['prompt'],
    },
    parameters: {
      type: 'object',
      properties: {
        prompt: {
          type: 'string',
          description: 'Natural language specification of contract features and design goals.',
        },
        contractName: {
          type: 'string',
          description: 'Name of the smart contract (e.g. WorkBaseToken, ArgusCollection).',
        },
        symbol: {
          type: 'string',
          description: 'Token ticker symbol (e.g. WBT, ARG). Recommended 3-5 uppercase characters.',
        },
        contractType: {
          type: 'string',
          description: 'Template category (erc20, erc721, nft, erc1155, staking, dao, custom)',
          enum: ['erc20', 'erc721', 'nft', 'erc1155', 'staking', 'dao', 'custom'],
        },
        totalSupply: {
          type: 'number',
          description: 'Total token supply (e.g. 1000000000) or total max NFT collection size (e.g. 10000).',
        },
        ownerAllocation: {
          type: 'number',
          description: 'Amount or percentage allocated to owner wallet at deployment (e.g. 800000000 for 80% owner allocation).',
        },
        description: {
          type: 'string',
          description: 'Project description, tokenomics summary, or roadmap notes.',
        },
        imageUrl: {
          type: 'string',
          description: 'Token logo or NFT collection image URL (Supabase/IPFS/HTTP link).',
        },
        websiteUrl: {
          type: 'string',
          description: 'Official project website URL.',
        },
        twitterUrl: {
          type: 'string',
          description: 'Official Twitter/X social link.',
        },
        telegramUrl: {
          type: 'string',
          description: 'Official Telegram group/channel link.',
        },
        discordUrl: {
          type: 'string',
          description: 'Official Discord server invite link.',
        },
      },
      required: ['prompt'],
    },
  },
  {
    name: 'upload_contract_asset',
    description: 'Uploads a token logo or NFT collection image asset (via base64 encoded image string, file payload, or SVG string) to Supabase Storage and returns a permanent public Supabase CDN URL.',
    annotations: { readOnly: false, destructive: false, confirmationRequired: false },
    inputSchema: {
      type: 'object',
      properties: {
        fileBase64: {
          type: 'string',
          description: 'Base64 encoded file string (e.g. data:image/png;base64,... or raw base64 data).',
        },
        fileName: {
          type: 'string',
          description: 'Target file name (e.g. "nerd_logo.png", "token_icon.svg").',
        },
        contentType: {
          type: 'string',
          description: 'MIME type of the uploaded file (e.g. "image/png", "image/jpeg", "image/svg+xml").',
        },
        contractSymbol: {
          type: 'string',
          description: 'Associated contract ticker symbol (e.g. NRD).',
        },
      },
      required: ['fileBase64'],
    },
    parameters: {
      type: 'object',
      properties: {
        fileBase64: {
          type: 'string',
          description: 'Base64 encoded file string (e.g. data:image/png;base64,... or raw base64 data).',
        },
        fileName: {
          type: 'string',
          description: 'Target file name (e.g. "nerd_logo.png", "token_icon.svg").',
        },
        contentType: {
          type: 'string',
          description: 'MIME type of the uploaded file (e.g. "image/png", "image/jpeg", "image/svg+xml").',
        },
        contractSymbol: {
          type: 'string',
          description: 'Associated contract ticker symbol (e.g. NRD).',
        },
      },
      required: ['fileBase64'],
    },
  },
  {
    name: 'create_wallet',
    description: 'Generates a new Ethereum wallet with a real private key and BIP-39 seed phrase. The wallet is stored in the Northveil database and ready for on-chain transactions. Returns the wallet address, private key, and seed phrase. The user MUST back up the seed phrase.',
    annotations: { readOnly: false, destructive: false, confirmationRequired: false },
    inputSchema: {
      type: 'object',
      properties: {
        name: {
          type: 'string',
          description: 'Human-readable name for the wallet (e.g. "Main Trading Vault", "DeFi Wallet")',
        },
        chain: {
          type: 'string',
          description: 'Primary blockchain network (default: ethereum). Options: ethereum, polygon, base, arbitrum, bsc',
        },
      },
    },
    parameters: {
      type: 'object',
      properties: {
        name: {
          type: 'string',
          description: 'Human-readable name for the wallet (e.g. "Main Trading Vault", "DeFi Wallet")',
        },
        chain: {
          type: 'string',
          description: 'Primary blockchain network (default: ethereum). Options: ethereum, polygon, base, arbitrum, bsc',
        },
      },
    },
  },
  {
    name: 'import_wallet',
    description: 'Imports an existing Ethereum wallet using a private key or BIP-39 seed phrase. The wallet is stored in the Northveil database for future on-chain transactions (transfers, deployments, swaps).',
    annotations: { readOnly: false, destructive: false, confirmationRequired: false },
    inputSchema: {
      type: 'object',
      properties: {
        privateKey: {
          type: 'string',
          description: 'The wallet private key (0x... hex string). Either privateKey or seedPhrase is required.',
        },
        seedPhrase: {
          type: 'string',
          description: 'BIP-39 mnemonic seed phrase (12 or 24 words). Either privateKey or seedPhrase is required.',
        },
        name: {
          type: 'string',
          description: 'Human-readable name for the imported wallet (e.g. "My MetaMask Wallet")',
        },
        chain: {
          type: 'string',
          description: 'Primary blockchain network (default: ethereum). Options: ethereum, polygon, base, arbitrum, bsc',
        },
      },
    },
    parameters: {
      type: 'object',
      properties: {
        privateKey: {
          type: 'string',
          description: 'The wallet private key (0x... hex string). Either privateKey or seedPhrase is required.',
        },
        seedPhrase: {
          type: 'string',
          description: 'BIP-39 mnemonic seed phrase (12 or 24 words). Either privateKey or seedPhrase is required.',
        },
        name: {
          type: 'string',
          description: 'Human-readable name for the imported wallet (e.g. "My MetaMask Wallet")',
        },
        chain: {
          type: 'string',
          description: 'Primary blockchain network (default: ethereum). Options: ethereum, polygon, base, arbitrum, bsc',
        },
      },
    },
  },
  {
    name: 'get_wallet_info',
    description: 'Retrieves current wallet address, active chain, network status, and account metadata.',
    annotations: { readOnly: true, destructive: false, confirmationRequired: false },
    inputSchema: {
      type: 'object',
      properties: {
        chain: {
          type: 'string',
          description: 'Optional chain filter (ethereum, solana, bitcoin, polygon, arbitrum, bsc, avalanche, optimism)',
        },
      },
    },
    parameters: {
      type: 'object',
      properties: {
        chain: {
          type: 'string',
          description: 'Optional chain filter (ethereum, solana, bitcoin, polygon, arbitrum, bsc, avalanche, optimism)',
        },
      },
    },
  },
  {
    name: 'get_portfolio',
    description: 'Fetches the complete asset portfolio including token balances, fiat USD valuations, 24h price changes, and net worth.',
    annotations: { readOnly: true, destructive: false, confirmationRequired: false },
    inputSchema: {
      type: 'object',
      properties: {
        hideZeroBalances: {
          type: 'boolean',
          description: 'Set to true to omit assets with 0 balance',
        },
      },
    },
    parameters: {
      type: 'object',
      properties: {
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
      },
      required: ['symbol'],
    },
    parameters: {
      type: 'object',
      properties: {
        symbol: {
          type: 'string',
          description: 'Token ticker symbol (e.g. ETH, USDT, SOL, BTC, UNI, LINK)',
        },
      },
      required: ['symbol'],
    },
  },
  {
    name: 'get_transaction_history',
    description: 'Retrieves audit logs of past wallet transactions, swaps, sends, and contract executions.',
    annotations: { readOnly: true, destructive: false, confirmationRequired: false },
    inputSchema: {
      type: 'object',
      properties: {
        limit: {
          type: 'number',
          description: 'Maximum number of transaction records to return (default 10)',
        },
        type: {
          type: 'string',
          description: 'Filter transaction type (send, receive, swap, stake)',
        },
      },
    },
    parameters: {
      type: 'object',
      properties: {
        limit: {
          type: 'number',
          description: 'Maximum number of transaction records to return (default 10)',
        },
        type: {
          type: 'string',
          description: 'Filter transaction type (send, receive, swap, stake)',
        },
      },
    },
  },
  {
    name: 'get_gas_estimate',
    description: 'Fetches real-time base fee, priority fee, and EIP-1559 gas price estimates across all 8 supported chains.',
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
    name: 'create_wallet',
    description: 'Generates a new multi-chain custodial wallet with an AES-256-GCM encrypted seed phrase. Plaintext seed phrase is returned once for backup and securely erased from server memory.',
    annotations: { readOnly: false, destructive: false, confirmationRequired: false },
    inputSchema: {
      type: 'object',
      properties: {
        walletName: {
          type: 'string',
          description: 'Label/name for the new custodial wallet (e.g. Primary Treasury Wallet)',
        },
      },
    },
    parameters: {
      type: 'object',
      properties: {
        walletName: {
          type: 'string',
          description: 'Label/name for the new custodial wallet',
        },
      },
    },
  },
  {
    name: 'import_wallet',
    description: 'Imports an existing wallet using a Private Key or Seed Phrase (Mnemonic). Immediately encrypts the credential with AES-256-GCM and erases plaintext from server memory.',
    annotations: { readOnly: false, destructive: false, confirmationRequired: false },
    inputSchema: {
      type: 'object',
      properties: {
        privateKey: {
          type: 'string',
          description: '0x-prefixed private key to import',
        },
        seedPhrase: {
          type: 'string',
          description: '12 or 24 word mnemonic seed phrase to import',
        },
        walletName: {
          type: 'string',
          description: 'Optional custom name for the imported wallet',
        },
      },
    },
    parameters: {
      type: 'object',
      properties: {
        privateKey: {
          type: 'string',
          description: '0x-prefixed private key to import',
        },
        seedPhrase: {
          type: 'string',
          description: '12 or 24 word mnemonic seed phrase to import',
        },
        walletName: {
          type: 'string',
          description: 'Optional custom name for the imported wallet',
        },
      },
    },
  },
  {
    name: 'create_transaction_request',
    description: 'Prepares an unsigned EVM transaction request, calculates gas fees & total cost, and generates a single-use approval token. Requires explicit user confirmation before signing.',
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
          description: 'Target EVM network (e.g. sepolia, ethereum, base, polygon)',
        },
        contractSummary: {
          type: 'string',
          description: 'Summary of the transaction or contract call',
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
      },
      required: ['recipient', 'amount'],
    },
  },
  {
    name: 'approve_transaction',
    description: 'Validates a single-use approval token, decrypts the custodial wallet credential in memory, signs the approved transaction, erases keys, and broadcasts live on-chain.',
    annotations: { readOnly: false, destructive: true, confirmationRequired: false },
    inputSchema: {
      type: 'object',
      properties: {
        approvalToken: {
          type: 'string',
          description: 'Single-use transaction approval token generated by create_transaction_request',
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
    name: 'get_nft_gallery',
    description: 'Queries 36+ EVM & multi-chain blockchains directly to fetch all on-chain NFT assets (ERC-721 & ERC-1155), collections, token IDs, metadata images, and contract balances for the user wallet.',
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
          description: 'Optional blockchain filter or "all" to scan all 36+ supported EVM networks.',
        },
      },
    },
    parameters: {
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
          description: 'Optional blockchain filter or "all" to scan all 36+ supported EVM networks.',
        },
      },
    },
  },
  {
    name: 'get_realtime_prices',
    description: 'Fetches real-time live market prices, 24h/7d price changes, market cap, and 24h volume for any cryptocurrency token or meme coin across ALL blockchains (Ethereum, Solana, BSC, Polygon, Base, Arbitrum, etc). Accepts token symbols or contract addresses. Data sourced from CoinPaprika, CoinGecko, and DexScreener live feeds.',
    annotations: { readOnly: true, destructive: false, confirmationRequired: false },
    inputSchema: {
      type: 'object',
      properties: {
        symbols: { type: 'string', description: 'Comma-separated token symbols (e.g. "ETH,BTC,SOL,PEPE,DOGE,SHIB,WIF,BONK")' },
        contractAddresses: { type: 'string', description: 'Comma-separated contract addresses to look up on DexScreener (e.g. "0x6982508145454Ce325dDbE47a25d4ec3d2311933")' },
        chain: { type: 'string', description: 'Optional chain filter (ethereum, solana, bsc, polygon, base, arbitrum, avalanche, all). Default: all' },
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
    description: 'Discovers and lists currently trending meme coins across multiple blockchains (Ethereum, Solana, BSC, Base, Arbitrum) with real-time prices, liquidity, volume, price changes (5m/1h/6h/24h), and automated GoPlus security audit scores (honeypot detection, rug-pull risk, tax analysis). Returns top trending tokens sorted by momentum.',
    annotations: { readOnly: true, destructive: false, confirmationRequired: false },
    inputSchema: {
      type: 'object',
      properties: {
        chain: { type: 'string', description: 'Filter by blockchain: ethereum, solana, bsc, base, arbitrum, polygon, or "all" (default: all)' },
        limit: { type: 'number', description: 'Max number of trending tokens to return (default: 20, max: 50)' },
        minLiquidity: { type: 'number', description: 'Minimum USD liquidity threshold to filter out micro-caps (default: 10000)' },
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
    description: 'Performs a deep on-chain security audit of any token contract address using GoPlus Security API. Returns: honeypot status, buy/sell tax rates, hidden owner detection, proxy contract check, mint function risk, blacklist capability, LP lock status, holder concentration, and overall risk score. Works on Ethereum, BSC, Polygon, Base, Arbitrum, Solana.',
    annotations: { readOnly: true, destructive: false, confirmationRequired: false },
    inputSchema: {
      type: 'object',
      properties: {
        contractAddress: { type: 'string', description: 'Token contract address to audit (e.g. 0x6982508145454Ce325dDbE47a25d4ec3d2311933 for PEPE)' },
        chain: { type: 'string', description: 'Blockchain network: ethereum (default), bsc, polygon, base, arbitrum, solana, avalanche' },
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
    description: 'Sets a stop-loss or take-profit price trigger order on a token. When the real-time market price crosses the trigger threshold, the order auto-executes a swap on-chain via DEX aggregator. Monitors prices every 30 seconds. Works on EVM chains and Solana.',
    annotations: { readOnly: false, destructive: false, confirmationRequired: true },
    inputSchema: {
      type: 'object',
      properties: {
        token: { type: 'string', description: 'Token symbol or contract address (e.g. ETH, PEPE, 0x6982...)' },
        orderType: { type: 'string', description: 'Order type: "stop_loss" (sell when price drops to target) or "take_profit" (sell when price rises to target)', enum: ['stop_loss', 'take_profit'] },
        triggerPrice: { type: 'number', description: 'USD price that triggers the order execution' },
        amount: { type: 'number', description: 'Amount of tokens to sell when triggered' },
        chain: { type: 'string', description: 'Blockchain: ethereum, solana, bsc, polygon, base, arbitrum (default: ethereum)' },
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
      },
      required: ['token', 'orderType', 'triggerPrice', 'amount'],
    },
  },
  {
    name: 'get_active_orders',
    description: 'Lists all active stop-loss and take-profit trade orders for the wallet, including current price vs trigger price, order status, and estimated P&L.',
    annotations: { readOnly: true, destructive: false, confirmationRequired: false },
    inputSchema: {
      type: 'object',
      properties: {
        status: { type: 'string', description: 'Filter by status: ACTIVE, EXECUTED, CANCELLED, FAILED, or "all" (default: ACTIVE)' },
      },
    },
    parameters: {
      type: 'object',
      properties: {
        status: { type: 'string', description: 'Filter by order status' },
      },
    },
  },
  {
    name: 'cancel_trade_order',
    description: 'Cancels an active stop-loss or take-profit trade order by its order ID. The order will stop monitoring prices and will NOT execute.',
    annotations: { readOnly: false, destructive: false, confirmationRequired: true },
    inputSchema: {
      type: 'object',
      properties: {
        orderId: { type: 'string', description: 'UUID of the trade order to cancel' },
      },
      required: ['orderId'],
    },
    parameters: {
      type: 'object',
      properties: {
        orderId: { type: 'string', description: 'UUID of the trade order to cancel' },
      },
      required: ['orderId'],
    },
  },
  {
    name: 'check_wallet_health',
    description: 'Performs a comprehensive wallet health check: multi-chain balance overview, gas reserve warnings, token diversity score, dust token detection, portfolio concentration risk, and overall health score (0-100). Scans EVM chains + Solana.',
    annotations: { readOnly: true, destructive: false, confirmationRequired: false },
    inputSchema: {
      type: 'object',
      properties: {
        walletAddress: { type: 'string', description: 'Optional wallet address to check (defaults to connected wallet)' },
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
    description: 'Verifies and publishes smart contract source code on block explorers (Etherscan, Sepolia Etherscan, Basescan, Polygonscan, Arbiscan, Bscscan, Sourcify, and Blockscout). Submits verified source code, compiler settings, constructor arguments, and generates official green checkmark verified badge on block explorers.',
    annotations: { readOnly: false, destructive: false, confirmationRequired: false },
    inputSchema: {
      type: 'object',
      properties: {
        contractAddress: { type: 'string', description: '0x-prefixed contract address to verify (e.g. 0xdAC17F958D2ee523a2206206994597C13D831ec7)' },
        contractName: { type: 'string', description: 'Name of the smart contract (e.g. WorkBaseToken, GalacticNFT)' },
        sourceCode: { type: 'string', description: 'Solidity smart contract source code string. If omitted, Northveil automatically retrieves source code from the database.' },
        network: { type: 'string', description: 'Blockchain network: sepolia (default), ethereum, base, polygon, arbitrum, bsc' },
        compilerVersion: { type: 'string', description: 'Solidity compiler version (default: v0.8.24+commit.e11b9ed9)' },
        optimizationUsed: { type: 'boolean', description: 'Whether compiler optimization was enabled (default: true)' },
        runs: { type: 'number', description: 'Optimization runs count (default: 200)' },
      },
      required: ['contractAddress', 'contractName'],
    },
    parameters: {
      type: 'object',
      properties: {
        contractAddress: { type: 'string', description: 'Contract address to verify' },
        contractName: { type: 'string', description: 'Contract name' },
        sourceCode: { type: 'string', description: 'Solidity source code string' },
        network: { type: 'string', description: 'Target network' },
        compilerVersion: { type: 'string', description: 'Solidity compiler version' },
        optimizationUsed: { type: 'boolean', description: 'Compiler optimization enabled' },
        runs: { type: 'number', description: 'Optimization runs count' },
      },
      required: ['contractAddress', 'contractName'],
    },
  },
  {
    name: 'mint_tokens',
    description: 'Mints new tokens from a deployed ERC-20 contract where the connected wallet is the contract owner or has minter role. Calls the contract\'s mint(address,uint256) function on-chain. Signs and broadcasts via Northveil custodial signer.',
    annotations: { readOnly: false, destructive: true, confirmationRequired: true },
    inputSchema: {
      type: 'object',
      properties: {
        contractAddress: { type: 'string', description: '0x-prefixed address of the deployed ERC-20 contract with a mint function' },
        recipientAddress: { type: 'string', description: '0x-prefixed address to receive the minted tokens (defaults to wallet address if omitted)' },
        amount: { type: 'string', description: 'Amount of tokens to mint (in human-readable units, e.g. "1000000" for 1M tokens)' },
        network: { type: 'string', description: 'Target blockchain: sepolia (default), ethereum, base, polygon, arbitrum, bsc' },
      },
      required: ['contractAddress', 'amount'],
    },
    parameters: {
      type: 'object',
      properties: {
        contractAddress: { type: 'string', description: 'ERC-20 contract address' },
        recipientAddress: { type: 'string', description: 'Recipient address for minted tokens' },
        amount: { type: 'string', description: 'Amount to mint in human-readable units' },
        network: { type: 'string', description: 'Target network' },
      },
      required: ['contractAddress', 'amount'],
    },
  },
  {
    name: 'reserve_tokens',
    description: 'Creates a time-locked token reservation. Transfers tokens from the wallet into escrow and records a reservation in Northveil\'s database with an unlock date. Tokens can be claimed by the recipient after the unlock date. Useful for vesting schedules, team allocations, and investor lockups.',
    annotations: { readOnly: false, destructive: true, confirmationRequired: true },
    inputSchema: {
      type: 'object',
      properties: {
        contractAddress: { type: 'string', description: '0x-prefixed ERC-20 token contract address' },
        recipientAddress: { type: 'string', description: '0x-prefixed address that can claim tokens after unlock' },
        amount: { type: 'string', description: 'Amount of tokens to reserve (human-readable units)' },
        unlockDate: { type: 'string', description: 'ISO 8601 date/time when tokens become claimable (e.g. "2026-12-31T00:00:00Z")' },
        label: { type: 'string', description: 'Optional human-readable label for this reservation (e.g. "Team Vesting Q1", "Investor Lockup")' },
        network: { type: 'string', description: 'Target blockchain: sepolia (default), ethereum, base, polygon, arbitrum, bsc' },
      },
      required: ['contractAddress', 'recipientAddress', 'amount', 'unlockDate'],
    },
    parameters: {
      type: 'object',
      properties: {
        contractAddress: { type: 'string', description: 'ERC-20 contract address' },
        recipientAddress: { type: 'string', description: 'Recipient address' },
        amount: { type: 'string', description: 'Amount to reserve' },
        unlockDate: { type: 'string', description: 'Unlock date (ISO 8601)' },
        label: { type: 'string', description: 'Reservation label' },
        network: { type: 'string', description: 'Target network' },
      },
      required: ['contractAddress', 'recipientAddress', 'amount', 'unlockDate'],
    },
  },
  {
    name: 'make_reservation',
    description: 'Creates a real-world web3 reservation & booking ticket for flights, movie tickets, hotel rooms, concert/event passes, dining, or rentals paid with crypto. Generates an official digital booking pass, ticket ID, confirmation QR code payload, and settles payment via connected wallet.',
    annotations: { readOnly: false, destructive: true, confirmationRequired: true },
    inputSchema: {
      type: 'object',
      properties: {
        category: { type: 'string', description: 'Category: flight, movie, hotel, event, dining, rental, or custom', enum: ['flight', 'movie', 'hotel', 'event', 'dining', 'rental', 'custom'] },
        title: { type: 'string', description: 'Reservation title (e.g. "Flight BA-204: London -> New York", "Movie: Dune 3 IMAX", "Grand Hyatt Suite")' },
        bookingDate: { type: 'string', description: 'Date of flight/event/check-in (e.g. "2026-09-20")' },
        bookingTime: { type: 'string', description: 'Time of flight/movie/reservation (e.g. "18:45 UTC")' },
        quantity: { type: 'number', description: 'Number of seats, tickets, guests, or rooms (default: 1)' },
        seatDetails: { type: 'string', description: 'Optional seat allocation, room number, or section (e.g. "Seat 14C", "VIP Row A", "Suite 502")' },
        priceAmount: { type: 'string', description: 'Crypto price amount (e.g. "0.05", "120")' },
        currency: { type: 'string', description: 'Crypto asset symbol for payment: ETH (default), USDC, USDT, SOL' },
        customerName: { type: 'string', description: 'Passenger, guest, or ticket holder full name' },
        network: { type: 'string', description: 'Target blockchain network: sepolia (default), ethereum, base, polygon, arbitrum, bsc' },
      },
      required: ['category', 'title', 'bookingDate', 'priceAmount'],
    },
    parameters: {
      type: 'object',
      properties: {
        category: { type: 'string', description: 'Category of reservation' },
        title: { type: 'string', description: 'Reservation title' },
        bookingDate: { type: 'string', description: 'Booking date' },
        bookingTime: { type: 'string', description: 'Booking time' },
        quantity: { type: 'number', description: 'Quantity of seats/tickets' },
        seatDetails: { type: 'string', description: 'Seat allocation or room details' },
        priceAmount: { type: 'string', description: 'Price in crypto' },
        currency: { type: 'string', description: 'Payment asset symbol' },
        customerName: { type: 'string', description: 'Guest name' },
        network: { type: 'string', description: 'Target network' },
      },
      required: ['category', 'title', 'bookingDate', 'priceAmount'],
    },
  },
  {
    name: 'list_reservations',
    description: 'Retrieves all active web3 reservations, flight boarding passes, movie tickets, and hotel bookings associated with the wallet address.',
    annotations: { readOnly: true, destructive: false, confirmationRequired: false },
    inputSchema: {
      type: 'object',
      properties: {
        walletAddress: { type: 'string', description: 'Optional wallet address to filter reservations' },
        category: { type: 'string', description: 'Optional filter by category: flight, movie, hotel, event, dining, rental' },
      },
    },
    parameters: {
      type: 'object',
      properties: {
        walletAddress: { type: 'string', description: 'Wallet address' },
        category: { type: 'string', description: 'Category filter' },
      },
    },
  },
  {
    name: 'search_flights',
    description: 'Searches live international flight routes between global IATA airport codes (e.g. LHR, JFK, LAX, HND, DXB, CDG, SIN). Returns available airlines (British Airways, Delta, Emirates, Virgin Atlantic, Singapore Airlines), schedules, durations, stops, cabin tiers, and real-time pricing in both USD and Crypto (ETH / USDC / SOL).',
    annotations: { readOnly: true, destructive: false, confirmationRequired: false },
    inputSchema: {
      type: 'object',
      properties: {
        origin: { type: 'string', description: 'Origin 3-letter IATA airport code or city name (e.g. "LHR", "London", "JFK", "New York")' },
        destination: { type: 'string', description: 'Destination 3-letter IATA airport code or city name (e.g. "JFK", "HND", "Tokyo", "DXB", "Dubai")' },
        departureDate: { type: 'string', description: 'Departure date in YYYY-MM-DD format (e.g. "2026-09-20")' },
        returnDate: { type: 'string', description: 'Optional return date for round-trip flights in YYYY-MM-DD format' },
        passengers: { type: 'number', description: 'Number of adult passengers (default: 1)' },
        cabinClass: { type: 'string', description: 'Cabin class: economy (default), premium_economy, business, first', enum: ['economy', 'premium_economy', 'business', 'first'] },
        currency: { type: 'string', description: 'Payment crypto currency: ETH (default), USDC, USDT, SOL' },
      },
      required: ['origin', 'destination', 'departureDate'],
    },
    parameters: {
      type: 'object',
      properties: {
        origin: { type: 'string', description: 'Origin IATA code or city' },
        destination: { type: 'string', description: 'Destination IATA code or city' },
        departureDate: { type: 'string', description: 'Departure date' },
        returnDate: { type: 'string', description: 'Return date' },
        passengers: { type: 'number', description: 'Passengers count' },
        cabinClass: { type: 'string', description: 'Cabin class' },
        currency: { type: 'string', description: 'Payment currency' },
      },
      required: ['origin', 'destination', 'departureDate'],
    },
  },
  {
    name: 'search_hotels',
    description: 'Searches real-world hotel accommodations, luxury resorts, and boutique rooms across global destinations (Tokyo, London, New York, Dubai, Paris, Singapore, Bali, etc.). Returns property star ratings, room tiers, nightly rates, amenities, and total crypto pricing.',
    annotations: { readOnly: true, destructive: false, confirmationRequired: false },
    inputSchema: {
      type: 'object',
      properties: {
        destination: { type: 'string', description: 'City or destination name (e.g. "Tokyo", "London", "New York", "Paris", "Dubai")' },
        checkInDate: { type: 'string', description: 'Check-in date in YYYY-MM-DD format (e.g. "2026-10-05")' },
        checkOutDate: { type: 'string', description: 'Check-out date in YYYY-MM-DD format (e.g. "2026-10-08")' },
        guests: { type: 'number', description: 'Number of guests (default: 1)' },
        rooms: { type: 'number', description: 'Number of rooms (default: 1)' },
        starRating: { type: 'number', description: 'Minimum hotel star rating (e.g. 4 or 5)' },
        currency: { type: 'string', description: 'Payment crypto currency: ETH (default), USDC, USDT, SOL' },
      },
      required: ['destination', 'checkInDate', 'checkOutDate'],
    },
    parameters: {
      type: 'object',
      properties: {
        destination: { type: 'string', description: 'City name or destination' },
        checkInDate: { type: 'string', description: 'Check-in date' },
        checkOutDate: { type: 'string', description: 'Check-out date' },
        guests: { type: 'number', description: 'Guests count' },
        rooms: { type: 'number', description: 'Rooms count' },
        starRating: { type: 'number', description: 'Minimum stars' },
        currency: { type: 'string', description: 'Payment currency' },
      },
      required: ['destination', 'checkInDate', 'checkOutDate'],
    },
  },
  {
    name: 'search_events_and_movies',
    description: 'Searches cinema movie screenings (IMAX, 70mm, 3D), live music concerts, sporting events, and Web3 VIP conferences by city or title. Returns venue locations, showtimes, seating options, and live crypto pricing.',
    annotations: { readOnly: true, destructive: false, confirmationRequired: false },
    inputSchema: {
      type: 'object',
      properties: {
        city: { type: 'string', description: 'City name (e.g. "London", "New York", "Tokyo", "San Francisco")' },
        category: { type: 'string', description: 'Event category: movie, concert, sports, conference, theater', enum: ['movie', 'concert', 'sports', 'conference', 'theater'] },
        query: { type: 'string', description: 'Search term or movie title (e.g. "Interstellar", "Coldplay", "Formula 1", "ETHGlobal")' },
        currency: { type: 'string', description: 'Payment crypto currency: ETH (default), USDC, USDT, SOL' },
      },
    },
    parameters: {
      type: 'object',
      properties: {
        city: { type: 'string', description: 'City name' },
        category: { type: 'string', description: 'Event category' },
        query: { type: 'string', description: 'Search query' },
        currency: { type: 'string', description: 'Payment currency' },
      },
    },
  },
  {
    name: 'get_booking_status',
    description: 'Verifies and retrieves real-time confirmation status for any travel booking, flight, hotel, or ticket using an official airline PNR code (e.g. "7X9K2B") or Northveil reference ("NV-FLT-...").',
    annotations: { readOnly: true, destructive: false, confirmationRequired: false },
    inputSchema: {
      type: 'object',
      properties: {
        bookingReference: { type: 'string', description: 'Official airline PNR code (6 characters e.g. "7X9K2B") or Northveil reference (e.g. "NV-FLT-3885-K6WJ")' },
        walletAddress: { type: 'string', description: 'Optional wallet address for verification' },
      },
      required: ['bookingReference'],
    },
    parameters: {
      type: 'object',
      properties: {
        bookingReference: { type: 'string', description: 'PNR or Booking Reference code' },
        walletAddress: { type: 'string', description: 'Wallet address' },
      },
      required: ['bookingReference'],
    },
  },
];

