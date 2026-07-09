import { useState, useEffect, useRef, useCallback } from 'react';
import Chart from 'chart.js/auto';
import flatpickr from 'flatpickr';
import type { Instance as FlatpickrInstance } from 'flatpickr/dist/types/instance';
import { Uzbek } from 'flatpickr/dist/l10n/uz.js';
import * as XLSX from 'xlsx';
import { API_BASE, apiGet, apiPost, apiPut, apiDelete, getToken } from './api';
import type {
  AdminCtx, AdminOrder, AdminOrderStatus, AdminMenuItem, AdminCategory,
  AdminUser, AdminCoupon, AdminStats, AdminAnalytics, SaveRef
} from './types';

// ─── ORDER DETAIL MODAL ──────────────────────────────────────────────────────

const ORDER_STATUS_MAP: Record<string, { label: string; color: string }> = {
  'new': { label: 'Yangi', color: '#FFB800' },
  'confirmed': { label: 'Tasdiqlangan', color: '#00C853' },
  'cooking': { label: 'Tayyorlanmoqda', color: '#FF6B00' },
  'delivering': { label: "Yo'lga chiqdi", color: '#2196F3' },
  'delivered': { label: 'Yetkazildi', color: '#00C853' },
  'cancelled': { label: 'Bekor qilingan', color: '#E8001C' }
};

function OrderDetailBody({ order, onStatusUpdate }: {
  order: AdminOrder;
  onStatusUpdate: (id: string, status: AdminOrderStatus) => void;
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
      const orders = await apiGet<AdminOrder[]>(`/api/admin/orders?search=${orderId}`);
      const order = orders.find(x => x.id === orderId);
      if (!order) return;

      const onStatusUpdate = async (id: string, status: AdminOrderStatus): Promise<void> => {
        if (!confirm('Tasdiqlaysizmi?')) return;
        try {
          await apiPost(`/api/admin/orders/${id}/status`, { status });
          showToast('Yangilandi');
          closeModal();
          reload();
        } catch (err) { showToast('Xatolik yuz berdi', 'error'); }
      };

      openModal('Buyurtma Tafsilotlari', <OrderDetailBody order={order} onStatusUpdate={onStatusUpdate} />);
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
  const [liveOrders, setLiveOrders] = useState<AdminOrder[] | null>(null);
  const [filterTick, setFilterTick] = useState(0);
  const dateRef = useRef<{ start: string; end: string }>({ start: '', end: '' });
  const pickerInput = useRef<HTMLInputElement | null>(null);
  const pickerInstance = useRef<FlatpickrInstance | null>(null);
  const revCanvas = useRef<HTMLCanvasElement | null>(null);
  const topCanvas = useRef<HTMLCanvasElement | null>(null);
  const revChart = useRef<Chart | null>(null);
  const topChart = useRef<Chart<'doughnut'> | null>(null);

  const dateQuery = (prefix = '?'): string => {
    const { start, end } = dateRef.current;
    return start ? `${prefix}start_date=${encodeURIComponent(start)}&end_date=${encodeURIComponent(end)}` : '';
  };

  async function fetchStats(): Promise<void> {
    try {
      const res = await apiGet<AdminStats>(`/api/admin/stats${dateQuery()}`);
      setStats(res);
    } catch (err) { console.error('Stats error', err); }
  }

  async function fetchDashboardOrders(): Promise<void> {
    try {
      let q = '?status=new,confirmed,cooking,delivering&limit=15';
      q += dateQuery('&');
      const orders = await apiGet<AdminOrder[]>(`/api/admin/orders${q}`);
      setLiveOrders(orders);
    } catch (err) { console.error('Dashboard orders error', err); }
  }

  async function renderAnalytics(): Promise<void> {
    try {
      const data = await apiGet<AdminAnalytics>(`/api/admin/analytics${dateQuery()}`);
      setReturningPercent(data.returning_percent);

      Chart.defaults.color = '#94A3B8';
      Chart.defaults.font.family = "'Inter', sans-serif";

      if (revCanvas.current) {
        if (revChart.current) revChart.current.destroy();
        revChart.current = new Chart(revCanvas.current, {
          type: 'line',
          data: {
            labels: data.revenue_chart.labels,
            datasets: [{
              label: 'Daromad (sum)',
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
    } catch (e) { console.error('Analytics chart error', e); }
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
    fetchDashboardOrders();
    renderAnalytics();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filterTick, refreshTick]);

  // 15 soniyada avtomatik yangilanish
  useEffect(() => {
    const interval = setInterval(() => {
      fetchStats();
      fetchDashboardOrders();
    }, 15000);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const showOrderDetail = useOrderDetail(ctx, fetchDashboardOrders);

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
          <button className="btn btn-success" onClick={downloadExcel} style={{ background: 'var(--success)', color: 'white' }}>📥 Excel</button>
        </div>
      </div>

      <div className="stats-grid">
        {!stats ? (
          [1, 2, 3, 4].map(i => <div key={i} className="stat-card skeleton" style={{ height: 100 }}></div>)
        ) : (
          <>
            <div className="stat-card">
              <span className="stat-label">Buyurtmalar Soni</span>
              <div className="stat-value">{stats.today?.orders || 0} {getTrend(stats.today?.orders_diff || 0)}</div>
            </div>
            <div className="stat-card">
              <span className="stat-label">Daromad</span>
              <div className="stat-value">{(stats.today?.revenue || 0).toLocaleString()} <span style={{ fontSize: '0.8rem', marginLeft: 4, color: 'var(--gray)' }}>sum</span> {getTrend(stats.today?.revenue_diff || 0)}</div>
            </div>
            <div className="stat-card">
              <span className="stat-label">Jami Foydalanuvchilar</span>
              <div className="stat-value">{stats.total_users || 0}</div>
            </div>
            <div className="stat-card">
              <span className="stat-label">O'rtacha Chek</span>
              <div className="stat-value">{Math.round((stats.today?.revenue || 0) / (stats.today?.orders || 1)).toLocaleString()} <span style={{ fontSize: '0.8rem', marginLeft: 4, color: 'var(--gray)' }}>sum</span></div>
            </div>
            {returningPercent !== null && (
              <div className="stat-card" style={{ gridColumn: 'span 1' }}>
                <span className="stat-label">Qayta Xarid Qilganlar</span>
                <div className="stat-value">{returningPercent}% <span style={{ fontSize: '0.8rem', marginLeft: 4, color: 'var(--gray)' }}>mijozlar</span></div>
              </div>
            )}
          </>
        )}
      </div>

      <div className="stats-grid" style={{ gridTemplateColumns: '2fr 1fr', marginBottom: '2rem' }}>
        <div className="stat-card">
          <h3 style={{ fontSize: '1rem', marginBottom: '1rem', color: 'var(--gray)' }}>Tushumlar Dinamikasi</h3>
          <canvas ref={revCanvas} style={{ maxHeight: 250 }}></canvas>
        </div>
        <div className="stat-card">
          <h3 style={{ fontSize: '1rem', marginBottom: '1rem', color: 'var(--gray)' }}>Top Mahsulotlar (Soni)</h3>
          <canvas ref={topCanvas} style={{ maxHeight: 250 }}></canvas>
        </div>
      </div>

      <div className="table-container">
        <div style={{ padding: '1.5rem', borderBottom: '1px solid var(--border)' }}>
          <h3 style={{ fontSize: '1rem' }}>Jonli Faol Buyurtmalar</h3>
        </div>
        <div>
          {liveOrders === null ? (
            <div className="skeleton" style={{ height: 300 }}></div>
          ) : (
            <table>
              <thead>
                <tr><th>ID</th><th>Mijoz</th><th>Mahsulot</th><th>Jami</th><th>Status</th><th>Vaqt</th></tr>
              </thead>
              <tbody>
                {liveOrders.length === 0 ? (
                  <tr><td colSpan={6} style={{ textAlign: 'center', padding: '2rem', color: 'var(--gray)' }}>Faol buyurtmalar mavjud emas</td></tr>
                ) : liveOrders.map(o => (
                  <tr key={o.id} onClick={() => showOrderDetail(o.id)} style={{ cursor: 'pointer' }}>
                    <td style={{ fontWeight: 600, color: 'var(--primary)' }}>{o.id}</td>
                    <td>{o.users?.full_name || o.users?.username || 'Telegram Foydalanuvchisi'}</td>
                    <td>{(o.items || []).length} ta mahsulot</td>
                    <td style={{ fontWeight: 600 }}>{(o.total || 0).toLocaleString()} sum</td>
                    <td><span className={`badge badge-${o.status}`}>{o.status}</span></td>
                    <td style={{ color: 'var(--gray)' }}>{formatTimeLocal(o.created_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
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

export function Orders({ ctx }: { ctx: AdminCtx }) {
  const { refreshTick } = ctx;
  const [status, setStatus] = useState('');
  const [query, setQuery] = useState('');
  const [orders, setOrders] = useState<AdminOrder[] | null | 'error'>(null);

  const loadOrders = useCallback(async (): Promise<void> => {
    try {
      const data = await apiGet<AdminOrder[]>(`/api/admin/orders?status=${status}&search=${query}`);
      setOrders(data);
    } catch (err) { setOrders('error'); }
  }, [status, query]);

  useEffect(() => { loadOrders(); }, [loadOrders, refreshTick]);

  const showOrderDetail = useOrderDetail(ctx, loadOrders);

  return (
    <>
      <div className="page-title">
        <span>📦 Buyurtmalar</span>
        <input type="text" className="form-input" style={{ width: 250 }} placeholder="ID yoki ism bo'yicha qidirish..."
          value={query} onChange={e => setQuery(e.target.value)} />
      </div>
      <div className="tabs">
        {ORDER_TABS.map(t => (
          <div key={t.status} className={`tab${status === t.status ? ' active' : ''}`} onClick={() => setStatus(t.status)}>{t.label}</div>
        ))}
      </div>
      <div className="table-container">
        {orders === null && [1, 2, 3, 4, 5].map(i => <div key={i} className="skeleton" style={{ height: 60, margin: 10 }}></div>)}
        {orders === 'error' && <p style={{ padding: '2rem' }}>Xatolik yuz berdi.</p>}
        {Array.isArray(orders) && (
          <table>
            <thead><tr><th>ID</th><th>Mijoz</th><th>Mahsulot</th><th>Jami</th><th>Status</th><th>Vaqt</th><th></th></tr></thead>
            <tbody>
              {orders.length === 0 ? (
                <tr><td colSpan={7} style={{ textAlign: 'center' }}>Hech narsa topilmadi</td></tr>
              ) : orders.map(o => (
                <tr key={o.id} onClick={() => showOrderDetail(o.id)} style={{ cursor: 'pointer' }}>
                  <td style={{ color: 'var(--primary)' }}>{o.id}</td>
                  <td>{o.users?.full_name || "Noma'lum"}</td>
                  <td>{(o.items || []).length} ta mahsulot</td>
                  <td>{(o.total || 0).toLocaleString()} sum</td>
                  <td><span className={`badge badge-${o.status}`}>{o.status}</span></td>
                  <td>{formatTimeLocal(o.created_at)}</td>
                  <td><button className="btn btn-outline sm">Detail</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
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

  async function uploadImageToServer(file: File): Promise<string | null> {
    const formData = new FormData();
    formData.append('file', file);
    showToast('📤 Rasm yuklanmoqda...', 'info');
    try {
      const res = await fetch(`${API_BASE}/api/admin/menu/upload`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${getToken()}` },
        body: formData
      });
      if (!res.ok) throw new Error('Upload failed');
      const data: { url?: string } = await res.json();
      showToast('✅ Rasm yuklandi!', 'success');
      return data.url || null;
    } catch (e) {
      showToast('❌ Rasm yuklanmadi', 'error');
      return null;
    }
  }

  // modal footer'dagi Saqlash tugmasi uchun handler ro'yxatga olinadi
  saveRef.current = async () => {
    const price = parseInt(form.price);
    if (!form.name_uz || isNaN(price)) { showToast("Ma'lumotlarni to'liq kiriting!", 'error'); return; }

    let finalImageUrl: string | null = null;
    if (imageFile) {
      finalImageUrl = await uploadImageToServer(imageFile);
      if (!finalImageUrl) return; // Upload failed
    } else if (imageUrl) {
      finalImageUrl = imageUrl.trim();
    } else if (isEdit && item) {
      finalImageUrl = item.image_url || null;
    }

    const data = {
      ...form,
      price,
      is_available: true,
      sort_order: 99,
      image_url: finalImageUrl
    };

    try {
      if (isEdit && item) {
        await apiPut(`/api/admin/menu/${item.id}`, data);
        showToast('Muvaffaqiyatli tahrirlandi', 'success');
      } else {
        await apiPost('/api/admin/menu', data);
        showToast('Saqlandi', 'success');
      }
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
  const [users, setUsers] = useState<AdminUser[]>([]);

  const loadUsers = useCallback(async (): Promise<void> => {
    try {
      const data = await apiGet<AdminUser[]>(`/api/admin/users?search=${query}`);
      setUsers(Array.isArray(data) ? data : []);
    } catch (err) { /* jadval bo'sh qoladi */ }
  }, [query]);

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
        <input type="text" className="form-input" style={{ width: 250 }} placeholder="Qidirish..."
          value={query} onChange={e => setQuery(e.target.value)} />
      </div>
      <div className="table-container">
        <table>
          <thead><tr><th></th><th>Ism</th><th>User</th><th>B-lar</th><th>Xarajat</th><th>Ball</th><th>Sana</th><th>Status</th><th></th></tr></thead>
          <tbody>
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

  const loadCoupons = useCallback(async (): Promise<void> => {
    try {
      const data = await apiGet<AdminCoupon[]>('/api/admin/coupons');
      setCoupons(Array.isArray(data) ? data : []);
    } catch (err) { /* jadval bo'sh qoladi */ }
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
      <div className="table-container">
        <table>
          <thead><tr><th>Kod</th><th>Qiymat</th><th>Ishlatilgan</th><th>Status</th><th></th></tr></thead>
          <tbody>
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
