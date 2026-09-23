/// <reference types="vite/client" />

declare global {
  interface TelegramWebApp {
    initData: string;
    initDataUnsafe: { user?: { id: number; first_name: string; username?: string } };
    ready: () => void;
    expand: () => void;
    close: () => void;
    enableClosingConfirmation: () => void;
    disableVerticalSwipes?: () => void;
    isClosingConfirmationEnabled?: boolean;
    BackButton: { show: () => void; hide: () => void; onClick: (callback: () => void) => void; offClick: (callback: () => void) => void };
    MainButton: { text: string; show: () => void; hide: () => void; enable: () => void; disable: () => void; setText: (text: string) => void; onClick: (callback: () => void) => void; offClick: (callback: () => void) => void };
    HapticFeedback: { impactOccurred: (style: 'light' | 'medium' | 'heavy') => void; notificationOccurred: (type: 'error' | 'success' | 'warning') => void; selectionChanged: () => void };
    colorScheme: 'light' | 'dark';
    themeParams: Record<string, string>;
  }
  interface Window { Telegram?: { WebApp: TelegramWebApp } }
}
export {};
