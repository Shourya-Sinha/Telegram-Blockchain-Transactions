import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';

const read = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8');

test('raw row locks cast string parameters to UUID for Postgres comparisons', () => {
  const paths = [
    'src/services/ledgerService.ts',
    'src/services/devCreditService.ts',
    'src/services/depositService.ts',
    'src/services/envelopeService.ts',
    'src/services/withdrawalService.ts',
    'prisma/devCredit.ts'
  ];

  for (const path of paths) {
    assert.match(read(path), /\$1::uuid\s+FOR UPDATE/, `${path} must cast raw UUID lock parameters`);
  }
});
