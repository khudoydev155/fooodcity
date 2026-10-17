// Telegram Mini App WebApp API — loyihada ishlatiladigan qismi
export interface TgUser {
  id: number;
  first_name: string;
  last_name?: string;
  username?: string;
  language_code?: string;
  photo_url?: string;
}

export interface TgPopupParams {
  title?: string;
  message: string;
  buttons?: { id?: string; type?: string; text?: string }[];
}

export interface TgLocationData {
  latitude: number;
  longitude: number;
}

export interface TgLocationManager {
  init(callback?: () => void): void;
  isLocationAvailable: boolean;
  getLocation(callback: (data: TgLocationData | null) => void): void;
}

export interface TgSafeAreaInset {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export interface TelegramWebApp {
  ready(): void;
  expand(): void;
  requestFullscreen?: () => void;
  safeAreaInset?: TgSafeAreaInset;
  contentSafeAreaInset?: TgSafeAreaInset;
  onEvent?: (eventType: string, eventHandler: () => void) => void;
  offEvent?: (eventType: string, eventHandler: () => void) => void;
  initData: string;
  initDataUnsafe: { user?: TgUser };
  HapticFeedback: {
    impactOccurred(style: 'light' | 'medium' | 'heavy' | 'rigid' | 'soft'): void;
    selectionChanged(): void;
    notificationOccurred(type: 'error' | 'success' | 'warning'): void;
  };
  showPopup(params: TgPopupParams, callback?: (buttonId: string) => void): void;
  openTelegramLink(url: string): void;
  isVersionAtLeast(version: string): boolean;
  LocationManager: TgLocationManager;
}

declare global {
  interface Window {
    Telegram?: { WebApp: TelegramWebApp };
    webkitAudioContext?: typeof AudioContext;
    onTelegramAuth?: (user: Record<string, unknown>) => void;
  }
}
