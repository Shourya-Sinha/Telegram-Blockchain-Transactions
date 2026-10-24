import { isEligibleUsernameRecipient, normalizeTelegramUsername } from '../utils/envelopeAudience';

export type EnvelopeRecipientIdentity = { telegramId: bigint; username?: string | null };

/**
 * Checks both stable numeric-ID selections and username reservations. Once a
 * username is bound, the numeric Telegram ID remains authoritative even if
 * that person later changes usernames.
 */
export async function isEnvelopeRecipientSelected(
  database: any,
  envelopeId: string,
  claimant: EnvelopeRecipientIdentity
): Promise<boolean> {
  const selectedById = await database.redEnvelopeEligibleUser.findUnique({
    where: { envelopeId_telegramId: { envelopeId, telegramId: claimant.telegramId } },
    select: { telegramId: true }
  });
  if (selectedById) return true;

  const username = normalizeTelegramUsername(claimant.username);
  const [boundEntry, usernameEntry] = await Promise.all([
    database.redEnvelopeEligibleUsername.findFirst({
      where: { envelopeId, telegramId: claimant.telegramId },
      select: { username: true, telegramId: true }
    }),
    username
      ? database.redEnvelopeEligibleUsername.findUnique({
        where: { envelopeId_username: { envelopeId, username } },
        select: { username: true, telegramId: true }
      })
      : Promise.resolve(null)
  ]);

  return [boundEntry, usernameEntry]
    .filter(Boolean)
    .some((entry) => isEligibleUsernameRecipient(entry, claimant));
}
