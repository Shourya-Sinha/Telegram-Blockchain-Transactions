import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';

const read = (relativePath: string): string => readFileSync(resolve(process.cwd(), relativePath), 'utf8');

test('every history row opens something: no inert rows are rendered', () => {
  const history = read('../frontend/src/components/HistoryPanel.tsx');
  // Ledger rows and withdrawal requests are buttons wired to the detail sheet.
  assert.match(history, /<button type="button" className="activity-row"[^>]*onClick=\{\(\) => openLedger\(entry\)\}/);
  assert.match(history, /<button type="button" className="withdrawal-row"[\s\S]{0,200}?onOpenDetail\(\{ kind: 'withdrawal', withdrawal: w \}\)/);
  // Red envelope rows keep opening the envelope UI.
  assert.match(history, /<EnvelopeRow key=\{entry\.id\} entry=\{entry\} onOpen=\{onOpenEnvelope\} \/>/);
  assert.equal(/<div className="activity-row"/.test(history), false);
  assert.equal(/<div className="withdrawal-row"/.test(history), false);

  const wallet = read('../frontend/src/screens/WalletScreen.tsx');
  assert.match(wallet, /onOpenDetail\(\{ kind: 'ledger', entry \}\)/);
  assert.equal(/entry\.type === 'CLAIM' && onClaim/.test(wallet), false);
});

test('the transaction detail sheet reports the full record of a movement', () => {
  const detail = read('../frontend/src/components/TransactionDetail.tsx');
  for (const key of ['typeLabel', 'directionLabel', 'dateTimeLabel', 'balanceAfterLabel', 'referenceLabel', 'txHashLabel', 'destinationLabel', 'confirmationsLabel', 'sharesClaimedLabel', 'envelopeStatusHeading']) {
    assert.ok(detail.includes(`t('${key}')`), `detail sheet is missing the ${key} row`);
  }
  // Withdrawal and deposit rows resolve their on-chain record.
  assert.match(detail, /queryKey: \['withdrawals'\]/);
  assert.match(detail, /queryKey: \['deposits'\]/);
  // Envelope movements can jump into the envelope UI from here.
  assert.match(detail, /onOpenEnvelope\(entry\.referenceId/);
});

test('the detail sheet can always be dismissed (back arrow, close button, backdrop)', () => {
  const detail = read('../frontend/src/components/TransactionDetail.tsx');
  assert.match(detail, /className="detail-back"[\s\S]{0,120}?onClose\(\)/);
  assert.match(detail, /className="icon-button"[\s\S]{0,120}?onClose\(\)/);
  assert.match(detail, /className="secondary-button detail-close"[\s\S]{0,120}?onClose\(\)/);
  assert.match(detail, /onMouseDown=\{\(event\) => \{ if \(event\.target === event\.currentTarget\) onClose\(\); \}\}/);

  const css = read('../frontend/src/index.css');
  // Header and footer live outside the scrolling area, so the controls cannot
  // scroll out of reach on a long record.
  assert.match(css, /\.detail-sheet \{ display: flex; flex-direction: column;[^}]*overflow: hidden;/);
  assert.match(css, /\.detail-scroll \{ flex: 1 1 auto; min-height: 0; overflow-y: auto;/);
});

test('a red envelope that fails to open can be retried instead of dead-ending', () => {
  const claim = read('../frontend/src/components/ClaimModal.tsx');
  // Only these four codes are final; everything else rewinds to the seal.
  const api = read('../frontend/src/api.ts');
  assert.match(api, /TERMINAL_ENVELOPE_CODES = \['ALREADY_CLAIMED', 'ENVELOPE_CLOSED', 'ENVELOPE_EXPIRED', 'ENVELOPE_NOT_FOUND'\]/);
  assert.match(claim, /if \(mutation\.isError && !isTerminalEnvelopeError\(mutation\.error\)\) \{ setPhase\('sealed'\); return; \}/);
  assert.match(claim, /className="hb-retry"/);
  // A failed envelope lookup no longer locks the envelope: it offers a retry.
  assert.match(claim, /void detail\.refetch\(\)/);
  assert.equal(/detailUnavailable/.test(claim), false);
  // A malformed claim response must not throw while rendering.
  assert.match(claim, /mutation\.data\?\.claim\?\.amountMinor/);
});

test('the envelope screen keeps its exits and shows the envelope details', () => {
  const claim = read('../frontend/src/components/ClaimModal.tsx');
  assert.match(claim, /className="hb-topbar"/);
  assert.match(claim, /className="hb-back"/);
  assert.match(claim, /className="hb-footer"/);
  for (const key of ['envelopeTotalLabel', 'sharesClaimedLabel', 'distributionLabel', 'envelopeStatusHeading', 'yourShareLabel']) {
    assert.ok(claim.includes(`t('${key}')`), `envelope screen is missing the ${key} detail`);
  }

  const css = read('../frontend/src/index.css');
  const overlay = css.split('\n').find((line) => line.startsWith('.hongbao-overlay {'));
  assert.ok(overlay, '.hongbao-overlay rule is missing');
  assert.match(overlay, /display: flex; flex-direction: column; overflow: hidden;/);
  assert.match(css, /\.hb-scroll \{ flex: 1 1 auto; min-height: 0;[^}]*overflow-y: auto;/);
  assert.match(css, /\.hb-footer \{ flex: 0 0 auto;/);
});

test('back always closes the top-most layer and never traps the user', () => {
  const app = read('../frontend/src/App.tsx');
  assert.match(app, /const closeTopLayer = useCallback\(\(\) => \{\s*if \(claimLaunch\)[\s\S]*if \(detail\)[\s\S]*if \(historyOpen\) setHistoryOpen\(false\);/);
  assert.match(app, /configureBackButton\(closeTopLayer, anyLayerOpen\)/);
  assert.match(app, /event\.key === 'Escape'/);
  // Telegram's drag-to-dismiss is suspended while an overlay owns the screen.
  assert.match(app, /setSwipeDismissEnabled\(!overlayOpen\)/);

  const main = read('../frontend/src/main.tsx');
  assert.match(main, /<ErrorBoundary><App \/><\/ErrorBoundary>/);
});

test('wallet responses are never served from the WebView cache', () => {
  const api = read('../frontend/src/api.ts');
  assert.match(api, /fetch\(path, \{ cache: 'no-store', \.\.\.options, headers \}\)/);
  assert.match(api, /NETWORK_ERROR/);

  const server = read('src/server.ts');
  assert.match(server, /app\.set\('etag', false\)/);
  assert.match(server, /res\.set\('Cache-Control', 'no-store, no-cache, must-revalidate'\)/);
});
