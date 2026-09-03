import { supabase } from '../supabase.js';

export interface HistoryItem {
  hash: string;
  from: string;
  to: string;
  value: string;
  timestamp: string;
  status: 'confirmed' | 'failed' | 'pending';
  explorerUrl?: string;
  action?: string;
  asset?: string;
}

export interface TxHistoryResult {
  chain: string;
  address: string;
  items: HistoryItem[];
  warning?: string;
}

function moralisChain(chain: string): string {
  const norm = chain.toLowerCase().replace(/^eip155:/, '');
  const map: Record<string, string> = {
    '1': 'eth',
    'ethereum': 'eth',
    'eth': 'eth',
    '8453': 'base',
    'base': 'base',
    '137': 'polygon',
    'polygon': 'polygon',
    '42161': 'arbitrum',
    'arbitrum': 'arbitrum',
    '10': 'optimism',
    'optimism': 'optimism',
    '11155111': 'sepolia',
    'sepolia': 'sepolia',
  };
  return map[norm] || 'eth';
}

function explorerUrl(chain: string, hash: string): string {
  const norm = chain.toLowerCase().replace(/^eip155:/, '');
  if (norm === '8453' || norm === 'base') return `https://basescan.org/tx/${hash}`;
  if (norm === '137' || norm === 'polygon') return `https://polygonscan.com/tx/${hash}`;
  if (norm === '42161' || norm === 'arbitrum') return `https://arbiscan.io/tx/${hash}`;
  if (norm === '11155111' || norm === 'sepolia') return `https://sepolia.etherscan.io/tx/${hash}`;
  return `https://etherscan.io/tx/${hash}`;
}

export async function getTxHistory(address: string, chain: string = 'base'): Promise<TxHistoryResult> {
  const key = process.env.MORALIS_API_KEY || process.env.VITE_MORALIS_API_KEY;
  let items: HistoryItem[] = [];
  let warning: string | undefined;

  // 1. Fetch from on-chain indexer (Moralis) if configured
  if (key) {
    try {
      const url = `https://deep-index.moralis.io/api/v2.2/${address}?chain=${moralisChain(chain)}`;
      const res = await fetch(url, { headers: { 'X-API-Key': key } });
      if (res.ok) {
        const data = (await res.json()) as any;
        items = (data.result ?? []).map((t: any) => ({
          hash: t.hash,
          from: t.from_address,
          to: t.to_address,
          value: t.value,
          timestamp: t.block_timestamp,
          status: t.receipt_status === '1' ? 'confirmed' : 'failed',
          explorerUrl: explorerUrl(chain, t.hash),
        }));
      }
    } catch (err: any) {
      console.warn('[Northveil] Moralis indexer fetch error:', err.message);
      warning = 'INDEXER_FETCH_FAILED';
    }
  } else {
    warning = 'INDEXER_NOT_CONFIGURED';
  }

  // 2. Merge audit_logs rows for MCP-originated txs
  try {
    const { data: auditLogs } = await supabase
      .from('audit_logs')
      .select('*')
      .ilike('wallet_address', address)
      .order('created_at', { ascending: false })
      .limit(50);

    if (auditLogs && auditLogs.length > 0) {
      const seenHashes = new Set(items.map((i) => i.hash.toLowerCase()));
      for (const log of auditLogs) {
        const txHash = log.details?.txHash;
        if (txHash && typeof txHash === 'string' && !seenHashes.has(txHash.toLowerCase())) {
          seenHashes.add(txHash.toLowerCase());
          items.push({
            hash: txHash,
            from: address,
            to: log.details?.to || '',
            value: log.details?.amount || '0',
            timestamp: log.created_at,
            status: 'confirmed',
            explorerUrl: explorerUrl(chain, txHash),
            action: log.action,
            asset: log.details?.asset || 'ETH',
          });
        }
      }
    }
  } catch (err: any) {
    // Database logs query optional if Supabase unconfigured
  }

  // Sort descending by timestamp
  items.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

  return {
    chain,
    address,
    items,
    warning: items.length > 0 ? undefined : warning,
  };
}
