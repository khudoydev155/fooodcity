import { createClient } from '@supabase/supabase-js';
import type { TelegramWebApp } from '../telegram.d';
import type { Lang } from './types';

// NOTE: Enable Realtime for menu_items table in Supabase Dashboard:
// Supabase → Database → Replication → enable menu_items table
export const API_BASE = "https://worker-production-7c481.up.railway.app";

// TELEGRAM INIT (brauzerda ochilganda ishlaydigan zaxira stub bilan)
const tgStub: TelegramWebApp = {
  ready: () => {},
  expand: () => {},
  initData: '',
  initDataUnsafe: {},
  HapticFeedback: {
    impactOccurred: () => {},
    selectionChanged: () => {},
    notificationOccurred: () => {}
  },
  showPopup: (p) => alert((p.title ? p.title + '\n' : '') + (p.message || '')),
  isVersionAtLeast: () => false,
  LocationManager: {
    init: (cb) => cb?.(),
    isLocationAvailable: false,
    getLocation: (cb) => cb(null)
  }
};

export const tg: TelegramWebApp = window.Telegram?.WebApp || tgStub;

try {
  tg.ready();
  tg.expand();
} catch (e) {
  console.error("TG Init error:", e);
}

// ENV & SUPABASE
const SUPABASE_URL = "https://jciuzrttciqmmnweglpd.supabase.co";
const SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImpjaXV6cnR0Y2lxbW1ud2VnbHBkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzgzMzUyMjgsImV4cCI6MjA5MzkxMTIyOH0.sBu-06SdGf28Py9FdJaRw1xd2OjaRrk7NGcFPe2gwGU";

export const supabaseClient = createClient(SUPABASE_URL, SUPABASE_KEY);

fetch(`${API_BASE}/health`).then(res => res.json()).catch(() => {});

export const user = tg.initDataUnsafe?.user || { id: 111111, first_name: "Mijoz", language_code: "uz" };

const isLang = (v: string): v is Lang => ['uz', 'ru', 'en'].includes(v);
const storedLang = localStorage.getItem('lang') || user.language_code || 'uz';
export const lang: Lang = isLang(storedLang) ? storedLang : 'uz';

export const strings: Record<Lang, { search: string; add: string; cart: string }> = {
  uz: { search: "Qidirish...", add: "Qo'shish", cart: "Savatcha" },
  ru: { search: "Поиск...", add: "Добавить", cart: "Корзина" },
  en: { search: "Search...", add: "Add", cart: "Cart" }
};

export const categoryGradients: Record<string, string> = {
  'Burgerlar': 'linear-gradient(135deg, #8B4513, #D2691E)',
  'Burgers': 'linear-gradient(135deg, #8B4513, #D2691E)',
  'Pizzalar': 'linear-gradient(135deg, #8B0000, #DC143C)',
  'Pizza': 'linear-gradient(135deg, #8B0000, #DC143C)',
  'Sneklar': 'linear-gradient(135deg, #DAA520, #FFD700)',
  'Snacks': 'linear-gradient(135deg, #DAA520, #FFD700)',
  'Ichimliklar': 'linear-gradient(135deg, #1E3A5F, #4169E1)',
  'Drinks': 'linear-gradient(135deg, #1E3A5F, #4169E1)',
  'Kombolar': 'linear-gradient(135deg, #2D5016, #228B22)',
  'Combo': 'linear-gradient(135deg, #2D5016, #228B22)'
};

export const DEFAULT_GRADIENT = 'linear-gradient(135deg, #3D1A00, #2D1500)';
export const DELIVERY_FEE = 15000;

// Foydalanuvchini tasdiqlovchi endpointlar uchun umumiy sarlavhalar.
// Backend user_id ni aynan shu initData'dan oladi (IDOR himoyasi).
export const authHeaders = (): Record<string, string> => ({
  'X-TG-Init-Data': tg.initData
});

