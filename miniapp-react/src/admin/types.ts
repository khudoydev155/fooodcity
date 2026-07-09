import type { ReactNode } from 'react';

export type AdminOrderStatus = 'new' | 'confirmed' | 'cooking' | 'delivering' | 'delivered' | 'cancelled';

export interface AdminOrderItem {
  name?: string;
  name_uz?: string;
  name_ru?: string;
  name_en?: string;
  qty?: number;
  price?: number;
  emoji?: string;
}

export interface AdminOrder {
  id: string;
  status: AdminOrderStatus;
  total: number | null;
  created_at: string;
  items: AdminOrderItem[] | null;
  users?: { full_name?: string | null; username?: string | null } | null;
  delivery_address?: string | null;
  delivery_fee?: number | null;
  discount?: number | null;
  note?: string | null;
}

export interface AdminMenuItem {
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
}

export interface AdminCategory {
  id: string;
  name_uz: string;
  emoji?: string | null;
}

export interface AdminUser {
  id: number;
  full_name?: string | null;
  username?: string | null;
  total_orders?: number | null;
  total_spent?: number | null;
  loyalty_points?: number | null;
  created_at: string;
  is_blocked?: boolean;
}

export interface AdminCoupon {
  id: string;
  code: string;
  discount_type: 'percent' | 'fixed';
  discount_value: number;
  used_count: number;
  max_uses: number;
  is_active: boolean;
}

export interface AdminStats {
  today?: {
    orders?: number;
    orders_diff?: number;
    revenue?: number;
    revenue_diff?: number;
  };
  total_users?: number;
}

export interface AdminAnalytics {
  returning_percent: number;
  revenue_chart: { labels: string[]; data: number[] };
  top_items_chart: { labels: string[]; data: number[] };
}

export type ToastType = 'success' | 'error' | 'info';

/** Har bir view'ga uzatiladigan umumiy kontekst */
export interface AdminCtx {
  showToast: (msg: string, type?: ToastType) => void;
  openModal: (title: string, body: ReactNode, footer?: ReactNode) => void;
  closeModal: () => void;
  refreshTick: number;
  bumpRefresh: () => void;
}

/** Modal footer tugmasi forma ichidagi saqlash funksiyasini chaqirishi uchun */
export interface SaveRef {
  current: (() => Promise<void>) | null;
}
