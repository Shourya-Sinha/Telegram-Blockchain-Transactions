import { createHmac, timingSafeEqual } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import { prisma } from '../lib/prisma';
import { config } from '../config';
import { AppError } from '../utils/errors';

function safeEqual(left: string, right: string): boolean {
  const a = Buffer.from(left, 'hex');
  const b = Buffer.from(right, 'hex');
  return a.length === b.length && timingSafeEqual(a, b);
}

export function validateTelegramInitData(initData: string): { telegramId: bigint; username?: string; firstName: string } {
  if (!initData || !config.botToken) throw new AppError(401, 'Telegram authentication is required', 'AUTH_REQUIRED');
  const params = new URLSearchParams(initData);
  const receivedHash = params.get('hash');
  if (!receivedHash) throw new AppError(401, 'Invalid Telegram init data', 'AUTH_INVALID');
  params.delete('hash');
  const dataCheckString = [...params.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([key, value]) => `${key}=${value}`).join('\n');
  const secretKey = createHmac('sha256', 'WebAppData').update(config.botToken).digest();
  const calculatedHash = createHmac('sha256', secretKey).update(dataCheckString).digest('hex');
  if (!safeEqual(calculatedHash, receivedHash)) throw new AppError(401, 'Telegram authentication signature is invalid', 'AUTH_INVALID');
  const authDate = Number(params.get('auth_date'));
  if (!Number.isSafeInteger(authDate) || Math.floor(Date.now() / 1000) - authDate > config.telegramInitDataMaxAge) {
    throw new AppError(401, 'Telegram authentication data has expired', 'AUTH_EXPIRED');
  }
  const rawUser = params.get('user');
  if (!rawUser) throw new AppError(401, 'Telegram user is missing', 'AUTH_INVALID');
  try {
    const user = JSON.parse(rawUser) as { id?: number; username?: string; first_name?: string };
    if (!user.id || !user.first_name) throw new Error('missing user fields');
    return { telegramId: BigInt(user.id), username: user.username, firstName: user.first_name };
  } catch {
    throw new AppError(401, 'Telegram user data is invalid', 'AUTH_INVALID');
  }
}

export async function telegramAuth(req: Request, _res: Response, next: NextFunction): Promise<void> {
  try {
    const initData = req.header('x-telegram-init-data') ?? (typeof req.body?.initData === 'string' ? req.body.initData : '');
    const identity = validateTelegramInitData(initData);
    const user = await prisma.user.upsert({
      where: { telegramId: identity.telegramId },
      update: { username: identity.username, firstName: identity.firstName },
      create: { telegramId: identity.telegramId, username: identity.username, firstName: identity.firstName, wallet: { create: {} } }
    });
    if (user.status === 'BANNED') throw new AppError(403, 'This Telegram account is banned', 'BANNED');
    req.telegramUser = { id: user.id, telegramId: user.telegramId, username: user.username ?? undefined, firstName: user.firstName, createdAt: user.createdAt, isAdmin: user.isAdmin, status: user.status };
    next();
  } catch (error) { next(error); }
}
