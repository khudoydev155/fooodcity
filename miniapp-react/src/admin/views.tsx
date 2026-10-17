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
  if (pStatus === 'paid') { text = "✅ To'langan"; color = '#10B981'; }
  else if (pStatus === 'rejected') { text = '❌ Chek rad'; color = '#EF4444'; }
  else if (method === 'card_transfer' && order.payment_receipt_url) { text = '🧾 Chekni tekshiring'; color = '#F59E0B'; }
  else if (method === 'card_transfer') { text = '💳 Chek kutilmoqda'; color = '#3B82F6'; }
  else { text = '💵 Naqd'; color = '#9CA3AF'; }
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

function PaymentBox({ order, onConfirm, onReject }: {
  order: AdminOrder;
  onConfirm: (id: string) => Promise<void>;
  onReject: (id: string) => Promise<void>;
}) {
  const [processing, setProcessing] = useState(false);
  const method = order.payment_method || 'cash';
  const pStatus = order.payment_status || 'pending';
  const ui = PAYMENT_STATUS_UI[pStatus] || PAYMENT_STATUS_UI.pending;
  const receipt = order.payment_receipt_url;
  const btn = (bg: string): React.CSSProperties => ({
    flex: 1, padding: 10, borderRadius: 8, border: 'none', background: bg, color: '#fff', fontWeight: 700, cursor: 'pointer'
  });

  return (
    <div style={{ padding: 16, borderBottom: '1px solid rgba(255,255,255,0.05)', margin: '0 -1.5rem' }}>
      <div style={{ color: '#888', fontSize: 11, textTransform: 'uppercase', marginBottom: 8 }}>TO'LOV</div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
        <div style={{ fontWeight: 700 }}>{method === 'cash' ? '💵 Naqd pul' : "💳 Karta orqali o'tkazma"}</div>
        <div style={{ background: ui.color + '22', color: ui.color, padding: '4px 12px', borderRadius: 50, fontWeight: 700, fontSize: 12 }}>
          {ui.label}
        </div>
      </div>

      {method === 'card_transfer' && !receipt && (
        <div style={{ color: '#aaa', fontSize: 13 }}>Mijoz hali chek yuklamagan</div>
      )}

      {method === 'card_transfer' && receipt && (
        <div style={{ marginBottom: 10 }}>
          <a href={receipt} target="_blank" rel="noreferrer">
            <img src={receipt} alt="To'lov cheki"
              style={{ maxWidth: '100%', maxHeight: 280, borderRadius: 8, border: '1px solid rgba(255,255,255,0.1)', display: 'block' }} />
          </a>
          <div style={{ color: '#888', fontSize: 11, marginTop: 4 }}>Rasmni bosib to'liq ko'rish mumkin</div>
        </div>
      )}

      {pStatus !== 'paid' && (method === 'cash' || receipt) && (
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
          {method === 'card_transfer' && pStatus !== 'rejected' && (
            <button
              style={btn('#EF4444')}
              disabled={processing}
              onClick={async () => {
                setProcessing(true);
                try { await onReject(order.id); } finally { setProcessing(false); }
              }}
            >
              {processing ? '⏳ Saqlanmoqda...' : '❌ Rad etish'}
            </button>
          )}
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
      <div className="page-title" style={{ flexWrap: 'wrap', gap: '1rem' }}>
        <span>📈 Dashboard Analitika</span>
        <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
          <button className="btn btn-outline sm" onClick={() => setDateFilter('today')}>Bugun</button>
          <button className="btn btn-outline sm" onClick={() => setDateFilter('yesterday')}>Kecha</button>
          <button className="btn btn-outline sm" onClick={() => setDateFilter('7days')}>7 Kun</button>
          <button className="btn btn-outline sm" onClick={() => setDateFilter('thisMonth')}>Shu oy</button>
          <input type="text" ref={pickerInput} className="form-input" style={{ width: '100%', maxWidth: 280, padding: '0.4rem 0.8rem', fontSize: '0.85rem' }} placeholder="Vaqtni tanlang..." />
          <button className="btn btn-success" onClick={downloadExcel}>📥 Excel</button>
        </div>
      </div>

      <div className="stats-grid dashboard-kpis">
        {!stats ? (
          statsError ? (
            <div className="admin-data-error" role="alert">
              Statistikani yuklab bo'lmadi.
              <button className="btn btn-outline sm" onClick={fetchStats}>Qayta urinish</button>
            </div>
          ) : [1, 2, 3, 4].map(i => <div key={i} className="stat-card skeleton" style={{ height: 100 }}></div>)
        ) : (
          <>
            {statsError && (
              <div className="admin-data-warning" role="status">
                Yangilashda xatolik. Quyidagi qiymatlar oxirgi muvaffaqiyatli yuklangan ma'lumotlar.
                <button className="btn btn-outline sm" onClick={fetchStats}>Qayta urinish</button>
              </div>
            )}
            <div className="stat-card">
              <span className="stat-label">Tanlangan davrdagi buyurtmalar</span>
              <div className="stat-value">{stats.today?.orders ?? stats.today_count ?? 0} {getTrend(stats.today?.orders_diff ?? stats.today_count_diff ?? 0)}</div>
            </div>
            <div className="stat-card">
              <span className="stat-label">Tasdiqlangan tushum</span>
              <div className="stat-value">{(stats.today?.revenue ?? stats.today_revenue ?? 0).toLocaleString()} <span style={{ fontSize: '0.8rem', marginLeft: 4, color: 'var(--gray)' }}>sum</span> {getTrend(stats.today?.revenue_diff ?? stats.today_revenue_diff ?? 0)}</div>
              <div className="stat-footnote">{stats.today?.paid_orders ?? 0} ta to'langan buyurtma</div>
            </div>
            <div className="stat-card">
              <span className="stat-label">Jami Foydalanuvchilar</span>
              <div className="stat-value">{stats.total_users || 0}</div>
            </div>
            <div className="stat-card">
              <span className="stat-label">O'rtacha to'langan chek</span>
              <div className="stat-value">{(stats.today?.average_order_value ?? Math.round((stats.today?.revenue ?? stats.today_revenue ?? 0) / Math.max(1, (stats.today?.orders ?? stats.today_count ?? 0) - (stats.today?.cancelled_orders ?? 0)))).toLocaleString()} <span style={{ fontSize: '0.8rem', marginLeft: 4, color: 'var(--gray)' }}>sum</span></div>
            </div>
            <div className="stat-card">
              <span className="stat-label">Faol buyurtmalar</span>
              <div className="stat-value">{stats.today?.active_orders ?? 0}</div>
            </div>
            <div className="stat-card">
              <span className="stat-label">Yetkazilgan</span>
              <div className="stat-value">{stats.today?.delivered_orders ?? 0}</div>
            </div>
            <div className="stat-card">
              <span className="stat-label">Bekor qilingan</span>
              <div className="stat-value">{stats.today?.cancelled_orders ?? 0}</div>
            </div>
            <div className="stat-card">
              <span className="stat-label">Undirilmagan summa</span>
              <div className="stat-value">{(stats.today?.pending_payment_amount ?? 0).toLocaleString()} <span style={{ fontSize: '0.8rem', marginLeft: 4, color: 'var(--gray)' }}>sum</span></div>
              <div className="stat-footnote">{stats.today?.pending_payment_orders ?? 0} ta to'lanmagan buyurtma</div>
            </div>
            <div className="stat-card">
              <span className="stat-label">Buyurtma qilgan mijozlar</span>
              <div className="stat-value">{stats.today?.unique_customers ?? 0}</div>
            </div>
            <div className="stat-card">
              <span className="stat-label">Yetkazish darajasi</span>
              <div className="stat-value">{stats.today?.delivery_rate ?? 0}%</div>
            </div>
            <div className="stat-card">
              <span className="stat-label">Bekor qilish darajasi</span>
              <div className="stat-value">{stats.today?.cancellation_rate ?? 0}%</div>
            </div>
            {returningPercent !== null && (
              <div className="stat-card">
                <span className="stat-label">Qayta xarid qilganlar (umumiy)</span>
                <div className="stat-value">{returningPercent}% <span style={{ fontSize: '0.8rem', marginLeft: 4, color: 'var(--gray)' }}>mijozlar</span></div>
              </div>
            )}
          </>
        )}
      </div>

      <div className="stats-grid dashboard-charts">
        <div className="stat-card">
          <h3 style={{ fontSize: '1rem', marginBottom: '1rem', color: 'var(--gray)' }}>Tushumlar Dinamikasi</h3>
          {analyticsError && <div className="admin-data-error" role="alert">Analitikani yuklab bo'lmadi. <button className="btn btn-outline sm" onClick={renderAnalytics}>Qayta urinish</button></div>}
          <canvas ref={revCanvas} style={{ maxHeight: 250 }}></canvas>
        </div>
        <div className="stat-card">
          <h3 style={{ fontSize: '1rem', marginBottom: '1rem', color: 'var(--gray)' }}>Top Mahsulotlar (Soni)</h3>
          {analyticsError && <div className="admin-data-error" role="alert">Analitikani yuklab bo'lmadi.</div>}
          <canvas ref={topCanvas} style={{ maxHeight: 250 }}></canvas>
        </div>
      </div>

    </>
  );
}

// ─── ORDERS ──────────────────────────────────────────────────────────────────

const ORDER_TABS: { label: string; status: string }[] = [
  { label: 'Hammasi', status: '' },
  { label: 'Yangi', status: 'new' },
  { label: 'Tasdiqlangan', status: 'confirmed' },
  { label: 'Tayyorlanmoqda', status: 'cooking' },
  { label: "Yo'lda", status: 'delivering' },
  { label: 'Yetkazildi', status: 'delivered' },
  { label: 'Bekor', status: 'cancelled' }
];

const PAGE_SIZE = 30;

export function Orders({ ctx }: { ctx: AdminCtx }) {
  const { refreshTick } = ctx;
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
  // MUHIM: ilgari bu sahifa hech qanday "limit" yubormas edi — backend esa
  // default holda faqat 20 ta ENG SO'NGGI buyurtmani qaytarardi. Ya'ni 20
  // tadan ko'p buyurtma (masalan "Yetkazildi" yoki "Bekor" tarixida)
  // bo'lsa, qolganlari admin panelda HECH QACHON ko'rinmasdi — sahifalash
  // (pagination) yo'q edi. Endi "Yana yuklash" tugmasi bilan kengaytiriladi.
  const canLoadMore = Array.isArray(orders) && orders.length >= page * PAGE_SIZE;

  return (
    <>
      <div className="page-title">
        <div className="orders-heading">
          <span>📦 Buyurtmalar</span>
          <small>Yangi zakazlar shu yerga tushadi va har 10 soniyada yangilanadi</small>
        </div>
        <div className="orders-toolbar">
          <span className="orders-live-indicator"><i /> Jonli yangilanish</span>
          <button className="btn btn-outline sm" disabled={refreshing} onClick={() => { setRefreshing(true); void loadOrders(); }}>
            {refreshing ? 'Yangilanmoqda...' : '↻ Yangilash'}
          </button>
          <input type="search" className="form-input" aria-label="Buyurtmalarni qidirish" placeholder="ID, ism, username yoki telefon..."
            value={query} onChange={e => setQuery(e.target.value)} />
        </div>
      </div>
      <div className="tabs">
        {ORDER_TABS.map(t => (
          <button
            key={t.status}
            type="button"
            className={`tab${status === t.status ? ' active' : ''}`}
            aria-pressed={status === t.status}
            onClick={() => setStatus(t.status)}
          >
            {t.label}
          </button>
        ))}
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
            return (
              <article key={order.id} className={`admin-order-card${order.status === 'new' ? ' is-new' : ''}`}>
                <div className="admin-order-card-top">
                  <div>
                    <span className="admin-order-number">#{order.id}</span>
                    <time dateTime={order.created_at}>
                      {new Date(order.created_at).toLocaleString('uz-UZ', {
                        day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit'
                      })}
                    </time>
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
                    <a href={`tel:${order.users.phone}`} onClick={event => event.stopPropagation()}>
                      ☎️ {order.users.phone}
                    </a>
                  ) : (
                    <span className="admin-order-muted">☎️ Telefon kiritilmagan</span>
                  )}
                  {address && (
                    mapUrl ? (
                      <a href={mapUrl} target="_blank" rel="noreferrer" onClick={event => event.stopPropagation()}>
                        📍 {isPickup ? 'Olib ketish' : 'Xaritada manzil'}
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
                  {orderItems.length > 3 && <div className="admin-order-more">yana {orderItems.length - 3} xil mahsulot</div>}
                  {orderItems.length === 0 && <div className="admin-order-muted">Mahsulot tafsiloti mavjud emas</div>}
                  {order.note && <div className="admin-order-note">📝 {order.note}</div>}
                </div>

                <div className="admin-order-card-bottom">
                  <div className="admin-order-payment">
                    <PaymentBadge order={order} />
                    {order.payment_receipt_url && (
                      <a href={order.payment_receipt_url} target="_blank" rel="noreferrer" onClick={event => event.stopPropagation()}>
                        Chekni ko‘rish ↗
                      </a>
                    )}
                  </div>
                  <strong className="admin-order-total">{(Number(order.total) || 0).toLocaleString('uz-UZ')} <small>so‘m</small></strong>
                </div>

                <button type="button" className="admin-order-details" onClick={() => showOrderDetail(order.id)}>
                  Buyurtma tafsilotlari <span aria-hidden="true">→</span>
                </button>
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

  const loadMenu = useCallback(async (): Promise<void> => {
    try {
      const data = await apiGet<AdminMenuItem[]>('/api/admin/menu');
      setMenu(data);
    } catch (err) { setMenu('error'); }
  }, []);

  useEffect(() => { loadMenu(); }, [loadMenu]);

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

  return (
    <>
      <div className="page-title">
        <span>🍽 Menyu</span>
        <button className="btn btn-primary" onClick={() => openMenuFormModal(null)}>+ Yangi taom</button>
      </div>
      <div className="menu-grid">
        {menu === null && [1, 2, 3, 4, 5, 6].map(i => <div key={i} className="menu-card skeleton" style={{ height: 250 }}></div>)}
        {menu === 'error' && 'Xatolik.'}
        {Array.isArray(menu) && menu.map(item => (
          <div className="menu-card" key={item.id}>
            <div className="menu-img">
              {item.image_url ? <img src={item.image_url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : item.emoji}
            </div>
            <div className="menu-info">
              <div className="menu-name">{item.name_uz}</div>
              <div className="menu-cat">{item.category_id}</div>
              <div className="menu-price-row">
                <div className="menu-price">{item.price.toLocaleString()} sum</div>
                <label className="switch">
                  <input type="checkbox" checked={!!item.is_available} onChange={e => toggleItem(item.id, e.target.checked)} />
                  <span className="slider"></span>
                </label>
              </div>
              <div style={{ marginTop: '1rem', display: 'flex', gap: '0.5rem' }}>
                <button className="btn btn-outline sm" onClick={() => openMenuFormModal(item)}>Tahrirlash</button>
                <button className="btn btn-danger sm" onClick={() => deleteItem(item.id)}>🗑</button>
              </div>
            </div>
          </div>
        ))}
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
      <div className="page-title">
        <span>👥 Foydalanuvchilar</span>
        <div className="orders-toolbar">
          <button className="btn btn-outline sm" onClick={() => void loadUsers()}>↻ Yangilash</button>
          <input type="search" className="form-input" placeholder="Qidirish..."
            value={query} onChange={e => setQuery(e.target.value)} />
        </div>
      </div>
      <div className="table-container">
        <table>
          <thead><tr><th></th><th>Ism</th><th>User</th><th>B-lar</th><th>Xarajat</th><th>Ball</th><th>Sana</th><th>Status</th><th></th></tr></thead>
          <tbody>
            {usersLoadState === 'loading' && <tr><td colSpan={9}>Foydalanuvchilar yuklanmoqda...</td></tr>}
            {usersLoadState === 'error' && users.length === 0 && (
              <tr><td colSpan={9} className="admin-data-error" role="alert">
                Ma'lumotlarni yuklab bo'lmadi.
                <button className="btn btn-outline sm" onClick={() => void loadUsers()}>Qayta urinish</button>
              </td></tr>
            )}
            {usersLoadState === 'error' && users.length > 0 && (
              <tr><td colSpan={9} className="admin-data-warning" role="status">Yangilash muvaffaqiyatsiz. Oxirgi yuklangan ma'lumotlar ko'rsatilmoqda.</td></tr>
            )}
            {usersLoadState === 'ready' && users.length === 0 && (
              <tr><td colSpan={9} style={{ textAlign: 'center' }}>Foydalanuvchilar topilmadi.</td></tr>
            )}
            {users.map(u => (
              <tr key={u.id}>
                <td><div style={{ width: 32, height: 32, background: 'var(--sidebar-bg)', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{(u.full_name || u.username || '?').charAt(0)}</div></td>
                <td>{u.full_name || u.username || "Noma'lum"}</td>
                <td>@{u.username || '-'}</td>
                <td>{u.total_orders || 0}</td>
                <td style={{ fontWeight: 600 }}>{(u.total_spent || 0).toLocaleString()} sum</td>
                <td style={{ color: 'var(--primary)' }}>{u.loyalty_points || 0} pt</td>
                <td>{new Date(u.created_at).toLocaleDateString()}</td>
                <td><span className={`badge ${u.is_blocked ? 'badge-cancelled' : 'badge-delivered'}`}>{u.is_blocked ? 'Blok' : 'Faol'}</span></td>
                <td>
                  <button className="btn btn-outline sm" onClick={() => toggleUserBlock(u.id, !u.is_blocked)}>
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
      <h1 className="page-title">🎟 Kuponlar <button className="btn btn-primary" onClick={openAddCouponModal}>+ Yangi</button></h1>
      <div className="orders-toolbar" style={{ justifyContent: 'flex-end', marginBottom: '1rem' }}>
        <button className="btn btn-outline sm" onClick={() => void loadCoupons()}>↻ Yangilash</button>
      </div>
      <div className="table-container">
        <table>
          <thead><tr><th>Kod</th><th>Qiymat</th><th>Ishlatilgan</th><th>Status</th><th></th></tr></thead>
          <tbody>
            {couponsLoadState === 'loading' && <tr><td colSpan={5}>Kuponlar yuklanmoqda...</td></tr>}
            {couponsLoadState === 'error' && coupons.length === 0 && (
              <tr><td colSpan={5} className="admin-data-error" role="alert">
                Kuponlarni yuklab bo'lmadi.
                <button className="btn btn-outline sm" onClick={() => void loadCoupons()}>Qayta urinish</button>
              </td></tr>
            )}
            {couponsLoadState === 'error' && coupons.length > 0 && (
              <tr><td colSpan={5} className="admin-data-warning" role="status">Yangilash muvaffaqiyatsiz. Oxirgi yuklangan ma'lumotlar ko'rsatilmoqda.</td></tr>
            )}
            {couponsLoadState === 'ready' && coupons.length === 0 && (
              <tr><td colSpan={5} style={{ textAlign: 'center' }}>Kuponlar topilmadi.</td></tr>
            )}
            {coupons.map(c => (
              <tr key={c.id}>
                <td style={{ fontWeight: 700, color: 'var(--primary)' }}>{c.code}</td>
                <td>{c.discount_type === 'percent' ? c.discount_value + '%' : c.discount_value.toLocaleString() + ' sum'}</td>
                <td>{c.used_count} / {c.max_uses}</td>
                <td><span className={`badge ${c.is_active ? 'badge-delivered' : 'badge-cancelled'}`}>{c.is_active ? 'Faol' : "O'chgan"}</span></td>
                <td><button className="btn btn-danger sm" onClick={() => deleteCoupon(c.id)}>🗑</button></td>
              </tr>
            ))}
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

  async function sendBroadcast(): Promise<void> {
    if (!text) { showToast('Xabar yozing!', 'error'); return; }
    if (!confirm('Haqiqatdan ham barcha foydalanuvchilarga xabar yubormoqchimisiz?')) return;
    try {
      await apiPost('/api/admin/broadcast', { message: text });
      showToast('Xabar yuborish boshlandi!', 'success');
      setText('');
    } catch (err) { showToast('Xatolik!', 'error'); }
  }

  return (
    <>
      <h1 className="page-title">📢 Xabar yuborish</h1>
      <div className="stat-card" style={{ maxWidth: 600 }}>
        <div className="form-group">
          <label className="form-label">Xabar matni</label>
          <textarea className="form-textarea" rows={8} placeholder="Barcha foydalanuvchilarga yuboriladigan xabar..."
            value={text} onChange={e => setText(e.target.value)} />
        </div>
        <div style={{ background: 'rgba(0,0,0,0.2)', padding: '1rem', borderRadius: '0.5rem', marginBottom: '1.5rem' }}>
          <small style={{ color: 'var(--gray)' }}>Ko'rinishi:</small>
          <div style={{ marginTop: '0.5rem', whiteSpace: 'pre-wrap' }}>{text}</div>
        </div>
        <button className="btn btn-primary" onClick={sendBroadcast} style={{ width: '100%' }}>🚀 Xabarni yuborish</button>
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
      showToast("To'g'ri Telegram ID kiriting (raqamlardan iborat)", 'error');
      return;
    }
    setBusy(true);
    try {
      const res = await apiPost<{ success?: boolean; error?: string }>('/api/admin/couriers', { user_id: Number(id) });
      if (res.error) {
        showToast(res.error, 'error');
      } else {
        showToast('Kuryer qo\'shildi', 'success');
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
      <h1 className="page-title">🛵 Kuryerlar <button className="btn btn-outline sm" onClick={() => void loadCouriers()}>↻ Yangilash</button></h1>

      <div className="stat-card" style={{ maxWidth: 500, marginBottom: '1.5rem' }}>
        <div className="form-label" style={{ marginBottom: 8 }}>Yangi kuryer qo'shish</div>
        <p style={{ fontSize: 13, color: 'var(--gray)', marginBottom: 12 }}>
          Kuryer avval botga <code>/start</code> bosgan bo'lishi kerak. Uning Telegram ID'sini kiriting
          (botga <code>/myid</code> yozib olishi mumkin, yoki @userinfobot orqali).
        </p>
        <div style={{ display: 'flex', gap: 8 }}>
          <input type="text" className="form-input" placeholder="Telegram ID (masalan: 123456789)"
            value={newId} onChange={e => setNewId(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') addCourier(); }} />
          <button className="btn btn-primary" disabled={busy} onClick={addCourier}>Qo'shish</button>
        </div>
      </div>

      <div className="table-container">
        <table>
          <thead><tr><th>Ism</th><th>Username</th><th>ID</th><th>Qo'shilgan</th><th></th></tr></thead>
          <tbody>
            {couriersLoadState === 'loading' && <tr><td colSpan={5}>Kuryerlar yuklanmoqda...</td></tr>}
            {couriersLoadState === 'error' && couriers.length === 0 && (
              <tr><td colSpan={5} className="admin-data-error" role="alert">
                Kuryerlarni yuklab bo'lmadi.
                <button className="btn btn-outline sm" onClick={() => void loadCouriers()}>Qayta urinish</button>
              </td></tr>
            )}
            {couriersLoadState === 'error' && couriers.length > 0 && (
              <tr><td colSpan={5} className="admin-data-warning" role="status">Yangilash muvaffaqiyatsiz. Oxirgi yuklangan ma'lumotlar ko'rsatilmoqda.</td></tr>
            )}
            {couriersLoadState === 'ready' && couriers.length === 0 && (
              <tr><td colSpan={5} style={{ textAlign: 'center', color: 'var(--gray)' }}>Hali kuryer qo'shilmagan</td></tr>
            )}
            {couriers.map(c => (
              <tr key={c.user_id}>
                <td>{c.users?.full_name || "Noma'lum"}</td>
                <td>@{c.users?.username || '-'}</td>
                <td>{c.user_id}</td>
                <td>{new Date(c.added_at).toLocaleDateString('uz-UZ')}</td>
                <td><button className="btn btn-danger sm" onClick={() => removeCourier(c.user_id)}>🗑</button></td>
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
  const [cardNumber, setCardNumber] = useState('');
  const [cardHolder, setCardHolder] = useState('');
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    apiGet<PaymentSettings>('/api/admin/payment-settings')
      .then(d => {
        setCardNumber(d.payment_card_number || '');
        setCardHolder(d.payment_card_holder || '');
      })
      .catch(() => showToast("Sozlamalarni yuklab bo'lmadi", 'error'))
      .finally(() => setLoaded(true));
  }, [showToast]);

  async function save(): Promise<void> {
    const digits = cardNumber.replace(/\s/g, '');
    if (digits && !/^\d{16}$/.test(digits)) {
      showToast("Karta raqami 16 ta raqamdan iborat bo'lishi kerak", 'error');
      return;
    }
    setBusy(true);
    try {
      const res = await apiPut<{ success?: boolean }>('/api/admin/payment-settings', {
        card_number: digits.replace(/(\d{4})(?=\d)/g, '$1 '),
        card_holder: cardHolder.trim(),
      });
      if (res.success) showToast('Saqlandi', 'success');
      else showToast('Saqlanmadi', 'error');
    } catch (err) { showToast('Xatolik yuz berdi', 'error'); }
    finally { setBusy(false); }
  }

  return (
    <>
      <h1 className="page-title">⚙️ Sozlamalar</h1>
      <div className="stat-card" style={{ maxWidth: 500 }}>
        <div className="form-label" style={{ marginBottom: 8 }}>💳 Karta orqali to'lov rekvizitlari</div>
        <p style={{ fontSize: 13, color: 'var(--gray)', marginBottom: 12 }}>
          Mijoz "Karta orqali" usulini tanlaganda, shu karta raqami unga ko'rsatiladi.
        </p>
        <input type="text" className="form-input" style={{ marginBottom: 8 }} placeholder="Karta raqami (16 ta raqam)"
          inputMode="numeric" maxLength={19} value={cardNumber} disabled={!loaded}
          onChange={e => setCardNumber(e.target.value)} />
        <input type="text" className="form-input" style={{ marginBottom: 12 }} placeholder="Karta egasi (masalan: ALIYEV VALI)"
          value={cardHolder} disabled={!loaded} onChange={e => setCardHolder(e.target.value)} />
        <button className="btn btn-primary" disabled={busy || !loaded} onClick={save}>Saqlash</button>
      </div>
    </>
  );
}
