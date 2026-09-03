import { ethers } from 'ethers';
import { canonicalPayloadHash } from '../policy/grantEngine.js';

export interface SignRequest {
  mpcWalletId: string;
  unsignedTx: {
    to: string;
    value: string;
    data: string;
    chainId: number;
    nonce: number;
    gasLimit?: string;
    maxFeePerGas?: string;
    maxPriorityFeePerGas?: string;
    gasPrice?: string;
  };
  payloadHash: string;
  approvalEvidence: {
    type: 'passkey' | 'autonomous_grant';
    approvalId?: string;
    grantId?: string;
  };
}

export interface SignResult {
  txHash: string;
  rawTransaction?: string;
}

export interface MpcProvider {
  createWallet(userId: string): Promise<{ mpcWalletId: string; address: string }>;
  signAndBroadcast(req: SignRequest): Promise<SignResult>;
}

export function getMpcProvider(): MpcProvider {
  if (process.env.NODE_ENV === 'production') {
    if (!process.env.TURNKEY_API_PUBLIC_KEY || !process.env.TURNKEY_API_PRIVATE_KEY) {
      throw new Error('FATAL: Production requires valid Turnkey MPC credentials (TURNKEY_API_PUBLIC_KEY). Server refuses to boot with unconfigured or custodial signers.');
    }
    return turnkeyProvider();
  }

  // Local dev / test mock: never permitted in production
  return process.env.TURNKEY_API_PUBLIC_KEY ? turnkeyProvider() : devMockProvider();
}

function turnkeyProvider(): MpcProvider {
  return {
    async createWallet(userId: string) {
      const { TurnkeyClient } = await import('@turnkey/http');
      const { ApiKeyStamper } = await import('@turnkey/api-key-stamper');

      const stamper = new ApiKeyStamper({
        apiPublicKey: process.env.TURNKEY_API_PUBLIC_KEY!,
        apiPrivateKey: process.env.TURNKEY_API_PRIVATE_KEY!,
      });

      const client = new TurnkeyClient(
        { baseUrl: process.env.TURNKEY_BASE_URL || 'https://api.turnkey.com' },
        stamper
      );

      const organizationId = process.env.TURNKEY_ORGANIZATION_ID!;
      // Create wallet inside user's isolated partition in Turnkey enclave
      const activity = await client.createWallet({
        type: 'ACTIVITY_TYPE_CREATE_WALLET',
        organizationId,
        parameters: {
          walletName: `Northveil Vault User ${userId}`,
          accounts: [
            {
              curve: 'CURVE_SECP256K1',
              pathFormat: 'PATH_FORMAT_BIP32',
              path: "m/44'/60'/0'/0/0",
              addressFormat: 'ADDRESS_FORMAT_ETHEREUM',
            },
          ],
        },
        timestampMs: String(Date.now()),
      });

      const pollResult = await client.getActivity({
        organizationId,
        activityId: activity.activity.id,
      });

      const walletResult = (pollResult.activity.result as any)?.createWalletResult;
      const address = walletResult?.addresses?.[0] || '';
      const mpcWalletId = walletResult?.walletId || '';

      if (!address || !mpcWalletId) {
        throw new Error('Turnkey failed to provision wallet account');
      }

      return { mpcWalletId, address };
    },

    async signAndBroadcast(req: SignRequest): Promise<SignResult> {
      const { TurnkeyClient } = await import('@turnkey/http');
      const { ApiKeyStamper } = await import('@turnkey/api-key-stamper');

      const stamper = new ApiKeyStamper({
        apiPublicKey: process.env.TURNKEY_API_PUBLIC_KEY!,
        apiPrivateKey: process.env.TURNKEY_API_PRIVATE_KEY!,
      });

      const client = new TurnkeyClient(
        { baseUrl: process.env.TURNKEY_BASE_URL || 'https://api.turnkey.com' },
        stamper
      );

      // 1. Re-hash unsignedTx and compare with payloadHash
      const recomputedHash = canonicalPayloadHash({
        chain: `eip155:${req.unsignedTx.chainId}`,
        to: req.unsignedTx.to,
        valueWei: req.unsignedTx.value,
        data: req.unsignedTx.data || '0x',
        nonce: req.unsignedTx.nonce,
      });

      if (recomputedHash !== req.payloadHash) {
        throw new Error('PAYLOAD_TAMPERING_DETECTED: Recomputed payload hash does not match approved hash.');
      }

      const organizationId = process.env.TURNKEY_ORGANIZATION_ID!;
      
      // Serialize unsigned transaction to EIP-1559 RLP format
      const tx = ethers.Transaction.from({
        to: req.unsignedTx.to,
        value: BigInt(req.unsignedTx.value),
        data: req.unsignedTx.data || '0x',
        chainId: req.unsignedTx.chainId,
        nonce: req.unsignedTx.nonce,
        gasLimit: req.unsignedTx.gasLimit ? BigInt(req.unsignedTx.gasLimit) : 21000n,
        maxFeePerGas: req.unsignedTx.maxFeePerGas ? BigInt(req.unsignedTx.maxFeePerGas) : 1000000000n,
        maxPriorityFeePerGas: req.unsignedTx.maxPriorityFeePerGas ? BigInt(req.unsignedTx.maxPriorityFeePerGas) : 1000000000n,
        type: 2,
      });

      const unsignedSerialized = tx.unsignedSerialized;

      // 2. Turnkey threshold sign in secure enclave
      const signActivity = await client.signTransaction({
        type: 'ACTIVITY_TYPE_SIGN_TRANSACTION',
        organizationId,
        parameters: {
          signWith: req.mpcWalletId,
          type: 'TRANSACTION_TYPE_ETHEREUM',
          unsignedTransaction: unsignedSerialized,
        },
        timestampMs: String(Date.now()),
      });

      const pollSign = await client.getActivity({
        organizationId,
        activityId: signActivity.activity.id,
      });

      const signedTx = (pollSign.activity.result as any)?.signTransactionResult?.signedTransaction;
      if (!signedTx) {
        throw new Error('Turnkey failed to sign transaction');
      }

      // 3. Broadcast to public RPC
      const rpcUrl = getRpcForChain(req.unsignedTx.chainId);
      const provider = new ethers.JsonRpcProvider(rpcUrl);
      const broadcastResponse = await provider.broadcastTransaction(signedTx);

      return {
        txHash: broadcastResponse.hash,
        rawTransaction: signedTx,
      };
    },
  };
}

function devMockProvider(): MpcProvider {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('SECURITY VIOLATION: Dev mock signer forbidden in production');
  }

  return {
    async createWallet() {
      return {
        mpcWalletId: 'mock-mpc-wallet-' + crypto.randomUUID().replace(/-/g, '').slice(0, 12),
        address: '0x1111111111111111111111111111111111111111',
      };
    },
    async signAndBroadcast(req: SignRequest) {
      // Deterministic pseudo-hash for unit testing
      const fakeTxHash = ethers.keccak256(ethers.toUtf8Bytes(req.payloadHash + Date.now().toString()));
      return {
        txHash: fakeTxHash,
        rawTransaction: '0x' + Buffer.from('mock-signed-tx').toString('hex'),
      };
    },
  };
}

function getRpcForChain(chainId: number): string {
  switch (chainId) {
    case 8453:
      return process.env.BASE_RPC_URL || 'https://mainnet.base.org';
    case 11155111:
      return process.env.SEPOLIA_RPC_URL || 'https://rpc.sepolia.org';
    case 1:
      return process.env.ETHEREUM_RPC_URL || 'https://cloudflare-eth.com';
    default:
      return process.env.BASE_RPC_URL || 'https://mainnet.base.org';
  }
}
