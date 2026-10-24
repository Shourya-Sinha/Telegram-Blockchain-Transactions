import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';

test('backend build and typecheck regenerate Prisma Client from the current schema first', () => {
  const packageJson = JSON.parse(readFileSync(resolve(process.cwd(), 'package.json'), 'utf8')) as {
    scripts: Record<string, string | undefined>;
  };

  assert.equal(packageJson.scripts.prebuild, 'npm run prisma:generate');
  assert.equal(packageJson.scripts.pretypecheck, 'npm run prisma:generate');
  assert.equal(packageJson.scripts['prisma:generate'], 'prisma generate');
});
