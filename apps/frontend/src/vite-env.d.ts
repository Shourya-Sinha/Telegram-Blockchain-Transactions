/// <reference types="vite/client" />

declare global {
  type TelegramSafeAreaInset = { top: number; right: number; bottom: number; left: number };
  type TelegramWebAppEvent = 'viewportChanged' | 'safeAreaChanged' | 'contentSafeAreaChanged' | 'fullscreenChanged' | 'fullscreenFailed';

  interface TelegramWebApp {
    initData: string;
    initDataUnsafe: { user?: { id: number; first_name: string; username?: string } };
    version?: string;
    platform?: string;
    viewportHeight?: number;
    viewportStableHeight?: number;
    isExpanded?: boolean;
    isFullscreen?: boolean;
    safeAreaInset?: TelegramSafeAreaInset;
    contentSafeAreaInset?: TelegramSafeAreaInset;
    ready: () => void;
    expand: () => void;
    requestFullscreen?: () => void;
    exitFullscreen?: () => void;
    close: () => void;
    enableClosingConfirmation: () => void;
    disableVerticalSwipes?: () => void;
    isClosingConfirmationEnabled?: boolean;
    setHeaderColor?: (color: string) => void;
    setBackgroundColor?: (color: string) => void;
    setBottomBarColor?: (color: string) => void;
    onEvent?: (event: TelegramWebAppEvent, callback: () => void) => void;
    offEvent?: (event: TelegramWebAppEvent, callback: () => void) => void;
    BackButton: { show: () => void; hide: () => void; onClick: (callback: () => void) => void; offClick: (callback: () => void) => void };
    MainButton: { text: string; show: () => void; hide: () => void; enable: () => void; disable: () => void; setText: (text: string) => void; onClick: (callback: () => void) => void; offClick: (callback: () => void) => void };
    HapticFeedback: { impactOccurred: (style: 'light' | 'medium' | 'heavy') => void; notificationOccurred: (type: 'error' | 'success' | 'warning') => void; selectionChanged: () => void };
    colorScheme: 'light' | 'dark';
    themeParams: Record<string, string>;
  }
  interface Window { Telegram?: { WebApp: TelegramWebApp } }
}
export {};
