const webApp = () => window.Telegram?.WebApp;

export function initializeTelegram(): void {
  const app = webApp();
  if (!app) return;
  app.ready();
  app.expand();
  app.disableVerticalSwipes?.();
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
