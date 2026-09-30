import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';

const read = (relativePath: string): string => readFileSync(resolve(process.cwd(), relativePath), 'utf8');

test('Telegram Mini App initialization never auto-expands or requests fullscreen', () => {
  const source = read('../frontend/src/telegram.ts');
  assert.equal(/\bapp\.(?:expand|requestFullscreen)\s*\(/.test(source), false);
  assert.equal(source.includes('app.exitFullscreen?.()'), true);
  assert.equal(source.includes('app.enableVerticalSwipes?.()'), true);
});

test('the mini app sheet covers 80% of the Telegram viewport, not the display', () => {
  const source = read('../frontend/src/telegram.ts');
  assert.equal(source.includes('export const SHEET_HEIGHT_RATIO = 0.8;'), true);
  // The sheet must be derived from Telegram's reported viewport so a maximised
  // Telegram Desktop window and a phone both get a proportional sheet.
  assert.match(source, /--app-sheet-height[^\n]*stableHeight \* ratio/);
  assert.equal(source.includes("root.style.setProperty('--app-viewport-stable-height'"), true);
});

test('Telegram fullscreen is left again whenever the client re-enters it', () => {
  const source = read('../frontend/src/telegram.ts');
  assert.match(source, /onEvent\?\.\('fullscreenChanged', syncFullscreen\)/);
  assert.match(source, /const syncFullscreen = \(\) => \{\s*leaveFullscreen\(app\);/);
});

test('the app shell is a bottom sheet with curved top corners', () => {
  const css = read('../frontend/src/index.css');
  const shell = css.split('\n').find((line) => line.startsWith('.app-shell {'));
  assert.ok(shell, '.app-shell rule is missing');
  assert.match(shell, /height: var\(--app-sheet-height/);
  assert.match(shell, /border-radius: var\(--app-sheet-radius[^;]*\) var\(--app-sheet-radius[^;]*\) 0 0/);
  assert.match(shell, /animation: sheet-rise/);
  assert.match(css, /@keyframes sheet-rise \{ from \{ transform: translateY\(100%\); \}/);
});

test('overlays stay inside the sheet instead of covering the Telegram strip', () => {
  const css = read('../frontend/src/index.css');
  assert.match(css, /\.modal-backdrop \{ position: absolute;/);
  assert.match(css, /\.build-indicator \{ position: absolute;/);
  assert.match(css, /\.bottom-nav \{ position: relative;/);
  assert.equal(/\.ambient \{ position: fixed;/.test(css), false);
});
