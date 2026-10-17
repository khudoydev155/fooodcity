import { createClient } from '@supabase/supabase-js';
import type { TelegramWebApp } from '../telegram.d';
import type { Lang, MenuItem } from './types';

// NOTE: Enable Realtime for menu_items table in Supabase Dashboard:
// Supabase → Database → Replication → enable menu_items table
export const API_BASE: string =
  import.meta.env.VITE_API_BASE ??
  (import.meta.env.DEV ? '' : "https://worker-production-7c481.up.railway.app");

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
  openTelegramLink: (url) => { window.open(url, '_blank', 'noopener,noreferrer'); },
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
const storedLang = localStorage.getItem('lang') || 'uz';
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

const MENU_IMAGE_URLS = {
  burger: 'https://images.unsplash.com/photo-1568901346375-23c9450c58cd?auto=format&fit=crop&w=900&q=85',
  chickenBurger: 'https://images.unsplash.com/photo-1606755962773-d324e0a13086?auto=format&fit=crop&w=900&q=85',
  pizza: 'https://images.unsplash.com/photo-1571407970349-bc81e7e96d47?auto=format&fit=crop&w=900&q=85',
  fries: 'https://images.unsplash.com/photo-1573080496219-bb080dd4f877?auto=format&fit=crop&w=900&q=85',
  nuggets: 'https://images.unsplash.com/photo-1562967914-608f82629710?auto=format&fit=crop&w=900&q=85',
  cheese: 'https://images.unsplash.com/photo-1531749668029-2db88e4276c7?auto=format&fit=crop&w=900&q=85',
  cola: 'https://images.unsplash.com/photo-1554866585-cd94860890b7?auto=format&fit=crop&w=900&q=85',
  orangeDrink: 'https://images.unsplash.com/photo-1629203851122-3726ecdf080e?auto=format&fit=crop&w=900&q=85',
  wrap: 'https://images.unsplash.com/photo-1626700051175-6818013e1d4f?auto=format&fit=crop&w=900&q=85',
  meal: 'https://images.unsplash.com/photo-1600891964599-f61ba0e24092?auto=format&fit=crop&w=900&q=85'
} as const;

export function menuItemImageUrl(item: MenuItem): string {
  if (item.image_url?.trim()) return item.image_url;

  const text = [
    item.name_uz, item.name_ru, item.name_en,
    item.description_uz, item.description_ru, item.description_en
  ].filter(Boolean).join(' ').toLocaleLowerCase();

  if (['lavash', 'shawarma', 'шаурма', 'wrap'].some(term => text.includes(term))) return MENU_IMAGE_URLS.wrap;
  if (['tovuqli burger', 'chicken burger', 'куриный бургер', 'chicken sandwich'].some(term => text.includes(term))) return MENU_IMAGE_URLS.chickenBurger;
  if (['burger', 'бургер'].some(term => text.includes(term))) return MENU_IMAGE_URLS.burger;
  if (['pizza', 'пицц', 'пицца', 'margarita', 'маргарита', 'pepperoni', 'пепперони'].some(term => text.includes(term))) return MENU_IMAGE_URLS.pizza;
  if (['fri', 'fries', 'kartoshka', 'картоф', 'french fries'].some(term => text.includes(term))) return MENU_IMAGE_URLS.fries;
  if (['nugget', 'nagget', 'наггет'].some(term => text.includes(term))) return MENU_IMAGE_URLS.nuggets;
  if (['cheese', 'pishloq', 'сыр', 'tayoqcha'].some(term => text.includes(term))) return MENU_IMAGE_URLS.cheese;
  if (['cola', 'coca', 'kola', 'кола'].some(term => text.includes(term))) return MENU_IMAGE_URLS.cola;
  if (['fanta', 'orange', 'апельсин'].some(term => text.includes(term))) return MENU_IMAGE_URLS.orangeDrink;

  const category = [
    item.categories?.name_uz, item.categories?.name_ru, item.categories?.name_en
  ].filter(Boolean).join(' ').toLocaleLowerCase();
  if (item.category_id === '11111111-1111-1111-1111-111111111111' || category.includes('burger') || category.includes('бургер')) return MENU_IMAGE_URLS.burger;
  if (item.category_id === '22222222-2222-2222-2222-222222222222' || category.includes('pizza') || category.includes('пицц')) return MENU_IMAGE_URLS.pizza;
  if (item.category_id === '33333333-3333-3333-3333-333333333333' || category.includes('snack') || category.includes('snek') || category.includes('снек')) return MENU_IMAGE_URLS.fries;
  if (item.category_id === '44444444-4444-4444-4444-444444444444' || category.includes('drink') || category.includes('напит')) return MENU_IMAGE_URLS.cola;
  return MENU_IMAGE_URLS.meal;
}

// Foydalanuvchini tasdiqlovchi endpointlar uchun umumiy sarlavhalar.
// Backend user_id ni aynan shu initData'dan oladi (IDOR himoyasi).
export const authHeaders = (): Record<string, string> => ({
  'X-TG-Init-Data': tg.initData
});
