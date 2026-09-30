const webApp = () => window.Telegram?.WebApp;

function setViewportVariables(app?: TelegramWebApp): void {
  const root = document.documentElement;
  const viewportHeight = app?.viewportHeight || window.innerHeight;
  const stableHeight = app?.viewportStableHeight || viewportHeight;
  root.style.setProperty('--app-viewport-height', `${viewportHeight}px`);
  root.style.setProperty('--app-viewport-stable-height', `${stableHeight}px`);

  const safeArea = app?.safeAreaInset;
  const contentSafeArea = app?.contentSafeAreaInset;
  root.style.setProperty('--app-safe-top', `${Math.max(safeArea?.top ?? 0, contentSafeArea?.top ?? 0)}px`);
  root.style.setProperty('--app-safe-right', `${Math.max(safeArea?.right ?? 0, contentSafeArea?.right ?? 0)}px`);
  root.style.setProperty('--app-safe-bottom', `${Math.max(safeArea?.bottom ?? 0, contentSafeArea?.bottom ?? 0)}px`);
  root.style.setProperty('--app-safe-left', `${Math.max(safeArea?.left ?? 0, contentSafeArea?.left ?? 0)}px`);
}

function requestTelegramFullscreen(app: TelegramWebApp): void {
  // expand() supports old Telegram clients; requestFullscreen() removes the
  // remaining Telegram header on clients that implement Mini Apps 8.0+.
  app.expand();
  if (!app.requestFullscreen || app.isFullscreen) return;
  try {
    app.requestFullscreen();
  } catch {
    // Older clients still stay in the maximum height provided by expand().
  }
}

export function initializeTelegram(): () => void {
  const app = webApp();
  if (!app) {
    const resize = () => setViewportVariables();
    resize();
    window.addEventListener('resize', resize);
    return () => window.removeEventListener('resize', resize);
  }

  app.ready();
  app.expand();
  app.setHeaderColor?.('#07101c');
  app.setBackgroundColor?.('#07101c');
  app.setBottomBarColor?.('#07101c');
  app.disableVerticalSwipes?.();
  setViewportVariables(app);

  const syncViewport = () => setViewportVariables(app);
  app.onEvent?.('viewportChanged', syncViewport);
  app.onEvent?.('safeAreaChanged', syncViewport);
  app.onEvent?.('contentSafeAreaChanged', syncViewport);
  app.onEvent?.('fullscreenChanged', syncViewport);

  // Waiting one frame lets Telegram finish mounting its native container first.
  const fullscreenTimer = window.setTimeout(() => requestTelegramFullscreen(app), 50);
  // Some iOS/Android versions only honor fullscreen after a user gesture.
  const retryOnFirstGesture = () => requestTelegramFullscreen(app);
  document.addEventListener('pointerdown', retryOnFirstGesture, { once: true, passive: true });

  return () => {
    window.clearTimeout(fullscreenTimer);
    document.removeEventListener('pointerdown', retryOnFirstGesture);
    app.offEvent?.('viewportChanged', syncViewport);
    app.offEvent?.('safeAreaChanged', syncViewport);
    app.offEvent?.('contentSafeAreaChanged', syncViewport);
    app.offEvent?.('fullscreenChanged', syncViewport);
  };
}

export function telegramInitData(): string { return webApp()?.initData ?? ''; }
export function haptic(style: 'light' | 'medium' | 'heavy' = 'light'): void { try { webApp()?.HapticFeedback.impactOccurred(style); } catch { /* browsers outside Telegram do not expose haptics */ } }
export function successHaptic(): void { try { webApp()?.HapticFeedback.notificationOccurred('success'); } catch { /* no-op outside Telegram */ } }
export function configureBackButton(onBack: () => void, visible: boolean): () => void {
  const button = webApp()?.BackButton;
  if (!button) return () => undefined;
  if (visible) button.show(); else button.hide();
  button.onClick(onBack);
  return () => button.offClick(onBack);
}
