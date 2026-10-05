const webApp = () => window.Telegram?.WebApp;

/**
 * Portion of the Telegram viewport the mini app sheet is allowed to cover.
 * The remaining 20% stays transparent so the Telegram client is still visible
 * above the sheet and the app never reads as a full-screen external page.
 */
export const SHEET_HEIGHT_RATIO = 0.8;

/** Rounded top corners of the sheet, in CSS pixels. */
const SHEET_CORNER_RADIUS = 22;

const MOBILE_PLATFORMS = ['android', 'android_x', 'ios'];

const FALLBACK_BEHIND_COLOR = '#07101c';

/**
 * Telegram for Android/iOS already renders a mini app that was never expanded
 * as a partial sheet with the chat visible above it. Shrinking our own layout
 * a second time there would stack two gaps, so on that platform the document
 * fills the WebView and Telegram keeps owning the sheet geometry.
 */
function usesNativeTelegramSheet(app?: TelegramWebApp): boolean {
  if (!app) return false;
  if (!MOBILE_PLATFORMS.includes((app.platform ?? '').toLowerCase())) return false;
  return app.isExpanded !== true && app.isFullscreen !== true;
}

function behindColor(app?: TelegramWebApp): string {
  const params = app?.themeParams ?? {};
  return params.secondary_bg_color || params.bg_color || FALLBACK_BEHIND_COLOR;
}

function setViewportVariables(app?: TelegramWebApp): void {
  const root = document.documentElement;
  const viewportHeight = app?.viewportHeight || window.innerHeight;
  const stableHeight = app?.viewportStableHeight || viewportHeight;
  root.style.setProperty('--app-viewport-height', `${viewportHeight}px`);
  root.style.setProperty('--app-viewport-stable-height', `${stableHeight}px`);

  // The sheet is always measured against the viewport Telegram reports, never
  // against the physical screen, so the same layout works on a phone and in a
  // maximised Telegram Desktop window.
  const native = usesNativeTelegramSheet(app);
  const ratio = native ? 1 : SHEET_HEIGHT_RATIO;
  root.style.setProperty('--app-sheet-ratio', `${ratio}`);
  root.style.setProperty('--app-sheet-height', `${Math.round(stableHeight * ratio)}px`);
  root.style.setProperty('--app-sheet-radius', native ? '0px' : `${SHEET_CORNER_RADIUS}px`);
  if (document.body) document.body.dataset.sheet = native ? 'native' : 'overlay';

  const safeArea = app?.safeAreaInset;
  const contentSafeArea = app?.contentSafeAreaInset;
  root.style.setProperty('--app-safe-top', `${Math.max(safeArea?.top ?? 0, contentSafeArea?.top ?? 0)}px`);
  root.style.setProperty('--app-safe-right', `${Math.max(safeArea?.right ?? 0, contentSafeArea?.right ?? 0)}px`);
  root.style.setProperty('--app-safe-bottom', `${Math.max(safeArea?.bottom ?? 0, contentSafeArea?.bottom ?? 0)}px`);
  root.style.setProperty('--app-safe-left', `${Math.max(safeArea?.left ?? 0, contentSafeArea?.left ?? 0)}px`);
}

/**
 * Paint the strip above the sheet with Telegram's own chat background so the
 * uncovered 20% blends into the client instead of showing an app-coloured band.
 */
function setThemeVariables(app?: TelegramWebApp): void {
  document.documentElement.style.setProperty('--tg-behind-color', behindColor(app));
}

function leaveFullscreen(app: TelegramWebApp): void {
  if (!app.isFullscreen) return;
  try {
    app.exitFullscreen?.();
  } catch {
    // Clients without a working fullscreen API will retain their native mode.
  }
}

/**
 * Apply the sheet geometry before React's first paint so the app never flashes
 * at full height and then snaps down to 80%.
 */
export function primeTelegramViewport(): void {
  const app = webApp();
  setThemeVariables(app);
  setViewportVariables(app);
}

export function initializeTelegram(): () => void {
  const app = webApp();
  if (!app) {
    const resize = () => {
      setViewportVariables();
      setThemeVariables();
    };
    resize();
    window.addEventListener('resize', resize);
    return () => window.removeEventListener('resize', resize);
  }

  app.ready();
  // Keep Telegram's native compact sheet instead of covering the chat. Calling
  // expand() or requestFullscreen() here makes the sheet grow after loading,
  // which is especially noticeable in Telegram Desktop. If this WebView was
  // restored in fullscreen, leave it before rendering and allow native swipes.
  leaveFullscreen(app);
  app.enableVerticalSwipes?.();
  const behind = behindColor(app);
  try {
    app.setHeaderColor?.(behind);
    app.setBackgroundColor?.(behind);
  } catch {
    // Older clients only accept the bg_color/secondary_bg_color keywords.
  }
  app.setBottomBarColor?.('#07101c');
  setThemeVariables(app);
  setViewportVariables(app);

  const syncViewport = () => setViewportVariables(app);
  const syncFullscreen = () => {
    leaveFullscreen(app);
    setViewportVariables(app);
  };
  const syncTheme = () => {
    setThemeVariables(app);
    setViewportVariables(app);
  };
  app.onEvent?.('viewportChanged', syncViewport);
  app.onEvent?.('safeAreaChanged', syncViewport);
  app.onEvent?.('contentSafeAreaChanged', syncViewport);
  app.onEvent?.('fullscreenChanged', syncFullscreen);
  app.onEvent?.('themeChanged', syncTheme);

  return () => {
    app.offEvent?.('viewportChanged', syncViewport);
    app.offEvent?.('safeAreaChanged', syncViewport);
    app.offEvent?.('contentSafeAreaChanged', syncViewport);
    app.offEvent?.('fullscreenChanged', syncFullscreen);
    app.offEvent?.('themeChanged', syncTheme);
  };
}

export function telegramInitData(): string { return webApp()?.initData ?? ''; }
export function telegramStartParam(): string { return webApp()?.initDataUnsafe?.start_param ?? ''; }
export function haptic(style: 'light' | 'medium' | 'heavy' = 'light'): void { try { webApp()?.HapticFeedback.impactOccurred(style); } catch { /* browsers outside Telegram do not expose haptics */ } }
export function successHaptic(): void { try { webApp()?.HapticFeedback.notificationOccurred('success'); } catch { /* no-op outside Telegram */ } }
export function configureBackButton(onBack: () => void, visible: boolean): () => void {
  const button = webApp()?.BackButton;
  if (!button) return () => undefined;
  if (visible) button.show(); else button.hide();
  button.onClick(onBack);
  return () => button.offClick(onBack);
}
