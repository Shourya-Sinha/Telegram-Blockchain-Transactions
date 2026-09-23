import { prisma } from '../lib/prisma';
import { redis } from '../lib/redis';
import { AppError } from '../utils/errors';

export async function assertClaimEligibility(userId: string, groupId: bigint): Promise<void> {
  if ((await redis.get('emergency:envelopes-disabled')) === '1') throw new AppError(503, 'Red envelope claims are temporarily disabled', 'ENVELOPES_DISABLED');
  const setting = await prisma.groupSetting.findUnique({ where: { chatId: groupId } });
  if (setting && !setting.enabled) throw new AppError(403, 'Red envelopes are disabled in this group', 'GROUP_DISABLED');
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { createdAt: true } });
  if (!user) throw new AppError(404, 'User not found', 'USER_NOT_FOUND');
  if (setting && setting.minAccountAgeDays > 0) {
    const ageMs = setting.minAccountAgeDays * 24 * 60 * 60 * 1000;
    if (Date.now() - user.createdAt.getTime() < ageMs) throw new AppError(403, 'Your account is too new to claim in this group', 'ACCOUNT_TOO_NEW');
  }
  if (setting && setting.minMessages > 0) {
    const count = Number(await redis.get(`group:messages:${groupId.toString()}:${userId}`) ?? 0);
    if (count < setting.minMessages) throw new AppError(403, `Send at least ${setting.minMessages} group messages before claiming`, 'MESSAGE_REQUIREMENT');
  }
  if (setting && setting.maxClaimsPerDay > 0) {
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const claims = await prisma.redEnvelopeClaim.count({ where: { userId, claimedAt: { gte: since } } });
    if (claims >= setting.maxClaimsPerDay) throw new AppError(429, 'Daily claim limit reached', 'CLAIM_LIMIT');
  }
}
