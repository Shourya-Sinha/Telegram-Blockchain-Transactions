import type { AdminRole } from '../utils/prismaEnums';

declare global {
  namespace Express {
    interface Request {
      telegramUser?: {
        id: string;
        telegramId: bigint;
        username?: string;
        firstName: string;
        locale: string;
        createdAt: Date;
        isAdmin: boolean;
        status: string;
      };
      adminUser?: { id: string; username: string; role: AdminRole };
    }
  }
}

export {};
