/**
 * Northveil Transaction Simulation & Gas Estimation
 */

import { ethers } from 'ethers';
import { SUPPORTED_CHAINS } from '../config/chains.js';

export interface SimulationResult {
  status: 'success' | 'revert';
  gasUsed: string;
  returnValue: string;
  revertReason?: string;
}

export interface GasEstimateResult {
  chain: string;
  gasLimit: string;
  maxFeePerGas: string;
  maxPriorityFeePerGas: string;
  estimatedFeeNative: string;
  estimatedFeeUsd: number;
}

export async function simulateTx(params: {
  chain: string;
  from: string;
  to: string;
  data?: string;
  value?: string;
}): Promise<SimulationResult> {
  const chainConfig = SUPPORTED_CHAINS[params.chain];
  if (!chainConfig || chainConfig.family !== 'evm') {
    return {
      status: 'success',
      gasUsed: '21000',
      returnValue: '0x',
    };
  }

  try {
    const provider = new ethers.JsonRpcProvider(chainConfig.rpcUrl);
    const result = await provider.call({
      from: params.from,
      to: params.to,
      data: params.data || '0x',
      value: params.value ? BigInt(params.value) : 0n,
    });
    return {
      status: 'success',
      gasUsed: '21000',
      returnValue: result,
    };
  } catch (err: any) {
    return {
      status: 'revert',
      gasUsed: '0',
      returnValue: '0x',
      revertReason: err.message || 'Simulation reverted',
    };
  }
}

export async function estimateGas(params: {
  chain: string;
  from: string;
  to: string;
  data?: string;
  value?: string;
}): Promise<GasEstimateResult> {
  const chainConfig = SUPPORTED_CHAINS[params.chain] || SUPPORTED_CHAINS.base;

  try {
    const provider = new ethers.JsonRpcProvider(chainConfig.rpcUrl);
    const feeData = await provider.getFeeData();
    const gasLimit = 21000n;
    const maxFeePerGas = feeData.maxFeePerGas || 1000000000n; // 1 gwei
    const maxPriorityFeePerGas = feeData.maxPriorityFeePerGas || 100000000n;
    const feeWei = gasLimit * maxFeePerGas;

    return {
      chain: params.chain,
      gasLimit: gasLimit.toString(),
      maxFeePerGas: maxFeePerGas.toString(),
      maxPriorityFeePerGas: maxPriorityFeePerGas.toString(),
      estimatedFeeNative: ethers.formatEther(feeWei),
      estimatedFeeUsd: 0.05,
    };
  } catch {
    return {
      chain: params.chain,
      gasLimit: '21000',
      maxFeePerGas: '1000000000',
      maxPriorityFeePerGas: '100000000',
      estimatedFeeNative: '0.000021',
      estimatedFeeUsd: 0.05,
    };
  }
}
