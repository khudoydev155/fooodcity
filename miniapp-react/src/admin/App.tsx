import { useState, useEffect, useRef, useCallback } from 'react';
import type { ReactNode } from 'react';
import { API_BASE, apiGet, logout } from './api';
import type { AdminCtx, AdminOrder, ToastType, AdminRole } from './types';
import { Dashboard, Orders, MenuView, Users, Coupons, Broadcast, Couriers, Settings } from './views';
import { HashRouter, Routes, Route, Navigate, Link, useLocation } from 'react-router-dom';
import { LayoutDashboard, ShoppingBag, Menu, Users as UsersIcon, Tag, Megaphone as BroadcastIcon, Truck, Settings as SettingsIcon, Images } from 'lucide-react';
import CourierApp from './courier';
import { playBeep } from './notifications';
import { Promotions } from './promotions';

type AdminPage = 'dashboard' | 'orders' | 'menu' | 'promotions' | 'users' | 'coupons' | 'broadcast' | 'couriers' | 'settings';

interface NavDef {
  page: AdminPage;
  label: string;
  icon: ReactNode;
}

const NAV_ITEMS: NavDef[] = [
  { page: 'dashboard', label: 'Dashboard', icon: <LayoutDashboard size={20} /> },
  { page: 'orders', label: 'Buyurtmalar', icon: <ShoppingBag size={20} /> },
  { page: 'menu', label: 'Menyu', icon: <Menu size={20} /> },
  { page: 'promotions', label: 'Stories & Banner', icon: <Images size={20} /> },
  { page: 'users', label: 'Foydalanuvchilar', icon: <UsersIcon size={20} /> },
  { page: 'coupons', label: 'Kuponlar', icon: <Tag size={20} /> },
  { page: 'couriers', label: 'Kuryerlar', icon: <Truck size={20} /> },
  { page: 'broadcast', label: 'Broadcast', icon: <BroadcastIcon size={20} /> },
  { page: 'settings', label: 'Sozlamalar', icon: <SettingsIcon size={20} /> },
];

interface AuthResponse {
  valid?: boolean;
  is_admin?: boolean;
  token?: string;
  role?: AdminRole;
  reason?: string;
  error?: string;
}

async function readAuthResponse(response: Response): Promise<AuthResponse> {
  let data: AuthResponse;
  try {
    data = await response.json() as AuthResponse;
  } catch {
    throw new Error(`Admin server noto'g'ri javob qaytardi (${response.status})`);
  }
  if (!response.ok) {
    throw new Error(data.reason || data.error || `Admin server xatosi (${response.status})`);
  }
  return data;
}

interface ToastItem {
  id: number;
  msg: string;
  type: ToastType;
}

function ToastContainer({ toasts }: { toasts: ToastItem[] }) {
  return (
    <div id="toast-container">
      {toasts.map(t => (
        <div key={t.id} className="toast"
          style={{ backgroundColor: t.type === 'success' ? 'var(--success)' : t.type === 'error' ? 'var(--error)' : 'var(--info)' }}>
          <span>{t.type === 'success' ? '✅' : t.type === 'error' ? '❌' : 'ℹ️'}</span>
          <span>{t.msg}</span>
        </div>
      ))}
    </div>
  );
}

function Login({ onAuth, showToast }: {
  onAuth: (token: string, user: Record<string, unknown>, role: AdminRole) => void;
  showToast: (msg: string, type?: ToastType) => void;
}) {
  const temporaryHost = import.meta.env.DEV
    || window.location.hostname === 'localhost'
    || window.location.hostname === '127.0.0.1'
    || /\.(trycloudflare\.com|loca\.lt)$/.test(window.location.hostname);
  const [tab, setTab] = useState<'telegram' | 'pin'>(() => temporaryHost ? 'pin' : 'telegram');
  const [pin, setPin] = useState('');
  const widgetRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    window.onTelegramAuth = async (tgUser: Record<string, unknown>) => {
      showToast('Tekshirilmoqda...', 'info');
      try {
        const res = await fetch(`${API_BASE}/api/auth/verify`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(tgUser)
        });
        const data = await readAuthResponse(res);
        if (data.valid && data.is_admin && data.token) {
          sessionStorage.setItem('admin_token', data.token);
          sessionStorage.setItem('admin_user', JSON.stringify(tgUser));
          sessionStorage.setItem('admin_role', data.role || 'staff');
          onAuth(data.token, tgUser, data.role || 'staff');
          showToast('Xush kelibsiz!', 'success');
        } else {
          showToast(data.reason || "Sizda admin ruxsati yo'q!", 'error');
        }
      } catch (err) {
        showToast(err instanceof Error ? err.message : 'Server bilan aloqa uzildi', 'error');
      }
    };

    const script = document.createElement('script');
    script.async = true;
    script.src = 'https://telegram.org/js/telegram-widget.js?22';
    script.setAttribute('data-telegram-login', 'foood_city_official_bot');
    script.setAttribute('data-size', 'large');
    script.setAttribute('data-radius', '8');
    script.setAttribute('data-onauth', 'onTelegramAuth(user)');
    script.setAttribute('data-request-access', 'write');
    widgetRef.current?.appendChild(script);

    return () => { delete window.onTelegramAuth; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function onPinLogin(): Promise<void> {
    if (pin.length !== 6) { showToast('6 xonali PIN kod kiriting!', 'error'); return; }
    showToast('Tekshirilmoqda...', 'info');
    try {
      const res = await fetch(`${API_BASE}/api/auth/pin`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pin })
      });
      const data = await readAuthResponse(res);
      if (data.valid && data.token) {
        const pinUser = { first_name: 'Admin', id: 'pin' };
        sessionStorage.setItem('admin_token', data.token);
        sessionStorage.setItem('admin_user', JSON.stringify(pinUser));
        sessionStorage.setItem('admin_role', 'superadmin');
        onAuth(data.token, pinUser, 'superadmin');
        showToast('Xush kelibsiz!', 'success');
      } else {
        showToast(data.reason || "Noto'g'ri PIN kod!", 'error');
      }
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Server bilan aloqa uzildi', 'error');
    }
  }

  return (
    <section id="login-page">
      <div className="login-card">
        <div className="login-logo">🍔</div>
        <h1 className="login-title">FOOOD CITY</h1>
        <p className="login-subtitle">Restaurant Admin Management Panel</p>
        {temporaryHost && (
          <p className="login-host-notice">
            Vaqtinchalik yoki lokal manzilda Telegram login domeni tasdiqlanmagan bo'lishi mumkin.
            Admin PIN orqali kiring.
          </p>
        )}

        <div className="login-tabs">
          <button className={`login-tab-btn${tab === 'telegram' ? ' active' : ''}`} onClick={() => setTab('telegram')}>Telegram</button>
          <button className={`login-tab-btn${tab === 'pin' ? ' active' : ''}`} onClick={() => setTab('pin')}>PIN Kod</button>
        </div>

        <div style={{ display: tab === 'telegram' ? 'block' : 'none' }}>
          <div ref={widgetRef}></div>
        </div>

        <div style={{ display: tab === 'pin' ? 'block' : 'none' }}>
          <div className="form-group">
            <input type="password" className="form-input" placeholder="6 xonali PIN kod" maxLength={6}
              value={pin} onChange={e => setPin(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') onPinLogin(); }}
              style={{ textAlign: 'center', fontSize: '1.5rem', letterSpacing: '0.5rem' }} />
          </div>
          <button className="btn btn-primary" onClick={onPinLogin} style={{ width: '100%', justifyContent: 'center', padding: '0.8rem' }}>Kirish</button>
        </div>
      </div>
    </section>
  );
}

interface ModalState {
  title: string;
  body: ReactNode;
  footer: ReactNode;
}

function AppContent({ onAuth, showToast }: { onAuth: (token: string) => void; showToast: (msg: string, type?: ToastType) => void }) {
  const [modal, setModal] = useState<ModalState | null>(null);
  const [refreshTick, setRefreshTick] = useState(0);
  const location = useLocation();
  const currentPage = location.pathname.replace(/^\//, '') || 'dashboard';

  const openModal = useCallback((title: string, body: ReactNode, footer: ReactNode = null) => {
    setModal({ title, body, footer });
  }, []);
  const closeModal = useCallback(() => setModal(null), []);
  const bumpRefresh = useCallback(() => setRefreshTick(t => t + 1), []);

  useEffect(() => {
    const token = sessionStorage.getItem('admin_token');
    if (!token) return;
    if (window.Notification && Notification.permission === 'default') {
      Notification.requestPermission();
    }

    // MUHIM: ilgari faqat "eng so'nggi bitta ID" saqlanib, u bilan
    // taqqoslanardi. Agar admin ENG YANGI 'new' buyurtmani tasdiqlasa
    // (uni 'new' holatidan chiqarsa), ro'yxatda undan OLDINGI, hali ham
    // 'new' bo'lgan boshqa buyurtma bo'lsa — tizim uni xato ravishda
    // "yangi buyurtma keldi" deb QAYTA ogohlantirar edi (chunki uning ID'si
    // saqlangan lastId'dan farq qiladi). Endi KO'RILGAN barcha ID'lar
    // to'plami saqlanadi — faqat haqiqatan ilgari ko'rilmagan ID'lar
    // uchun ogohlantirish beriladi.
    const rawSeen = sessionStorage.getItem('seen_new_order_ids');
    const seenIds = new Set<string>(rawSeen ? JSON.parse(rawSeen) : []);
    let isFirstCheck = rawSeen === null;

    function persistSeenIds(): void {
      // Cheksiz o'sib ketmasligi uchun faqat oxirgi 200 tasini saqlaymiz
      sessionStorage.setItem('seen_new_order_ids', JSON.stringify(Array.from(seenIds).slice(-200)));
    }

    async function checkForNewOrders(): Promise<void> {
      try {
        const orders = await apiGet<AdminOrder[]>('/api/admin/orders?status=new&limit=10');
        if (!Array.isArray(orders)) return;

        if (isFirstCheck) {
          // Ilk tekshiruvda mavjud 'new' buyurtmalarni ogohlantirishsiz
          // "ko'rilgan" deb belgilaymiz — aks holda sahifa har
          // yangilanganda eski, allaqachon ma'lum buyurtmalar uchun ham
          // signal chalinaverardi.
          orders.forEach(o => seenIds.add(o.id));
          isFirstCheck = false;
          persistSeenIds();
          return;
        }

        const freshOrders = orders.filter(o => !seenIds.has(o.id));
        if (freshOrders.length === 0) return;

        freshOrders.forEach(o => seenIds.add(o.id));
        persistSeenIds();

        playBeep();
        const msg = freshOrders.length === 1
          ? `🔔 Yangi buyurtma keldi: #${freshOrders[0].id}`
          : `🔔 ${freshOrders.length} ta yangi buyurtma keldi!`;
        showToast(msg, 'success');
        if (window.Notification && Notification.permission === 'granted') {
          new Notification('🍔 Yangi Buyurtma!', { body: msg, icon: '/favicon.ico' });
        }
        if (currentPage === 'orders' || currentPage === 'dashboard') {
          setRefreshTick(t => t + 1);
        }
      } catch (e) {
        console.warn('Order check failed:', e);
      }
    }

    checkForNewOrders();
    const interval = setInterval(checkForNewOrders, 10000);
    return () => clearInterval(interval);
  }, [showToast, currentPage]);

  const ctx: AdminCtx = { showToast, openModal, closeModal, refreshTick, bumpRefresh };

  return (
    <>
      <main id="app">
        <aside className="sidebar">
          <div className="sidebar-logo">
            <span>🍔</span> <span>Food City</span>
          </div>
          <ul className="nav-list">
            {NAV_ITEMS.map(n => (
              <li key={n.page} className={`nav-item${currentPage === n.page ? ' active' : ''}`}>
                <Link to={`/${n.page}`} className="nav-link">
                  {n.icon}
                  <span>{n.label}</span>
                </Link>
              </li>
            ))}
          </ul>
          <div className="nav-item logout-btn" onClick={() => { logout(); onAuth(''); }}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>
            <span>Chiqish</span>
          </div>
        </aside>

        <section className="main-content">
          <Routes>
            <Route path="/" element={<Navigate to="/dashboard" replace />} />
            <Route path="/dashboard" element={<Dashboard ctx={ctx} />} />
            <Route path="/orders" element={<Orders ctx={ctx} />} />
            <Route path="/menu" element={<MenuView ctx={ctx} />} />
            <Route path="/promotions" element={<Promotions ctx={ctx} />} />
            <Route path="/users" element={<Users ctx={ctx} />} />
            <Route path="/coupons" element={<Coupons ctx={ctx} />} />
            <Route path="/couriers" element={<Couriers ctx={ctx} />} />
            <Route path="/broadcast" element={<Broadcast ctx={ctx} />} />
            <Route path="/settings" element={<Settings ctx={ctx} />} />
          </Routes>
        </section>
      </main>

      {modal && (
        <div className="modal-overlay" onClick={e => { if (e.target === e.currentTarget) closeModal(); }}>
          <div className="modal">
            <div className="modal-header">
              <h3>{modal.title}</h3>
              <button className="btn btn-outline" onClick={closeModal} style={{ padding: '0.25rem 0.5rem' }}>✕</button>
            </div>
            <div className="modal-body">{modal.body}</div>
            <div className="modal-footer">{modal.footer}</div>
          </div>
        </div>
      )}
    </>
  );
}

export default function App() {
  const [token, setToken] = useState<string | null>(() => sessionStorage.getItem('admin_token'));
  const [role, setRole] = useState<AdminRole | null>(() => (sessionStorage.getItem('admin_role') as AdminRole | null));
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const toastId = useRef(0);

  const showToast = useCallback((msg: string, type: ToastType = 'success') => {
    const id = ++toastId.current;
    setToasts(t => [...t, { id, msg, type }]);
    setTimeout(() => setToasts(t => t.filter(x => x.id !== id)), 3000);
  }, []);

  const handleAuth = useCallback((tk: string, _user: Record<string, unknown>, r: AdminRole) => {
    setToken(tk);
    setRole(r);
  }, []);

  const handleLogout = useCallback(() => {
    logout(); // sessionStorage.clear() + reload — token/role holati shu bilan tozalanadi
  }, []);

  return (
    <HashRouter>
      <ToastContainer toasts={toasts} />
      {!token || !role ? (
        <Login showToast={showToast} onAuth={handleAuth} />
      ) : role === 'courier' ? (
        <CourierApp showToast={showToast} onLogout={handleLogout} />
      ) : (
        <AppContent onAuth={setToken} showToast={showToast} />
      )}
    </HashRouter>
  );
}
