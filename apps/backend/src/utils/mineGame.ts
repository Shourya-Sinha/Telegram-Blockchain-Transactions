import { randomClaimAmount } from './envelopeAllocation';

/** USDT is displayed to two decimal places; use one cent as the game unit. */
export const USDT_CENT_MINOR = 10_000n;
export const MINE_GAME_PORTION_COUNTS = [5, 6, 9] as const;

export function isMineGamePortionCount(value: number): value is (typeof MINE_GAME_PORTION_COUNTS)[number] {
  return MINE_GAME_PORTION_COUNTS.includes(value as (typeof MINE_GAME_PORTION_COUNTS)[number]);
}

/** The final displayed cent digit: 12.36 USDT has digit 6. */
export function lastDisplayedCentDigit(amountMinor: bigint): number {
  if (amountMinor < 0n || amountMinor % USDT_CENT_MINOR !== 0n) {
    throw new Error('Mine-game portions must be non-negative whole cents');
  }
  return Number((amountMinor / USDT_CENT_MINOR) % 10n);
}

/** Allocate a WeChat-style random portion while keeping all amounts cent-exact. */
export function randomMinePortion(remainingMinor: bigint, remainingSlots: number): bigint {
  if (remainingMinor <= 0n || remainingMinor % USDT_CENT_MINOR !== 0n) {
    throw new Error('Mine-game remaining amount must be a positive whole number of cents');
  }
  if (remainingMinor / USDT_CENT_MINOR < BigInt(remainingSlots)) {
    throw new Error('Mine-game must retain at least one cent per unopened portion');
  }
  return randomClaimAmount(remainingMinor / USDT_CENT_MINOR, remainingSlots) * USDT_CENT_MINOR;
}

export function mineHit(amountMinor: bigint, targetDigit: number): boolean {
  if (!Number.isInteger(targetDigit) || targetDigit < 0 || targetDigit > 9) {
    throw new Error('Mine digit must be an integer from 0 to 9');
  }
  return lastDisplayedCentDigit(amountMinor) === targetDigit;
}
