import { PrismaClient } from '@prisma/client';

export const prisma = new PrismaClient({ log: process.env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'] });

process.once('SIGINT', () => { void prisma.$disconnect(); });
process.once('SIGTERM', () => { void prisma.$disconnect(); });
