/**
 * Northveil Position Watcher Worker
 * Section 23 of Implementation Specification
 */

import { inMemoryPositions, Position } from '../tools/positions.js';
import { getTokenPrice } from '../read/prices.js';

export interface WatcherResult {
  checked: number;
  triggered: number;
  executed: number;
}

export async function checkPositions(mockPrices?: Record<string, number>): Promise<WatcherResult> {
  const openPositions = Array.from(inMemoryPositions.values()).filter(p => p.status === 'open');
  let triggered = 0;
  let executed = 0;

  for (const pos of openPositions) {
    let currentPrice: number;
    if (mockPrices && mockPrices[pos.baseAsset] !== undefined) {
      currentPrice = mockPrices[pos.baseAsset];
    } else {
      const priceResult = await getTokenPrice(pos.baseAsset);
      currentPrice = priceResult.priceUsd;
    }

    let shouldTrigger = false;

    if (pos.side === 'take_profit' || pos.side === 'limit_sell') {
      // Trigger when price rises to or above target
      if (currentPrice >= pos.triggerPriceUsd) {
        shouldTrigger = true;
      }
    } else if (pos.side === 'stop_loss' || pos.side === 'limit_buy') {
      // Trigger when price falls to or below target
      if (currentPrice <= pos.triggerPriceUsd) {
        shouldTrigger = true;
      }
    }

    if (shouldTrigger) {
      triggered++;
      pos.status = 'triggered';
      // In autonomous mode or with passkey ticket, simulate execution
      pos.status = 'executed';
      executed++;
      inMemoryPositions.set(pos.id, pos);
    }
  }

  return {
    checked: openPositions.length,
    triggered,
    executed,
  };
}
