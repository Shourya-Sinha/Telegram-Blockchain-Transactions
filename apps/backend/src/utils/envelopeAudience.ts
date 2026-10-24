export type EnvelopeAudience = 'ALL' | 'SELECTED';

/** Canonicalize the Telegram ID allowlist once, before validating/saving it. */
export function normalizeEligibleTelegramIds(audience: EnvelopeAudience, telegramIds: string[]): string[] {
  if (audience === 'ALL') return [];
  return [...new Set(telegramIds.map((telegramId) => BigInt(telegramId).toString()))];
}

export function normalizeTelegramUsername(username: string | null | undefined): string | undefined {
  const normalized = username?.trim().replace(/^@/, '').toLowerCase();
  return normalized || undefined;
}

export function normalizeEligibleTelegramUsernames(audience: EnvelopeAudience, usernames: string[]): string[] {
  if (audience === 'ALL') return [];
  return [...new Set(usernames.map((username) => normalizeTelegramUsername(username)).filter((username): username is string => Boolean(username)))];
}

/** A pending username is matched at claim time, then remains bound to its Telegram ID. */
export function isEligibleUsernameRecipient(
  entry: { username: string; telegramId: bigint | null },
  claimant: { telegramId: bigint; username?: string | null }
): boolean {
  if (entry.telegramId !== null) return entry.telegramId === claimant.telegramId;
  return normalizeTelegramUsername(claimant.username) === entry.username.toLowerCase();
}

/** Shared policy used by envelope previews and the transactional claim path. */
export function isEnvelopeAudienceAllowed(input: {
  audience: EnvelopeAudience;
  isSelected: boolean;
  isSender?: boolean;
  allowSenderView?: boolean;
}): boolean {
  if (input.audience === 'ALL') return true;
  if (input.allowSenderView && input.isSender) return true;
  return input.isSelected;
}
