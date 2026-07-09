import { useState, useEffect, useRef, useCallback } from 'react';
import type { ReactNode } from 'react';
import { API_BASE, apiGet, logout } from './api';
import type { AdminCtx, AdminOrder, ToastType } from './types';
import { Dashboard, Orders, MenuView, Users, Coupons, Broadcast } from './views';

type AdminPage = 'dashboard' | 'orders' | 'menu' | 'users' | 'coupons' | 'broadcast';

interface NavDef {
  page: AdminPage;
  label: string;
  icon: ReactNode;
}

const NAV_ITEMS: NavDef[] = [
  {
    page: 'dashboard', label: 'Dashboard',
    icon: <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="7" height="7"></rect><rect x="14" y="3" width="7" height="7"></rect><rect x="14" y="14" width="7" height="7"></rect><rect x="3" y="14" width="7" height="7"></rect></svg>
  },
  {
    page: 'orders', label: 'Buyurtmalar',
    icon: <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4Z"></path><line x1="3" y1="6" x2="21" y2="6"></line><path d="M16 10a4 4 0 0 1-8 0"></path></svg>
  },
  {
    page: 'menu', label: 'Menyu',
    icon: <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 2v7c0 1.1.9 2 2 2h4a2 2 0 0 0 2-2V2"></path><path d="M7 2v20"></path><path d="M21 15V2v0a5 5 0 0 0-5 5v6c0 1.1.9 2 2 2h3Zm0 0v7"></path></svg>
  },
  {
    page: 'users', label: 'Foydalanuvchilar',
    icon: <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"></path><circle cx="9" cy="7" r="4"></circle><path d="M22 21v-2a4 4 0 0 0-3-3.87"></path><path d="M16 3.13a4 4 0 0 1 0 7.75"></path></svg>
  },
  {
    page: 'coupons', label: 'Kuponlar',
    icon: <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M15 5 5 15"></path><path d="M16 2 2 16"></path><path d="M22 17v3a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2v-3"></path><path d="M22 7V4a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2v3"></path><circle cx="18" cy="6" r="1"></circle><circle cx="6" cy="18" r="1"></circle></svg>
  },
  {
    page: 'broadcast', label: 'Broadcast',
    icon: <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 12h-4l-3 9L9 3l-3 9H2"></path></svg>
  }
];

function playBeep(): void {
  try {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
    const oscillator = ctx.createOscillator();
    const gainNode = ctx.createGain();
    oscillator.connect(gainNode);
    gainNode.connect(ctx.destination);
    oscillator.type = 'sine';
    // Birinchi ton
    oscillator.frequency.setValueAtTime(880, ctx.currentTime);
    gainNode.gain.setValueAtTime(0.4, ctx.currentTime);
    gainNode.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.4);
    oscillator.start(ctx.currentTime);
    oscillator.stop(ctx.currentTime + 0.4);
    // Ikkinchi ton (echo effekt)
    const osc2 = ctx.createOscillator();
    const gain2 = ctx.createGain();
    osc2.connect(gain2);
    gain2.connect(ctx.destination);
    osc2.type = 'sine';
    osc2.frequency.setValueAtTime(660, ctx.currentTime + 0.45);
    gain2.gain.setValueAtTime(0.3, ctx.currentTime + 0.45);
    gain2.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.85);
    osc2.start(ctx.currentTime + 0.45);
    osc2.stop(ctx.currentTime + 0.85);
  } catch (e) {
    console.warn('Audio beep failed:', e);
  }
}

interface AuthResponse {
  valid?: boolean;
  is_admin?: boolean;
  token?: string;
  reason?: string;
}

function Login({ onAuth, showToast }: {
  onAuth: (token: string, user: Record<string, unknown>) => void;
  showToast: (msg: string, type?: ToastType) => void;
}) {
  const [tab, setTab] = useState<'telegram' | 'pin'>('telegram');
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
        const data: AuthResponse = await res.json();
        if (data.valid && data.is_admin && data.token) {
          sessionStorage.setItem('admin_token', data.token);
          sessionStorage.setItem('admin_user', JSON.stringify(tgUser));
          onAuth(data.token, tgUser);
          showToast('Xush kelibsiz!', 'success');
        } else {
          showToast(data.reason || "Sizda admin ruxsati yo'q!", 'error');
        }
      } catch (err) {
        showToast('Server bilan aloqa uzildi', 'error');
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
      const data: AuthResponse = await res.json();
      if (data.valid && data.token) {
        const pinUser = { first_name: 'Admin', id: 'pin' };
        sessionStorage.setItem('admin_token', data.token);
        sessionStorage.setItem('admin_user', JSON.stringify(pinUser));
        onAuth(data.token, pinUser);
        showToast('Xush kelibsiz!', 'success');
      } else {
        showToast(data.reason || "Noto'g'ri PIN kod!", 'error');
      }
    } catch (err) {
      showToast('Server bilan aloqa uzildi', 'error');
    }
  }

  return (
    <section id="login-page">
      <div className="login-card">
        <div className="login-logo">🍔</div>
        <h1 className="login-title">FOOOD CITY</h1>
        <p className="login-subtitle">Restaurant Admin Management Panel</p>

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

interface ToastItem {
  id: number;
  msg: string;
  type: ToastType;
}

interface ModalState {
  title: string;
  body: ReactNode;
  footer: ReactNode;
}

export default function App() {
  const [token, setToken] = useState<string | null>(() => sessionStorage.getItem('admin_token'));
  const [page, setPage] = useState<AdminPage>('dashboard');
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const [modal, setModal] = useState<ModalState | null>(null);
  const [refreshTick, setRefreshTick] = useState(0);
  const toastId = useRef(0);
  const pageRef = useRef<AdminPage>(page);
  pageRef.current = page;

  const showToast = useCallback((msg: string, type: ToastType = 'success') => {
    const id = ++toastId.current;
    setToasts(t => [...t, { id, msg, type }]);
    setTimeout(() => setToasts(t => t.filter(x => x.id !== id)), 3000);
  }, []);

  const openModal = useCallback((title: string, body: ReactNode, footer: ReactNode = null) => {
    setModal({ title, body, footer });
  }, []);
  const closeModal = useCallback(() => setModal(null), []);
  const bumpRefresh = useCallback(() => setRefreshTick(t => t + 1), []);

  // 🔔 ADMIN OVOZLI BILDIRISHNOMA TIZIMI — har 12 soniyada yangi buyurtmalar tekshiriladi
  useEffect(() => {
    if (!token) return;
    if (window.Notification && Notification.permission === 'default') {
      Notification.requestPermission();
    }
    let lastId: string | null = sessionStorage.getItem('last_known_order_id');

    async function checkForNewOrders(): Promise<void> {
      try {
        const orders = await apiGet<AdminOrder[]>('/api/admin/orders?status=new&limit=1');
        if (!Array.isArray(orders) || orders.length === 0) return;
        const latestId = orders[0].id;
        if (lastId === null) {
          lastId = latestId;
          sessionStorage.setItem('last_known_order_id', latestId);
        } else if (latestId !== lastId) {
          lastId = latestId;
          sessionStorage.setItem('last_known_order_id', latestId);
          playBeep();
          showToast(`🔔 Yangi buyurtma keldi: #${latestId}`, 'success');
          if (window.Notification && Notification.permission === 'granted') {
            new Notification('🍔 Yangi Buyurtma!', {
              body: `Buyurtma #${latestId} keldi. Darhol tekshiring!`,
              icon: '/favicon.ico'
            });
          }
          if (pageRef.current === 'orders' || pageRef.current === 'dashboard') {
            setRefreshTick(t => t + 1);
          }
        }
      } catch (e) {
        console.warn('Order check failed:', e);
      }
    }

    checkForNewOrders();
    const interval = setInterval(checkForNewOrders, 12000);
    return () => clearInterval(interval);
  }, [token, showToast]);

  const ctx: AdminCtx = { showToast, openModal, closeModal, refreshTick, bumpRefresh };

  return (
    <>
      <div id="toast-container">
        {toasts.map(t => (
          <div key={t.id} className="toast"
            style={{ backgroundColor: t.type === 'success' ? 'var(--success)' : t.type === 'error' ? 'var(--error)' : 'var(--info)' }}>
            <span>{t.type === 'success' ? '✅' : t.type === 'error' ? '❌' : 'ℹ️'}</span>
            <span>{t.msg}</span>
          </div>
        ))}
      </div>

      {!token ? (
        <Login showToast={showToast} onAuth={(tk) => setToken(tk)} />
      ) : (
        <main id="app">
          <aside className="sidebar">
            <div className="sidebar-logo">
              <span>🍔</span> <span>Food City</span>
            </div>
            <ul className="nav-list">
              {NAV_ITEMS.map(n => (
                <li key={n.page} className={`nav-item${page === n.page ? ' active' : ''}`} onClick={() => setPage(n.page)}>
                  {n.icon}
                  <span>{n.label}</span>
                </li>
              ))}
            </ul>
            <div className="nav-item logout-btn" onClick={logout}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"></path><polyline points="16 17 21 12 16 7"></polyline><line x1="21" y1="12" x2="9" y2="12"></line></svg>
              <span>Chiqish</span>
            </div>
          </aside>

          <section className="main-content">
            {page === 'dashboard' && <Dashboard ctx={ctx} />}
            {page === 'orders' && <Orders ctx={ctx} />}
            {page === 'menu' && <MenuView ctx={ctx} />}
            {page === 'users' && <Users ctx={ctx} />}
            {page === 'coupons' && <Coupons ctx={ctx} />}
            {page === 'broadcast' && <Broadcast ctx={ctx} />}
          </section>
        </main>
      )}

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
