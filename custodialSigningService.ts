/**
 * LEGACY CUSTODIAL SIGNING SERVICE — PERMANENTLY DISABLED IN PRODUCTION
 * 
 * In accordance with the Northveil Non-Custodial Protocol Specification:
 * Server-held private keys, seed phrase storage, and custodial signing are disabled.
 * All production signing operations MUST use the threshold MPC control plane (src/wallet/mpcAdapter.ts).
 */

export const LEGACY_CUSTODY_DISABLED = true;

export async function createCustodialWallet(userId: string = 'default_user', walletName: string = 'Northveil Vault Wallet') {
  if (process.env.NODE_ENV !== 'test') {
    throw new Error('SECURITY VIOLATION: Custodial wallet creation is permanently disabled. Use non-custodial MPC partitions.');
  }
  return {
    address: '0x0000000000000000000000000000000000000000',
    name: walletName,
    chain_id: 'ethereum',
    wallet_status: 'disabled',
    backupSeedPhrase: '',
  };
}

export async function importCustodialWallet(cleanKey: string, userId: string = 'default_user', walletName: string = 'Imported Wallet') {
  throw new Error('SECURITY VIOLATION: Raw private key imports into server memory are permanently disabled.');
}

export async function createTransactionRequest(params: any) {
  if (process.env.NODE_ENV !== 'test') {
    throw new Error('SECURITY VIOLATION: Legacy custodial transaction requests are disabled. Use prepareTransfer().');
  }
  return {
    success: false,
    error: 'LEGACY_CUSTODY_DISABLED: Use non-custodial prepareTransfer() with MPC and passkeys.',
  };
}

export async function executeCustodialSigning(requestIdOrToken: string) {
  throw new Error('SECURITY VIOLATION: Custodial signing is permanently disabled. Use passkey-verified threshold MPC signing.');
}

export async function logWalletAudit(...args: any[]) {
  // no-op legacy stub
}
