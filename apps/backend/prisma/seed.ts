import 'dotenv/config';
import bcrypt from 'bcryptjs';
import { PrismaClient } from '@prisma/client';
import { AdminRole } from '../src/utils/prismaEnums';

const prisma = new PrismaClient();

async function main() {
  const username = process.env.ADMIN_USERNAME ?? 'admin';
  const password = process.env.ADMIN_PASSWORD ?? 'change-this-password';
  const passwordHash = await bcrypt.hash(password, 12);
  await prisma.adminUser.upsert({
    where: { username },
    update: { passwordHash, role: (process.env.ADMIN_ROLE as AdminRole) ?? AdminRole.SUPER_ADMIN },
    create: { username, passwordHash, role: (process.env.ADMIN_ROLE as AdminRole) ?? AdminRole.SUPER_ADMIN }
  });
  console.log(`Admin ${username} is ready. Change ADMIN_PASSWORD before production use.`);
}

main().catch((error) => { console.error(error); process.exitCode = 1; }).finally(() => prisma.$disconnect());
