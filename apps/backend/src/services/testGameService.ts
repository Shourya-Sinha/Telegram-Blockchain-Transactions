import { randomUUID } from 'node:crypto';
import { prisma } from '../lib/prisma';
import { config } from '../config';
import { AppError } from '../utils/errors';
import { calculateTestPayouts, calculateTurnoverCommission, DEFAULT_TEST_GAME_PROFILES, formatTestUnits, normalizeOddsEntries, outcomesForRound, parseMultiplierHundredths, parseTestUnits, type TestGamePayoutPolicy, type TestGameVariant } from '../utils/testGames';
import { debitWallet, writeAudit } from './ledgerService';

const db = prisma as any;
const TEST_BET_REFERENCE = 'TEST_GAME_BET';
const MAX_TEST_STAKE_MINOR = 1_000_000_000_000n; // cap at 1,000,000 test USDT

type TestProfileRow = {
  id: string;
  key: string;
  name: string;
  stakeMinMinor: bigint;
  stakeMaxMinor: bigint;
  odds: unknown;
  active: boolean;
};

type TestRoundRow = {
  id: string;
  profileId: string;
  profileName: string;
  stakeMinMinor: bigint;
  stakeMaxMinor: bigint;
  oddsSnapshot: unknown;
  variant: TestGameVariant;
  packetCount: number;
  targetDigit: number;
  status: 'OPEN' | 'SETTLED';
  outcomeKey: string | null;
  payoutPolicySelected: TestGamePayoutPolicy | null;
  payoutPolicyApprovalReference: string | null;
  createdAt: Date;
  settledAt: Date | null;
};

export function assertTestGamesEnabled(): void {
  if (config.fundsMode !== 'test') {
    throw new AppError(403, 'Test games and agent commission are available only while FUNDS_MODE=test. Real-funds game play is disabled.', 'TEST_GAMES_DISABLED');
  }
}

function normalizeProfile(profile: TestProfileRow) {
  let odds;
  try { odds = normalizeOddsEntries(profile.odds); }
  catch { throw new AppError(409, `Profile “${profile.name}” has an invalid odds table`, 'TEST_GAME_PROFILE_ODDS_INVALID'); }
  return { ...profile, odds };
}

export async function ensureDefaultTestGameProfiles(): Promise<void> {
  assertTestGamesEnabled();
  for (const preset of DEFAULT_TEST_GAME_PROFILES) {
    const stakeMinMinor = parseTestUnits(preset.stakeMinUnits);
    const stakeMaxMinor = parseTestUnits(preset.stakeMaxUnits);
    await db.testGameProfile.upsert({
      where: { key: preset.key },
      update: {},
      create: {
        key: preset.key,
        name: preset.name,
        stakeMinMinor,
        stakeMaxMinor,
        odds: preset.odds,
        active: true
      }
    });
  }
}

export async function listTestGameProfiles() {
  await ensureDefaultTestGameProfiles();
  const rows = await db.testGameProfile.findMany({ orderBy: { key: 'asc' } }) as TestProfileRow[];
  return rows.map(normalizeProfile);
}

export async function updateTestGameProfile(
  profileId: string,
  input: { name: string; stakeMin: string; stakeMax: string; odds: unknown; active: boolean },
  adminId: string,
  ipAddress?: string
) {
  await ensureDefaultTestGameProfiles();
  const before = await db.testGameProfile.findUnique({ where: { id: profileId } }) as TestProfileRow | null;
  if (!before) throw new AppError(404, 'Test game profile not found', 'TEST_GAME_PROFILE_NOT_FOUND');
  const stakeMinMinor = parseTestUnits(input.stakeMin);
  const stakeMaxMinor = parseTestUnits(input.stakeMax);
  if (stakeMaxMinor < stakeMinMinor) throw new AppError(400, 'Maximum stake must be greater than or equal to the minimum stake', 'TEST_GAME_STAKE_RANGE_INVALID');
  if (stakeMaxMinor > MAX_TEST_STAKE_MINOR) throw new AppError(400, 'Maximum test stake cannot exceed 1,000,000 USDT', 'TEST_GAME_STAKE_RANGE_INVALID');
  const odds = normalizeOddsEntries(input.odds);
  const updated = await db.testGameProfile.update({
    where: { id: profileId },
    data: { name: input.name.trim(), stakeMinMinor, stakeMaxMinor, odds, active: input.active }
  });
  await prisma.auditLog.create({ data: {
    actorId: adminId,
    action: 'TEST_GAME_PROFILE_UPDATED',
    entityType: 'TestGameProfile',
    entityId: profileId,
    before: { name: before.name, stakeMinMinor: before.stakeMinMinor.toString(), stakeMaxMinor: before.stakeMaxMinor.toString(), odds: before.odds, active: before.active } as any,
    after: { name: updated.name, stakeMinMinor: stakeMinMinor.toString(), stakeMaxMinor: stakeMaxMinor.toString(), odds, active: input.active } as any,
    ipAddress
  } });
  return normalizeProfile(updated as TestProfileRow);
}

function assertVariantPacketCount(variant: TestGameVariant, packetCount: number): void {
  if ((variant === 'SINGLE_MINE' && ![5, 6, 9].includes(packetCount))
    || (variant === 'CHAIN_MINE' && ![5, 6].includes(packetCount))
    || (variant === 'NINE_MULTI_MINE' && packetCount !== 9)) {
    throw new AppError(400, 'That game mode is not available for the selected packet count', 'TEST_GAME_CONFIGURATION_INVALID');
  }
}

export async function createTestGameRound(
  input: { profileId: string; variant: TestGameVariant; packetCount: number; targetDigit: number },
  adminId: string,
  ipAddress?: string
) {
  await ensureDefaultTestGameProfiles();
  assertVariantPacketCount(input.variant, input.packetCount);
  const profile = await db.testGameProfile.findUnique({ where: { id: input.profileId } }) as TestProfileRow | null;
  if (!profile || !profile.active) throw new AppError(404, 'Active test game profile not found', 'TEST_GAME_PROFILE_NOT_FOUND');
  const normalized = normalizeProfile(profile);
  const applicableOdds = outcomesForRound(normalized.odds, input.variant, input.packetCount);
  if (!applicableOdds.length) throw new AppError(400, 'This profile has no odds configured for the selected game mode', 'TEST_GAME_ODDS_MISSING');
  const id = randomUUID();
  const round = await db.testGameRound.create({
    data: {
      id,
      profileId: normalized.id,
      profileName: normalized.name,
      stakeMinMinor: normalized.stakeMinMinor,
      stakeMaxMinor: normalized.stakeMaxMinor,
      oddsSnapshot: normalized.odds,
      variant: input.variant,
      packetCount: input.packetCount,
      targetDigit: input.targetDigit,
      createdByAdminId: adminId
    }
  });
  await prisma.auditLog.create({ data: {
    actorId: adminId,
    action: 'TEST_GAME_ROUND_OPENED',
    entityType: 'TestGameRound',
    entityId: id,
    after: { profileId: profile.id, profileName: profile.name, variant: input.variant, packetCount: input.packetCount, targetDigit: input.targetDigit } as any,
    ipAddress
  } });
  return round;
}

export async function listAdminTestGameRounds(limit = 50) {
  assertTestGamesEnabled();
  const rounds = await db.testGameRound.findMany({
    include: {
      bets: { orderBy: { createdAt: 'asc' }, include: { user: { select: { id: true, telegramId: true, username: true, firstName: true } }, agent: { include: { user: { select: { firstName: true, username: true } } } } } },
      _count: { select: { bets: true } }
    },
    orderBy: { createdAt: 'desc' },
    take: Math.min(Math.max(limit, 1), 100)
  });
  return rounds.map((round: any) => ({ ...round, oddsSnapshot: normalizeOddsEntries(round.oddsSnapshot) }));
}

export async function listOpenTestGameRounds() {
  assertTestGamesEnabled();
  const rounds = await db.testGameRound.findMany({
    where: { status: 'OPEN' },
    include: { _count: { select: { bets: true } } },
    orderBy: { createdAt: 'asc' },
    take: 50
  });
  return rounds.map((round: any) => ({
    id: round.id,
    profileName: round.profileName,
    stakeMinMinor: round.stakeMinMinor,
    stakeMaxMinor: round.stakeMaxMinor,
    variant: round.variant,
    packetCount: round.packetCount,
    targetDigit: round.targetDigit,
    status: round.status,
    createdAt: round.createdAt,
    betCount: round._count.bets,
    odds: outcomesForRound(normalizeOddsEntries(round.oddsSnapshot), round.variant, round.packetCount)
  }));
}

export async function placeTestGameBet(
  userId: string,
  input: { roundId: string; outcomeKey: string; stake: string }
) {
  assertTestGamesEnabled();
  const stakeMinor = parseTestUnits(input.stake);
  const round = await db.testGameRound.findUnique({ where: { id: input.roundId } }) as TestRoundRow | null;
  if (!round) throw new AppError(404, 'Game round not found', 'TEST_GAME_ROUND_NOT_FOUND');
  if (round.status !== 'OPEN') throw new AppError(409, 'This test game round is closed', 'TEST_GAME_ROUND_CLOSED');
  if (stakeMinor < round.stakeMinMinor || stakeMinor > round.stakeMaxMinor) {
    throw new AppError(400, `Stake must be between ${formatTestUnits(round.stakeMinMinor)} and ${formatTestUnits(round.stakeMaxMinor)} test USDT`, 'TEST_GAME_STAKE_OUT_OF_RANGE');
  }
  const odds = outcomesForRound(normalizeOddsEntries(round.oddsSnapshot), round.variant, round.packetCount);
  const selectedOdds = odds.find((row) => row.outcomeKey === input.outcomeKey);
  if (!selectedOdds) throw new AppError(400, 'Selected outcome is not part of this round', 'TEST_GAME_OUTCOME_INVALID');
  const user = await db.user.findUnique({
    where: { id: userId },
    select: { id: true, referredByAgent: { select: { id: true, commissionRateBps: true, active: true } } }
  });
  if (!user) throw new AppError(404, 'Player not found', 'USER_NOT_FOUND');
  const agent = user.referredByAgent;
  const agentId = agent?.id ?? null;
  const commissionRateBps = agent?.active ? agent.commissionRateBps : 0;
  const agentCommissionMinor = agentId ? calculateTurnoverCommission(stakeMinor, commissionRateBps) : 0n;
  const multiplierHundredths = parseMultiplierHundredths(selectedOdds.multiplier);
  const betId = randomUUID();
  const result = await (prisma as any).$transaction(async (tx: any) => {
    const lockedRounds = await tx.$queryRawUnsafe(
      'SELECT "id" FROM "TestGameRound" WHERE "id" = $1::uuid AND "status" = \'OPEN\' FOR UPDATE',
      input.roundId
    ) as Array<{ id: string }>;
    if (!lockedRounds.length) throw new AppError(409, 'This test game round is closed', 'TEST_GAME_ROUND_CLOSED');
    await debitWallet(tx, userId, stakeMinor, 'GAME_STAKE', TEST_BET_REFERENCE, betId);
    return tx.testGameBet.create({ data: {
      id: betId,
      roundId: input.roundId,
      userId,
      agentId,
      outcomeKey: selectedOdds.outcomeKey,
      stakeMinor,
      multiplierHundredths,
      agentCommissionRateBps: commissionRateBps,
      agentCommissionMinor
    } });
  });
  const quote = calculateTestPayouts(stakeMinor, multiplierHundredths, true);
  return {
    bet: result,
    potentialPayouts: {
      multiplierIncludesStakeMinor: quote.payoutMultiplierIncludesStake,
      multiplierIsProfitMinor: quote.payoutMultiplierIsProfit,
      policy: 'SHOW_BOTH' as const
    }
  };
}

export async function listMyTestGameBets(userId: string, limit = 50) {
  assertTestGamesEnabled();
  return db.testGameBet.findMany({
    where: { userId },
    include: { round: { select: { profileName: true, variant: true, packetCount: true, targetDigit: true, status: true, outcomeKey: true, payoutPolicySelected: true, payoutPolicyApprovalReference: true, createdAt: true, settledAt: true } } },
    orderBy: { createdAt: 'desc' },
    take: Math.min(Math.max(limit, 1), 100)
  });
}

export async function settleTestGameRound(
  roundId: string,
  outcomeKey: string,
  adminId: string,
  ipAddress?: string
) {
  assertTestGamesEnabled();
  return (prisma as any).$transaction(async (tx: any) => {
    const lockedRounds = await tx.$queryRawUnsafe(
      'SELECT "id" FROM "TestGameRound" WHERE "id" = $1::uuid FOR UPDATE',
      roundId
    ) as Array<{ id: string }>;
    if (!lockedRounds.length) throw new AppError(404, 'Game round not found', 'TEST_GAME_ROUND_NOT_FOUND');
    const round = await tx.testGameRound.findUnique({ where: { id: roundId } }) as TestRoundRow | null;
    if (!round) throw new AppError(404, 'Game round not found', 'TEST_GAME_ROUND_NOT_FOUND');
    if (round.status !== 'OPEN') throw new AppError(409, 'This round has already been settled', 'TEST_GAME_ROUND_ALREADY_SETTLED');
    const odds = outcomesForRound(normalizeOddsEntries(round.oddsSnapshot), round.variant, round.packetCount);
    if (!odds.some((row) => row.outcomeKey === outcomeKey)) throw new AppError(400, 'Outcome is not configured for this round', 'TEST_GAME_OUTCOME_INVALID');
    const bets = await tx.testGameBet.findMany({ where: { roundId }, orderBy: { createdAt: 'asc' } });
    let winCount = 0;
    for (const bet of bets) {
      const isWin = bet.outcomeKey === outcomeKey;
      const payouts = calculateTestPayouts(bet.stakeMinor, bet.multiplierHundredths, isWin);
      if (isWin) winCount++;
      await tx.testGameBet.update({ where: { id: bet.id }, data: {
        isWin,
        payoutIncludesStakeMinor: payouts.payoutMultiplierIncludesStake,
        payoutIsProfitMinor: payouts.payoutMultiplierIsProfit,
        netIncludesStakeMinor: payouts.netMultiplierIncludesStake,
        netIsProfitMinor: payouts.netMultiplierIsProfit
      } });
    }
    const settled = await tx.testGameRound.update({ where: { id: roundId }, data: { status: 'SETTLED', outcomeKey, settledAt: new Date() } });
    await writeAudit(tx, {
      actorId: adminId,
      action: 'TEST_GAME_ROUND_SETTLED',
      entityType: 'TestGameRound',
      entityId: roundId,
      before: { status: round.status },
      after: { status: 'SETTLED', outcomeKey, betCount: bets.length, winCount },
      ipAddress
    });
    return { round: settled, betCount: bets.length, winCount, lossCount: bets.length - winCount };
  });
}

export async function confirmManualPayoutPolicy(
  roundId: string,
  policy: TestGamePayoutPolicy,
  approvalReference: string,
  adminId: string,
  ipAddress?: string
) {
  assertTestGamesEnabled();
  if (policy === 'SHOW_BOTH') throw new AppError(400, 'Choose one boss-approved payout basis before recording manual payments', 'PAYOUT_POLICY_NOT_PAYABLE');
  const reference = approvalReference.trim();
  if (reference.length < 3 || reference.length > 200) throw new AppError(400, 'Enter the boss decision reference (3–200 characters)', 'PAYOUT_APPROVAL_REFERENCE_REQUIRED');
  return (prisma as any).$transaction(async (tx: any) => {
    const rows = await tx.$queryRawUnsafe('SELECT "id" FROM "TestGameRound" WHERE "id" = $1::uuid FOR UPDATE', roundId) as Array<{ id: string }>;
    if (!rows.length) throw new AppError(404, 'Game round not found', 'TEST_GAME_ROUND_NOT_FOUND');
    const round = await tx.testGameRound.findUnique({ where: { id: roundId }, include: { bets: true } });
    if (!round || round.status !== 'SETTLED') throw new AppError(409, 'Settle the round before choosing a manual payout basis', 'TEST_GAME_ROUND_NOT_SETTLED');
    if (round.payoutPolicySelected && round.payoutPolicySelected !== policy) {
      throw new AppError(409, 'A payout interpretation is already locked for this round and cannot be changed', 'PAYOUT_POLICY_LOCKED');
    }
    if (round.payoutPolicySelected === policy) return round;
    const paid = round.bets.some((bet: any) => bet.manualPayoutAt);
    if (paid) throw new AppError(409, 'A manual payment has already been recorded; the payout basis cannot be changed', 'PAYOUT_POLICY_LOCKED');
    for (const bet of round.bets as any[]) {
      await tx.testGameBet.update({
        where: { id: bet.id },
        data: { selectedPayoutMinor: bet.isWin ? (policy === 'MULTIPLIER_INCLUDES_STAKE' ? bet.payoutIncludesStakeMinor : bet.payoutIsProfitMinor) : null }
      });
    }
    const updated = await tx.testGameRound.update({ where: { id: roundId }, data: { payoutPolicySelected: policy, payoutPolicyApprovalReference: reference } });
    await writeAudit(tx, {
      actorId: adminId,
      action: 'TEST_GAME_PAYOUT_POLICY_APPROVED',
      entityType: 'TestGameRound',
      entityId: roundId,
      before: { payoutPolicySelected: null },
      after: { payoutPolicySelected: policy, approvalReference: reference },
      ipAddress
    });
    return updated;
  });
}

export async function recordManualTestPayout(
  betId: string,
  transferReference: string,
  adminId: string,
  ipAddress?: string
) {
  assertTestGamesEnabled();
  const reference = transferReference.trim();
  if (reference.length < 3 || reference.length > 200) throw new AppError(400, 'Enter a manual transfer reference (3–200 characters)', 'MANUAL_PAYOUT_REFERENCE_REQUIRED');
  return (prisma as any).$transaction(async (tx: any) => {
    const rows = await tx.$queryRawUnsafe('SELECT "id" FROM "TestGameBet" WHERE "id" = $1::uuid FOR UPDATE', betId) as Array<{ id: string }>;
    if (!rows.length) throw new AppError(404, 'Game bet not found', 'TEST_GAME_BET_NOT_FOUND');
    const bet = await tx.testGameBet.findUnique({ where: { id: betId }, include: { round: true } });
    if (!bet) throw new AppError(404, 'Game bet not found', 'TEST_GAME_BET_NOT_FOUND');
    if (bet.round.status !== 'SETTLED' || !bet.round.payoutPolicySelected || !bet.selectedPayoutMinor) {
      throw new AppError(409, 'Only winning bets with a boss-approved payout basis can be marked as manually paid', 'MANUAL_PAYOUT_NOT_READY');
    }
    if (bet.manualPayoutAt) throw new AppError(409, 'A manual transfer is already recorded for this winning bet', 'MANUAL_PAYOUT_ALREADY_RECORDED');
    const updated = await tx.testGameBet.update({ where: { id: betId }, data: { manualPayoutReference: reference, manualPayoutAt: new Date(), manualPayoutByAdminId: adminId } });
    await writeAudit(tx, {
      actorId: adminId,
      action: 'TEST_GAME_MANUAL_PAYOUT_RECORDED',
      entityType: 'TestGameBet',
      entityId: betId,
      after: { amountMinor: bet.selectedPayoutMinor.toString(), policy: bet.round.payoutPolicySelected, transferReference: reference },
      ipAddress
    });
    return updated;
  });
}
