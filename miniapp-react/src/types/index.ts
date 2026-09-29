// src/types/index.ts

/**
 * Type definitions for Food City admin panel.
 * All UI text and comments are in Oʻzbek tilida.
 */

// Order related types
export type OrderStatus =
  | 'new'
  | 'preparing'
  | 'ready'
  | 'delivering'
  | 'completed'
  | 'cancelled';

export interface OrderItem {
  /** Mahsulot ID */
  productId: string;
  /** Mahsulot nomi */
  name: string;
  /** Soni */
  quantity: number;
  /** Xarid vaqtida narxi */
  priceAtPurchase: number;
  /** Qo'shimcha izoh */
  notes?: string;
}

export interface DeliveryAddress {
  /** Ko'cha manzili */
  street: string;
  /** Shahar */
  city: string;
  /** Pochta indeksi */
  zipCode: string;
}

export interface Order {
  /** Buyurtma ID */
  id: string;
  /** Foydalanuvchi ID */
  customerId: string;
  /** Foydalanuvchi ismi */
  customerName: string;
  /** Buyurtma holati */
  status: OrderStatus;
  /** Mahsulotlar ro'yxati */
  items: OrderItem[];
  /** Umumiy summa */
  totalAmount: number;
  /** Yetkazib berish manzili */
  deliveryAddress: DeliveryAddress;
  /** Yaratilgan vaqt */
  createdAt: string; // ISO string
  /** Yangilangan vaqt */
  updatedAt: string;
}

// Menu related types
export interface MenuItem {
  /** Taom ID */
  id: string;
  /** Taom nomi */
  name: string;
  /** Narxi */
  price: number;
  /** Kategoriya ID */
  categoryId: string;
  /** Ta'rif (ixtiyoriy) */
  description?: string;
  /** Rasm URL (ixtiyoriy) */
  imageUrl?: string;
  /** Mavjudligi */
  available: boolean;
}

export interface Category {
  /** Kategoriya ID */
  id: string;
  /** Kategoriya nomi */
  name: string;
  /** Ta'rif (ixtiyoriy) */
  description?: string;
  /** Ona kategoriya ID (ixtiyoriy) */
  parentId?: string;
}

// User related types
export type UserRole = 'admin' | 'staff' | 'owner';

export interface User {
  /** Foydalanuvchi ID */
  id: string;
  /** Ismi */
  name: string;
  /** Email */
  email: string;
  /** Rol */
  role: UserRole;
  /** Ro'yxatdan o'tgan sana */
  createdAt: string;
}

// Dashboard statistikasi
export interface DashboardStats {
  /** Jami buyurtma soni */
  totalOrders: number;
  /** Jami daromad */
  totalRevenue: number;
  /** Yangi buyurtmalar */
  newOrders: number;
  /** Tayyorlanayotgan buyurtmalar */
  preparingOrders: number;
  /** Yetkazib berilayotgan buyurtmalar */
  deliveringOrders: number;
  /** To'langan buyurtmalar */
  completedOrders: number;
}

// Kuponlar
export interface Coupon {
  /** Kupon ID */
  id: string;
  /** Kupon kodi */
  code: string;
  /** Chegirma foizi */
  discountPercent: number;
  /** Boshlanish vaqti */
  validFrom: string;
  /** Tugash vaqti */
  validTo: string;
  /** Maksimal foydalanish soni */
  maxUses: number;
  /** Hozirgi foydalanish soni */
  usedCount: number;
  /** Aktive (faol) */
  active: boolean;
}

// Admin foydalanuvchi
export interface AdminUser {
  /** Admin ID */
  id: string;
  /** Foydalanuvchi nomi */
  username: string;
  /** Rollar ro'yxati */
  roles: UserRole[];
  /** Kiritilgan token */
  token?: string;
}

/**
 * Boshqa umumiy turlar shu yerga qo'shiladi.
 */
