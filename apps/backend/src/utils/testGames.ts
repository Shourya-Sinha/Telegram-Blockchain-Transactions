export type TestGameVariant = 'SINGLE_MINE' | 'CHAIN_MINE' | 'NINE_MULTI_MINE';
export type TestGamePayoutPolicy = 'SHOW_BOTH' | 'MULTIPLIER_INCLUDES_STAKE' | 'MULTIPLIER_IS_PROFIT';

export interface TestGameOddsEntry {
  variant: TestGameVariant;
  packetCount: 5 | 6 | 9;
  outcomeKey: string;
  label: string;
  /** Effective reward multiplier used by the provisional test calculation. */
  multiplier: string;
  /** The posters show a separate base rate for 9-packet multi-mine. */
  baseMultiplier?: string;
  /** Marks values inferred from the poster's “and so on” wording. */
  inferred?: boolean;
  groupKey?: string;
}

export interface TestGameProfilePreset {
  key: string;
  name: string;
  stakeMinUnits: string;
  stakeMaxUnits: string;
  odds: TestGameOddsEntry[];
}

const entries = (
  variant: TestGameVariant,
  packetCount: 5 | 6 | 9,
  rows: Array<[string, string, string]>
): TestGameOddsEntry[] => rows.map(([outcomeKey, label, multiplier]) => ({ variant, packetCount, outcomeKey, label, multiplier }));

const multiEntries = (
  groupKey: string,
  groupLabel: string,
  baseMultiplier: string | undefined,
  rows: Array<[number, string, boolean]>
): TestGameOddsEntry[] => rows.map(([hits, multiplier, inferred]) => ({
  variant: 'NINE_MULTI_MINE', packetCount: 9,
  outcomeKey: `${groupKey}_HITS_${hits}`,
  label: `${groupLabel} · ${hits} hits`,
  multiplier,
  ...(baseMultiplier ? { baseMultiplier } : {}),
  ...(inferred ? { inferred: true } : {}),
  groupKey
}));

/** Provisional, editable test presets transcribed from the two supplied posters. */
export const DEFAULT_TEST_GAME_PROFILES: TestGameProfilePreset[] = [
  {
    key: 'poster_daxiaojie',
    name: 'Poster 1 · 大小姐',
    stakeMinUnits: '30',
    stakeMaxUnits: '1000',
    odds: [
      ...entries('SINGLE_MINE', 5, [['HITS_1', '1 hit', '2.0'], ['HITS_2', '2 hits', '3.2'], ['HITS_3', '3 hits', '5.0'], ['HITS_4', '4 hits', '10'], ['HITS_5', '5 hits', '15']]),
      ...entries('CHAIN_MINE', 5, [['CHAIN_2_OF_2', '2 of 2', '4.0'], ['CHAIN_3_OF_3', '3 of 3', '20'], ['CHAIN_4_OF_4', '4 of 4', '40'], ['CHAIN_5_OF_5', '5 of 5', '50']]),
      ...entries('SINGLE_MINE', 6, [['HITS_1', '1 hit', '1.5'], ['HITS_2', '2 hits', '3.0'], ['HITS_3', '3 hits', '4.5'], ['HITS_4', '4 hits', '8.0'], ['HITS_5', '5 hits', '12'], ['HITS_6', '6 hits', '20']]),
      ...entries('CHAIN_MINE', 6, [['CHAIN_2_OF_2', '2 of 2', '3.0'], ['CHAIN_3_OF_3', '3 of 3', '12'], ['CHAIN_4_OF_4', '4 of 4', '25'], ['CHAIN_5_OF_5', '5 of 5', '45'], ['CHAIN_6_OF_6', '6 of 6', '65']]),
      ...entries('SINGLE_MINE', 9, [['HITS_1', '1 hit', '1.0'], ['HITS_2', '2 hits', '1.5'], ['HITS_3', '3 hits', '2.5'], ['HITS_4', '4 hits', '3.5'], ['HITS_5', '5 hits', '5.5'], ['HITS_6', '6 hits', '7.5']]),
      ...multiEntries('M2', '2 mines', '1.01', [[6, '1.0', false], [7, '2.0', false], [8, '3.0', true], [9, '4.0', true]]),
      ...multiEntries('M3', '3 mines', '1.30', [[7, '0.5', false], [8, '1.0', false], [9, '1.5', true]]),
      ...multiEntries('M4', '4 mines', '1.73', [[8, '1.0', false], [9, '2.0', false]]),
      ...multiEntries('M5', '5 mines', undefined, [[5, '18.2', false]]),
      ...multiEntries('M6', '6 mines', undefined, [[6, '28', false]]),
      ...multiEntries('M7', '7 mines', undefined, [[7, '50', false]]),
      ...multiEntries('M8', '8 mines', undefined, [[8, '70', false]]),
      ...multiEntries('M9', '9 mines', undefined, [[9, '100', false]])
    ]
  },
  {
    key: 'poster_rongyao',
    name: 'Poster 2 · 荣耀',
    stakeMinUnits: '20',
    stakeMaxUnits: '500',
    odds: [
      ...entries('SINGLE_MINE', 5, [['HITS_1', '1 hit', '2.0'], ['HITS_2', '2 hits', '3.2'], ['HITS_3', '3 hits', '6.0'], ['HITS_4', '4 hits', '10'], ['HITS_5', '5 hits', '15']]),
      ...entries('CHAIN_MINE', 5, [['CHAIN_2_OF_2', '2 of 2', '5.0'], ['CHAIN_3_OF_3', '3 of 3', '20'], ['CHAIN_4_OF_4', '4 of 4', '35'], ['CHAIN_5_OF_5', '5 of 5', '50']]),
      ...entries('SINGLE_MINE', 6, [['HITS_1', '1 hit', '1.5'], ['HITS_2', '2 hits', '2.8'], ['HITS_3', '3 hits', '5.0'], ['HITS_4', '4 hits', '8.0'], ['HITS_5', '5 hits', '12'], ['HITS_6', '6 hits', '20']]),
      ...entries('CHAIN_MINE', 6, [['CHAIN_2_OF_2', '2 of 2', '3.0'], ['CHAIN_3_OF_3', '3 of 3', '13.15'], ['CHAIN_4_OF_4', '4 of 4', '28'], ['CHAIN_5_OF_5', '5 of 5', '40'], ['CHAIN_6_OF_6', '6 of 6', '60']]),
      ...multiEntries('M2', '2 mines', '1.02', [[6, '1.0', false], [7, '2.0', false], [8, '3.0', true], [9, '4.0', true]]),
      ...multiEntries('M3', '3 mines', '1.30', [[7, '1.0', false], [8, '2.0', false], [9, '3.0', true]]),
      ...multiEntries('M4', '4 mines', '1.80', [[8, '1.0', false], [9, '2.0', false]]),
      ...multiEntries('M5', '5 mines', undefined, [[5, '19', false]]),
      ...multiEntries('M6', '6 mines', undefined, [[6, '28', false]]),
      ...multiEntries('M7', '7 mines', undefined, [[7, '50', false]]),
      ...multiEntries('M8', '8 mines', undefined, [[8, '70', false]]),
      ...multiEntries('M9', '9 mines', undefined, [[9, '100', false]])
    ]
  }
];

const USDT_SCALE = 1_000_000n;

export function parseTestUnits(value: string): bigint {
  const normalized = value.trim();
  if (normalized.length > 32 || !/^\d+(\.\d{1,6})?$/.test(normalized)) throw new Error('Enter a positive amount with at most six decimal places');
  const [whole, fraction = ''] = normalized.split('.');
  const minor = BigInt(whole) * USDT_SCALE + BigInt(fraction.padEnd(6, '0'));
  if (minor <= 0n) throw new Error('Test stake must be greater than zero');
  return minor;
}

export function formatTestUnits(minor: bigint): string {
  const negative = minor < 0n;
  const absolute = negative ? -minor : minor;
  const fraction = (absolute % USDT_SCALE).toString().padStart(6, '0').replace(/0+$/, '');
  return `${negative ? '-' : ''}${absolute / USDT_SCALE}${fraction ? `.${fraction}` : ''}`;
}

/** Multipliers use hundredths: 2.00x -> 200; 13.15x -> 1315. */
export function parseMultiplierHundredths(value: string): number {
  const normalized = value.trim();
  if (!/^\d+(\.\d{1,2})?$/.test(normalized)) throw new Error('Multiplier must be a positive number with at most two decimals');
  const [whole, fraction = ''] = normalized.split('.');
  const multiplier = Number(BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0')));
  if (!Number.isSafeInteger(multiplier) || multiplier <= 0 || multiplier > 1_000_000) throw new Error('Multiplier is outside the supported range');
  return multiplier;
}

function roundHalfUp(numerator: bigint, denominator: bigint): bigint {
  return (numerator + denominator / 2n) / denominator;
}

export function calculateTestPayouts(stakeMinor: bigint, multiplierHundredths: number, won: boolean) {
  if (stakeMinor <= 0n) throw new Error('Stake must be positive');
  if (!Number.isSafeInteger(multiplierHundredths) || multiplierHundredths <= 0) throw new Error('Multiplier must be positive');
  const multiplierProfitMinor = roundHalfUp(stakeMinor * BigInt(multiplierHundredths), 100n);
  const payoutMultiplierIncludesStake = won ? multiplierProfitMinor : 0n;
  const payoutMultiplierIsProfit = won ? stakeMinor + multiplierProfitMinor : 0n;
  return {
    payoutMultiplierIncludesStake,
    payoutMultiplierIsProfit,
    netMultiplierIncludesStake: payoutMultiplierIncludesStake - stakeMinor,
    netMultiplierIsProfit: payoutMultiplierIsProfit - stakeMinor
  };
}

export function calculateTurnoverCommission(stakeMinor: bigint, commissionBps: number): bigint {
  if (stakeMinor < 0n || !Number.isInteger(commissionBps) || commissionBps < 0 || commissionBps > 10_000) {
    throw new Error('Invalid turnover commission inputs');
  }
  return (stakeMinor * BigInt(commissionBps)) / 10_000n;
}

export function normalizeOddsEntries(value: unknown): TestGameOddsEntry[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > 200) throw new Error('Odds table must contain 1–200 outcomes');
  const seen = new Set<string>();
  return value.map((raw) => {
    if (typeof raw !== 'object' || raw === null) throw new Error('Invalid odds row');
    const row = raw as Record<string, unknown>;
    const variant = row.variant;
    const packetCount = row.packetCount;
    const outcomeKey = typeof row.outcomeKey === 'string' ? row.outcomeKey.trim() : '';
    const label = typeof row.label === 'string' ? row.label.trim() : '';
    const multiplier = typeof row.multiplier === 'string' ? row.multiplier.trim() : String(row.multiplier ?? '');
    const baseMultiplier = row.baseMultiplier === undefined || row.baseMultiplier === null || row.baseMultiplier === ''
      ? undefined
      : typeof row.baseMultiplier === 'string' ? row.baseMultiplier.trim() : String(row.baseMultiplier);
    const groupKey = row.groupKey === undefined || row.groupKey === null || row.groupKey === ''
      ? undefined
      : typeof row.groupKey === 'string' ? row.groupKey.trim() : '';
    if (!['SINGLE_MINE', 'CHAIN_MINE', 'NINE_MULTI_MINE'].includes(String(variant))) throw new Error('Invalid game variant');
    if (![5, 6, 9].includes(Number(packetCount))) throw new Error('Packet count must be 5, 6, or 9');
    if (variant === 'CHAIN_MINE' && ![5, 6].includes(Number(packetCount))) throw new Error('Chain mine supports only 5 or 6 packets');
    if (variant === 'NINE_MULTI_MINE' && Number(packetCount) !== 9) throw new Error('Multi-mine supports only 9 packets');
    if (!/^[A-Z0-9_]{1,40}$/.test(outcomeKey) || !label || label.length > 100) throw new Error('Invalid outcome key or label');
    const multiplierHundredths = parseMultiplierHundredths(multiplier);
    if (baseMultiplier !== undefined) parseMultiplierHundredths(baseMultiplier);
    if (groupKey !== undefined && !/^[A-Z0-9_]{1,40}$/.test(groupKey)) throw new Error('Invalid odds group key');
    const uniqueKey = `${variant}:${packetCount}:${outcomeKey}`;
    if (seen.has(uniqueKey)) throw new Error('Duplicate outcome key');
    seen.add(uniqueKey);
    return {
      variant: variant as TestGameVariant,
      packetCount: Number(packetCount) as 5 | 6 | 9,
      outcomeKey,
      label,
      multiplier: (multiplierHundredths / 100).toFixed(2),
      ...(baseMultiplier === undefined ? {} : { baseMultiplier: (parseMultiplierHundredths(baseMultiplier) / 100).toFixed(2) }),
      ...(typeof row.inferred === 'boolean' && row.inferred ? { inferred: true } : {}),
      ...(groupKey ? { groupKey } : {})
    };
  });
}

export function outcomesForRound(odds: TestGameOddsEntry[], variant: TestGameVariant, packetCount: number) {
  return odds.filter((row) => row.variant === variant && row.packetCount === packetCount);
}
