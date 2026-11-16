import { randomBytes } from 'node:crypto';
import { prisma } from '../lib/prisma';
import { config } from '../config';
import { AppError } from '../utils/errors';
import { assertTestGamesEnabled } from './testGameService';

const db = prisma as any;

type AgentPlayerRow = {
  userId: string;
  telegramId: string;
  firstName: string;
  username: string | null;
  turnoverMinor: bigint;
  wins: number;
  losses: number;
  pendingBets: number;
  netIncludesStakeMinor: bigint;
  netIsProfitMinor: bigint;
  commissionMinor: bigint;
};

function inviteUrl(inviteCode: string): string {
  if (config.telegramBotUsername) {
    const bot = encodeURIComponent(config.telegramBotUsername);
    const payload = encodeURIComponent(`agent_${inviteCode}`);
    if (config.telegramMiniAppShortName) {
      return `https://t.me/${bot}/${encodeURIComponent(config.telegramMiniAppShortName)}?startapp=${payload}`;
    }
    return `https://t.me/${bot}?start=${payload}`;
  }
  const url = new URL(config.publicAppUrl);
  url.searchParams.set('ref', inviteCode);
  return url.toString();
}

function agentCode(): string {
  return randomBytes(6).toString('hex').toUpperCase();
}

export async function createAgentForTelegramId(
  telegramIdText: string,
  adminId: string,
  input: { commissionRateBps?: number; active?: boolean } = {},
  ipAddress?: string
) {
  assertTestGamesEnabled();
  const telegramId = BigInt(telegramIdText);
  if (telegramId <= 0n || telegramId > 9_223_372_036_854_775_807n) throw new AppError(400, 'Telegram ID is outside the supported range', 'TELEGRAM_ID_INVALID');
  const user = await db.user.findUnique({ where: { telegramId }, select: { id: true, telegramId: true, firstName: true, username: true, status: true } });
  if (!user) throw new AppError(404, 'Player must open the Mini App or bot once before being added as an agent', 'AGENT_USER_NOT_FOUND');
  if (user.status !== 'ACTIVE') throw new AppError(409, 'A banned Telegram account cannot be made an agent', 'AGENT_USER_INACTIVE');
  const rate = input.commissionRateBps ?? 0;
  if (!Number.isInteger(rate) || rate < 0 || rate > 10_000) throw new AppError(400, 'Commission rate must be between 0 and 100 percent', 'AGENT_COMMISSION_RATE_INVALID');
  const existing = await db.agent.findUnique({ where: { userId: user.id } });
  if (existing) throw new AppError(409, 'This Telegram user is already an agent', 'AGENT_ALREADY_EXISTS');
  const code = agentCode();
  const agent = await db.agent.create({ data: {
    userId: user.id,
    inviteCode: code,
    commissionRateBps: rate,
    active: input.active ?? true
  } });
  await prisma.auditLog.create({ data: {
    actorId: adminId,
    action: 'AGENT_CREATED',
    entityType: 'Agent',
    entityId: agent.id,
    after: { userId: user.id, telegramId: telegramIdText, inviteCode: code, commissionRateBps: rate, active: input.active ?? true } as any,
    ipAddress
  } });
  return { ...agent, user, inviteUrl: inviteUrl(code) };
}

export async function updateAgent(
  agentId: string,
  input: { commissionRateBps: number; active: boolean },
  adminId: string,
  ipAddress?: string
) {
  assertTestGamesEnabled();
  if (!Number.isInteger(input.commissionRateBps) || input.commissionRateBps < 0 || input.commissionRateBps > 10_000) {
    throw new AppError(400, 'Commission rate must be between 0 and 100 percent', 'AGENT_COMMISSION_RATE_INVALID');
  }
  const before = await db.agent.findUnique({ where: { id: agentId } });
  if (!before) throw new AppError(404, 'Agent not found', 'AGENT_NOT_FOUND');
  const updated = await db.agent.update({ where: { id: agentId }, data: input });
  await prisma.auditLog.create({ data: {
    actorId: adminId,
    action: 'AGENT_UPDATED',
    entityType: 'Agent',
    entityId: agentId,
    before: { commissionRateBps: before.commissionRateBps, active: before.active },
    after: input,
    ipAddress
  } });
  return updated;
}

async function agentPlayerStats(agentId: string): Promise<AgentPlayerRow[]> {
  return prisma.$queryRawUnsafe(`
    SELECT
      u."id"::text AS "userId",
      u."telegramId"::text AS "telegramId",
      u."firstName" AS "firstName",
      u."username" AS "username",
      COALESCE(SUM(b."stakeMinor"), 0)::bigint AS "turnoverMinor",
      COUNT(b."id") FILTER (WHERE b."isWin" = TRUE)::int AS "wins",
      COUNT(b."id") FILTER (WHERE b."isWin" = FALSE)::int AS "losses",
      COUNT(b."id") FILTER (WHERE b."isWin" IS NULL)::int AS "pendingBets",
      COALESCE(SUM(b."netIncludesStakeMinor") FILTER (WHERE b."isWin" IS NOT NULL), 0)::bigint AS "netIncludesStakeMinor",
      COALESCE(SUM(b."netIsProfitMinor") FILTER (WHERE b."isWin" IS NOT NULL), 0)::bigint AS "netIsProfitMinor",
      COALESCE(SUM(b."agentCommissionMinor"), 0)::bigint AS "commissionMinor"
    FROM "User" u
    LEFT JOIN "TestGameBet" b ON b."userId" = u."id" AND b."agentId" = $1::uuid
    WHERE u."referredByAgentId" = $1::uuid
    GROUP BY u."id", u."telegramId", u."firstName", u."username"
    ORDER BY COALESCE(SUM(b."stakeMinor"), 0) DESC, u."createdAt" DESC
    LIMIT 500
  `, agentId) as Promise<AgentPlayerRow[]>;
}

function totalsFromPlayers(players: AgentPlayerRow[]) {
  return players.reduce((totals, player) => ({
    turnoverMinor: totals.turnoverMinor + player.turnoverMinor,
    wins: totals.wins + player.wins,
    losses: totals.losses + player.losses,
    pendingBets: totals.pendingBets + player.pendingBets,
    netIncludesStakeMinor: totals.netIncludesStakeMinor + player.netIncludesStakeMinor,
    netIsProfitMinor: totals.netIsProfitMinor + player.netIsProfitMinor,
    commissionMinor: totals.commissionMinor + player.commissionMinor
  }), {
    turnoverMinor: 0n, wins: 0, losses: 0, pendingBets: 0,
    netIncludesStakeMinor: 0n, netIsProfitMinor: 0n, commissionMinor: 0n
  });
}

export async function applyAgentReferral(userId: string, rawCode: string) {
  assertTestGamesEnabled();
  const inviteCode = rawCode.trim().toUpperCase();
  if (!/^[A-F0-9]{12}$/.test(inviteCode)) return { attributed: false, reason: 'invalid_code' as const };
  const agent = await db.agent.findUnique({ where: { inviteCode }, select: { id: true, userId: true, active: true } });
  if (!agent || !agent.active || agent.userId === userId) return { attributed: false, reason: 'invalid_or_inactive_agent' as const };
  const current = await db.user.findUnique({ where: { id: userId }, select: { referredByAgentId: true } });
  if (!current) throw new AppError(404, 'Player not found', 'USER_NOT_FOUND');
  if (current.referredByAgentId) {
    return { attributed: current.referredByAgentId === agent.id, alreadyAttributed: true, reason: 'already_attributed' as const };
  }
  const result = await (prisma as any).$transaction(async (tx: any) => {
    const updated = await tx.user.updateMany({ where: { id: userId, referredByAgentId: null }, data: { referredByAgentId: agent.id } });
    if (updated.count === 1) {
      await tx.auditLog.create({ data: {
        actorId: userId,
        action: 'AGENT_REFERRAL_ATTRIBUTED',
        entityType: 'User',
        entityId: userId,
        after: { agentId: agent.id, inviteCode } as any
      } });
    }
    return updated;
  });
  if (result.count === 1) return { attributed: true, alreadyAttributed: false };
  const after = await db.user.findUnique({ where: { id: userId }, select: { referredByAgentId: true } });
  return { attributed: after?.referredByAgentId === agent.id, alreadyAttributed: true, reason: 'attribution_was_already_set' as const };
}

export async function getAgentReportForUser(userId: string) {
  assertTestGamesEnabled();
  const agent = await db.agent.findUnique({
    where: { userId },
    include: { user: { select: { id: true, telegramId: true, firstName: true, username: true } } }
  });
  if (!agent) return { isAgent: false };
  const players = await agentPlayerStats(agent.id);
  return {
    isAgent: true,
    agent: {
      id: agent.id,
      telegramId: agent.user.telegramId,
      firstName: agent.user.firstName,
      username: agent.user.username,
      inviteCode: agent.inviteCode,
      inviteUrl: inviteUrl(agent.inviteCode),
      commissionRateBps: agent.commissionRateBps,
      active: agent.active,
      createdAt: agent.createdAt
    },
    totals: totalsFromPlayers(players),
    referredPlayers: players
  };
}

export async function listAdminAgentReports() {
  assertTestGamesEnabled();
  const agents = await db.agent.findMany({
    include: { user: { select: { id: true, telegramId: true, firstName: true, username: true } } },
    orderBy: { createdAt: 'desc' },
    take: 100
  });
  return Promise.all(agents.map(async (agent: any) => {
    const players = await agentPlayerStats(agent.id);
    return {
      id: agent.id,
      user: agent.user,
      inviteCode: agent.inviteCode,
      inviteUrl: inviteUrl(agent.inviteCode),
      commissionRateBps: agent.commissionRateBps,
      active: agent.active,
      createdAt: agent.createdAt,
      totals: totalsFromPlayers(players),
      referredPlayers: players
    };
  }));
}

export async function resolveAgentInviteUrl(inviteCode: string) {
  return inviteUrl(inviteCode);
}
