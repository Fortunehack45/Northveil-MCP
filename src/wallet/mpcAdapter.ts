import { ethers } from 'ethers';
import crypto from 'node:crypto';
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

export function isHosted(): boolean {
  return process.env.NODE_ENV === 'production' || process.env.VERCEL === '1' || process.env.NORTHVEIL_HOSTED === '1';
}

export function allowOrgSign(): boolean {
  // Local only, and only with an explicit escape hatch.
  return !isHosted() && process.env.ALLOW_ORG_ROOT_SIGN === '1';
}

const ALREADY = /already imported/i;
const WALLET_ID = /wallet\s+([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i;

export function parseAlreadyImportedWalletId(message: string): string | null {
  if (!ALREADY.test(message)) return null;
  return message.match(WALLET_ID)?.[1] || null;
}

export async function fetchTurnkeyWalletAddress(mpcWalletId: string): Promise<string | null> {
  if (!process.env.TURNKEY_API_PUBLIC_KEY || !process.env.TURNKEY_API_PRIVATE_KEY || !process.env.TURNKEY_ORGANIZATION_ID) {
    if (process.env.NODE_ENV !== 'production') {
      return '0x' + crypto.createHash('sha256').update(mpcWalletId).digest('hex').slice(0, 40);
    }
    return null;
  }
  try {
    const { TurnkeyClient } = await import('@turnkey/http');
    const { ApiKeyStamper } = await import('@turnkey/api-key-stamper');

    const stamper = new ApiKeyStamper({
      apiPublicKey: process.env.TURNKEY_API_PUBLIC_KEY,
      apiPrivateKey: process.env.TURNKEY_API_PRIVATE_KEY,
    });

    const client = new TurnkeyClient(
      { baseUrl: process.env.TURNKEY_BASE_URL || 'https://api.turnkey.com' },
      stamper
    );

    const organizationId = process.env.TURNKEY_ORGANIZATION_ID;
    const accountsResp = await client.getWalletAccounts({
      organizationId,
      walletId: mpcWalletId,
    });

    const accounts = (accountsResp as any)?.accounts || [];
    const ethAcc = accounts.find((a: any) => a.addressFormat === 'ADDRESS_FORMAT_ETHEREUM' || (a.address && a.address.startsWith('0x'))) || accounts[0];
    return ethAcc?.address ? ethAcc.address.toLowerCase() : null;
  } catch (err: any) {
    console.warn('[Northveil] fetchTurnkeyWalletAddress warning:', err?.message);
    return null;
  }
}

export async function attachExistingTurnkeyWallet(userId: string): Promise<{ mpcWalletId: string; address: string } | null> {
  if (!process.env.TURNKEY_API_PUBLIC_KEY || !process.env.TURNKEY_API_PRIVATE_KEY || !process.env.TURNKEY_ORGANIZATION_ID) {
    return null;
  }
  try {
    const { TurnkeyClient } = await import('@turnkey/http');
    const { ApiKeyStamper } = await import('@turnkey/api-key-stamper');

    const stamper = new ApiKeyStamper({
      apiPublicKey: process.env.TURNKEY_API_PUBLIC_KEY,
      apiPrivateKey: process.env.TURNKEY_API_PRIVATE_KEY,
    });

    const client = new TurnkeyClient(
      { baseUrl: process.env.TURNKEY_BASE_URL || 'https://api.turnkey.com' },
      stamper
    );

    const organizationId = process.env.TURNKEY_ORGANIZATION_ID;
    const walletsResp = await client.getWallets({ organizationId });
    const walletsList: any[] = (walletsResp as any)?.wallets || [];

    const matching = walletsList.find((w: any) =>
      typeof w.walletName === 'string' && w.walletName.includes(userId)
    );


    if (!matching || !matching.walletId) {
      return null;
    }

    const address = await fetchTurnkeyWalletAddress(matching.walletId);
    if (!address) return null;

    return {
      mpcWalletId: matching.walletId,
      address: address.toLowerCase(),
    };
  } catch (err: any) {
    console.warn('[Northveil] attachExistingTurnkeyWallet warning:', err?.message);
    return null;
  }
}

export async function importFinishOrAttach(
  userId: string,
  input: { encryptedBundle: string; name?: string }
): Promise<{ mpcWalletId: string; address: string }> {
  try {
    const mpc = getMpcProvider();
    if (typeof mpc.importFinish !== 'function') {
      throw new Error('Signer provider does not support importFinish');
    }
    return await mpc.importFinish(userId, input);
  } catch (err: any) {
    const msg = String(err?.message || err);
    const mpcWalletId = parseAlreadyImportedWalletId(msg);
    if (!mpcWalletId) throw err;
    const address = await fetchTurnkeyWalletAddress(mpcWalletId);
    if (!address) throw err;
    return { mpcWalletId, address: address.toLowerCase() };
  }
}


export interface MpcProvider {
  createWallet(userId: string): Promise<{ mpcWalletId: string; address: string }>;
  importBegin?(userId: string): Promise<{ importBundle: string; organizationId: string; userId: string }>;
  importFinish?(userId: string, input: { encryptedBundle: string; name?: string }): Promise<{ mpcWalletId: string; address: string }>;
  importWallet?(userId: string, input: { mnemonic?: string; privateKey?: string }): Promise<{ mpcWalletId: string; address: string }>;
  signAndBroadcast(req: SignRequest): Promise<SignResult>;
  createSignActivity(req: SignRequest): Promise<{
    activityId: string;
    organizationId: string;
    unsignedTransaction: string;
  }>;
  submitStampedActivity(input: {
    activityId?: string;
    stampedRequest: unknown;
  }): Promise<{ signedTransaction: string }>;
  broadcastSignedTx(chainId: number, signedTransaction: string): Promise<{ txHash: string }>;
}

export function getMpcProvider(): MpcProvider {
  const hosted = isHosted();
  if (hosted) {
    if (!process.env.TURNKEY_API_PUBLIC_KEY || !process.env.TURNKEY_API_PRIVATE_KEY || !process.env.TURNKEY_ORGANIZATION_ID) {
      throw new Error('FATAL: hosted Northveil requires Turnkey');
    }
    return turnkeyProvider();
  }

  if (process.env.ALLOW_MOCK_SIGNER === '1') return devMockProvider();
  if (process.env.TURNKEY_API_PUBLIC_KEY) return turnkeyProvider();
  throw new Error('No signer configured. Set Turnkey or ALLOW_MOCK_SIGNER=1 for local tests only.');
}

export function turnkeyProvider(): MpcProvider {
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
        type: 'ACTIVITY_TYPE_CREATE_WALLET' as any,
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
        } as any,
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

    async importBegin(userId: string) {
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
      const whoami = await client.getWhoami({ organizationId });
      const turnkeyUserId = whoami.userId;

      const initResp = await client.initImportWallet({
        type: 'ACTIVITY_TYPE_INIT_IMPORT_WALLET',
        organizationId,
        parameters: {
          userId: turnkeyUserId,
        },
        timestampMs: String(Date.now()),
      });

      const pollInit = await client.getActivity({
        organizationId,
        activityId: initResp.activity.id,
      });

      const importBundle = (pollInit.activity.result as any)?.initImportWalletResult?.importBundle;
      if (!importBundle) {
        throw new Error('Failed to initialize enclave wallet import bundle');
      }

      return {
        importBundle,
        organizationId,
        userId: turnkeyUserId,
      };
    },

    async importFinish(userId: string, input: { encryptedBundle: string; name?: string }) {
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
      const whoami = await client.getWhoami({ organizationId });
      const turnkeyUserId = whoami.userId;

      const importResp = await client.importWallet({
        type: 'ACTIVITY_TYPE_IMPORT_WALLET',
        organizationId,
        parameters: {
          userId: turnkeyUserId,
          walletName: input.name || `Northveil Vault Imported ${userId} ${Date.now()}`,
          encryptedBundle: input.encryptedBundle,
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

      const pollImport = await client.getActivity({
        organizationId,
        activityId: importResp.activity.id,
      });

      const result = (pollImport.activity.result as any)?.importWalletResult;
      const address = (result?.addresses?.[0] || '').toLowerCase();
      const mpcWalletId = result?.walletId || '';

      if (!address || !mpcWalletId) {
        throw new Error('IMPORT_WALLET_FAILED: Turnkey returned empty address or walletId');
      }

      return { mpcWalletId, address };
    },

    async importWallet() {
      throw new Error("RAW_MATERIAL_FORBIDDEN");
    },

    async signAndBroadcast(_req: SignRequest): Promise<SignResult> {
      throw new Error(
        'ORG_ROOT_SIGN_FORBIDDEN: hosted signing must use createSignActivity + submitStampedActivity + broadcastSignedTx'
      );
    },


    async createSignActivity(req: SignRequest): Promise<{
      activityId: string;
      organizationId: string;
      unsignedTransaction: string;
    }> {
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
      const organizationId = process.env.TURNKEY_ORGANIZATION_ID || '';
      let activityId = `act_${crypto.randomUUID().replace(/-/g, '')}`;

      try {
        if (process.env.TURNKEY_API_PUBLIC_KEY && process.env.TURNKEY_API_PRIVATE_KEY && organizationId) {
          const { TurnkeyClient } = await import('@turnkey/http');
          const { ApiKeyStamper } = await import('@turnkey/api-key-stamper');
          const stamper = new ApiKeyStamper({
            apiPublicKey: process.env.TURNKEY_API_PUBLIC_KEY,
            apiPrivateKey: process.env.TURNKEY_API_PRIVATE_KEY,
          });
          const client = new TurnkeyClient(
            { baseUrl: process.env.TURNKEY_BASE_URL || 'https://api.turnkey.com' },
            stamper
          );
          const actResp = await (client as any).createActivity({
            type: 'ACTIVITY_TYPE_SIGN_TRANSACTION_V2' as any,
            organizationId,
            parameters: {
              signWith: req.mpcWalletId,
              type: 'TRANSACTION_TYPE_ETHEREUM',
              unsignedTransaction: unsignedSerialized,
            } as any,
            timestampMs: String(Date.now()),
          });
          if (actResp?.activity?.id) {
            activityId = actResp.activity.id;
          }
        }
      } catch {
        // If Turnkey rejects org create, create the unsigned payload only and let browser start/stamp
      }

      return {
        activityId,
        organizationId,
        unsignedTransaction: unsignedSerialized,
      };
    },

    async submitStampedActivity(input: {
      activityId?: string;
      stampedRequest: unknown;
    }): Promise<{ signedTransaction: string }> {
      const organizationId = process.env.TURNKEY_ORGANIZATION_ID || '';
      const stamped: any = input.stampedRequest;

      // If client directly provided signed transaction
      if (typeof stamped === 'object' && stamped?.signedTransaction) {
        return { signedTransaction: stamped.signedTransaction };
      }

      // If client provided a stamped HTTP payload to post to Turnkey
      if (typeof stamped === 'object' && stamped?.url && stamped?.stamp) {
        const fetchRes = await fetch(stamped.url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Stamp': stamped.stamp,
            ...(stamped.headers || {}),
          },
          body: typeof stamped.body === 'string' ? stamped.body : JSON.stringify(stamped.body),
        });
        const resJson: any = await fetchRes.json();
        const activityId = resJson?.activity?.id || input.activityId;
        if (activityId && process.env.TURNKEY_API_PUBLIC_KEY && process.env.TURNKEY_API_PRIVATE_KEY) {
          const { TurnkeyClient } = await import('@turnkey/http');
          const { ApiKeyStamper } = await import('@turnkey/api-key-stamper');
          const stamper = new ApiKeyStamper({
            apiPublicKey: process.env.TURNKEY_API_PUBLIC_KEY,
            apiPrivateKey: process.env.TURNKEY_API_PRIVATE_KEY,
          });
          const client = new TurnkeyClient(
            { baseUrl: process.env.TURNKEY_BASE_URL || 'https://api.turnkey.com' },
            stamper
          );
          const pollSign = await client.getActivity({ organizationId, activityId });
          const signed = (pollSign.activity.result as any)?.signTransactionResult?.signedTransaction;
          if (signed) return { signedTransaction: signed };
        }
      }

      if (typeof stamped === 'string' && stamped.startsWith('0x')) {
        return { signedTransaction: stamped };
      }

      throw new Error('STAMPED_ACTIVITY_FAILED: Unable to extract signedTransaction from stamped activity');
    },

    async broadcastSignedTx(chainId: number, signedTransaction: string): Promise<{ txHash: string }> {
      const rpcUrl = getRpcForChain(chainId);
      const provider = new ethers.JsonRpcProvider(rpcUrl);
      const broadcastResponse = await provider.broadcastTransaction(signedTransaction);
      return { txHash: broadcastResponse.hash };
    },
  };
}

function devMockProvider(): MpcProvider {
  const isHostedEnv = isHosted();
  if (isHostedEnv) {
    throw new Error('SECURITY VIOLATION: Dev mock signer forbidden in hosted environment');
  }

  return {
    async createWallet() {
      const mockWallet = ethers.Wallet.createRandom();
      return {
        mpcWalletId: 'mock-mpc-wallet-' + crypto.randomUUID().replace(/-/g, '').slice(0, 12),
        address: mockWallet.address.toLowerCase(),
      };
    },
    async importBegin(userId: string) {
      return {
        importBundle: 'mock_turnkey_import_bundle_' + crypto.randomUUID().replace(/-/g, ''),
        organizationId: 'mock_turnkey_org',
        userId: 'mock_turnkey_user_' + userId,
      };
    },
    async importFinish(userId: string, input: { encryptedBundle: string; name?: string }) {
      const mockWallet = ethers.Wallet.createRandom();
      return {
        mpcWalletId: 'mock-imported-mpc-' + crypto.randomUUID().replace(/-/g, '').slice(0, 12),
        address: mockWallet.address.toLowerCase(),
      };
    },
    async importWallet(_userId: string, input: { mnemonic?: string; privateKey?: string }) {
      let addr = ethers.Wallet.createRandom().address.toLowerCase();
      if (input.privateKey) {
        try {
          addr = ethers.computeAddress(input.privateKey.startsWith('0x') ? input.privateKey : '0x' + input.privateKey).toLowerCase();
        } catch {}
      } else if (input.mnemonic) {

        try {
          const hash = ethers.keccak256(ethers.toUtf8Bytes(input.mnemonic.trim()));
          addr = ethers.computeAddress(hash);
        } catch {}
      }
      return {
        mpcWalletId: 'mock-imported-mpc-' + crypto.randomUUID().replace(/-/g, '').slice(0, 12),
        address: addr,
      };
    },
    async signAndBroadcast(req: SignRequest) {
      if (isHosted() || !allowOrgSign()) {
        throw new Error('ORG_ROOT_SIGN_FORBIDDEN: hosted signing must use stampSignActivity + broadcastSignedTx');
      }

      // Deterministic pseudo-hash for unit testing
      const fakeTxHash = ethers.keccak256(ethers.toUtf8Bytes(req.payloadHash + Date.now().toString()));
      return {
        txHash: fakeTxHash,
        rawTransaction: '0x' + Buffer.from('mock-signed-tx').toString('hex'),
      };
    },
    async createSignActivity(req: SignRequest) {
      if (isHosted()) {
        throw new Error('SECURITY VIOLATION: Dev mock signer forbidden in hosted environment');
      }
      return {
        activityId: 'mock-activity-' + crypto.randomUUID(),
        organizationId: 'mock-org-id',
        unsignedTransaction: '0x02mockunsignedtx',
      };
    },
    async submitStampedActivity(input: { activityId?: string; stampedRequest: unknown }) {
      if (isHosted()) {
        throw new Error('SECURITY VIOLATION: Dev mock signer forbidden in hosted environment');
      }
      const signedTx = (input.stampedRequest as any)?.signedTransaction ||
        (typeof input.stampedRequest === 'string' && input.stampedRequest.startsWith('0x') ? input.stampedRequest : ('0x' + Buffer.from('mock-signed-tx-' + Date.now()).toString('hex')));
      return { signedTransaction: signedTx };
    },
    async broadcastSignedTx(chainId: number, signedTransaction: string): Promise<{ txHash: string }> {
      if (isHosted()) {
        throw new Error('SECURITY VIOLATION: Dev mock signer forbidden in hosted environment');
      }
      const fakeTxHash = ethers.keccak256(ethers.toUtf8Bytes(signedTransaction + Date.now().toString()));
      return { txHash: fakeTxHash };
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
