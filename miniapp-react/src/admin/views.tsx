import { useState, useEffect, useRef, useCallback } from 'react';
import Chart from 'chart.js/auto';
import flatpickr from 'flatpickr';
import type { Instance as FlatpickrInstance } from 'flatpickr/dist/types/instance';
import { Uzbek } from 'flatpickr/dist/l10n/uz.js';
import * as XLSX from 'xlsx';
import { API_BASE, apiGet, apiPost, apiPut, apiDelete, apiUploadMenuImage, getToken } from './api';
import type {
  AdminCtx, AdminOrder, AdminOrderStatus, AdminMenuItem, AdminCategory,
  AdminUser, AdminCoupon, AdminStats, AdminAnalytics, SaveRef, AdminCourier, PaymentSettings
} from './types';

// ─── ORDER DETAIL MODAL ──────────────────────────────────────────────────────

// Qidiruv maydonlari uchun: har bir tugma bosilganda emas, foydalanuvchi
// yozishni to'xtatgandan keyingina so'rov yuboriladi (ortiqcha API
// chaqiruvlarining oldini oladi).
function useDebouncedValue<T>(value: T, delayMs = 350): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(t);
  }, [value, delayMs]);
  return debounced;
}

const ORDER_STATUS_MAP: Record<string, { label: string; color: string }> = {
  'new': { label: 'Yangi', color: '#FFB800' },
  'confirmed': { label: 'Tasdiqlangan', color: '#00C853' },
  'cooking': { label: 'Tayyorlanmoqda', color: '#FF6B00' },
  'delivering': { label: "Yo'lga chiqdi", color: '#2196F3' },
  'delivered': { label: 'Yetkazildi', color: '#00C853' },
  'cancelled': { label: 'Bekor qilingan', color: '#E8001C' }
};

function CourierAssignBox({ order, onAssign }: {
  order: AdminOrder;
  onAssign: (courierId: number) => void;
}) {
  const [couriers, setCouriers] = useState<AdminCourier[] | null>(null);
  const [courierLoadError, setCourierLoadError] = useState(false);

  useEffect(() => {
    void loadCouriers();
  }, []);

  async function loadCouriers(): Promise<void> {
    try {
      const data = await apiGet<AdminCourier[]>('/api/admin/couriers');
      if (!Array.isArray(data)) throw new Error("Kuryerlar noto'g'ri formatda keldi");
      setCouriers(data);
      setCourierLoadError(false);
    } catch (error) {
      console.error('Courier options load failed:', error);
      setCourierLoadError(true);
      setCouriers(current => current ?? []);
    }
  }

  return (
    <div style={{ padding: 16, borderBottom: '1px solid rgba(255,255,255,0.05)', margin: '0 -1.5rem' }}>
      <div style={{ color: '#888', fontSize: 11, textTransform: 'uppercase', marginBottom: 8 }}>KURYER</div>
      {order.courier?.full_name ? (
        <div style={{ marginBottom: 8 }}>🛵 <strong>{order.courier.full_name}</strong> biriktirilgan</div>
      ) : (
        <div style={{ color: '#aaa', marginBottom: 8 }}>Hali kuryer biriktirilmagan</div>
      )}
      {couriers === null ? (
        <div style={{ color: '#888', fontSize: 13 }}>Yuklanmoqda...</div>
      ) : courierLoadError && couriers.length === 0 ? (
        <div className="admin-data-error" role="alert">
          Kuryerlar ro'yxatini yuklab bo'lmadi.
          <button className="btn btn-outline sm" onClick={() => void loadCouriers()}>Qayta urinish</button>
        </div>
      ) : courierLoadError ? (
        <div className="admin-data-warning" role="status">Kuryerlar ro'yxati eskirgan bo'lishi mumkin.</div>
      ) : couriers.length === 0 ? (
        <div style={{ color: '#888', fontSize: 13 }}>Kuryerlar bo'limida avval kuryer qo'shing</div>
      ) : (
        <select
          className="form-select"
          defaultValue=""
          onChange={e => { if (e.target.value) onAssign(Number(e.target.value)); }}
        >
          <option value="" disabled>Kuryer tanlang...</option>
          {couriers.map(c => (
            <option key={c.user_id} value={c.user_id}>
              {c.users?.full_name || c.users?.username || c.user_id}
            </option>
          ))}
        </select>
      )}
    </div>
  );
}

function PaymentBadge({ order }: { order: AdminOrder }) {
  const method = order.payment_method || 'cash';
  const pStatus = order.payment_status || 'pending';
  let text: string; let color: string;
  if (pStatus === 'paid') {
    text = method === 'click' ? "✅ Click (to'langan)" : method === 'payme' ? "✅ Payme (to'langan)" : "✅ To'langan";
    color = '#10B981';
  } else if (pStatus === 'rejected') {
    text = '❌ Rad etilgan';
    color = '#EF4444';
  } else if (method === 'click') {
    text = '🟢 Click kutilmoqda';
    color = '#00B159';
  } else if (method === 'payme') {
    text = '🔵 Payme kutilmoqda';
    color = '#00CCCC';
  } else {
    text = '💵 Naqd';
    color = '#9CA3AF';
  }
  return (
    <span style={{ background: color + '22', color, padding: '3px 10px', borderRadius: 50, fontWeight: 700, fontSize: 12, whiteSpace: 'nowrap' }}>
      {text}
    </span>
  );
}

const PAYMENT_STATUS_UI: Record<string, { label: string; color: string }> = {
  pending: { label: 'Kutilmoqda', color: '#F59E0B' },
  paid: { label: "To'langan", color: '#10B981' },
  rejected: { label: 'Rad etilgan', color: '#EF4444' },
};

function PaymentBox({ order, onConfirm }: {
  order: AdminOrder;
  onConfirm: (id: string) => Promise<void>;
  onReject?: (id: string) => Promise<void>;
}) {
  const [processing, setProcessing] = useState(false);
  const method = order.payment_method || 'cash';
  const pStatus = order.payment_status || 'pending';
  const ui = PAYMENT_STATUS_UI[pStatus] || PAYMENT_STATUS_UI.pending;
  const btn = (bg: string): React.CSSProperties => ({
    flex: 1, padding: 10, borderRadius: 8, border: 'none', background: bg, color: '#fff', fontWeight: 700, cursor: 'pointer'
  });

  const methodTitle =
    method === 'click' ? '🟢 Click to‘lovi' :
    method === 'payme' ? '🔵 Payme to‘lovi' : '💵 Naqd pul';

  return (
    <div style={{ padding: 16, borderBottom: '1px solid rgba(255,255,255,0.05)', margin: '0 -1.5rem' }}>
      <div style={{ color: '#888', fontSize: 11, textTransform: 'uppercase', marginBottom: 8 }}>TO'LOV</div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
        <div style={{ fontWeight: 700 }}>{methodTitle}</div>
        <div style={{ background: ui.color + '22', color: ui.color, padding: '4px 12px', borderRadius: 50, fontWeight: 700, fontSize: 12 }}>
          {ui.label}
        </div>
      </div>

      {(method === 'click' || method === 'payme') && (
        <div style={{ color: '#aaa', fontSize: 12, marginBottom: 8 }}>
          {pStatus === 'paid'
            ? "⚡ To'lov tizim orqali avtomatik tasdiqlangan (100% kafolatlangan)"
            : "⏳ Mijozdan avtomatik to'lov kutilmoqda..."}
        </div>
      )}

      {pStatus !== 'paid' && method === 'cash' && (
        <div style={{ display: 'flex', gap: 8 }}>
          <button
            style={btn('#10B981')}
            disabled={processing}
            onClick={async () => {
              setProcessing(true);
              try { await onConfirm(order.id); } finally { setProcessing(false); }
            }}
          >
            {processing ? '⏳ Saqlanmoqda...' : "✅ To'landi deb belgilash"}
          </button>
        </div>
      )}
    </div>
  );
}

function OrderDetailBody({ order, onStatusUpdate, onAssignCourier, onConfirmPayment, onRejectPayment }: {
  order: AdminOrder;
  onStatusUpdate: (id: string, status: AdminOrderStatus) => Promise<void>;
  onAssignCourier: (id: string, courierId: number) => Promise<void>;
  onConfirmPayment: (id: string) => Promise<void>;
  onRejectPayment: (id: string) => Promise<void>;
}) {
  const status = order.status;
  const info = ORDER_STATUS_MAP[status] || { label: status, color: '#aaa' };
  const formattedDate = new Date(order.created_at).toLocaleString('uz-UZ', {
    day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit'
  });
  const items = order.items || [];
  const subtotal = items.reduce((s, i) => s + ((i.price || 0) * (i.qty || 1)), 0);
  const deliveryFee = order.delivery_fee || 0;
  const discount = order.discount || 0;
  const total = order.total || (subtotal + deliveryFee - discount);

  const btnStyle = (bg: string, full?: boolean): React.CSSProperties => ({
    flex: full ? undefined : 1, width: full ? '100%' : undefined, padding: 10,
    borderRadius: 8, border: 'none', background: bg, color: '#fff', fontWeight: 700, cursor: 'pointer'
  });

  return (
    <>
      <div style={{ background: 'linear-gradient(135deg,#1e3a5f,#16213e)', padding: 20, borderRadius: '12px 12px 0 0', margin: '-1.5rem -1.5rem 0 -1.5rem' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <div style={{ color: '#FFB800', fontSize: 20, fontWeight: 800 }}>{order.id}</div>
            <div style={{ color: '#aaa', fontSize: 13 }}>{formattedDate}</div>
          </div>
          <div style={{ background: info.color + '22', color: info.color, padding: '6px 14px', borderRadius: 50, fontWeight: 700, fontSize: 13 }}>
            {info.label}
          </div>
        </div>
      </div>

      <div style={{ padding: 16, borderBottom: '1px solid rgba(255,255,255,0.05)', margin: '0 -1.5rem' }}>
        <div style={{ color: '#888', fontSize: 11, textTransform: 'uppercase', marginBottom: 8 }}>MIJOZ MA'LUMOTLARI</div>
        <div style={{ fontWeight: 700, fontSize: 15 }}>{order.users?.full_name || "Noma'lum"}</div>
        <div style={{ color: '#FFB800', fontSize: 13 }}>{order.users?.username ? '@' + order.users.username : '-'}</div>
        <div style={{ color: '#aaa', fontSize: 13, marginTop: 4 }}>📍 {order.delivery_address || "Manzil ko'rsatilmagan"}</div>
        {order.note ? <div style={{ color: '#aaa', fontSize: 13 }}>📝 {order.note}</div> : null}
      </div>

      <PaymentBox order={order} onConfirm={onConfirmPayment} onReject={onRejectPayment} />

      <CourierAssignBox order={order} onAssign={(courierId) => onAssignCourier(order.id, courierId)} />

      <div style={{ padding: 16, borderBottom: '1px solid rgba(255,255,255,0.05)', margin: '0 -1.5rem' }}>
        <div style={{ color: '#888', fontSize: 11, textTransform: 'uppercase', marginBottom: 8 }}>BUYURTMA TARKIBI</div>
        {items.map((item, idx) => (
          <div key={idx} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 0', borderBottom: '1px solid rgba(255,255,255,0.03)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: 20 }}>{item.emoji || '🍽'}</span>
              <div>
                <div style={{ fontWeight: 600, fontSize: 14 }}>{item.name_uz || item.name_ru || item.name || 'Taom'}</div>
                <div style={{ color: '#888', fontSize: 12 }}>{(item.price || 0).toLocaleString()} so'm × {item.qty || 1}</div>
              </div>
            </div>
            <div style={{ fontWeight: 700, color: '#FFB800' }}>{((item.price || 0) * (item.qty || 1)).toLocaleString()} so'm</div>
          </div>
        ))}
      </div>

      <div style={{ padding: 16, borderBottom: '1px solid rgba(255,255,255,0.05)', margin: '0 -1.5rem' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', color: '#aaa', fontSize: 14, marginBottom: 6 }}>
          <span>Mahsulotlar:</span><span>{subtotal.toLocaleString()} so'm</span>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', color: '#aaa', fontSize: 14, marginBottom: 6 }}>
          <span>Yetkazib berish:</span><span>{deliveryFee.toLocaleString()} so'm</span>
        </div>
        {discount > 0 && (
          <div style={{ display: 'flex', justifyContent: 'space-between', color: '#00C853', fontSize: 14, marginBottom: 6 }}>
            <span>Chegirma:</span><span>-{discount.toLocaleString()} so'm</span>
          </div>
        )}
        <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 800, fontSize: 17, marginTop: 8, paddingTop: 8, borderTop: '1px solid rgba(255,255,255,0.1)' }}>
          <span>JAMI:</span><span style={{ color: '#FFB800' }}>{total.toLocaleString()} so'm</span>
        </div>
      </div>

      <div style={{ padding: 16, margin: '0 -1.5rem -1.5rem -1.5rem' }}>
        <div style={{ color: '#888', fontSize: 11, textTransform: 'uppercase', marginBottom: 10 }}>STATUS O'ZGARTIRISH</div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          {status === 'new' && (
            <>
              <button onClick={() => onStatusUpdate(order.id, 'confirmed')} style={btnStyle('#00C853')}>✅ Tasdiqlash</button>
              <button onClick={() => onStatusUpdate(order.id, 'cancelled')} style={btnStyle('#E8001C')}>❌ Bekor qilish</button>
            </>
          )}
          {status === 'confirmed' && (
            <button onClick={() => onStatusUpdate(order.id, 'cooking')} style={btnStyle('#FF6B00', true)}>👨‍🍳 Tayyorlanmoqda</button>
          )}
          {status === 'cooking' && (
            <button onClick={() => onStatusUpdate(order.id, 'delivering')} style={btnStyle('#2196F3', true)}>🛵 Yo'lga chiqdi</button>
          )}
          {status === 'delivering' && (
            <button onClick={() => onStatusUpdate(order.id, 'delivered')} style={btnStyle('#00C853', true)}>✅ Yetkazildi</button>
          )}
        </div>
      </div>
    </>
  );
}

function useOrderDetail(ctx: AdminCtx, reload: () => void) {
  const { showToast, openModal, closeModal } = ctx;

  return useCallback(async function showOrderDetail(orderId: string): Promise<void> {
    try {
      const orders = await apiGet<AdminOrder[]>(`/api/admin/orders?search=${encodeURIComponent(orderId)}`);
      const order = orders.find(x => x.id === orderId);
      if (!order) return;

      const onStatusUpdate = async (id: string, status: AdminOrderStatus): Promise<void> => {
        if (!confirm('Tasdiqlaysizmi?')) return;
        try {
          await apiPost(`/api/admin/orders/${id}/status`, { status });
          showToast('Yangilandi');
          closeModal();
          reload();
        } catch (err) { showToast(err instanceof Error ? err.message : 'Holatni yangilab bo‘lmadi', 'error'); }
      };

      const onAssignCourier = async (id: string, courierId: number): Promise<void> => {
        try {
          const result = await apiPost<{ notification_sent?: boolean }>(
            `/api/admin/orders/${id}/assign-courier`,
            { courier_id: courierId }
          );
          showToast(
            result.notification_sent
              ? 'Kuryer biriktirildi va buyurtma manzili Telegram orqali yuborildi'
              : "Kuryer biriktirildi, lekin Telegram xabari yuborilmadi",
            result.notification_sent ? 'success' : 'info'
          );
          closeModal();
          reload();
        } catch (err) { showToast(err instanceof Error ? err.message : 'Kuryer biriktirilmadi', 'error'); }
      };

      const onConfirmPayment = async (id: string): Promise<void> => {
        if (!confirm("To'lov qabul qilinganini tasdiqlaysizmi?")) return;
        try {
          await apiPost(`/api/admin/orders/${id}/confirm-payment`, {});
          showToast("To'lov tasdiqlandi");
          closeModal();
          reload();
        } catch (err) { showToast(err instanceof Error ? err.message : 'To‘lov tasdiqlanmadi', 'error'); }
      };

      const onRejectPayment = async (id: string): Promise<void> => {
        if (!confirm("Chekni rad etasizmi? Mijozga qayta yuborish imkoni beriladi.")) return;
        try {
          await apiPost(`/api/admin/orders/${id}/reject-payment`, {});
          showToast('Chek rad etildi');
          closeModal();
          reload();
        } catch (err) { showToast(err instanceof Error ? err.message : 'To‘lovni rad etib bo‘lmadi', 'error'); }
      };

      openModal('Buyurtma Tafsilotlari', <OrderDetailBody order={order} onStatusUpdate={onStatusUpdate} onAssignCourier={onAssignCourier} onConfirmPayment={onConfirmPayment} onRejectPayment={onRejectPayment} />);
    } catch (err) {
      console.error(err);
      showToast('Xatolik yuz berdi', 'error');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reload]);
}

// ─── DASHBOARD ───────────────────────────────────────────────────────────────

function getTrend(diff: number) {
  if (diff > 0) return <span className="stat-trend trend-up">↑ +{diff}%</span>;
  if (diff < 0) return <span className="stat-trend trend-down">↓ {diff}%</span>;
  return <span className="stat-trend" style={{ color: 'var(--gray)' }}>— 0%</span>;
}

function formatTimeLocal(iso: string): string {
  const date = new Date(iso);
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

type DateFilterType = 'today' | 'yesterday' | '7days' | 'thisMonth';

export function Dashboard({ ctx }: { ctx: AdminCtx }) {
  const { showToast, refreshTick } = ctx;
  const [stats, setStats] = useState<AdminStats | null>(null);
  const [returningPercent, setReturningPercent] = useState<number | null>(null);
  const [statsError, setStatsError] = useState(false);
  const [analyticsError, setAnalyticsError] = useState(false);
  const [filterTick, setFilterTick] = useState(0);
  const [activeFilter, setActiveFilter] = useState<DateFilterType>('today');
  const dateRef = useRef<{ start: string; end: string }>({ start: '', end: '' });
  const pickerInput = useRef<HTMLInputElement | null>(null);
  const pickerInstance = useRef<FlatpickrInstance | null>(null);
  const revCanvas = useRef<HTMLCanvasElement | null>(null);
  const topCanvas = useRef<HTMLCanvasElement | null>(null);
  const revChart = useRef<Chart | null>(null);
  const topChart = useRef<Chart<'doughnut'> | null>(null);
  const statsRequestId = useRef(0);
  const analyticsRequestId = useRef(0);

  const dateQuery = (prefix = '?'): string => {
    const { start, end } = dateRef.current;
    return start ? `${prefix}start_date=${encodeURIComponent(start)}&end_date=${encodeURIComponent(end)}` : '';
  };

  async function fetchStats(): Promise<void> {
    const requestId = ++statsRequestId.current;
    try {
      const res = await apiGet<AdminStats>(`/api/admin/stats${dateQuery()}`);
      if (requestId !== statsRequestId.current) return;
      setStats(res);
      setStatsError(false);
    } catch (err) {
      if (requestId !== statsRequestId.current) return;
      console.error('Stats error', err);
      setStatsError(true);
    }
  }

  async function renderAnalytics(): Promise<void> {
    const requestId = ++analyticsRequestId.current;
    try {
      const data = await apiGet<AdminAnalytics>(`/api/admin/analytics${dateQuery()}`);
      if (requestId !== analyticsRequestId.current) return;
      setReturningPercent(data.returning_percent);
      setAnalyticsError(false);

      Chart.defaults.color = '#94A3B8';
      Chart.defaults.font.family = "'Inter', sans-serif";

      if (revCanvas.current) {
        if (revChart.current) revChart.current.destroy();
        revChart.current = new Chart(revCanvas.current, {
          type: 'line',
          data: {
            labels: data.revenue_chart.labels,
            datasets: [{
              label: "Tasdiqlangan tushum (so'm)",
              data: data.revenue_chart.data,
              borderColor: '#FF6B00',
              backgroundColor: 'rgba(255, 107, 0, 0.1)',
              fill: true,
              tension: 0.4
            }]
          },
          options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: { legend: { display: false } },
            scales: { y: { beginAtZero: true, grid: { color: 'rgba(255,255,255,0.05)' } }, x: { grid: { color: 'rgba(255,255,255,0.05)' } } }
          }
        });
      }

      if (topCanvas.current) {
        if (topChart.current) topChart.current.destroy();
        topChart.current = new Chart(topCanvas.current, {
          type: 'doughnut',
          data: {
            labels: data.top_items_chart.labels,
            datasets: [{
              data: data.top_items_chart.data,
              backgroundColor: ['#FF6B00', '#10B981', '#3B82F6', '#F59E0B', '#8B5CF6'],
              borderWidth: 0
            }]
          },
          options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: { legend: { position: 'right' } },
            cutout: '70%'
          }
        });
      }
    } catch (e) {
      if (requestId !== analyticsRequestId.current) return;
      console.error('Analytics chart error', e);
      setAnalyticsError(true);
    }
  }

  // flatpickr ni ishga tushirish
  useEffect(() => {
    if (pickerInput.current) {
      pickerInstance.current = flatpickr(pickerInput.current, {
        mode: 'range',
        enableTime: true,
        time_24hr: true,
        dateFormat: 'Y-m-d H:i',
        locale: Uzbek,
        onChange: (selectedDates) => {
          if (selectedDates.length === 2) {
            dateRef.current = { start: selectedDates[0].toISOString(), end: selectedDates[1].toISOString() };
            setFilterTick(t => t + 1);
          } else if (selectedDates.length === 0) {
            dateRef.current = { start: '', end: '' };
            setFilterTick(t => t + 1);
          }
        }
      });
    }
    return () => {
      pickerInstance.current?.destroy();
      if (revChart.current) { revChart.current.destroy(); revChart.current = null; }
      if (topChart.current) { topChart.current.destroy(); topChart.current = null; }
    };
  }, []);

  // mount / filtr o'zgarishi / tashqi yangilanishda to'liq yangilash
  useEffect(() => {
    fetchStats();
    renderAnalytics();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filterTick, refreshTick]);

  // Analitika ko'rsatkichlari davriy yangilanadi; buyurtmalar alohida sahifada kuzatiladi.
  useEffect(() => {
    const interval = setInterval(() => {
      fetchStats();
      renderAnalytics();
    }, 30000);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function setDateFilter(type: DateFilterType): void {
    setActiveFilter(type);
    const start = new Date();
    const end = new Date();
    if (type === 'today') {
      start.setHours(0, 0, 0, 0);
    } else if (type === 'yesterday') {
      start.setDate(start.getDate() - 1);
      start.setHours(0, 0, 0, 0);
      end.setDate(end.getDate() - 1);
      end.setHours(23, 59, 59, 999);
    } else if (type === '7days') {
      start.setDate(start.getDate() - 7);
      start.setHours(0, 0, 0, 0);
    } else if (type === 'thisMonth') {
      start.setDate(1);
      start.setHours(0, 0, 0, 0);
    }
    dateRef.current = { start: start.toISOString(), end: end.toISOString() };
    pickerInstance.current?.setDate([start, end]);
    setFilterTick(t => t + 1);
  }

  async function downloadExcel(): Promise<void> {
    try {
      showToast('Yuklanmoqda...', 'info');
      let q = '?limit=1000';
      q += dateQuery('&');
      const orders = await apiGet<AdminOrder[]>(`/api/admin/orders${q}`);
      if (!orders || orders.length === 0) { showToast("Eksport qilish uchun ma'lumot yo'q!", 'error'); return; }

      const excelData = orders.map(o => {
        const itemsStr = (o.items || []).map(i => `${i.name_uz} (x${i.qty})`).join(', ');
        return {
          "Buyurtma ID": o.id,
          "Sana": new Date(o.created_at).toLocaleString('uz-UZ'),
          "Mijoz Ismi": o.users?.full_name || o.users?.username || "Telegram Foydalanuvchisi",
          "Manzil": o.delivery_address || "",
          "Tarkibi": itemsStr,
          "Jami Summa": o.total,
          "Status": o.status
        };
      });

      const ws = XLSX.utils.json_to_sheet(excelData);
      ws['!cols'] = [{ wch: 15 }, { wch: 20 }, { wch: 25 }, { wch: 25 }, { wch: 40 }, { wch: 15 }, { wch: 15 }];
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, 'Buyurtmalar');
      XLSX.writeFile(wb, `FoodCity_Hisobot_${new Date().toISOString().split('T')[0]}.xlsx`);
      showToast('Muvaffaqiyatli yuklandi!', 'success');
    } catch (e) {
      console.error(e);
      showToast('Xatolik yuz berdi', 'error');
    }
  }

  return (
    <>
      <div className="page-header-container">
        <div className="page-header-left">
          <div className="page-header-title">
            <span>📈</span>
            <span>Dashboard & Analitika</span>
          </div>
          <div className="page-header-subtitle">
            Savdo statistikasi, tushum dinamikasi va mijozlar faolligi
          </div>
        </div>

        <div className="page-header-right">
          <div className="segmented-control" role="group" aria-label="Sana filtri">
            <button
              type="button"
              className={`segment-btn${activeFilter === 'today' ? ' active' : ''}`}
              onClick={() => setDateFilter('today')}
            >
              Bugun
            </button>
            <button
              type="button"
              className={`segment-btn${activeFilter === 'yesterday' ? ' active' : ''}`}
              onClick={() => setDateFilter('yesterday')}
            >
              Kecha
            </button>
            <button
              type="button"
              className={`segment-btn${activeFilter === '7days' ? ' active' : ''}`}
              onClick={() => setDateFilter('7days')}
            >
              7 Kun
            </button>
            <button
              type="button"
              className={`segment-btn${activeFilter === 'thisMonth' ? ' active' : ''}`}
              onClick={() => setDateFilter('thisMonth')}
            >
              Shu oy
            </button>
          </div>

          <div className="date-picker-wrapper">
            <span className="date-picker-icon">📅</span>
            <input
              type="text"
              ref={pickerInput}
              className="date-picker-input"
              placeholder="Sanani tanlang..."
            />
          </div>

          <button type="button" className="btn btn-success" onClick={downloadExcel}>
            <span>📥</span>
            <span>Excel Hisobot</span>
          </button>
        </div>
      </div>

      <div className="bento-grid">
        {!stats ? (
          statsError ? (
            <div className="admin-data-error" role="alert" style={{ gridColumn: '1 / -1' }}>
              Statistikani yuklab bo'lmadi.
              <button className="btn btn-outline sm" onClick={fetchStats}>Qayta urinish</button>
            </div>
          ) : [1, 2, 3, 4, 5, 6, 7, 8].map(i => <div key={i} className="bento-card skeleton" style={{ height: 130 }}></div>)
        ) : (
          <>
            {statsError && (
              <div className="admin-data-warning" role="status" style={{ gridColumn: '1 / -1' }}>
                Yangilashda xatolik. Quyidagi qiymatlar oxirgi muvaffaqiyatli yuklangan ma'lumotlar.
                <button className="btn btn-outline sm" onClick={fetchStats}>Qayta urinish</button>
              </div>
            )}

            <div className="bento-card">
              <div className="bento-card-top">
                <span className="bento-card-title">Buyurtmalar</span>
                <span className="bento-card-icon" style={{ background: 'rgba(255, 107, 0, 0.15)', color: '#FF6B00' }}>📦</span>
              </div>
              <div className="bento-card-value">
                {stats.today?.orders ?? stats.today_count ?? 0}
                <span className="bento-card-unit">ta</span>
              </div>
              <div className="bento-card-footer">
                <span>Davr bo'yicha</span>
                {getTrend(stats.today?.orders_diff ?? stats.today_count_diff ?? 0)}
              </div>
            </div>

            <div className="bento-card">
              <div className="bento-card-top">
                <span className="bento-card-title">Tasdiqlangan tushum</span>
                <span className="bento-card-icon" style={{ background: 'rgba(16, 185, 129, 0.15)', color: '#10B981' }}>💰</span>
              </div>
              <div className="bento-card-value">
                {(stats.today?.revenue ?? stats.today_revenue ?? 0).toLocaleString()}
                <span className="bento-card-unit">so'm</span>
              </div>
              <div className="bento-card-footer">
                <span>{stats.today?.paid_orders ?? 0} ta to'langan</span>
                {getTrend(stats.today?.revenue_diff ?? stats.today_revenue_diff ?? 0)}
              </div>
            </div>

            <div className="bento-card">
              <div className="bento-card-top">
                <span className="bento-card-title">O'rtacha chek</span>
                <span className="bento-card-icon" style={{ background: 'rgba(59, 130, 246, 0.15)', color: '#3B82F6' }}>🧾</span>
              </div>
              <div className="bento-card-value">
                {(stats.today?.average_order_value ?? Math.round((stats.today?.revenue ?? stats.today_revenue ?? 0) / Math.max(1, (stats.today?.orders ?? stats.today_count ?? 0) - (stats.today?.cancelled_orders ?? 0)))).toLocaleString()}
                <span className="bento-card-unit">so'm</span>
              </div>
              <div className="bento-card-footer">
                <span>1 xarid uchun o'rtacha</span>
              </div>
            </div>

            <div className="bento-card">
              <div className="bento-card-top">
                <span className="bento-card-title">Faol buyurtmalar</span>
                <span className="bento-card-icon" style={{ background: 'rgba(245, 158, 11, 0.15)', color: '#F59E0B' }}>🚀</span>
              </div>
              <div className="bento-card-value">
                {stats.today?.active_orders ?? 0}
                <span className="bento-card-unit">jarayonda</span>
              </div>
              <div className="bento-card-footer">
                <span>Oshxona & Kuryerda</span>
              </div>
            </div>

            <div className="bento-card">
              <div className="bento-card-top">
                <span className="bento-card-title">Yetkazilgan</span>
                <span className="bento-card-icon" style={{ background: 'rgba(16, 185, 129, 0.15)', color: '#10B981' }}>✅</span>
              </div>
              <div className="bento-card-value">
                {stats.today?.delivered_orders ?? 0}
                <span className="bento-card-unit">ta</span>
              </div>
              <div className="bento-card-footer">
                <span>Yetkazish: {stats.today?.delivery_rate ?? 0}%</span>
              </div>
            </div>

            <div className="bento-card">
              <div className="bento-card-top">
                <span className="bento-card-title">Bekor qilingan</span>
                <span className="bento-card-icon" style={{ background: 'rgba(239, 68, 68, 0.15)', color: '#EF4444' }}>❌</span>
              </div>
              <div className="bento-card-value">
                {stats.today?.cancelled_orders ?? 0}
                <span className="bento-card-unit">ta</span>
              </div>
              <div className="bento-card-footer">
                <span>Bekor qilish: {stats.today?.cancellation_rate ?? 0}%</span>
              </div>
            </div>

            <div className="bento-card">
              <div className="bento-card-top">
                <span className="bento-card-title">Undirilmagan summa</span>
                <span className="bento-card-icon" style={{ background: 'rgba(239, 68, 68, 0.15)', color: '#EF4444' }}>⏳</span>
              </div>
              <div className="bento-card-value">
                {(stats.today?.pending_payment_amount ?? 0).toLocaleString()}
                <span className="bento-card-unit">so'm</span>
              </div>
              <div className="bento-card-footer">
                <span>{stats.today?.pending_payment_orders ?? 0} ta to'lanmagan</span>
              </div>
            </div>

            <div className="bento-card">
              <div className="bento-card-top">
                <span className="bento-card-title">Jami Mijozlar</span>
                <span className="bento-card-icon" style={{ background: 'rgba(139, 92, 246, 0.15)', color: '#8B5CF6' }}>👥</span>
              </div>
              <div className="bento-card-value">
                {stats.total_users || 0}
                <span className="bento-card-unit">ta</span>
              </div>
              <div className="bento-card-footer">
                <span>Faol: {stats.today?.unique_customers ?? 0} ta {returningPercent !== null ? `| Qayta: ${returningPercent}%` : ''}</span>
              </div>
            </div>
          </>
        )}
      </div>

      <div className="stats-grid dashboard-charts">
        <div className="stat-card">
          <h3 style={{ fontSize: '1rem', fontWeight: 700, marginBottom: '1rem', color: '#E2E8F0', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <span>📊</span>
            <span>Tushumlar Dinamikasi</span>
          </h3>
          {analyticsError && <div className="admin-data-error" role="alert">Analitikani yuklab bo'lmadi. <button className="btn btn-outline sm" onClick={renderAnalytics}>Qayta urinish</button></div>}
          <canvas ref={revCanvas} style={{ maxHeight: 260 }}></canvas>
        </div>
        <div className="stat-card">
          <h3 style={{ fontSize: '1rem', fontWeight: 700, marginBottom: '1rem', color: '#E2E8F0', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <span>🍩</span>
            <span>Top Mahsulotlar (Soni)</span>
          </h3>
          {analyticsError && <div className="admin-data-error" role="alert">Analitikani yuklab bo'lmadi.</div>}
          <canvas ref={topCanvas} style={{ maxHeight: 260 }}></canvas>
        </div>
      </div>
    </>
  );
}

// ─── ORDERS ──────────────────────────────────────────────────────────────────

const ORDER_TABS: { label: string; status: string }[] = [
  { label: 'Barchasi', status: '' },
  { label: 'Yangi', status: 'new' },
  { label: 'Tasdiqlangan', status: 'confirmed' },
  { label: 'Tayyorlanmoqda', status: 'cooking' },
  { label: "Yo'lda", status: 'delivering' },
  { label: 'Yetkazildi', status: 'delivered' },
  { label: 'Bekor', status: 'cancelled' }
];

function getOrderSla(isoDate: string): { label: string; urgency: 'normal' | 'warning' | 'danger' } {
  try {
    const elapsedMs = Date.now() - new Date(isoDate).getTime();
    const elapsedMin = Math.max(0, Math.floor(elapsedMs / 60000));
    if (elapsedMin < 10) {
      return { label: `⏱ ${elapsedMin} daq`, urgency: 'normal' };
    } else if (elapsedMin < 20) {
      return { label: `⏱ ${elapsedMin} daq`, urgency: 'warning' };
    } else {
      return { label: `⚠️ ${elapsedMin} daq!`, urgency: 'danger' };
    }
  } catch {
    return { label: '⏱ —', urgency: 'normal' };
  }
}

const PAGE_SIZE = 30;

export function Orders({ ctx }: { ctx: AdminCtx }) {
  const { refreshTick, showToast } = ctx;
  const [status, setStatus] = useState('');
  const [query, setQuery] = useState('');
  const debouncedQuery = useDebouncedValue(query);
  const [orders, setOrders] = useState<AdminOrder[] | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [page, setPage] = useState(1);
  const ordersRequestId = useRef(0);

  const loadOrders = useCallback(async (): Promise<void> => {
    const requestId = ++ordersRequestId.current;
    try {
      const limit = page * PAGE_SIZE;
      const data = await apiGet<AdminOrder[]>(`/api/admin/orders?status=${encodeURIComponent(status)}&search=${encodeURIComponent(debouncedQuery)}&limit=${limit}`);
      if (requestId !== ordersRequestId.current) return;
      if (!Array.isArray(data)) throw new Error("Buyurtmalar noto'g'ri formatda keldi");
      setOrders(data);
      setLoadError(false);
    } catch (err) {
      if (requestId !== ordersRequestId.current) return;
      console.error('Orders load failed:', err);
      setLoadError(true);
    } finally {
      if (requestId === ordersRequestId.current) setRefreshing(false);
    }
  }, [status, debouncedQuery, page]);

  // Filtr yoki qidiruv o'zgarsa — sahifalashni boshidan boshlaymiz
  useEffect(() => { setPage(1); }, [status, debouncedQuery]);
  useEffect(() => { loadOrders(); }, [loadOrders, refreshTick]);
  useEffect(() => {
    const interval = window.setInterval(() => {
      if (document.visibilityState === 'visible') void loadOrders();
    }, 10000);
    return () => window.clearInterval(interval);
  }, [loadOrders]);

  const showOrderDetail = useOrderDetail(ctx, loadOrders);

  const handleQuickStatus = async (orderId: string, nextStatus: AdminOrderStatus, e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await apiPost(`/api/admin/orders/${orderId}/status`, { status: nextStatus });
      showToast(`Buyurtma #${orderId} yangilandi: ${ORDER_STATUS_MAP[nextStatus]?.label || nextStatus}`, 'success');
      void loadOrders();
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Holatni yangilab bo‘lmadi', 'error');
    }
  };

  const counts = (orders || []).reduce<Record<string, number>>((acc, o) => {
    acc[o.status] = (acc[o.status] || 0) + 1;
    return acc;
  }, {});

  const canLoadMore = Array.isArray(orders) && orders.length >= page * PAGE_SIZE;

  return (
    <>
      <div className="page-header-container">
        <div className="page-header-left">
          <div className="page-header-title">
            <span>📦</span>
            <span>Buyurtmalar Boshqaruvi</span>
          </div>
          <div className="page-header-subtitle">
            Jonli buyurtmalar oqimi, oshxona va kuryer holatlari nazorati
          </div>
        </div>
        <div className="page-header-right">
          <span className="orders-live-indicator"><i /> Jonli</span>
          <button className="btn btn-outline sm" disabled={refreshing} onClick={() => { setRefreshing(true); void loadOrders(); }}>
            {refreshing ? 'Yangilanmoqda...' : '↻ Yangilash'}
          </button>
          <div style={{ position: 'relative', display: 'inline-flex', alignItems: 'center' }}>
            <span style={{ position: 'absolute', left: '0.75rem', color: 'var(--gray)', pointerEvents: 'none', fontSize: '0.85rem' }}>🔍</span>
            <input
              type="search"
              className="form-input"
              style={{ paddingLeft: '2.1rem', width: '250px' }}
              aria-label="Buyurtmalarni qidirish"
              placeholder="ID, ism yoki telefon..."
              value={query}
              onChange={e => setQuery(e.target.value)}
            />
          </div>
        </div>
      </div>

      <div className="tabs">
        {ORDER_TABS.map(t => {
          const tabCount = t.status ? counts[t.status] || 0 : orders?.length || 0;
          return (
            <button
              key={t.status}
              type="button"
              className={`tab${status === t.status ? ' active' : ''}`}
              aria-pressed={status === t.status}
              onClick={() => setStatus(t.status)}
            >
              <span>{t.label}</span>
              {tabCount > 0 && (
                <span className={`tab-badge${t.status === 'new' ? ' is-new' : ''}`}>{tabCount}</span>
              )}
            </button>
          );
        })}
      </div>
      <div className="table-container">
        {orders === null && !loadError && (
          <div className="orders-loading-grid" aria-label="Buyurtmalar yuklanmoqda">
            {[1, 2, 3].map(i => <div key={i} className="skeleton orders-skeleton" />)}
          </div>
        )}
        {orders === null && loadError && (
          <div className="admin-data-error" role="alert">
            Buyurtmalarni yuklab bo'lmadi.
            <button className="btn btn-outline sm" onClick={() => { setRefreshing(true); void loadOrders(); }}>Qayta urinish</button>
          </div>
        )}
        {orders !== null && loadError && (
          <div className="admin-data-warning" role="status">
            Yangilashda xatolik. Oxirgi yuklangan buyurtmalar ko'rsatilmoqda.
            <button className="btn btn-outline sm" onClick={() => { setRefreshing(true); void loadOrders(); }}>Qayta urinish</button>
          </div>
        )}
        {Array.isArray(orders) && orders.length === 0 && (
          <div className="orders-empty-state">
            <span>📭</span>
            <strong>Bu bo‘limda buyurtma yo‘q</strong>
            <p>Yangi zakazlar kelishi bilan shu ro‘yxatda ko‘rinadi.</p>
          </div>
        )}
      </div>
      {Array.isArray(orders) && orders.length > 0 && (
        <div className="orders-card-grid" aria-label="Buyurtmalar ro'yxati">
          {orders.map(order => {
            const orderItems = order.items || [];
            const itemCount = orderItems.reduce((total, item) => total + Math.max(1, Number(item.qty) || 1), 0);
            const customerName = order.users?.full_name || order.users?.username || "Noma'lum mijoz";
            const statusInfo = ORDER_STATUS_MAP[order.status] || { label: order.status, color: '#A8B4C9' };
            const address = order.delivery_address?.trim();
            const isPickup = Boolean(address && ['olib ketish', 'pickup'].includes(address.toLowerCase()));
            const coordinates = order.location;
            const latitude = coordinates?.lat ?? coordinates?.latitude;
            const longitude = coordinates?.lon ?? coordinates?.longitude;
            const mapUrl = latitude !== undefined && longitude !== undefined
              ? `https://maps.google.com/?q=${latitude},${longitude}`
              : address && !isPickup
                ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`
                : '';
            const sla = getOrderSla(order.created_at);

            return (
              <article
                key={order.id}
                className={`admin-order-card${order.status === 'new' ? ' is-new' : ''}`}
                onClick={() => showOrderDetail(order.id)}
              >
                <div className="admin-order-card-top">
                  <div className="admin-order-id-group">
                    <span className="admin-order-number">#{order.id}</span>
                    <span className={`admin-order-sla sla-${sla.urgency}`}>{sla.label}</span>
                  </div>
                  <span
                    className={`badge badge-${order.status}`}
                    style={{ color: statusInfo.color, backgroundColor: `${statusInfo.color}20` }}
                  >
                    {statusInfo.label}
                  </span>
                </div>

                <div className="admin-order-customer">
                  <span className="admin-order-avatar" aria-hidden="true">👤</span>
                  <div>
                    <strong>{customerName}</strong>
                    {order.users?.username && order.users.full_name && <small>@{order.users.username}</small>}
                  </div>
                </div>

                <div className="admin-order-contact-row">
                  {order.users?.phone ? (
                    <a href={`tel:${order.users.phone}`} className="admin-order-call-btn" onClick={event => event.stopPropagation()} title="Qo'ng'iroq qilish">
                      📞 {order.users.phone}
                    </a>
                  ) : (
                    <span className="admin-order-muted">📞 Telefon yo'q</span>
                  )}
                  {address && (
                    mapUrl ? (
                      <a href={mapUrl} target="_blank" rel="noreferrer" className="admin-order-map-link" onClick={event => event.stopPropagation()}>
                        📍 {isPickup ? 'Olib ketish' : address} ↗
                      </a>
                    ) : <span>📍 {address}</span>
                  )}
                </div>

                <div className="admin-order-items">
                  <div className="admin-order-section-label">BUYURTMA TARKIBI <span>{itemCount} ta</span></div>
                  {orderItems.slice(0, 3).map((item, index) => (
                    <div className="admin-order-item" key={`${order.id}-${index}`}>
                      <span className="admin-order-item-name">
                        <span>{item.emoji || '🍽️'}</span>
                        {item.name_uz || item.name || item.name_ru || 'Taom'}
                        <b>×{Math.max(1, Number(item.qty) || 1)}</b>
                      </span>
                      <span>{((Number(item.price) || 0) * Math.max(1, Number(item.qty) || 1)).toLocaleString('uz-UZ')} so‘m</span>
                    </div>
                  ))}
                  {orderItems.length > 3 && <div className="admin-order-more">+ yana {orderItems.length - 3} ta mahsulot</div>}
                  {orderItems.length === 0 && <div className="admin-order-muted">Mahsulot tafsiloti mavjud emas</div>}
                  {order.note && <div className="admin-order-note">📝 {order.note}</div>}
                </div>

                <div className="admin-order-card-bottom">
                  <div className="admin-order-payment">
                    <PaymentBadge order={order} />
                    {order.payment_receipt_url && (
                      <a href={order.payment_receipt_url} target="_blank" rel="noreferrer" onClick={event => event.stopPropagation()}>
                        Chek ↗
                      </a>
                    )}
                  </div>
                  <strong className="admin-order-total">{(Number(order.total) || 0).toLocaleString('uz-UZ')} <small>so‘m</small></strong>
                </div>

                {order.courier && (
                  <div className="admin-order-courier-pill">
                    🛵 Kuryer: <b>{order.courier.full_name || order.courier.username || order.courier_id}</b>
                  </div>
                )}

                {/* TEZKOR HARAKAT TUGMALARI */}
                <div className="admin-order-quick-actions" onClick={event => event.stopPropagation()}>
                  {order.status === 'new' && (
                    <>
                      <button type="button" className="btn-quick-action btn-confirm" onClick={e => handleQuickStatus(order.id, 'confirmed', e)}>
                        ✅ Tasdiqlash
                      </button>
                      <button type="button" className="btn-quick-action btn-cancel" onClick={e => handleQuickStatus(order.id, 'cancelled', e)}>
                        ❌ Bekor
                      </button>
                    </>
                  )}
                  {order.status === 'confirmed' && (
                    <button type="button" className="btn-quick-action btn-cooking" onClick={e => handleQuickStatus(order.id, 'cooking', e)}>
                      👨‍🍳 Oshxonaga
                    </button>
                  )}
                  {order.status === 'cooking' && (
                    <button type="button" className="btn-quick-action btn-courier" onClick={() => showOrderDetail(order.id)}>
                      🛵 Kuryer biriktirish
                    </button>
                  )}
                  {order.status === 'delivering' && (
                    <button type="button" className="btn-quick-action btn-delivered" onClick={e => handleQuickStatus(order.id, 'delivered', e)}>
                      ✅ Yetkazildi
                    </button>
                  )}
                  <button type="button" className="btn-quick-action btn-details" onClick={() => showOrderDetail(order.id)}>
                    Batafsil ↗
                  </button>
                </div>
              </article>
            );
          })}
        </div>
      )}
      {canLoadMore && (
        <div style={{ textAlign: 'center', marginTop: '1rem' }}>
          <button className="btn btn-outline" onClick={() => setPage(p => p + 1)}>Yana yuklash</button>
        </div>
      )}
    </>
  );
}

// ─── MENU ────────────────────────────────────────────────────────────────────

interface MenuFormState {
  category_id: string;
  name_uz: string;
  name_ru: string;
  name_en: string;
  description_uz: string;
  description_ru: string;
  description_en: string;
  price: string;
  emoji: string;
  badge: string;
}

function MenuFormBody({ item, saveRef, ctx, reload }: {
  item: AdminMenuItem | null;
  saveRef: SaveRef;
  ctx: AdminCtx;
  reload: () => void;
}) {
  const { showToast, closeModal } = ctx;
  const isEdit = !!item;
  const [categories, setCategories] = useState<AdminCategory[]>([]);
  const [form, setForm] = useState<MenuFormState>({
    category_id: item?.category_id || '',
    name_uz: item?.name_uz || '',
    name_ru: item?.name_ru || '',
    name_en: item?.name_en || '',
    description_uz: item?.description_uz || '',
    description_ru: item?.description_ru || '',
    description_en: item?.description_en || '',
    price: item?.price != null ? String(item.price) : '',
    emoji: item?.emoji || (isEdit ? '🍽' : ''),
    badge: item?.badge || ''
  });
  const [imgTab, setImgTab] = useState<'url' | 'file'>('url');
  const [imageUrl, setImageUrl] = useState(item?.image_url || '');
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [previewSrc, setPreviewSrc] = useState<string | null>(item?.image_url || null);
  const fileInput = useRef<HTMLInputElement | null>(null);
  const dropZone = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch(`${API_BASE}/api/menu/categories`, {
          headers: { 'Authorization': `Bearer ${getToken()}` }
        });
        const cats: AdminCategory[] = await res.json();
        setCategories(cats);
        if (!isEdit && cats.length > 0) {
          setForm(f => f.category_id ? f : { ...f, category_id: cats[0].id });
        }
      } catch (err) { console.error('Cats load error:', err); }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function handleImageFile(file: File | undefined): void {
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) {
      showToast("❌ Rasm 5MB dan kichik bo'lishi kerak", 'error');
      return;
    }
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
      showToast('❌ Faqat JPG, PNG, WEBP formatlar', 'error');
      return;
    }
    setImageFile(file);
    setImageUrl('');
    const reader = new FileReader();
    reader.onload = (e) => setPreviewSrc(e.target?.result as string);
    reader.readAsDataURL(file);
    showToast('✅ Rasm tanlandi, saqlashda yuklanadi', 'success');
  }

  function clearImage(): void {
    setImageFile(null);
    setImageUrl('');
    setPreviewSrc(null);
    if (fileInput.current) fileInput.current.value = '';
  }

  // Rasm faylini serverga yuklaydi — item bazada mavjud bo'lgandan KEYIN chaqiriladi,
  // chunki backend pipeline (WEBP, thumbnail, dedup) item'ning product_code'iga bog'liq.
  async function uploadImageToServer(itemId: string, file: File): Promise<string | null> {
    showToast('📤 Rasm yuklanmoqda...', 'info');
    try {
      const data = await apiUploadMenuImage(itemId, file);
      showToast('✅ Rasm yuklandi!', 'success');
      return data.image_url || null;
    } catch (e) {
      showToast('❌ Rasm yuklanmadi (mahsulot ma\'lumotlari saqlandi)', 'error');
      return null;
    }
  }

  // modal footer'dagi Saqlash tugmasi uchun handler ro'yxatga olinadi
  saveRef.current = async () => {
    const price = parseInt(form.price);
    if (!form.name_uz || isNaN(price)) { showToast("Ma'lumotlarni to'liq kiriting!", 'error'); return; }

    // URL tab orqali kiritilgan rasm (fayl emas) — to'g'ridan-to'g'ri saqlanadi.
    // Fayl tab orqali tanlangan rasm esa item saqlangandan KEYIN alohida yuklanadi.
    let baseImageUrl: string | null = null;
    if (!imageFile && imageUrl) {
      baseImageUrl = imageUrl.trim();
    } else if (!imageFile && isEdit && item) {
      baseImageUrl = item.image_url || null;
    }

    const data = {
      ...form,
      price,
      is_available: true,
      sort_order: 99,
      image_url: baseImageUrl
    };

    try {
      let itemId: string;
      if (isEdit && item) {
        await apiPut(`/api/admin/menu/${item.id}`, data);
        itemId = item.id;
      } else {
        const created = await apiPost<AdminMenuItem>('/api/admin/menu', data);
        itemId = created.id;
      }

      if (imageFile) {
        await uploadImageToServer(itemId, imageFile);
      }

      showToast(isEdit ? 'Muvaffaqiyatli tahrirlandi' : 'Saqlandi', 'success');
      closeModal();
      reload();
    } catch (err) { showToast('Xatolik!', 'error'); }
  };

  const setField = (k: keyof MenuFormState) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
      setForm(f => ({ ...f, [k]: e.target.value }));

  const imgTabStyle = (active: boolean): React.CSSProperties => ({
    flex: 1, padding: 8, border: 'none', background: active ? '#FF6B00' : '#2D1500',
    color: active ? '#fff' : '#FFD4A3', fontSize: 13, fontWeight: 600, cursor: 'pointer'
  });

  return (
    <form style={{ display: 'grid', gap: '1rem' }} onSubmit={e => e.preventDefault()}>
      <div className="form-group">
        <label>Kategoriya</label>
        <select className="form-input" value={form.category_id} onChange={setField('category_id')}>
          {categories.length === 0 && <option>Yuklanmoqda...</option>}
          {categories.map(c => <option key={c.id} value={c.id}>{c.emoji || ''} {c.name_uz}</option>)}
        </select>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '0.5rem' }}>
        <div className="form-group"><label>Nomi (UZ)</label><input className="form-input" required value={form.name_uz} onChange={setField('name_uz')} /></div>
        <div className="form-group"><label>Nomi (RU)</label><input className="form-input" value={form.name_ru} onChange={setField('name_ru')} /></div>
        <div className="form-group"><label>Nomi (EN)</label><input className="form-input" value={form.name_en} onChange={setField('name_en')} /></div>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '0.5rem' }}>
        <div className="form-group"><label>Tavsif (UZ)</label><textarea className="form-input" value={form.description_uz} onChange={setField('description_uz')} /></div>
        <div className="form-group"><label>Tavsif (RU)</label><textarea className="form-input" value={form.description_ru} onChange={setField('description_ru')} /></div>
        <div className="form-group"><label>Tavsif (EN)</label><textarea className="form-input" value={form.description_en} onChange={setField('description_en')} /></div>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '0.5rem' }}>
        <div className="form-group"><label>Narx</label><input type="number" className="form-input" required value={form.price} onChange={setField('price')} /></div>
        <div className="form-group"><label>Emoji</label><input className="form-input" placeholder="🍔" value={form.emoji} onChange={setField('emoji')} /></div>
        <div className="form-group">
          <label>Badge</label>
          <select className="form-input" value={form.badge} onChange={setField('badge')}>
            <option value="">Yo'q</option>
            <option value="🔥 Hit">🔥 Hit</option>
            <option value="⭐ Yangi">⭐ Yangi</option>
            <option value="💰 Arzon">💰 Arzon</option>
          </select>
        </div>
      </div>
      {/* Image Section */}
      <div style={{ marginBottom: 16 }}>
        <label style={{ color: '#aaa', fontSize: 12, textTransform: 'uppercase', display: 'block', marginBottom: 8 }}>TAOM RASMI</label>

        <div style={{ display: 'flex', gap: 0, marginBottom: 10, borderRadius: 8, overflow: 'hidden', border: '1px solid rgba(255,107,0,0.3)' }}>
          <button type="button" onClick={() => setImgTab('url')} style={imgTabStyle(imgTab === 'url')}>🔗 URL</button>
          <button type="button" onClick={() => setImgTab('file')} style={imgTabStyle(imgTab === 'file')}>📁 Fayl</button>
        </div>

        {imgTab === 'url' && (
          <div>
            <input type="url" placeholder="https://example.com/image.jpg"
              value={imageUrl} onChange={e => setImageUrl(e.target.value)}
              style={{ width: '100%', padding: '10px 12px', borderRadius: 8, border: '1px solid rgba(255,107,0,0.3)', background: '#1A0A00', color: '#fff', fontSize: 14, boxSizing: 'border-box' }} />
          </div>
        )}

        {imgTab === 'file' && !previewSrc && (
          <div ref={dropZone}
            onClick={() => fileInput.current?.click()}
            onDragOver={e => { e.preventDefault(); if (dropZone.current) dropZone.current.style.borderColor = '#FF6B00'; }}
            onDragLeave={() => { if (dropZone.current) dropZone.current.style.borderColor = 'rgba(255,107,0,0.3)'; }}
            onDrop={e => { e.preventDefault(); handleImageFile(e.dataTransfer.files[0]); if (dropZone.current) dropZone.current.style.borderColor = 'rgba(255,107,0,0.3)'; }}
            style={{ border: '2px dashed rgba(255,107,0,0.3)', borderRadius: 8, padding: 24, textAlign: 'center', cursor: 'pointer', transition: 'all 0.2s', background: '#1A0A00' }}>
            <div style={{ fontSize: 32, marginBottom: 8 }}>📸</div>
            <div style={{ color: '#FFD4A3', fontSize: 14 }}>Rasmni shu yerga tashlang</div>
            <div style={{ color: '#666', fontSize: 12, marginTop: 4 }}>yoki bosib tanlang</div>
            <div style={{ color: '#666', fontSize: 11, marginTop: 4 }}>JPG, PNG, WEBP — max 5MB</div>
          </div>
        )}
        <input type="file" ref={fileInput} accept="image/*" style={{ display: 'none' }}
          onChange={e => handleImageFile(e.target.files?.[0])} />

        {previewSrc && (
          <div style={{ marginTop: 10 }}>
            <img src={previewSrc} alt="" style={{ width: '100%', maxHeight: 160, objectFit: 'cover', borderRadius: 8, border: '1px solid rgba(255,107,0,0.3)' }} />
            <button type="button" onClick={clearImage}
              style={{ width: '100%', marginTop: 6, padding: 6, borderRadius: 6, border: 'none', background: '#3D1500', color: '#FFD4A3', cursor: 'pointer', fontSize: 13 }}>
              ✕ Rasmni olib tashlash
            </button>
          </div>
        )}
      </div>
    </form>
  );
}

export function MenuView({ ctx }: { ctx: AdminCtx }) {
  const { showToast, openModal } = ctx;
  const [menu, setMenu] = useState<AdminMenuItem[] | null | 'error'>(null);
  const [categoriesList, setCategoriesList] = useState<AdminCategory[]>([]);
  const [categoryFilter, setCategoryFilter] = useState<string>('all');
  const [menuSearch, setMenuSearch] = useState<string>('');

  const loadCategories = useCallback(async (): Promise<void> => {
    try {
      const res = await fetch(`${API_BASE}/api/menu/categories`, {
        headers: { 'Authorization': `Bearer ${getToken()}` }
      });
      const data = await res.json();
      if (Array.isArray(data)) {
        setCategoriesList(data);
      }
    } catch (e) {
      console.error('Failed to load categories', e);
    }
  }, []);

  const loadMenu = useCallback(async (): Promise<void> => {
    try {
      const data = await apiGet<AdminMenuItem[]>('/api/admin/menu');
      setMenu(data);
    } catch (err) { setMenu('error'); }
  }, []);

  useEffect(() => {
    void loadMenu();
    void loadCategories();
  }, [loadMenu, loadCategories]);

  function openMenuFormModal(item: AdminMenuItem | null = null): void {
    const saveRef: SaveRef = { current: null };
    openModal(
      item ? 'Taomni tahrirlash' : "Yangi taom qo'shish",
      <MenuFormBody item={item} saveRef={saveRef} ctx={ctx} reload={loadMenu} />,
      <button className="btn btn-primary" onClick={() => saveRef.current?.()}>Saqlash</button>
    );
  }

  async function toggleItem(id: string, available: boolean): Promise<void> {
    setMenu(prev => Array.isArray(prev) ? prev.map(m => m.id === id ? { ...m, is_available: available } : m) : prev);
    try {
      await apiPut(`/api/admin/menu/${id}`, { is_available: available });
      showToast('Yangilandi');
    } catch (err) {
      showToast('Xatolik! Holat saqlanmadi', 'error');
      loadMenu(); // UI ni haqiqiy holatga qaytaramiz
    }
  }

  async function deleteItem(id: string): Promise<void> {
    if (!confirm("O'chirish?")) return;
    try {
      await apiDelete(`/api/admin/menu/${id}`);
      showToast("O'chirildi");
      loadMenu();
    } catch (err) { showToast('Xatolik yuz berdi', 'error'); }
  }

  const items = Array.isArray(menu) ? menu : [];
  const categoryIds = Array.from(new Set(items.map(i => i.category_id).filter(Boolean)));
  const catMap = new Map(categoriesList.map(c => [c.id, c]));

  const filteredItems = items.filter(item => {
    if (categoryFilter !== 'all' && item.category_id !== categoryFilter) return false;
    if (menuSearch.trim()) {
      const s = menuSearch.toLowerCase();
      const matchName = (item.name_uz || '').toLowerCase().includes(s) || (item.name_ru || '').toLowerCase().includes(s);
      if (!matchName) return false;
    }
    return true;
  });

  return (
    <>
      <div className="page-header-container">
        <div className="page-header-left">
          <div className="page-header-title">
            <span>🍽</span>
            <span>Menyu & Mahsulotlar</span>
          </div>
          <div className="page-header-subtitle">
            Katalogdagi taomlar, narxlar va oshxona qoldig'ini boshqarish
          </div>
        </div>
        <div className="page-header-right">
          <button className="btn btn-outline sm" onClick={() => { void loadMenu(); void loadCategories(); }}>↻ Yangilash</button>
          <div style={{ position: 'relative', display: 'inline-flex', alignItems: 'center' }}>
            <span style={{ position: 'absolute', left: '0.75rem', color: 'var(--gray)', pointerEvents: 'none', fontSize: '0.85rem' }}>🔍</span>
            <input
              type="search"
              className="form-input"
              style={{ paddingLeft: '2.1rem', width: '200px' }}
              placeholder="Taom qidirish..."
              value={menuSearch}
              onChange={e => setMenuSearch(e.target.value)}
            />
          </div>
          <button className="btn btn-primary" onClick={() => openMenuFormModal(null)}>+ Yangi taom</button>
        </div>
      </div>

      {categoryIds.length > 0 && (
        <div className="segmented-control" style={{ marginBottom: '1.25rem', overflowX: 'auto', maxWidth: '100%' }}>
          <button
            type="button"
            className={`segment-btn${categoryFilter === 'all' ? ' active' : ''}`}
            onClick={() => setCategoryFilter('all')}
          >
            Barchasi ({items.length})
          </button>
          {categoryIds.map(catId => {
            const catObj = catMap.get(catId);
            const label = catObj ? `${catObj.emoji || ''} ${catObj.name_uz}`.trim() : `Kategoriya (${catId.slice(0, 6)})`;
            return (
              <button
                key={catId}
                type="button"
                className={`segment-btn${categoryFilter === catId ? ' active' : ''}`}
                onClick={() => setCategoryFilter(catId)}
              >
                {label} ({items.filter(i => i.category_id === catId).length})
              </button>
            );
          })}
        </div>
      )}

      <div className="menu-grid">
        {menu === null && [1, 2, 3, 4, 5, 6].map(i => <div key={i} className="menu-card skeleton" style={{ height: 260 }}></div>)}
        {menu === 'error' && (
          <div className="admin-data-error" role="alert" style={{ gridColumn: '1 / -1' }}>
            Menyu ma'lumotlarini yuklab bo'lmadi.
            <button className="btn btn-outline sm" onClick={() => { void loadMenu(); void loadCategories(); }}>Qayta urinish</button>
          </div>
        )}
        {Array.isArray(menu) && filteredItems.length === 0 && (
          <div style={{ gridColumn: '1 / -1', textAlign: 'center', padding: '3rem', color: 'var(--gray)' }}>
            Taomlar topilmadi.
          </div>
        )}
        {Array.isArray(menu) && filteredItems.map(item => {
          const catObj = catMap.get(item.category_id);
          const catName = catObj ? `${catObj.emoji || ''} ${catObj.name_uz}`.trim() : 'Asosiy';
          return (
            <div className="menu-card" key={item.id}>
              <div className="menu-img" style={{ position: 'relative' }}>
                {item.image_url ? (
                  <img src={item.image_url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                ) : (
                  <span style={{ fontSize: '3rem' }}>{item.emoji || '🍽'}</span>
                )}
                {item.badge && (
                  <span style={{ position: 'absolute', top: 10, left: 10, background: 'rgba(255, 107, 0, 0.9)', color: '#fff', fontSize: '0.72rem', fontWeight: 800, padding: '3px 8px', borderRadius: 6, backdropFilter: 'blur(4px)' }}>
                    {item.badge}
                  </span>
                )}
                <span style={{ position: 'absolute', top: 10, right: 10, background: item.is_available ? 'rgba(16, 185, 129, 0.9)' : 'rgba(239, 68, 68, 0.9)', color: '#fff', fontSize: '0.68rem', fontWeight: 700, padding: '2px 7px', borderRadius: 6 }}>
                  {item.is_available ? 'Mavjud' : 'Tugagan'}
                </span>
              </div>
              <div className="menu-info">
                <div className="menu-name">{item.name_uz}</div>
                <div className="menu-cat">{catName}</div>
                <div className="menu-price-row">
                  <div className="menu-price">{item.price.toLocaleString()} <span style={{ fontSize: '0.75rem', color: 'var(--gray)' }}>so'm</span></div>
                  <label className="switch" title={item.is_available ? 'Mavjud' : 'Tugagan'}>
                    <input type="checkbox" checked={!!item.is_available} onChange={e => toggleItem(item.id, e.target.checked)} />
                    <span className="slider"></span>
                  </label>
                </div>
                <div style={{ marginTop: '1rem', display: 'flex', gap: '0.5rem' }}>
                  <button className="btn btn-outline sm" style={{ flex: 1 }} onClick={() => openMenuFormModal(item)}>Tahrirlash</button>
                  <button className="btn btn-danger sm" onClick={() => deleteItem(item.id)} title="O'chirish">🗑</button>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </>
  );
}

// ─── USERS ───────────────────────────────────────────────────────────────────

export function Users({ ctx }: { ctx: AdminCtx }) {
  const { showToast } = ctx;
  const [query, setQuery] = useState('');
  const debouncedQuery = useDebouncedValue(query);
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [usersLoadState, setUsersLoadState] = useState<'loading' | 'ready' | 'error'>('loading');

  const loadUsers = useCallback(async (): Promise<void> => {
    try {
      const data = await apiGet<AdminUser[]>(`/api/admin/users?search=${encodeURIComponent(debouncedQuery)}`);
      if (!Array.isArray(data)) throw new Error("Foydalanuvchilar noto'g'ri formatda keldi");
      setUsers(data);
      setUsersLoadState('ready');
    } catch (err) {
      console.error('Users load failed:', err);
      setUsersLoadState('error');
    }
  }, [debouncedQuery]);

  useEffect(() => { loadUsers(); }, [loadUsers]);

  async function toggleUserBlock(id: number, block: boolean): Promise<void> {
    try {
      await apiPost(`/api/admin/users/${id}/${block ? 'block' : 'unblock'}`, {});
      showToast('Bajarildi');
      loadUsers();
    } catch (err) { showToast('Xatolik yuz berdi', 'error'); }
  }

  return (
    <>
      <div className="page-header-container">
        <div className="page-header-left">
          <div className="page-header-title">
            <span>👥</span>
            <span>Mijozlar Bazasi</span>
          </div>
          <div className="page-header-subtitle">
            Ro'yxatdan o'tgan foydalanuvchilar, buyurtmalar soni va sodiqlik ballari
          </div>
        </div>
        <div className="page-header-right">
          <button className="btn btn-outline sm" onClick={() => void loadUsers()}>↻ Yangilash</button>
          <div style={{ position: 'relative', display: 'inline-flex', alignItems: 'center' }}>
            <span style={{ position: 'absolute', left: '0.75rem', color: 'var(--gray)', pointerEvents: 'none', fontSize: '0.85rem' }}>🔍</span>
            <input
              type="search"
              className="form-input"
              style={{ paddingLeft: '2.1rem', width: '240px' }}
              placeholder="Ism, username yoki telefon..."
              value={query}
              onChange={e => setQuery(e.target.value)}
            />
          </div>
        </div>
      </div>

      <div className="table-container">
        <table>
          <thead>
            <tr>
              <th>Mijoz</th>
              <th>Telefon</th>
              <th>Buyurtmalar</th>
              <th>Jami Xarajat</th>
              <th>Sodiqlik Ballari</th>
              <th>Ro'yxatdan o'tgan</th>
              <th>Holat</th>
              <th>Amallar</th>
            </tr>
          </thead>
          <tbody>
            {usersLoadState === 'loading' && (
              <tr><td colSpan={8} style={{ textAlign: 'center', padding: '2rem' }}>Foydalanuvchilar yuklanmoqda...</td></tr>
            )}
            {usersLoadState === 'error' && users.length === 0 && (
              <tr>
                <td colSpan={8} className="admin-data-error" role="alert">
                  Ma'lumotlarni yuklab bo'lmadi.
                  <button className="btn btn-outline sm" onClick={() => void loadUsers()}>Qayta urinish</button>
                </td>
              </tr>
            )}
            {usersLoadState === 'error' && users.length > 0 && (
              <tr>
                <td colSpan={8} className="admin-data-warning" role="status">
                  Yangilash muvaffaqiyatsiz. Oxirgi yuklangan ma'lumotlar ko'rsatilmoqda.
                </td>
              </tr>
            )}
            {usersLoadState === 'ready' && users.length === 0 && (
              <tr>
                <td colSpan={8} style={{ textAlign: 'center', padding: '2rem', color: 'var(--gray)' }}>
                  Foydalanuvchilar topilmadi.
                </td>
              </tr>
            )}
            {users.map(u => (
              <tr key={u.id}>
                <td>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                    <div style={{ width: 34, height: 34, borderRadius: 10, background: 'linear-gradient(135deg, rgba(255,107,0,0.25), rgba(255,255,255,0.08))', border: '1px solid rgba(255,255,255,0.1)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, color: '#FF922B', fontSize: '0.85rem' }}>
                      {(u.full_name || u.username || '?').charAt(0).toUpperCase()}
                    </div>
                    <div>
                      <div style={{ fontWeight: 700, color: '#fff' }}>{u.full_name || "Noma'lum"}</div>
                      <div style={{ fontSize: '0.76rem', color: 'var(--gray)' }}>@{u.username || '-'}</div>
                    </div>
                  </div>
                </td>
                <td style={{ color: '#CBD5E1', fontSize: '0.84rem' }}>
                  {u.phone ? <a href={`tel:${u.phone}`} style={{ color: '#10B981', fontWeight: 600 }}>{u.phone}</a> : '—'}
                </td>
                <td style={{ fontWeight: 650, fontVariantNumeric: 'tabular-nums' }}>
                  {u.total_orders || 0} ta
                </td>
                <td style={{ fontWeight: 700, color: '#F8FAFC', fontVariantNumeric: 'tabular-nums' }}>
                  {(u.total_spent || 0).toLocaleString()} <small style={{ color: 'var(--gray)', fontWeight: 500 }}>so'm</small>
                </td>
                <td>
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.25rem', padding: '2px 8px', borderRadius: 999, background: 'rgba(255,107,0,0.12)', border: '1px solid rgba(255,107,0,0.25)', color: '#FFB800', fontWeight: 700, fontSize: '0.78rem' }}>
                    ⭐ {u.loyalty_points || 0}
                  </span>
                </td>
                <td style={{ color: 'var(--gray)', fontSize: '0.82rem' }}>
                  {new Date(u.created_at).toLocaleDateString('uz-UZ')}
                </td>
                <td>
                  <span className={`badge ${u.is_blocked ? 'badge-cancelled' : 'badge-delivered'}`}>
                    {u.is_blocked ? 'Bloklangan' : 'Faol'}
                  </span>
                </td>
                <td>
                  <button
                    className={`btn sm ${u.is_blocked ? 'btn-success' : 'btn-outline'}`}
                    onClick={() => toggleUserBlock(u.id, !u.is_blocked)}
                  >
                    {u.is_blocked ? 'Ochish' : 'Bloklash'}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

// ─── COUPONS ─────────────────────────────────────────────────────────────────

function CouponFormBody({ saveRef, ctx, reload }: {
  saveRef: SaveRef;
  ctx: AdminCtx;
  reload: () => void;
}) {
  const { showToast, closeModal } = ctx;
  const [form, setForm] = useState({ code: '', discount_type: 'percent' as 'percent' | 'fixed', discount_value: '' });

  saveRef.current = async () => {
    const code = form.code.trim().toUpperCase();
    const value = parseInt(form.discount_value);
    if (!code) { showToast('Kupon kodini kiriting!', 'error'); return; }
    if (isNaN(value) || value <= 0) { showToast("To'g'ri qiymat kiriting!", 'error'); return; }
    if (form.discount_type === 'percent' && value > 100) { showToast('Foiz 100 dan oshmasligi kerak!', 'error'); return; }
    const data = {
      code,
      discount_type: form.discount_type,
      discount_value: value,
      max_uses: 100,
      used_count: 0,
      is_active: true
    };
    try {
      const res = await apiPost<{ error?: string }>('/api/admin/coupons', data);
      if (res && res.error) throw new Error(res.error);
      showToast('Saqlandi');
      closeModal();
      reload();
    } catch (err) { showToast('Xatolik! Kupon saqlanmadi', 'error'); }
  };

  return (
    <form onSubmit={e => e.preventDefault()}>
      <div className="form-group"><label>Kod</label><input className="form-input" value={form.code} onChange={e => setForm(f => ({ ...f, code: e.target.value }))} /></div>
      <div className="form-group">
        <label>Turi</label>
        <select className="form-select" value={form.discount_type} onChange={e => setForm(f => ({ ...f, discount_type: e.target.value as 'percent' | 'fixed' }))}>
          <option value="percent">Foiz (%)</option>
          <option value="fixed">Summa (sum)</option>
        </select>
      </div>
      <div className="form-group"><label>Qiymat</label><input type="number" className="form-input" value={form.discount_value} onChange={e => setForm(f => ({ ...f, discount_value: e.target.value }))} /></div>
    </form>
  );
}

export function Coupons({ ctx }: { ctx: AdminCtx }) {
  const { showToast, openModal } = ctx;
  const [coupons, setCoupons] = useState<AdminCoupon[]>([]);
  const [couponsLoadState, setCouponsLoadState] = useState<'loading' | 'ready' | 'error'>('loading');

  const loadCoupons = useCallback(async (): Promise<void> => {
    try {
      const data = await apiGet<AdminCoupon[]>('/api/admin/coupons');
      if (!Array.isArray(data)) throw new Error("Kuponlar noto'g'ri formatda keldi");
      setCoupons(data);
      setCouponsLoadState('ready');
    } catch (err) {
      console.error('Coupons load failed:', err);
      setCouponsLoadState('error');
    }
  }, []);

  useEffect(() => { loadCoupons(); }, [loadCoupons]);

  function openAddCouponModal(): void {
    const saveRef: SaveRef = { current: null };
    openModal(
      'Yangi kupon',
      <CouponFormBody saveRef={saveRef} ctx={ctx} reload={loadCoupons} />,
      <button className="btn btn-primary" onClick={() => saveRef.current?.()}>Saqlash</button>
    );
  }

  async function deleteCoupon(id: string): Promise<void> {
    if (!confirm("O'chirish?")) return;
    try {
      await apiDelete(`/api/admin/coupons/${id}`);
      showToast("O'chirildi");
      loadCoupons();
    } catch (err) { showToast('Xatolik yuz berdi', 'error'); }
  }

  return (
    <>
      <div className="page-header-container">
        <div className="page-header-left">
          <div className="page-header-title">
            <span>🎟</span>
            <span>Kuponlar & Promokodlar</span>
          </div>
          <div className="page-header-subtitle">
            Chegirma kodlari, foizlar va foydalanish limitlari nazorati
          </div>
        </div>
        <div className="page-header-right">
          <button className="btn btn-outline sm" onClick={() => void loadCoupons()}>↻ Yangilash</button>
          <button className="btn btn-primary" onClick={openAddCouponModal}>+ Yangi kupon</button>
        </div>
      </div>

      <div className="table-container">
        <table>
          <thead>
            <tr>
              <th>Promokod</th>
              <th>Chegirma</th>
              <th>Foydalanildi</th>
              <th>Holat</th>
              <th>Amallar</th>
            </tr>
          </thead>
          <tbody>
            {couponsLoadState === 'loading' && (
              <tr><td colSpan={5} style={{ textAlign: 'center', padding: '2rem' }}>Kuponlar yuklanmoqda...</td></tr>
            )}
            {couponsLoadState === 'error' && coupons.length === 0 && (
              <tr>
                <td colSpan={5} className="admin-data-error" role="alert">
                  Kuponlarni yuklab bo'lmadi.
                  <button className="btn btn-outline sm" onClick={() => void loadCoupons()}>Qayta urinish</button>
                </td>
              </tr>
            )}
            {couponsLoadState === 'error' && coupons.length > 0 && (
              <tr>
                <td colSpan={5} className="admin-data-warning" role="status">
                  Yangilash muvaffaqiyatsiz. Oxirgi yuklangan ma'lumotlar ko'rsatilmoqda.
                </td>
              </tr>
            )}
            {couponsLoadState === 'ready' && coupons.length === 0 && (
              <tr>
                <td colSpan={5} style={{ textAlign: 'center', padding: '2rem', color: 'var(--gray)' }}>
                  Hali kuponlar yaratilmagan. Yangi kupon qo'shishingiz mumkin.
                </td>
              </tr>
            )}
            {coupons.map(c => {
              const usagePercent = Math.min(100, Math.round((c.used_count / Math.max(1, c.max_uses)) * 100));
              return (
                <tr key={c.id}>
                  <td>
                    <span style={{ display: 'inline-block', padding: '0.3rem 0.65rem', borderRadius: 8, background: 'rgba(255, 107, 0, 0.12)', border: '1px solid rgba(255, 107, 0, 0.25)', color: '#FF922B', fontWeight: 800, letterSpacing: '0.05em', fontFamily: 'monospace', fontSize: '0.9rem' }}>
                      {c.code}
                    </span>
                  </td>
                  <td style={{ fontWeight: 700, color: '#fff' }}>
                    {c.discount_type === 'percent' ? `${c.discount_value}%` : `${c.discount_value.toLocaleString()} so'm`}
                  </td>
                  <td>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem', minWidth: '120px' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.76rem', color: 'var(--gray)' }}>
                        <span>{c.used_count} ta</span>
                        <span>max {c.max_uses}</span>
                      </div>
                      <div style={{ height: 5, width: '100%', background: 'rgba(255,255,255,0.08)', borderRadius: 3, overflow: 'hidden' }}>
                        <div style={{ height: '100%', width: `${usagePercent}%`, background: usagePercent > 80 ? '#EF4444' : '#10B981', borderRadius: 3 }} />
                      </div>
                    </div>
                  </td>
                  <td>
                    <span className={`badge ${c.is_active ? 'badge-delivered' : 'badge-cancelled'}`}>
                      {c.is_active ? 'Faol' : "O'chirilgan"}
                    </span>
                  </td>
                  <td>
                    <button className="btn btn-danger sm" onClick={() => deleteCoupon(c.id)} title="O'chirish">
                      🗑 O'chirish
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}

// ─── BROADCAST ───────────────────────────────────────────────────────────────

export function Broadcast({ ctx }: { ctx: AdminCtx }) {
  const { showToast } = ctx;
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);

  async function sendBroadcast(): Promise<void> {
    if (!text.trim()) { showToast('Xabar matnini kiriting!', 'error'); return; }
    if (!confirm('Haqiqatdan ham BARCHA mijozlarga ushbu xabarni yuborishni tasdiqlaysizmi?')) return;
    setSending(true);
    try {
      await apiPost('/api/admin/broadcast', { message: text });
      showToast('Ommaviy xabar yuborish boshlandi!', 'success');
      setText('');
    } catch (err) {
      showToast('Xatolik yuz berdi!', 'error');
    } finally {
      setSending(false);
    }
  }

  return (
    <>
      <div className="page-header-container">
        <div className="page-header-left">
          <div className="page-header-title">
            <span>📢</span>
            <span>Ommaviy Xabarnoma</span>
          </div>
          <div className="page-header-subtitle">
            Barcha faol Telegram mijozlariga muhim yangilik va chegirmalarni yetkazish
          </div>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(300px, 1.2fr) minmax(280px, 1fr)', gap: '1.5rem', alignItems: 'start' }}>
        <div className="stat-card">
          <div className="form-group">
            <label className="form-label" style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span>Xabar matni</span>
              <span style={{ fontSize: '0.75rem', color: 'var(--gray)' }}>{text.length} ta belgi</span>
            </label>
            <textarea
              className="form-textarea"
              rows={9}
              placeholder="Assalomu alaykum! Bugun barcha buyurtmalarga 15% chegirma..."
              value={text}
              onChange={e => setText(e.target.value)}
            />
          </div>
          <button
            className="btn btn-primary"
            disabled={sending || !text.trim()}
            onClick={sendBroadcast}
            style={{ width: '100%', padding: '0.8rem' }}
          >
            {sending ? '⏳ Yuborilmoqda...' : '🚀 Xabarni barcha foydalanuvchilarga yuborish'}
          </button>
        </div>

        <div className="stat-card">
          <div style={{ fontSize: '0.8rem', fontWeight: 700, color: '#94A3B8', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '0.85rem' }}>
            Telegram ko'rinishi (Preview)
          </div>
          <div style={{ background: '#0F172A', borderRadius: 12, padding: 14, border: '1px solid rgba(255,255,255,0.08)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
              <div style={{ width: 30, height: 30, borderRadius: '50%', background: '#FF6B00', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.9rem' }}>
                🍔
              </div>
              <div>
                <div style={{ fontSize: '0.82rem', fontWeight: 700, color: '#fff' }}>Food City Bot</div>
                <div style={{ fontSize: '0.7rem', color: '#10B981' }}>bot</div>
              </div>
            </div>
            <div style={{ background: '#1E293B', padding: '10px 12px', borderRadius: '4px 12px 12px 12px', fontSize: '0.85rem', lineHeight: 1.5, color: '#F1F5F9', whiteSpace: 'pre-wrap', wordBreak: 'break-word', minHeight: 60 }}>
              {text.trim() || <span style={{ color: '#64748B', fontStyle: 'italic' }}>Xabar matni shu yerda ko'rinadi...</span>}
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

// ─── COURIERS ────────────────────────────────────────────────────────────────

export function Couriers({ ctx }: { ctx: AdminCtx }) {
  const { showToast } = ctx;
  const [couriers, setCouriers] = useState<AdminCourier[]>([]);
  const [couriersLoadState, setCouriersLoadState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [newId, setNewId] = useState('');
  const [busy, setBusy] = useState(false);

  const loadCouriers = useCallback(async (): Promise<void> => {
    try {
      const data = await apiGet<AdminCourier[]>('/api/admin/couriers');
      if (!Array.isArray(data)) throw new Error("Kuryerlar noto'g'ri formatda keldi");
      setCouriers(data);
      setCouriersLoadState('ready');
    } catch (err) {
      console.error('Couriers load failed:', err);
      setCouriersLoadState('error');
    }
  }, []);

  useEffect(() => { loadCouriers(); }, [loadCouriers]);

  async function addCourier(): Promise<void> {
    const id = newId.trim();
    if (!id || !/^\d+$/.test(id)) {
      showToast("To'g'ri Telegram ID kiriting (faqat raqamlar)", 'error');
      return;
    }
    setBusy(true);
    try {
      const res = await apiPost<{ success?: boolean; error?: string }>('/api/admin/couriers', { user_id: Number(id) });
      if (res.error) {
        showToast(res.error, 'error');
      } else {
        showToast("Kuryer muvaffaqiyatli qo'shildi", 'success');
        setNewId('');
        loadCouriers();
      }
    } catch (err) { showToast('Xatolik yuz berdi', 'error'); }
    finally { setBusy(false); }
  }

  async function removeCourier(userId: number): Promise<void> {
    if (!confirm("Bu kuryerni ro'yxatdan chiqarishni tasdiqlaysizmi?")) return;
    try {
      await apiDelete(`/api/admin/couriers/${userId}`);
      showToast("Kuryer o'chirildi");
      loadCouriers();
    } catch (err) { showToast('Xatolik yuz berdi', 'error'); }
  }

  return (
    <>
      <div className="page-header-container">
        <div className="page-header-left">
          <div className="page-header-title">
            <span>🛵</span>
            <span>Kuryerlar Boshqaruvi</span>
          </div>
          <div className="page-header-subtitle">
            Buyurtmalarni yetkazib beruvchi kuryerlar ro'yxati va avtorizatsiyasi
          </div>
        </div>
        <div className="page-header-right">
          <button className="btn btn-outline sm" onClick={() => void loadCouriers()}>↻ Yangilash</button>
        </div>
      </div>

      <div className="stat-card" style={{ maxWidth: 650, marginBottom: '1.75rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', marginBottom: 6 }}>
          <span style={{ fontSize: '1.15rem' }}>➕</span>
          <span style={{ fontWeight: 750, color: '#fff', fontSize: '0.95rem' }}>Yangi kuryer tayinlash</span>
        </div>
        <p style={{ fontSize: '0.82rem', color: 'var(--gray)', marginBottom: '1rem', lineHeight: 1.5 }}>
          Kuryer avval Telegram botimizga <code>/start</code> bosgan bo'lishi lozim. Uning Telegram raqamli ID'sini kiriting
          (botga <code>/myid</code> yuborib bilishi mumkin).
        </p>
        <div style={{ display: 'flex', gap: '0.65rem' }}>
          <input
            type="text"
            className="form-input"
            placeholder="Telegram ID (masalan: 123456789)"
            value={newId}
            onChange={e => setNewId(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') addCourier(); }}
          />
          <button className="btn btn-primary" disabled={busy} onClick={addCourier}>
            {busy ? '⏳ Qo\'shilmoqda...' : 'Qo\'shish'}
          </button>
        </div>
      </div>

      <div className="table-container">
        <table>
          <thead>
            <tr>
              <th>Kuryer</th>
              <th>Username</th>
              <th>Telegram ID</th>
              <th>Biriktirilgan Sana</th>
              <th>Amallar</th>
            </tr>
          </thead>
          <tbody>
            {couriersLoadState === 'loading' && (
              <tr><td colSpan={5} style={{ textAlign: 'center', padding: '2rem' }}>Kuryerlar yuklanmoqda...</td></tr>
            )}
            {couriersLoadState === 'error' && couriers.length === 0 && (
              <tr>
                <td colSpan={5} className="admin-data-error" role="alert">
                  Kuryerlarni yuklab bo'lmadi.
                  <button className="btn btn-outline sm" onClick={() => void loadCouriers()}>Qayta urinish</button>
                </td>
              </tr>
            )}
            {couriersLoadState === 'error' && couriers.length > 0 && (
              <tr>
                <td colSpan={5} className="admin-data-warning" role="status">
                  Yangilash muvaffaqiyatsiz. Oxirgi yuklangan ma'lumotlar ko'rsatilmoqda.
                </td>
              </tr>
            )}
            {couriersLoadState === 'ready' && couriers.length === 0 && (
              <tr>
                <td colSpan={5} style={{ textAlign: 'center', padding: '2rem', color: 'var(--gray)' }}>
                  Hali kuryer biriktirilmagan. Yuqoridagi forma orqali kuryer qo'shing.
                </td>
              </tr>
            )}
            {couriers.map(c => (
              <tr key={c.user_id}>
                <td>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem' }}>
                    <div style={{ width: 32, height: 32, borderRadius: 8, background: 'rgba(59, 130, 246, 0.15)', border: '1px solid rgba(59, 130, 246, 0.25)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, color: '#60A5FA', fontSize: '0.8rem' }}>
                      🛵
                    </div>
                    <strong style={{ color: '#fff' }}>{c.users?.full_name || "Noma'lum"}</strong>
                  </div>
                </td>
                <td style={{ color: 'var(--gray)' }}>
                  {c.users?.username ? `@${c.users.username}` : '—'}
                </td>
                <td style={{ fontFamily: 'monospace', color: '#93C5FD' }}>
                  {c.user_id}
                </td>
                <td style={{ color: 'var(--gray)', fontSize: '0.82rem' }}>
                  {new Date(c.added_at).toLocaleDateString('uz-UZ')}
                </td>
                <td>
                  <button className="btn btn-danger sm" onClick={() => removeCourier(c.user_id)} title="O'chirish">
                    🗑 O'chirish
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

// ─── SOZLAMALAR (to'lov rekvizitlari) ────────────────────────────────────────

export function Settings({ ctx }: { ctx: AdminCtx }) {
  const { showToast } = ctx;
  const [clickServiceId, setClickServiceId] = useState('');
  const [clickMerchantId, setClickMerchantId] = useState('');
  const [clickSecretKey, setClickSecretKey] = useState('');
  const [clickIsConfigured, setClickIsConfigured] = useState(false);
  const [paymeMerchantId, setPaymeMerchantId] = useState('');
  const [paymeSecretKey, setPaymeSecretKey] = useState('');
  const [paymeTestMode, setPaymeTestMode] = useState(true);
  const [paymeIsConfigured, setPaymeIsConfigured] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    apiGet<any>('/api/admin/click-payme-settings')
      .then(cpRes => {
        if (cpRes) {
          setClickServiceId(cpRes.click_service_id || '');
          setClickMerchantId(cpRes.click_merchant_id || '');
          setClickIsConfigured(Boolean(cpRes.click_is_configured));
          setPaymeMerchantId(cpRes.payme_merchant_id || '');
          setPaymeTestMode(Boolean(cpRes.payme_test_mode));
          setPaymeIsConfigured(Boolean(cpRes.payme_is_configured));
        }
      })
      .catch(() => showToast("Sozlamalarni yuklab bo'lmadi", 'error'))
      .finally(() => setLoaded(true));
  }, [showToast]);

  async function saveClickPayme(): Promise<void> {
    setBusy(true);
    try {
      const payload: any = {
        click_service_id: clickServiceId.trim(),
        click_merchant_id: clickMerchantId.trim(),
        payme_merchant_id: paymeMerchantId.trim(),
        payme_test_mode: paymeTestMode,
      };
      if (clickSecretKey.trim()) payload.click_secret_key = clickSecretKey.trim();
      if (paymeSecretKey.trim()) payload.payme_secret_key = paymeSecretKey.trim();

      const res = await apiPut<{ success?: boolean }>('/api/admin/click-payme-settings', payload);
      if (res.success) {
        showToast('Click & Payme sozlamalari saqlandi', 'success');
        setClickSecretKey('');
        setPaymeSecretKey('');
      } else {
        showToast('Saqlanmadi', 'error');
      }
    } catch { showToast('Xatolik yuz berdi', 'error'); }
    finally { setBusy(false); }
  }

  return (
    <>
      <div className="page-header-container">
        <div className="page-header-left">
          <div className="page-header-title">
            <span>⚙️</span>
            <span>Tizim Sozlamalari</span>
          </div>
          <div className="page-header-subtitle">
            Click va Payme rasmiy to'lov tizimlari integratsiyasi
          </div>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: '1.5rem', maxWidth: 960 }}>
        {/* CLICK INTEGRATSIYASI */}
        <div className="stat-card" style={{ display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12, paddingBottom: 10, borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ fontSize: '1.3rem' }}>🟢</span>
                <strong style={{ fontSize: '1.05rem', color: '#00B159' }}>Click Merchant</strong>
              </div>
              <span style={{ fontSize: '0.72rem', fontWeight: 700, padding: '3px 10px', borderRadius: 999, background: clickIsConfigured ? 'rgba(0,177,89,0.15)' : 'rgba(239,68,68,0.15)', color: clickIsConfigured ? '#00B159' : '#EF4444', border: `1px solid ${clickIsConfigured ? 'rgba(0,177,89,0.3)' : 'rgba(239,68,68,0.3)'}` }}>
                {clickIsConfigured ? '✅ Faol' : '❌ Ulanmagan'}
              </span>
            </div>
            <p style={{ fontSize: '0.8rem', color: 'var(--gray)', marginBottom: 14 }}>
              Click orqali to'lovlarni qabul qilish va avtomatik tasdiqlash uchun kabinetingizdagi kalitlar.
            </p>

            <div className="form-group">
              <label className="form-label">Click Service ID</label>
              <input type="text" className="form-input" placeholder="Service ID"
                value={clickServiceId} disabled={!loaded} onChange={e => setClickServiceId(e.target.value)} />
            </div>
            <div className="form-group">
              <label className="form-label">Click Merchant ID</label>
              <input type="text" className="form-input" placeholder="Merchant ID"
                value={clickMerchantId} disabled={!loaded} onChange={e => setClickMerchantId(e.target.value)} />
            </div>
            <div className="form-group">
              <label className="form-label">Click Secret Key</label>
              <input type="password" className="form-input" placeholder="Secret Key (o'zgartirish uchun)"
                value={clickSecretKey} disabled={!loaded} onChange={e => setClickSecretKey(e.target.value)} />
            </div>
          </div>
        </div>

        {/* PAYME INTEGRATSIYASI */}
        <div className="stat-card" style={{ display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12, paddingBottom: 10, borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ fontSize: '1.3rem' }}>🔵</span>
                <strong style={{ fontSize: '1.05rem', color: '#00CCCC' }}>Payme Business</strong>
              </div>
              <span style={{ fontSize: '0.72rem', fontWeight: 700, padding: '3px 10px', borderRadius: 999, background: paymeIsConfigured ? 'rgba(0,204,204,0.15)' : 'rgba(239,68,68,0.15)', color: paymeIsConfigured ? '#00CCCC' : '#EF4444', border: `1px solid ${paymeIsConfigured ? 'rgba(0,204,204,0.3)' : 'rgba(239,68,68,0.3)'}` }}>
                {paymeIsConfigured ? '✅ Faol' : '❌ Ulanmagan'}
              </span>
            </div>
            <p style={{ fontSize: '0.8rem', color: 'var(--gray)', marginBottom: 14 }}>
              Payme orqali kartadan kartaga xavfsiz to'lov va fiskal chek integratsiyasi.
            </p>

            <div className="form-group">
              <label className="form-label">Payme Merchant ID</label>
              <input type="text" className="form-input" placeholder="Merchant ID"
                value={paymeMerchantId} disabled={!loaded} onChange={e => setPaymeMerchantId(e.target.value)} />
            </div>
            <div className="form-group">
              <label className="form-label">Payme Secret Key</label>
              <input type="password" className="form-input" placeholder="Secret Key (o'zgartirish uchun)"
                value={paymeSecretKey} disabled={!loaded} onChange={e => setPaymeSecretKey(e.target.value)} />
            </div>
            <div className="form-group" style={{ marginTop: '0.75rem' }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: '0.84rem', color: '#E2E8F0', cursor: 'pointer' }}>
                <input type="checkbox" checked={paymeTestMode} onChange={e => setPaymeTestMode(e.target.checked)} />
                <span>Payme Test / Sandbox rejimi</span>
              </label>
            </div>
          </div>
        </div>

        <div style={{ gridColumn: '1 / -1' }}>
          <button
            className="btn btn-primary"
            style={{ width: '100%', padding: '0.85rem' }}
            disabled={busy || !loaded}
            onClick={saveClickPayme}
          >
            {busy ? '⏳ Saqlanmoqda...' : '💾 Click & Payme sozlamalarini saqlash'}
          </button>
        </div>
      </div>
    </>
  );
}
