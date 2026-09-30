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

export function initializeTelegram(): () => void {
  const app = webApp();
  if (!app) {
    const resize = () => setViewportVariables();
    resize();
    window.addEventListener('resize', resize);
    return () => window.removeEventListener('resize', resize);
  }

  app.ready();
  // Keep Telegram's native compact sheet instead of covering the chat. Calling
  // expand() or requestFullscreen() here makes the sheet grow after loading,
  // which is especially noticeable in Telegram Desktop. If this WebView was
  // restored in fullscreen, leave it before rendering and allow native swipes.
  if (app.isFullscreen) {
    try {
      app.exitFullscreen?.();
    } catch {
      // Clients without a working fullscreen API will retain their native mode.
    }
  }
  app.enableVerticalSwipes?.();
  app.setHeaderColor?.('#07101c');
  app.setBackgroundColor?.('#07101c');
  app.setBottomBarColor?.('#07101c');
  setViewportVariables(app);

  const syncViewport = () => setViewportVariables(app);
  app.onEvent?.('viewportChanged', syncViewport);
  app.onEvent?.('safeAreaChanged', syncViewport);
  app.onEvent?.('contentSafeAreaChanged', syncViewport);
  app.onEvent?.('fullscreenChanged', syncViewport);

  return () => {
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
