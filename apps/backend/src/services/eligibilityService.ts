import { prisma } from '../lib/prisma';
import { redis } from '../lib/redis';
import { AppError } from '../utils/errors';
import { isEnvelopeAudienceAllowed } from '../utils/envelopeAudience';
import { isEnvelopeRecipientSelected } from './envelopeRecipientService';

/** Protect private-audience envelope previews as well as claim attempts. */
export async function assertEnvelopeAudience(userId: string, envelopeId: string, allowSenderView = false): Promise<void> {
  const [envelope, user] = await Promise.all([
    prisma.redEnvelope.findUnique({ where: { id: envelopeId }, select: { senderId: true, audience: true } }),
    prisma.user.findUnique({ where: { id: userId }, select: { telegramId: true, username: true } })
  ]);
  if (!envelope) throw new AppError(404, 'Red envelope not found', 'ENVELOPE_NOT_FOUND');
  if (!user) throw new AppError(404, 'User not found', 'USER_NOT_FOUND');
  const allowed = envelope.audience === 'SELECTED'
    ? await isEnvelopeRecipientSelected(prisma, envelopeId, user)
    : false;
  if (!isEnvelopeAudienceAllowed({
    audience: envelope.audience,
    isSelected: Boolean(allowed),
    isSender: envelope.senderId === userId,
    allowSenderView
  })) {
    throw new AppError(403, 'This red envelope is limited to selected group members', 'ENVELOPE_NOT_ELIGIBLE');
  }
}

export async function assertClaimEligibility(userId: string, groupId: bigint, envelopeId?: string): Promise<void> {
  if ((await redis.get('emergency:envelopes-disabled')) === '1') throw new AppError(503, 'Red envelope claims are temporarily disabled', 'ENVELOPES_DISABLED');
  const setting = await prisma.groupSetting.findUnique({ where: { chatId: groupId } });
  if (setting && !setting.enabled) throw new AppError(403, 'Red envelopes are disabled in this group', 'GROUP_DISABLED');
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { createdAt: true, telegramId: true, username: true } });
  if (!user) throw new AppError(404, 'User not found', 'USER_NOT_FOUND');
  if (envelopeId) {
    const envelope = await prisma.redEnvelope.findUnique({ where: { id: envelopeId }, select: { audience: true } });
    if (!envelope) throw new AppError(404, 'Red envelope not found', 'ENVELOPE_NOT_FOUND');
    const allowed = envelope.audience === 'SELECTED'
      ? await isEnvelopeRecipientSelected(prisma, envelopeId, user)
      : false;
    if (!isEnvelopeAudienceAllowed({ audience: envelope.audience, isSelected: Boolean(allowed) })) {
      throw new AppError(403, 'This red envelope is limited to selected group members', 'ENVELOPE_NOT_ELIGIBLE');
    }
  }
  if (setting && setting.minAccountAgeDays > 0) {
    const ageMs = setting.minAccountAgeDays * 24 * 60 * 60 * 1000;
    if (Date.now() - user.createdAt.getTime() < ageMs) throw new AppError(403, 'Your account is too new to claim in this group', 'ACCOUNT_TOO_NEW');
  }
  if (setting && setting.minMessages > 0) {
    const count = Number(await redis.get(`group:messages:${groupId.toString()}:${user.telegramId.toString()}`) ?? 0);
    if (count < setting.minMessages) throw new AppError(403, `Send at least ${setting.minMessages} group messages before claiming`, 'MESSAGE_REQUIREMENT');
  }
  if (setting && setting.maxClaimsPerDay > 0) {
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const claims = await prisma.redEnvelopeClaim.count({
      where: { userId, claimedAt: { gte: since }, envelope: { groupId } }
    });
    if (claims >= setting.maxClaimsPerDay) throw new AppError(429, 'Daily claim limit reached', 'CLAIM_LIMIT');
  }
}
