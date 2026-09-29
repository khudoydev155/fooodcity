import { useState, useEffect, useCallback, useRef } from 'react';
import { apiGet, apiPost } from './api';
import type { AdminOrder, ToastType } from './types';
import { playBeep } from './notifications';

const STATUS_LABEL: Record<string, string> = {
  confirmed: 'Tasdiqlangan',
  cooking: 'Tayyorlanmoqda',
  delivering: "Yo'lda",
};

function formatMoney(n: number | null | undefined): string {
  return (n || 0).toLocaleString('ru-RU') + " so'm";
}

// Kuryer uchun: pul olish kerakmi yoki yo'qmi — aniq va katta ko'rinishda
function paymentNote(order: AdminOrder): { text: string; color: string } {
  const method = order.payment_method || 'cash';
  const paid = order.payment_status === 'paid';
  if (paid) return { text: "✅ To'langan — pul olmang", color: '#10B981' };
  if (method === 'cash') return { text: `💵 Naqd oling: ${formatMoney(order.total)}`, color: '#F59E0B' };
  return { text: "⏳ Karta to'lovi hali tasdiqlanmagan — pul olishdan oldin admin bilan bog'laning", color: '#EF4444' };
}

function OrderCard({ order, onStatusChange, busy }: {
  order: AdminOrder;
  onStatusChange: (id: string, status: 'delivering' | 'delivered') => void;
  busy: boolean;
}) {
  const customerName = order.users?.full_name || order.users?.username || "Mijoz";
  const phone = order.users?.phone;

  return (
    <div style={{
      background: 'var(--card-bg)', borderRadius: 12, padding: 16, marginBottom: 12,
      boxShadow: '0 1px 4px rgba(0,0,0,0.08)'
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 }}>
        <div>
          <div style={{ fontWeight: 700, fontSize: '1.1rem' }}>{order.id}</div>
          <div style={{ fontSize: '0.85rem', opacity: 0.7 }}>{STATUS_LABEL[order.status] || order.status}</div>
        </div>
        <div style={{ fontWeight: 700 }}>{formatMoney(order.total)}</div>
      </div>

      {(() => {
        const pn = paymentNote(order);
        return (
          <div style={{ background: pn.color + '22', color: pn.color, padding: '8px 12px', borderRadius: 8, fontWeight: 700, marginBottom: 10 }}>
            {pn.text}
          </div>
        );
      })()}

      <div style={{ marginBottom: 4 }}>👤 {customerName}</div>
      {phone && (
        <div style={{ marginBottom: 4 }}>
          <a href={`tel:${phone}`} style={{ color: 'var(--primary)' }}>☎️ {phone}</a>
        </div>
      )}
      {order.delivery_address && (
        <div style={{ marginBottom: 8 }}>📍 {order.delivery_address}</div>
      )}

      <div style={{ fontSize: '0.9rem', opacity: 0.85, marginBottom: 12 }}>
        {(order.items || []).map((it, i) => (
          <div key={i}>{it.emoji || ''} {it.name || it.name_uz} × {it.qty}</div>
        ))}
      </div>

      <div style={{ display: 'flex', gap: 8 }}>
        {order.status !== 'delivering' && (
          <button
            disabled={busy}
            onClick={() => onStatusChange(order.id, 'delivering')}
            className="btn btn-primary"
            style={{ flex: 1, justifyContent: 'center' }}
          >
            🚴 Yo'lga chiqdim
          </button>
        )}
        {order.status === 'delivering' && (
          <button
            disabled={busy}
            onClick={() => onStatusChange(order.id, 'delivered')}
            className="btn btn-primary"
            style={{ flex: 1, justifyContent: 'center', background: 'var(--success)' }}
          >
            ✅ Yetkazdim
          </button>
        )}
      </div>
    </div>
  );
}

export default function CourierApp({ showToast, onLogout }: {
  showToast: (msg: string, type?: ToastType) => void;
  onLogout: () => void;
}) {
  const [orders, setOrders] = useState<AdminOrder[] | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // Kuryerga endigina biriktirilgan buyurtmani "eski" (allaqachon
  // ko'rilgan) buyurtmalardan ajratish uchun — admin panelidagidek,
  // faqat ID emas, KO'RILGAN barcha ID'lar to'plami saqlanadi.
  const seenIdsRef = useRef<Set<string> | null>(null);

  const load = useCallback(async () => {
    try {
      const data = await apiGet<AdminOrder[]>('/api/courier/orders');
      const list = Array.isArray(data) ? data : [];

      if (seenIdsRef.current === null) {
        // Ilk yuklanish — mavjud buyurtmalarni ogohlantirishsiz "ko'rilgan" deb belgilaymiz.
        seenIdsRef.current = new Set(list.map(o => o.id));
      } else {
        const freshOrders = list.filter(o => !seenIdsRef.current!.has(o.id));
        if (freshOrders.length > 0) {
          freshOrders.forEach(o => seenIdsRef.current!.add(o.id));
          playBeep();
          showToast(
            freshOrders.length === 1
              ? `🔔 Sizga yangi buyurtma biriktirildi: #${freshOrders[0].id}`
              : `🔔 Sizga ${freshOrders.length} ta yangi buyurtma biriktirildi!`,
            'success'
          );
        }
      }

      setOrders(list);
      setLoadError(false);
    } catch (error) {
      console.error('Courier orders refresh failed:', error);
      setLoadError(true);
    }
  }, [showToast]);

  useEffect(() => {
    load();
    // Kuryer telefonida ilova doim ochiq turmaydi — shuning uchun yangi
    // biriktirilgan buyurtmalarni ko'rish uchun vaqti-vaqti bilan yangilanadi.
    pollRef.current = setInterval(load, 10000);
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [load]);

  async function handleStatusChange(id: string, status: 'delivering' | 'delivered') {
    setBusyId(id);
    try {
      await apiPost(`/api/courier/orders/${id}/status`, { status });
      showToast(status === 'delivered' ? '✅ Yetkazildi deb belgilandi' : "🚴 Yo'lga chiqdingiz", 'success');
      await load();
    } catch {
      showToast('❌ Holatni yangilab bo\'lmadi', 'error');
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div style={{ height: '100vh', overflowY: 'auto', padding: 16, maxWidth: 480, margin: '0 auto' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <h1 style={{ fontSize: '1.3rem', margin: 0 }}>🛵 Mening yetkazib berishlarim</h1>
        <button onClick={onLogout} className="btn btn-outline" style={{ padding: '0.4rem 0.8rem' }}>Chiqish</button>
      </div>

      {orders === null && !loadError && <div style={{ textAlign: 'center', opacity: 0.6, padding: 40 }}>Yuklanmoqda...</div>}
      {orders === null && loadError && (
        <div role="alert" style={{ textAlign: 'center', padding: 24 }}>
          Buyurtmalarni yuklab bo'lmadi.
          <button onClick={() => void load()} className="btn btn-outline" style={{ display: 'block', margin: '12px auto' }}>Qayta urinish</button>
        </div>
      )}
      {orders !== null && loadError && (
        <div role="status" style={{ textAlign: 'center', padding: 12, marginBottom: 12, color: '#F59E0B' }}>
          Yangilash amalga oshmadi. Oxirgi yuklangan buyurtmalar ko'rsatilmoqda.
        </div>
      )}
      {orders !== null && orders.length === 0 && (
        <div style={{ textAlign: 'center', opacity: 0.6, padding: 40 }}>
          Hozircha sizga biriktirilgan buyurtma yo'q
        </div>
      )}
      {orders?.map(o => (
        <OrderCard key={o.id} order={o} onStatusChange={handleStatusChange} busy={busyId === o.id} />
      ))}
    </div>
  );
}
