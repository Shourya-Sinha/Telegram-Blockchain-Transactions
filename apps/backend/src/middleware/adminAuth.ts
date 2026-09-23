import jwt from 'jsonwebtoken';
import type { NextFunction, Request, Response } from 'express';
import { config } from '../config';
import { prisma } from '../lib/prisma';
import { AppError } from '../utils/errors';
import type { AdminRole } from '../utils/prismaEnums';

export async function adminAuth(req: Request, _res: Response, next: NextFunction): Promise<void> {
  try {
    const header = req.header('authorization');
    if (!header?.startsWith('Bearer ')) throw new AppError(401, 'Admin authentication is required', 'ADMIN_AUTH_REQUIRED');
    const payload = jwt.verify(header.slice(7), config.jwtSecret) as { sub?: string };
    if (!payload.sub) throw new AppError(401, 'Invalid admin token', 'ADMIN_AUTH_INVALID');
    const admin = await prisma.adminUser.findUnique({ where: { id: payload.sub } });
    if (!admin) throw new AppError(401, 'Admin account no longer exists', 'ADMIN_AUTH_INVALID');
    req.adminUser = { id: admin.id, username: admin.username, role: admin.role as AdminRole };
    next();
  } catch (error) {
    next(error instanceof jwt.JsonWebTokenError ? new AppError(401, 'Invalid or expired admin token', 'ADMIN_AUTH_INVALID') : error);
  }
}

export function requireAdminRole(...roles: AdminRole[]) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.adminUser || (roles.length > 0 && !roles.includes(req.adminUser.role))) {
      next(new AppError(403, 'Insufficient admin permissions', 'FORBIDDEN'));
      return;
    }
    next();
  };
}
