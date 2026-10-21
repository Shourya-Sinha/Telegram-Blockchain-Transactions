import type { GroupMember } from '../api';

/** Prefer a real full name, fall back to @username, then the stable Telegram ID. */
export function groupMemberDisplayName(member: Pick<GroupMember, 'firstName' | 'lastName' | 'username' | 'telegramId'>): string {
  const fullName = [member.firstName, member.lastName]
    .map((value) => value?.trim() ?? '')
    .filter((value) => value.length > 0 && value.toLowerCase() !== 'unknown')
    .join(' ');
  if (fullName) return fullName;
  if (member.username?.trim()) return `@${member.username.trim().replace(/^@/, '')}`;
  return `Telegram user ${member.telegramId}`;
}
