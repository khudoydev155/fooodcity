export type Lang = 'uz' | 'ru' | 'en';

export type OrderStatus = 'new' | 'confirmed' | 'cooking' | 'delivering' | 'delivered' | 'cancelled';

export interface Category {
  id: string;
  name_uz: string;
  name_ru?: string;
  name_en?: string;
  emoji?: string | null;
  sort_order: number;
  /** name_${lang} ko'rinishidagi dinamik kirish uchun */
  [key: string]: unknown;
}

export interface MenuItem {
  id: string;
  category_id: string;
  name_uz: string;
  name_ru?: string;
  name_en?: string;
  description_uz?: string;
  description_ru?: string;
  description_en?: string;
  price: number;
  image_url?: string | null;
  emoji?: string | null;
  badge?: string | null;
  is_available: boolean;
  categories?: Category | null;
  [key: string]: unknown;
}

export interface CartEntry {
  item: MenuItem;
  qty: number;
}

export type Cart = Record<string, CartEntry>;

export interface AppliedCoupon {
  code: string;
  discount_type: 'percent' | 'fixed';
  discount_value: number;
  /** API validatsiyasi qaytargan tayyor chegirma summasi */
  discount?: number;
}

export interface OrderItem {
  id?: string;
  name?: string;
  name_uz?: string;
  name_ru?: string;
  name_en?: string;
  qty?: number;
  price?: number;
  emoji?: string;
  image_url?: string | null;
  category_id?: string | null;
}

export interface UserOrder {
  id: string;
  status: OrderStatus;
  created_at: string;
  total: number;
  items: OrderItem[];
}

export interface Profile {
  points: number;
  orders: number;
  spent: number;
}

export interface Avatar {
  id: string;
  emoji: string;
  bg: string;
  label: string;
}
