import { ethers } from 'ethers';

export interface GetTransactionStatusInput {
  txHash: string;
  chain?: string;
}

export async function getTransactionStatus(
  ctx: {
    wallet: { address: string };
  },
  args: GetTransactionStatusInput
) {
  const txHash = (args.txHash || '').trim();
  if (!txHash || !ethers.isHexString(txHash, 32)) {
    return {
      status: 'ERROR',
      message: 'Invalid transaction hash format. Must be a 32-byte 0x-prefixed hex string.',
    };
  }

  const chain = args.chain || 'base';
  const rpc = chain === 'sepolia'
    ? (process.env.SEPOLIA_RPC_URL || 'https://rpc.sepolia.org')
    : (process.env.BASE_RPC_URL || 'https://mainnet.base.org');

  const explorerBase = chain === 'sepolia'
    ? 'https://sepolia.etherscan.io/tx/'
    : 'https://basescan.org/tx/';

  try {
    const provider = new ethers.JsonRpcProvider(rpc);
    const receipt = await provider.getTransactionReceipt(txHash);

    if (!receipt) {
      return {
        status: 'PENDING',
        txHash,
        explorerUrl: `${explorerBase}${txHash}`,
        message: 'Transaction is submitted and pending inclusion in a block.',
      };
    }

    return {
      status: receipt.status === 1 ? 'CONFIRMED' : 'REVERTED',
      txHash,
      blockNumber: receipt.blockNumber,
      gasUsed: receipt.gasUsed.toString(),
      explorerUrl: `${explorerBase}${txHash}`,
    };
  } catch (err: any) {
    return {
      status: 'UNKNOWN',
      txHash,
      explorerUrl: `${explorerBase}${txHash}`,
      error: err.message,
    };
  }
}
