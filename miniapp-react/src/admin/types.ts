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

export type PaymentMethod = 'cash' | 'click' | 'payme';
export type PaymentStatus = 'pending' | 'paid' | 'rejected' | 'cancelled';

export interface PaymentSettings {
  payment_card_number?: string | null;
  payment_card_holder?: string | null;
  click_service_id?: string | null;
  click_merchant_id?: string | null;
  click_merchant_user_id?: string | null;
  click_secret_key_masked?: string | null;
  click_is_configured?: boolean;
  payme_merchant_id?: string | null;
  payme_secret_key_masked?: string | null;
  payme_test_mode?: boolean;
  payme_is_configured?: boolean;
}

export interface AdminOrder {
  id: string;
  status: AdminOrderStatus;
  total: number | null;
  created_at: string;
  items: AdminOrderItem[] | null;
  users?: { full_name?: string | null; username?: string | null; phone?: string | null } | null;
  delivery_address?: string | null;
  location?: { lat?: number; lon?: number; latitude?: number; longitude?: number } | null;
  subtotal?: number | null;
  delivery_fee?: number | null;
  discount?: number | null;
  note?: string | null;
  courier_id?: number | null;
  courier?: { full_name?: string | null; username?: string | null } | null;
  payment_method?: PaymentMethod;
  payment_status?: PaymentStatus;
  payment_receipt_url?: string | null;
  payment_receipt_uploaded_at?: string | null;
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
  phone?: string | null;
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

export type AdminRole = 'superadmin' | 'admin' | 'staff' | 'courier';

export interface AdminCourier {
  user_id: number;
  added_at: string;
  users?: { full_name?: string | null; username?: string | null } | null;
}

export interface AdminStats {
  today?: {
    orders?: number;
    orders_diff?: number;
    revenue?: number;
    revenue_diff?: number;
    average_order_value?: number;
    active_orders?: number;
    delivered_orders?: number;
    cancelled_orders?: number;
    paid_orders?: number;
    pending_payment_orders?: number;
    pending_payment_amount?: number;
    unique_customers?: number;
    cancellation_rate?: number;
    delivery_rate?: number;
  };
  today_count?: number;
  today_count_diff?: number;
  today_revenue?: number;
  today_revenue_diff?: number;
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
