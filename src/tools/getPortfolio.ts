import { ethers } from 'ethers';

export interface GetPortfolioInput {
  walletAddress?: string;
  chain?: string;
}

export async function getPortfolio(
  ctx: {
    userId: string;
    clientId: string;
    wallet: { id: string; address: string; chainFamily: string };
  },
  args: GetPortfolioInput = {}
) {
  const address = ctx.wallet.address;

  // Query public RPC for native balances
  const balances: Array<{
    chain: string;
    symbol: string;
    balance: string;
    balanceRaw: string;
    usdEstimate: string;
  }> = [];

  const rpcMap = [
    { chain: 'base', rpc: process.env.BASE_RPC_URL || 'https://mainnet.base.org', symbol: 'ETH' },
    { chain: 'sepolia', rpc: process.env.SEPOLIA_RPC_URL || 'https://rpc.sepolia.org', symbol: 'ETH' },
  ];

  for (const { chain, rpc, symbol } of rpcMap) {
    try {
      const provider = new ethers.JsonRpcProvider(rpc);
      const balanceWei = await provider.getBalance(address);
      const formatted = ethers.formatEther(balanceWei);
      balances.push({
        chain,
        symbol,
        balance: formatted,
        balanceRaw: balanceWei.toString(),
        usdEstimate: (parseFloat(formatted) * 3200).toFixed(2), // Approximate indexer rate
      });
    } catch {
      // Fallback display if RPC is unavailable
      balances.push({
        chain,
        symbol,
        balance: '0.0',
        balanceRaw: '0',
        usdEstimate: '0.00',
      });
    }
  }

  const markdown = [
    `### Northveil Wallet Portfolio`,
    `**Address**: \`${address}\``,
    ``,
    `| Network | Asset | Balance | Approx Value (USD) |`,
    `| :--- | :--- | :--- | :--- |`,
    ...balances.map(b => `| **${b.chain}** | ${b.symbol} | ${b.balance} | $${b.usdEstimate} |`),
  ].join('\n');

  return {
    address,
    balances,
    markdownSummary: markdown,
    timestamp: new Date().toISOString(),
  };
}
