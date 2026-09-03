/**
 * Northveil Supported Chains Registry
 * Section 16 of Implementation Specification
 */

export interface ChainConfig {
  id: string;
  name: string;
  family: 'evm' | 'solana';
  chainId?: number;
  isWriteReady: boolean;
  rpcUrl: string;
  nativeCurrency: { name: string; symbol: string; decimals: number };
  explorerUrl: string;
}

export const SUPPORTED_CHAINS: Record<string, ChainConfig> = {
  // Write-ready EVM chains
  ethereum: {
    id: 'ethereum',
    name: 'Ethereum Mainnet',
    family: 'evm',
    chainId: 1,
    isWriteReady: true,
    rpcUrl: process.env.EVM_RPC_ETHEREUM || 'https://eth.llamarpc.com',
    nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
    explorerUrl: 'https://etherscan.io',
  },
  base: {
    id: 'base',
    name: 'Base',
    family: 'evm',
    chainId: 8453,
    isWriteReady: true,
    rpcUrl: process.env.EVM_RPC_BASE || 'https://mainnet.base.org',
    nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
    explorerUrl: 'https://basescan.org',
  },
  arbitrum: {
    id: 'arbitrum',
    name: 'Arbitrum One',
    family: 'evm',
    chainId: 42161,
    isWriteReady: true,
    rpcUrl: process.env.EVM_RPC_ARBITRUM || 'https://arb1.arbitrum.io/rpc',
    nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
    explorerUrl: 'https://arbiscan.io',
  },
  optimism: {
    id: 'optimism',
    name: 'OP Mainnet',
    family: 'evm',
    chainId: 10,
    isWriteReady: true,
    rpcUrl: process.env.EVM_RPC_OPTIMISM || 'https://mainnet.optimism.io',
    nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
    explorerUrl: 'https://optimistic.etherscan.io',
  },
  polygon: {
    id: 'polygon',
    name: 'Polygon PoS',
    family: 'evm',
    chainId: 137,
    isWriteReady: true,
    rpcUrl: process.env.EVM_RPC_POLYGON || 'https://polygon-rpc.com',
    nativeCurrency: { name: 'POL', symbol: 'POL', decimals: 18 },
    explorerUrl: 'https://polygonscan.com',
  },
  bsc: {
    id: 'bsc',
    name: 'BNB Smart Chain',
    family: 'evm',
    chainId: 56,
    isWriteReady: true,
    rpcUrl: process.env.EVM_RPC_BSC || 'https://binance.llamarpc.com',
    nativeCurrency: { name: 'BNB', symbol: 'BNB', decimals: 18 },
    explorerUrl: 'https://bscscan.com',
  },
  avalanche: {
    id: 'avalanche',
    name: 'Avalanche C-Chain',
    family: 'evm',
    chainId: 43114,
    isWriteReady: true,
    rpcUrl: process.env.EVM_RPC_AVALANCHE || 'https://api.avax.network/ext/bc/C/rpc',
    nativeCurrency: { name: 'AVAX', symbol: 'AVAX', decimals: 18 },
    explorerUrl: 'https://snowtrace.io',
  },
  sepolia: {
    id: 'sepolia',
    name: 'Sepolia Testnet',
    family: 'evm',
    chainId: 11155111,
    isWriteReady: true,
    rpcUrl: process.env.EVM_RPC_SEPOLIA || 'https://rpc.sepolia.org',
    nativeCurrency: { name: 'Sepolia Ether', symbol: 'ETH', decimals: 18 },
    explorerUrl: 'https://sepolia.etherscan.io',
  },
  base_sepolia: {
    id: 'base_sepolia',
    name: 'Base Sepolia Testnet',
    family: 'evm',
    chainId: 84532,
    isWriteReady: true,
    rpcUrl: process.env.EVM_RPC_BASE_SEPOLIA || 'https://sepolia.base.org',
    nativeCurrency: { name: 'Base Sepolia Ether', symbol: 'ETH', decimals: 18 },
    explorerUrl: 'https://sepolia.basescan.org',
  },

  // Write-ready Solana chains
  solana: {
    id: 'solana',
    name: 'Solana Mainnet-Beta',
    family: 'solana',
    isWriteReady: true,
    rpcUrl: process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com',
    nativeCurrency: { name: 'Solana', symbol: 'SOL', decimals: 9 },
    explorerUrl: 'https://solscan.io',
  },
  solana_devnet: {
    id: 'solana_devnet',
    name: 'Solana Devnet',
    family: 'solana',
    isWriteReady: true,
    rpcUrl: process.env.SOLANA_DEVNET_RPC_URL || 'https://api.devnet.solana.com',
    nativeCurrency: { name: 'Devnet SOL', symbol: 'SOL', decimals: 9 },
    explorerUrl: 'https://solscan.io?cluster=devnet',
  },

  // Read-only extra chains (indexers only)
  linea: {
    id: 'linea',
    name: 'Linea',
    family: 'evm',
    chainId: 59144,
    isWriteReady: false,
    rpcUrl: 'https://rpc.linea.build',
    nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
    explorerUrl: 'https://lineascan.build',
  },
  scroll: {
    id: 'scroll',
    name: 'Scroll',
    family: 'evm',
    chainId: 534352,
    isWriteReady: false,
    rpcUrl: 'https://rpc.scroll.io',
    nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
    explorerUrl: 'https://scrollscan.com',
  },
  mantle: {
    id: 'mantle',
    name: 'Mantle',
    family: 'evm',
    chainId: 5000,
    isWriteReady: false,
    rpcUrl: 'https://rpc.mantle.xyz',
    nativeCurrency: { name: 'Mantle', symbol: 'MNT', decimals: 18 },
    explorerUrl: 'https://mantlescan.xyz',
  },
  zksync: {
    id: 'zksync',
    name: 'ZKsync Era',
    family: 'evm',
    chainId: 324,
    isWriteReady: false,
    rpcUrl: 'https://mainnet.era.zksync.io',
    nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
    explorerUrl: 'https://explorer.zksync.io',
  },
  blast: {
    id: 'blast',
    name: 'Blast',
    family: 'evm',
    chainId: 81457,
    isWriteReady: false,
    rpcUrl: 'https://rpc.blast.io',
    nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
    explorerUrl: 'https://blastscan.io',
  },
  sonic: {
    id: 'sonic',
    name: 'Sonic',
    family: 'evm',
    chainId: 146,
    isWriteReady: false,
    rpcUrl: 'https://rpc.soniclabs.com',
    nativeCurrency: { name: 'Sonic', symbol: 'S', decimals: 18 },
    explorerUrl: 'https://sonicscan.org',
  },
};

export const WRITE_CHAINS = Object.values(SUPPORTED_CHAINS).filter(c => c.isWriteReady).map(c => c.id);
export const READ_EXTRA_CHAINS = Object.values(SUPPORTED_CHAINS).filter(c => !c.isWriteReady).map(c => c.id);
