import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';

test('Telegram Mini App initialization never auto-expands or requests fullscreen', () => {
  const source = readFileSync(resolve(process.cwd(), '../frontend/src/telegram.ts'), 'utf8');
  assert.equal(/\bapp\.(?:expand|requestFullscreen)\s*\(/.test(source), false);
  assert.equal(source.includes('app.exitFullscreen?.()'), true);
  assert.equal(source.includes('app.enableVerticalSwipes?.()'), true);
});
