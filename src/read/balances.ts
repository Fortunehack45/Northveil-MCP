/**
 * Northveil Balance and Portfolio Readers
 * Section 18 of Implementation Specification
 */

import { ethers } from 'ethers';
import { SUPPORTED_CHAINS, WRITE_CHAINS, READ_EXTRA_CHAINS } from '../config/chains.js';

export interface TokenBalance {
  symbol: string;
  name: string;
  decimals: number;
  balance: string;
  balanceFormatted: string;
  contractAddress?: string;
  priceUsd?: number;
  valueUsd?: number;
}

export interface ChainBalancesResult {
  chain: string;
  address: string;
  native: TokenBalance;
  tokens: TokenBalance[];
  error?: string;
}

export async function fetchChainBalances(address: string, network: string): Promise<ChainBalancesResult> {
  const chainConfig = SUPPORTED_CHAINS[network];
  if (!chainConfig) {
    throw new Error(`Unsupported network: ${network}`);
  }

  // Handle Solana
  if (chainConfig.family === 'solana') {
    return {
      chain: network,
      address,
      native: {
        symbol: chainConfig.nativeCurrency.symbol,
        name: chainConfig.nativeCurrency.name,
        decimals: chainConfig.nativeCurrency.decimals,
        balance: '0',
        balanceFormatted: '0.00',
      },
      tokens: [],
    };
  }

  // Handle EVM
  try {
    const provider = new ethers.JsonRpcProvider(chainConfig.rpcUrl);
    const rawBalance = await provider.getBalance(address);
    const formatted = ethers.formatEther(rawBalance);

    return {
      chain: network,
      address,
      native: {
        symbol: chainConfig.nativeCurrency.symbol,
        name: chainConfig.nativeCurrency.name,
        decimals: chainConfig.nativeCurrency.decimals,
        balance: rawBalance.toString(),
        balanceFormatted: formatted,
      },
      tokens: [],
    };
  } catch (err: any) {
    throw new Error(`Failed to query ${network} RPC: ${err.message}`);
  }
}

export async function getBalances(address: string, network: string = 'all'): Promise<ChainBalancesResult[]> {
  if (network === 'all') {
    const chains = WRITE_CHAINS.concat(READ_EXTRA_CHAINS);
    const rows = await Promise.allSettled(chains.map((c) => fetchChainBalances(address, c)));
    return rows.map((r, i) => {
      if (r.status === 'fulfilled') {
        return r.value;
      }
      return {
        chain: chains[i],
        address,
        native: {
          symbol: SUPPORTED_CHAINS[chains[i]]?.nativeCurrency?.symbol || 'UNKNOWN',
          name: SUPPORTED_CHAINS[chains[i]]?.nativeCurrency?.name || 'Unknown',
          decimals: 18,
          balance: '0',
          balanceFormatted: '0.00',
        },
        tokens: [],
        error: String(r.reason?.message || r.reason),
      };
    });
  }

  const single = await fetchChainBalances(address, network);
  return [single];
}

export async function getNftBalances(address: string, network: string = 'base'): Promise<{ chain: string; address: string; nfts: any[] }> {
  return {
    chain: network,
    address,
    nfts: [],
  };
}
