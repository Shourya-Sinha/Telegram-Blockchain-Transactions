export type EnvelopeAudience = 'ALL' | 'SELECTED';

/** Canonicalize the Telegram ID allowlist once, before validating/saving it. */
export function normalizeEligibleTelegramIds(audience: EnvelopeAudience, telegramIds: string[]): string[] {
  if (audience === 'ALL') return [];
  return [...new Set(telegramIds.map((telegramId) => BigInt(telegramId).toString()))];
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
