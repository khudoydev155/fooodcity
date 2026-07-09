import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { API_BASE, tg, supabaseClient, user, lang, strings, categoryGradients, DEFAULT_GRADIENT, DELIVERY_FEE, authHeaders } from './config';
import { AVATARS, AVATAR_KEY, saveAvatar } from './avatars';
import type { MenuItem, Category, Cart, AppliedCoupon, UserOrder, OrderStatus, Profile, Avatar } from './types';

type Page = 'menu' | 'cart' | 'orders' | 'wishlist' | 'profile' | 'contact' | 'success' | 'tracking';
type OrdersState = UserOrder[] | null | 'error' | 'no-auth';

const gradFor = (item: MenuItem): string =>
  categoryGradients[item.categories?.name_en || 'Other'] || DEFAULT_GRADIENT;
const nameFor = (item: MenuItem): string =>
  (item[`name_${lang}`] as string | undefined) || item.name_uz;

function createConfetti(): void {
  for (let i = 0; i < 50; i++) {
    const c = document.createElement('div');
    c.className = 'confetti';
    c.style.left = Math.random() * 100 + 'vw';
    c.style.backgroundColor = ['#E8001C', '#FF6B00', '#FFB800', '#00C853'][Math.floor(Math.random() * 4)];
    c.style.animationDelay = Math.random() * 2 + 's';
    document.body.appendChild(c);
    setTimeout(() => c.remove(), 3000);
  }
}

interface NominatimAddress {
  road?: string; street?: string; house_number?: string;
  neighbourhood?: string; suburb?: string;
  city?: string; town?: string; village?: string;
}

async function reverseGeocode(lat: number, lon: number): Promise<string | null> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 5000);
  try {
    const res = await fetch(
      `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lon}&format=json&accept-language=uz`,
      { headers: { 'Accept-Language': 'uz,ru,en' }, signal: controller.signal }
    );
    clearTimeout(timeoutId);
    const data: { address?: NominatimAddress; display_name?: string } = await res.json();
    if (!data || !data.address) return null;
    const addr = data.address;
    const parts: string[] = [];
    if (addr.road || addr.street) parts.push((addr.road || addr.street)!);
    if (addr.house_number) parts.push(addr.house_number);
    if (addr.neighbourhood || addr.suburb) parts.push((addr.neighbourhood || addr.suburb)!);
    if (addr.city || addr.town || addr.village) parts.push((addr.city || addr.town || addr.village)!);
    return parts.length > 0 ? parts.join(', ') : data.display_name || null;
  } catch (e) {
    clearTimeout(timeoutId);
    console.error('Geocode error:', e);
    return null;
  }
}

export default function App() {
  const [splashVisible, setSplashVisible] = useState(true);
  const [splashFading, setSplashFading] = useState(false);
  const [page, setPage] = useState<Page>('menu');
  const [toast, setToast] = useState<{ msg: string; show: boolean }>({ msg: '', show: false });
  const [menuItems, setMenuItems] = useState<MenuItem[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [cart, setCart] = useState<Cart>({});
  const [wishlist, setWishlist] = useState<string[]>(() => JSON.parse(localStorage.getItem('wishlist') || '[]'));
  const [currentCat, setCurrentCat] = useState<string>('all');
  const [search, setSearch] = useState('');
  const [appliedCoupon, setAppliedCoupon] = useState<AppliedCoupon | null>(null);
  const [couponCode, setCouponCode] = useState('');
  const [couponMsg, setCouponMsg] = useState<{ text: string; color: string }>({ text: '', color: '' });
  const [usePoints, setUsePoints] = useState(false);
  const [userPoints, setUserPoints] = useState(0);
  const [address, setAddress] = useState('');
  const [addressDisabled, setAddressDisabled] = useState(false);
  const [note, setNote] = useState('');
  const [ordering, setOrdering] = useState(false);
  const [orderBtnText, setOrderBtnText] = useState('Buyurtma berish');
  const [orders, setOrders] = useState<OrdersState>(null);
  const [profile, setProfile] = useState<Profile>({ points: 0, orders: 0, spent: 0 });
  const [successOrderNum, setSuccessOrderNum] = useState('');
  const [successPoints, setSuccessPoints] = useState<string | null>(null);
  const [trackingId, setTrackingId] = useState<string | null>(null);
  const [trackingStatus, setTrackingStatus] = useState<OrderStatus | null>(null);
  const [showRating, setShowRating] = useState(false);
  const [avatarModalOpen, setAvatarModalOpen] = useState(false);
  const [avatarId, setAvatarId] = useState<string>(() => localStorage.getItem(AVATAR_KEY) || 'm1');
  const [cartBump, setCartBump] = useState(false);

  const toastTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const trackingInterval = useRef<ReturnType<typeof setInterval> | null>(null);
  const geo = useRef<{ lat: number | null; lon: number | null }>({ lat: null, lon: null });
  const pageRef = useRef<Page>(page);
  pageRef.current = page;

  const avatar: Avatar = AVATARS.find(a => a.id === avatarId) || AVATARS[0];

  const showToast = useCallback((msg: string) => {
    setToast({ msg, show: true });
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(t => ({ ...t, show: false })), 2500);
  }, []);

  // INIT
  useEffect(() => {
    let cancelled = false;
    async function init() {
      try {
        const res = await fetch(`${API_BASE}/api/menu`);
        const items: MenuItem[] = await res.json();
        if (cancelled) return;
        setMenuItems(items);

        const catMap = new Map<string, Category>();
        items.forEach(item => {
          if (item.categories && !catMap.has(item.category_id)) {
            catMap.set(item.category_id, {
              id: item.category_id,
              name_uz: item.categories.name_uz,
              name_ru: item.categories.name_ru,
              name_en: item.categories.name_en,
              emoji: item.categories.emoji,
              sort_order: item.categories.sort_order
            });
          }
        });
        setCategories(Array.from(catMap.values()).sort((a, b) => a.sort_order - b.sort_order));
      } catch (e) {
        console.error('Menu load error:', e);
      }
      setTimeout(() => {
        setSplashFading(true);
        setTimeout(() => setSplashVisible(false), 500);
      }, 1200);
    }
    init();
    loadProfile(); // lojallik ballari savatda ko'rinishi uchun boshidayoq yuklanadi
    // Forced Splash Dismissal (Safety Net)
    const safety = setTimeout(() => {
      setSplashFading(true);
      setTimeout(() => setSplashVisible(false), 500);
    }, 5000);
    return () => { cancelled = true; clearTimeout(safety); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // SUPABASE REALTIME
  useEffect(() => {
    const channel = supabaseClient
      .channel('menu_changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'menu_items' }, (payload) => {
        setMenuItems(prev => {
          if (payload.eventType === 'INSERT') return [...prev, payload.new as MenuItem];
          if (payload.eventType === 'UPDATE') {
            const updated = payload.new as MenuItem;
            return prev.map(i => i.id === updated.id ? { ...i, ...updated } : i);
          }
          if (payload.eventType === 'DELETE') {
            const removed = payload.old as { id: string };
            return prev.filter(i => i.id !== removed.id);
          }
          return prev;
        });
        showToast("Menyu yangilandi 🔄");
      })
      .subscribe();
    return () => { supabaseClient.removeChannel(channel); };
  }, [showToast]);

  // Derived cart values
  const cartValues = Object.values(cart);
  const cartCount = cartValues.reduce((s, c) => s + c.qty, 0);
  const cartTotal = cartValues.reduce((s, c) => s + c.qty * c.item.price, 0);
  const subtotal = cartTotal;

  // Chegirma joriy savat summasidan hisoblanadi (savat o'zgarsa ham to'g'ri qoladi)
  let discount = 0;
  if (appliedCoupon) {
    if (appliedCoupon.discount_type === 'percent') {
      discount = Math.floor(subtotal * (appliedCoupon.discount_value / 100));
    } else if (appliedCoupon.discount_value) {
      discount = appliedCoupon.discount_value;
    } else {
      discount = appliedCoupon.discount || 0;
    }
  }

  let pointsUsed = 0;
  if (usePoints) {
    pointsUsed = Math.min(subtotal * 0.3, userPoints * 10);
  }

  const total = subtotal + DELIVERY_FEE - discount - pointsUsed;
  const orderDisabled = !(address.length > 5 && Object.keys(cart).length > 0) || ordering;

  // Savat bo'shaganda eski kupon va ball tanlovi tozalanadi
  const cartEmpty = cartValues.length === 0;
  useEffect(() => {
    if (cartEmpty) {
      setAppliedCoupon(null);
      setCouponMsg({ text: '', color: '' });
      setCouponCode('');
      setUsePoints(false);
    }
  }, [cartEmpty]);

  // CART ACTIONS
  function addCart(id: string): void {
    const item = menuItems.find(x => x.id === id);
    if (!item) return;
    setCart(prev => ({ ...prev, [id]: { item, qty: 1 } }));
    tg.HapticFeedback.impactOccurred('medium');
    setCartBump(true);
    setTimeout(() => setCartBump(false), 300);
  }

  function updateQty(id: string, delta: number): void {
    setCart(prev => {
      if (!prev[id]) return prev;
      const qty = prev[id].qty + delta;
      const next = { ...prev };
      if (qty <= 0) delete next[id];
      else next[id] = { ...next[id], qty };
      return next;
    });
    tg.HapticFeedback.selectionChanged();
  }

  function toggleFav(id: string): void {
    tg.HapticFeedback.selectionChanged();
    setWishlist(prev => {
      let next: string[];
      if (prev.includes(id)) {
        next = prev.filter(x => x !== id);
      } else {
        next = [...prev, id];
        showToast("Saqlandi ❤️");
      }
      localStorage.setItem('wishlist', JSON.stringify(next));
      return next;
    });
  }

  // NAVIGATION
  const nav = useCallback((p: Page) => {
    if (trackingInterval.current && p !== 'tracking') {
      clearInterval(trackingInterval.current);
      trackingInterval.current = null;
    }
    setPage(p);
    window.scrollTo(0, 0);
    if (p === 'orders') fetchOrders();
    if (p === 'profile') loadProfile();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function setCat(id: string): void {
    setCurrentCat(id);
    tg.HapticFeedback.impactOccurred('light');
  }

  // COUPON
  async function applyCoupon(): Promise<void> {
    const code = couponCode.trim().toUpperCase();
    if (!code) return;
    const sub = Object.values(cart).reduce((s, c) => s + c.qty * c.item.price, 0);
    const userId = tg.initDataUnsafe?.user?.id || user?.id || 0;
    try {
      const res = await fetch(`${API_BASE}/api/coupon/validate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code, user_id: userId, subtotal: sub })
      });
      const data: {
        valid: boolean;
        discount?: number;
        error?: string;
        coupon?: { discount_type?: 'percent' | 'fixed'; discount_value?: number };
      } = await res.json();
      if (data.valid) {
        setAppliedCoupon({
          code,
          discount_type: data.coupon?.discount_type || 'fixed',
          discount_value: data.coupon?.discount_value || 0,
          discount: data.discount
        });
        setCouponMsg({ text: `✅ Kupon qabul qilindi! (-${data.discount?.toLocaleString()} so'm)`, color: '#00C853' });
        tg.HapticFeedback.notificationOccurred('success');
      } else {
        setAppliedCoupon(null);
        setCouponMsg({ text: `❌ ${data.error || 'Kupon yaroqsiz'}`, color: '#E8001C' });
        tg.HapticFeedback.notificationOccurred('error');
      }
    } catch (e) {
      console.error('Coupon error:', e);
      setCouponMsg({ text: '❌ Xatolik yuz berdi', color: '' });
    }
  }

  // LOCATION
  async function onLocationSuccess(latitude: number, longitude: number): Promise<void> {
    geo.current = { lat: latitude, lon: longitude };
    setAddress("📍 Manzil aniqlanmoqda...");
    setAddressDisabled(true);
    const addr = await reverseGeocode(latitude, longitude);
    setAddressDisabled(false);
    if (addr) {
      setAddress(addr);
      showToast("✅ Manzil aniqlandi!");
    } else {
      setAddress(`${latitude.toFixed(5)}, ${longitude.toFixed(5)}`);
      showToast("📍 Joylashuv olindi!");
    }
  }

  function showLocationFallback(): void {
    if (navigator.geolocation) {
      showToast("📍 Joylashuv aniqlanmoqda...");
      navigator.geolocation.getCurrentPosition(
        async (pos) => { await onLocationSuccess(pos.coords.latitude, pos.coords.longitude); },
        () => {
          tg.showPopup({
            title: "📍 Manzil kiriting",
            message: "Joylashuvni avtomatik ololmadik. Qo'lda kiriting.",
            buttons: [{ type: 'ok', text: 'Tushunarli' }]
          });
          document.getElementById('address-input')?.focus();
        },
        { timeout: 10000, enableHighAccuracy: true }
      );
    } else {
      document.getElementById('address-input')?.focus();
      showToast("Manzilni qo'lda kiriting");
    }
  }

  function requestLocation(): void {
    if (tg.isVersionAtLeast('6.9')) {
      tg.LocationManager.init(() => {
        if (tg.LocationManager.isLocationAvailable) {
          tg.LocationManager.getLocation(async (locationData) => {
            if (locationData) {
              await onLocationSuccess(locationData.latitude, locationData.longitude);
            } else {
              showLocationFallback();
            }
          });
        } else {
          showLocationFallback();
        }
      });
    } else {
      showLocationFallback();
    }
  }

  // ORDER
  async function placeOrder(): Promise<void> {
    tg.HapticFeedback.impactOccurred('heavy');
    setOrdering(true);
    setOrderBtnText('Yuborilmoqda...');

    const items = Object.values(cart).map(c => ({
      id: c.item.id,
      name: c.item.name_uz || c.item.name_ru || c.item.name_en || 'Taom',
      name_uz: c.item.name_uz || '',
      name_ru: c.item.name_ru || '',
      name_en: c.item.name_en || '',
      qty: Math.trunc(c.qty) || 1,
      price: Math.trunc(c.item.price) || 0,
      emoji: c.item.emoji || '🍽',
      image_url: c.item.image_url || null,
      category_id: c.item.category_id || null
    }));

    const sub = items.reduce((s, i) => s + i.price * i.qty, 0);
    let disc = 0;
    if (appliedCoupon) {
      disc = appliedCoupon.discount_type === 'percent'
        ? Math.floor(sub * (appliedCoupon.discount_value / 100))
        : Math.trunc(appliedCoupon.discount_value);
    }
    disc = Math.trunc(disc) || 0;

    let ptsUsed = 0;
    if (usePoints) {
      ptsUsed = Math.trunc(Math.min(sub * 0.3, userPoints * 10)) || 0;
    }
    const delivery_fee = DELIVERY_FEE;

    const payload = {
      items,
      subtotal: sub,
      delivery_fee,
      discount: disc,
      loyalty_points_used: ptsUsed,
      total: Math.trunc(sub + delivery_fee - disc - ptsUsed),
      coupon_code: appliedCoupon ? appliedCoupon.code : null,
      delivery_address: address,
      note,
      language: lang
    };

    try {
      const response = await fetch(`${API_BASE}/api/orders`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-TG-Init-Data': tg.initData },
        body: JSON.stringify(payload)
      });

      // Kill-Switch: Agar API 403 qaytarsa, xizmat to'xtatilgan
      if (response.status === 403) {
        const result: { error?: string } = await response.json();
        tg.showPopup({
          title: "⚠️ Xizmat vaqtincha to'xtatilgan",
          message: result.error || "Bot hozirda faol emas. Iltimos keyinroq urinib ko'ring.",
          buttons: [{ type: 'ok', text: 'Tushunarli' }]
        });
        setOrdering(false);
        setOrderBtnText('Buyurtma berish');
        return;
      }

      const result: { success?: boolean; error?: string; order?: { id: string; points_earned?: number } } = await response.json();
      if (response.ok && result.success && result.order) {
        createConfetti();
        setCart({});
        setOrdering(false);
        setOrderBtnText('Buyurtma berish');
        showSuccessPage(result.order.id, result.order.points_earned || 0);
        showToast("✅ Buyurtma qabul qilindi!");
      } else {
        throw new Error(result.error || "Buyurtma rad etildi");
      }
    } catch (e) {
      console.error("Order error:", e);
      tg.showPopup({
        title: "Xatolik",
        message: (e instanceof Error && e.message) || "Buyurtma berishda xatolik yuz berdi. Iltimos qayta urinib ko'ring.",
        buttons: [{ type: 'ok', text: 'Tushunarli' }]
      });
      setOrdering(false);
      setOrderBtnText('Qayta urinish');
    }
  }

  function showSuccessPage(orderNum: string, pointsEarned = 0): void {
    setSuccessOrderNum('#' + orderNum);
    setSuccessPoints(pointsEarned > 0 ? '🎁 +' + pointsEarned + ' ball oldingiz!' : null);
    setPage('success');
    window.scrollTo(0, 0);
    // foydalanuvchi 3 soniya ichida boshqa sahifaga o'tgan bo'lsa, tracking'ga tortib ketmaymiz
    setTimeout(() => {
      if (pageRef.current === 'success') showOrderTracking('#' + orderNum);
    }, 3000);
  }

  // TRACKING
  async function updateTracking(orderId: string): Promise<void> {
    const cleanId = orderId.toString().replace('#', '');
    try {
      const res = await fetch(`${API_BASE}/api/order/${cleanId}/status`);
      if (!res.ok) return;
      const data: { status?: OrderStatus; error?: string } = await res.json();
      if (!data || data.error || !data.status) return;
      setTrackingStatus(data.status);
      if (data.status === 'delivered') {
        if (trackingInterval.current) clearInterval(trackingInterval.current);
        setShowRating(true);
      }
      if (data.status === 'cancelled') {
        if (trackingInterval.current) clearInterval(trackingInterval.current);
      }
    } catch (e) {
      console.error('Tracking error:', e);
    }
  }

  function showOrderTracking(orderId: string): void {
    const cleanId = orderId.toString().replace('#', '');
    setTrackingId(cleanId);
    setTrackingStatus(null);
    setShowRating(false);
    setPage('tracking');
    window.scrollTo(0, 0);
    if (trackingInterval.current) clearInterval(trackingInterval.current);
    updateTracking(cleanId);
    trackingInterval.current = setInterval(() => updateTracking(cleanId), 10000);
  }

  useEffect(() => () => { if (trackingInterval.current) clearInterval(trackingInterval.current); }, []);

  function rateOrder(rating: number): void {
    fetch(`${API_BASE}/api/order/${trackingId}/rate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body: JSON.stringify({ rating })
    }).catch(e => console.error('Rate error:', e));
    showToast("⭐ Bahoyingiz uchun rahmat!");
    setShowRating(false);
  }

  // ORDERS
  async function fetchOrders(): Promise<void> {
    setOrders(null);
    const userId = tg.initDataUnsafe?.user?.id || user?.id;
    if (!userId || userId === 111111) {
      setOrders('no-auth');
      return;
    }
    try {
      const res = await fetch(`${API_BASE}/api/user/orders`, { headers: authHeaders() });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data: UserOrder[] = await res.json();
      setOrders(Array.isArray(data) ? data : []);
    } catch (e) {
      console.error('Orders error:', e);
      setOrders('error');
    }
  }

  // PROFILE
  function loadProfile(): void {
    const telegramUser = tg.initDataUnsafe?.user;
    const userId = telegramUser?.id || user?.id;
    if (userId && userId !== 111111) {
      fetch(`${API_BASE}/api/user/profile`, { headers: authHeaders() })
        .then(r => r.json())
        .then((data: { loyalty_points?: number; total_orders?: number; total_spent?: number }) => {
          setProfile({
            points: data.loyalty_points || 0,
            orders: data.total_orders || 0,
            spent: data.total_spent || 0
          });
          setUserPoints(data.loyalty_points || 0);
        })
        .catch(() => {});
    }
  }

  function changeLang(e: React.ChangeEvent<HTMLSelectElement>): void {
    localStorage.setItem('lang', e.target.value);
    showToast("Til o'zgardi 🌍");
    setTimeout(() => location.reload(), 500);
  }

  function selectAvatar(id: string): void {
    saveAvatar(id);
    setAvatarId(id);
    tg.HapticFeedback.selectionChanged();
    setTimeout(() => setAvatarModalOpen(false), 500);
    showToast('✅ Avatar saqlandi!');
  }

  // FILTERED MENU
  const filteredMenu = useMemo(() => menuItems.filter(i => {
    if (currentCat !== 'all' && i.category_id !== currentCat) return false;
    const itemName = ((i[`name_${lang}`] as string | undefined) || i.name_uz || '').toLowerCase();
    if (search && !itemName.includes(search.toLowerCase())) return false;
    return true;
  }), [menuItems, currentCat, search]);

  const telegramUser = tg.initDataUnsafe?.user;
  const fullName = telegramUser
    ? ([telegramUser.first_name, telegramUser.last_name].filter(Boolean).join(' ') || telegramUser.username || 'Foydalanuvchi')
    : user.first_name;

  const trackingSteps: OrderStatus[] = ['new', 'confirmed', 'cooking', 'delivering', 'delivered'];
  const stepLabels: Record<string, { icon: string; label: string; time: string }> = {
    new: { icon: '🆕', label: 'Qabul qilindi', time: '' },
    confirmed: { icon: '✅', label: 'Tasdiqlandi', time: '' },
    cooking: { icon: '👨‍🍳', label: 'Tayyorlanmoqda', time: '~25 daqiqa' },
    delivering: { icon: '🛵', label: "Yo'lda", time: '~10-15 daqiqa' },
    delivered: { icon: '🎉', label: 'Yetkazildi', time: '' }
  };
  const currentStepIdx = trackingStatus ? trackingSteps.indexOf(trackingStatus) : -1;

  const orderStatusMap: Record<string, { label: string; color: string }> = {
    'new': { label: '🆕 Yangi', color: '#FFB800' },
    'confirmed': { label: '✅ Tasdiqlandi', color: '#00C853' },
    'cooking': { label: '👨‍🍳 Tayyorlanmoqda', color: '#FF6B00' },
    'delivering': { label: '🛵 Yolda', color: '#2196F3' },
    'delivered': { label: '✅ Yetkazildi', color: '#00C853' },
    'cancelled': { label: '❌ Bekor', color: '#E8001C' }
  };

  function renderCardAction(i: MenuItem) {
    const qty = cart[i.id]?.qty || 0;
    if (!i.is_available) {
      return <div style={{ color: 'var(--primary)', fontSize: 11, fontWeight: 900 }}>Mavjud emas</div>;
    }
    if (qty === 0) {
      return <button className="btn-add" onClick={() => addCart(i.id)}>+</button>;
    }
    return (
      <div className="qty-controls">
        <button className="qty-btn" onClick={() => updateQty(i.id, -1)}>-</button>
        <span className="qty-num">{qty}</span>
        <button className="qty-btn" onClick={() => updateQty(i.id, 1)}>+</button>
      </div>
    );
  }

  return (
    <>
      {splashVisible && (
        <div id="splash" style={{ opacity: splashFading ? 0 : 1 }}>
          <div className="splash-logo">🍔 FOOOD CITY</div>
          <div className="splash-tagline">Mazali ovqat — bir tugmada</div>
          <div className="loader"><div className="dot"></div><div className="dot"></div><div className="dot"></div></div>
        </div>
      )}

      <div className={`toast${toast.show ? ' show' : ''}`}>{toast.msg}</div>

      {/* MENU PAGE */}
      <div id="page-menu" className={`page${page === 'menu' ? ' active' : ''}`}>
        <div className="header">
          <div className="header-top">
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <div id="header-avatar" onClick={() => nav('profile')}
                style={{ width: 36, height: 36, borderRadius: '50%', background: avatar.bg, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18, border: '2px solid rgba(255,107,0,0.5)', cursor: 'pointer', transition: 'transform 0.2s' }}>
                {avatar.emoji}
              </div>
              <div className="brand">🍔 FOOOD CITY</div>
            </div>
            <div className={`cart-icon-btn${cartBump ? ' bump' : ''}`} onClick={() => nav('cart')}>
              🛒{(cartCount > 0 || wishlist.length > 0) && (
                <span className="badge">{cartCount > 0 ? cartCount : wishlist.length}</span>
              )}
            </div>
          </div>
          <div className="header-sub">Tez va mazali yetkazib berish 🚀</div>
        </div>

        <div className="search-container">
          <span className="search-icon">🔍</span>
          <input type="text" className="search-bar" placeholder={strings[lang].search}
            value={search} onChange={e => setSearch(e.target.value)} />
        </div>

        <div className="tabs">
          <div className={`tab${currentCat === 'all' ? ' active' : ''}`} onClick={() => setCat('all')}>Hammasi</div>
          {categories.map(c => (
            <div key={c.id} className={`tab${currentCat === c.id ? ' active' : ''}`} onClick={() => setCat(c.id)}>
              {c.emoji || ''} {(c[`name_${lang}`] as string | undefined) || c.name_uz}
            </div>
          ))}
        </div>

        <div className="menu-grid" style={{ paddingBottom: cartCount > 0 ? 140 : 80 }}>
          {filteredMenu.map(i => (
            <div className="card" key={i.id}>
              <div className="card-top">
                {i.image_url
                  ? <img src={i.image_url} className="card-img" alt="" />
                  : <div className="card-placeholder" style={{ background: gradFor(i) }}>{i.emoji || '🍔'}</div>}
                {i.badge && <div className="card-badge">{i.badge}</div>}
                <div className="card-fav" onClick={() => toggleFav(i.id)}>{wishlist.includes(i.id) ? '❤️' : '🤍'}</div>
              </div>
              <div className="card-body">
                <div className="card-title">{nameFor(i)}</div>
                <div className="card-desc">{(i[`description_${lang}`] as string | undefined) || ''}</div>
                <div className="card-footer">
                  <div className="card-price">{i.price.toLocaleString()} so'm</div>
                  {renderCardAction(i)}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* CART PAGE */}
      <div id="page-cart" className={`page${page === 'cart' ? ' active' : ''}`} style={{ paddingBottom: 160 }}>
        <div className="header" style={{ marginBottom: 20, paddingBottom: 20 }}>
          <div className="header-top">
            <div className="brand" onClick={() => nav('menu')} style={{ cursor: 'pointer' }}>← 🛒 Savatcha</div>
          </div>
        </div>

        <div className="cart-list">
          {cartValues.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '80px 20px', color: 'var(--text2)', fontWeight: 700 }}>Savatchangiz bo'sh 🛒</div>
          ) : cartValues.map(c => (
            <div className="cart-item" key={c.item.id}>
              {c.item.image_url
                ? <img src={c.item.image_url} className="cart-item-img" alt="" />
                : <div className="cart-item-placeholder" style={{ background: gradFor(c.item) }}>{c.item.emoji || '🍔'}</div>}
              <div className="cart-item-info">
                <div className="cart-item-title">{nameFor(c.item)}</div>
                <div className="cart-item-price">{c.item.price.toLocaleString()} so'm</div>
              </div>
              <div className="qty-controls">
                <button className="qty-btn" onClick={() => updateQty(c.item.id, -1)}>-</button>
                <span className="qty-num">{c.qty}</span>
                <button className="qty-btn" onClick={() => updateQty(c.item.id, 1)}>+</button>
              </div>
            </div>
          ))}
        </div>

        {cartValues.length > 0 && (
          <div id="cart-summary">
            <div className="cart-divider"></div>

            <div className="promo-row">
              <input type="text" className="promo-input" placeholder="Promokod"
                value={couponCode} onChange={e => setCouponCode(e.target.value)} />
              <button className="promo-btn" onClick={applyCoupon}>Qo'llash</button>
            </div>
            <p style={{ fontSize: 12, marginTop: -15, marginBottom: 15, color: couponMsg.color || undefined }}>{couponMsg.text}</p>

            {userPoints > 0 && (
              <div style={{ background: 'rgba(255,184,0,0.1)', padding: 12, borderRadius: 16, marginBottom: 20 }}>
                <p style={{ fontSize: 14, marginBottom: 8 }}>💎 Balansingiz: <span>{userPoints}</span> ball</p>
                <label style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 14, fontWeight: 700 }}>
                  <input type="checkbox" checked={usePoints} onChange={e => setUsePoints(e.target.checked)} /> Ballardan foydalanish
                </label>
              </div>
            )}

            <div className="address-section">
              <div className="address-label">📍 Yetkazib berish manzili *</div>
              <button className="btn-location" onClick={requestLocation}>Joylashuvni ulashish</button>
              <input type="text" id="address-input" className="promo-input" placeholder="Ko'cha, uy raqami..."
                value={address} disabled={addressDisabled} onChange={e => setAddress(e.target.value)} />
            </div>

            <div style={{ marginBottom: 20 }}>
              <input type="text" className="promo-input" style={{ width: '100%' }} placeholder="Izoh (ixtiyoriy)..."
                value={note} onChange={e => setNote(e.target.value)} />
            </div>

            <div className="summary-card-new">
              <div className="summary-row"><span>Mahsulotlar</span><span>{subtotal.toLocaleString()} so'm</span></div>
              <div className="summary-row"><span>Yetkazib berish</span><span>15 000</span></div>
              {appliedCoupon && (
                <div className="summary-row" style={{ color: 'var(--success)' }}><span>Chegirma</span><span>-{discount.toLocaleString()} so'm</span></div>
              )}
              {usePoints && (
                <div className="summary-row" style={{ color: 'var(--accent)' }}><span>Ballar</span><span>-{pointsUsed.toLocaleString()} so'm</span></div>
              )}
              <div className="summary-total">
                <span>Jami:</span>
                <span className="total-golden">{total.toLocaleString()} so'm</span>
              </div>
            </div>

            <button className="btn-order" onClick={placeOrder} disabled={orderDisabled}>{orderBtnText}</button>
          </div>
        )}
      </div>

      {/* ORDERS PAGE */}
      <div id="page-orders" className={`page${page === 'orders' ? ' active' : ''}`}>
        <h2 style={{ fontWeight: 900, marginBottom: 20 }}>📦 Buyurtmalarim</h2>
        <div id="orders-list">
          {orders === null && <div style={{ textAlign: 'center', padding: 40, color: '#FFD4A3' }}>⏳ Yuklanmoqda...</div>}
          {orders === 'no-auth' && <div style={{ textAlign: 'center', padding: 40, color: '#FFD4A3' }}>⚠️ Telegram orqali kiring</div>}
          {orders === 'error' && (
            <div style={{ textAlign: 'center', padding: 40, color: '#FFD4A3' }}>
              <div style={{ fontSize: 48, marginBottom: 12 }}>📦</div>
              <div style={{ color: '#E8001C', marginBottom: 8 }}>❌ Xatolik yuz berdi</div>
              <button onClick={fetchOrders}
                style={{ padding: '10px 20px', borderRadius: 50, border: 'none', background: '#FF6B00', color: '#fff', cursor: 'pointer', fontWeight: 700 }}>
                🔄 Qayta urinish
              </button>
            </div>
          )}
          {Array.isArray(orders) && orders.length === 0 && (
            <div style={{ textAlign: 'center', padding: '60px 20px', color: '#FFD4A3' }}>
              <div style={{ fontSize: 64, marginBottom: 16 }}>📦</div>
              <div style={{ fontSize: 18, fontWeight: 700, color: '#fff', marginBottom: 8 }}>Buyurtmalar yo'q</div>
              <div style={{ fontSize: 14 }}>Birinchi buyurtmangizni bering!</div>
              <button onClick={() => nav('menu')}
                style={{ marginTop: 20, padding: '12px 28px', borderRadius: 50, border: 'none', background: 'linear-gradient(135deg,#E8001C,#FF6B00)', color: '#fff', fontWeight: 700, cursor: 'pointer', fontSize: 14 }}>
                🍔 Menuga o'tish
              </button>
            </div>
          )}
          {Array.isArray(orders) && orders.map(order => {
            const status = orderStatusMap[order.status] || { label: order.status, color: '#FFD4A3' };
            const date = new Date(order.created_at).toLocaleDateString('uz-UZ', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
            const items = Array.isArray(order.items) ? order.items : [];
            return (
              <div key={order.id} onClick={() => showOrderTracking(order.id)}
                style={{ background: '#2D1500', borderRadius: 16, padding: 16, marginBottom: 12, border: '1px solid rgba(255,107,0,0.2)', cursor: 'pointer', transition: 'transform 0.15s, border-color 0.15s' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                  <span style={{ fontSize: 16, fontWeight: 800, color: '#FFB800' }}>#{order.id}</span>
                  <span style={{ fontSize: 12, fontWeight: 700, color: status.color, background: status.color + '22', padding: '4px 10px', borderRadius: 50 }}>
                    {status.label}
                  </span>
                </div>
                <div style={{ marginBottom: 10 }}>
                  {items.map((i, idx) => (
                    <div key={idx} style={{ fontSize: 13, color: '#FFD4A3' }}>• {i.name_uz || i.name_ru || i.name || 'Taom'} x{i.qty || 1}</div>
                  ))}
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 10, borderTop: '1px solid rgba(255,255,255,0.05)', paddingTop: 10 }}>
                  <span style={{ fontSize: 12, color: '#6B4A3A' }}>{date}</span>
                  <span style={{ fontSize: 15, fontWeight: 800, color: '#fff' }}>{(order.total || 0).toLocaleString()} so'm</span>
                  <span style={{ fontSize: 11, color: '#FF6B00', fontWeight: 700 }}>Holati → </span>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* WISHLIST PAGE */}
      <div id="page-wishlist" className={`page${page === 'wishlist' ? ' active' : ''}`}>
        <h2 style={{ fontWeight: 900, marginBottom: 20 }}>❤️ Saqlanganlar</h2>
        <div className="menu-grid">
          {menuItems.filter(i => wishlist.includes(i.id)).length === 0 && (
            <p style={{ gridColumn: '1/-1', textAlign: 'center', padding: 40, color: 'var(--text2)' }}>Hali hech narsa yo'q</p>
          )}
          {menuItems.filter(i => wishlist.includes(i.id)).map(i => (
            <div className="card" key={i.id} onClick={() => nav('menu')}>
              <div className="card-top" style={{ height: 100 }}>
                {i.image_url
                  ? <img src={i.image_url} className="card-img" alt="" />
                  : <div className="card-placeholder" style={{ background: gradFor(i) }}>{i.emoji || '🍔'}</div>}
              </div>
              <div className="card-body">
                <div className="card-title">{nameFor(i)}</div>
                <div className="card-price">{i.price.toLocaleString()} so'm</div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* PROFILE PAGE */}
      <div id="page-profile" className={`page${page === 'profile' ? ' active' : ''}`}>
        <div style={{ textAlign: 'center', padding: '20px 0 12px' }}>
          <div id="profile-avatar-display" onClick={() => setAvatarModalOpen(true)}
            style={{ width: 90, height: 90, borderRadius: '50%', margin: '0 auto 12px', cursor: 'pointer', position: 'relative', background: avatar.bg, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 44, boxShadow: '0 4px 20px rgba(255,107,0,0.3)', border: '3px solid rgba(255,107,0,0.5)', transition: 'transform 0.2s' }}>
            <span className="avatar-emoji">{avatar.emoji}</span>
            <div style={{ position: 'absolute', bottom: 2, right: 2, width: 24, height: 24, borderRadius: '50%', background: '#FF6B00', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, color: '#fff' }}>✏️</div>
          </div>
          <div style={{ fontSize: 20, fontWeight: 800, color: '#fff' }}>{fullName}</div>
          <div style={{ color: '#FFB800', fontSize: 14, marginTop: 2 }}>{telegramUser?.username ? '@' + telegramUser.username : ''}</div>
        </div>

        <div className="summary-card">
          <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 4 }}>
            <div style={{ textAlign: 'center', flex: 1 }}>
              <div style={{ fontSize: 12, color: 'var(--text2)' }}>Buyurtmalar</div>
              <div style={{ fontSize: 18, fontWeight: 900, color: 'var(--text)' }}>{profile.orders}</div>
            </div>
            <div style={{ textAlign: 'center', flex: 1 }}>
              <div style={{ fontSize: 12, color: 'var(--text2)' }}>Sarflandi</div>
              <div style={{ fontSize: 18, fontWeight: 900, color: 'var(--text)' }}>{profile.spent.toLocaleString()} so'm</div>
            </div>
          </div>
          <p style={{ marginTop: 16, color: 'var(--accent)', fontWeight: 800, textAlign: 'center' }}>💎 {profile.points} ball</p>
          <div style={{ height: 1, background: 'rgba(255,255,255,0.1)', margin: '20px 0' }}></div>
          <p style={{ fontWeight: 700, marginBottom: 12 }}>Tilni tanlang:</p>
          <select className="promo-input" style={{ width: '100%' }} defaultValue={lang} onChange={changeLang}>
            <option value="uz">🇺🇿 O'zbekcha</option>
            <option value="ru">🇷🇺 Русский</option>
            <option value="en">🇬🇧 English</option>
          </select>
        </div>
      </div>

      {/* SUCCESS PAGE */}
      {page === 'success' && (
        <div id="page-success" className="page active" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: '80vh', textAlign: 'center', padding: 32 }}>
          <div style={{ width: 100, height: 100, borderRadius: '50%', background: 'linear-gradient(135deg, #00C853, #00E676)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 48, marginBottom: 24, animation: 'successPop 0.5s cubic-bezier(0.175, 0.885, 0.32, 1.275)' }}>
            ✅
          </div>
          <h2 style={{ fontSize: 24, fontWeight: 800, color: '#fff', marginBottom: 8 }}>Buyurtma qabul qilindi!</h2>
          <p style={{ color: '#FFD4A3', fontSize: 15, marginBottom: 20 }}>Tez orada tayyorlab yetkazamiz 🚀</p>
          <div style={{ background: 'linear-gradient(135deg, #FFB800, #FF6B00)', borderRadius: 50, padding: '10px 28px', fontSize: 22, fontWeight: 800, color: '#fff', marginBottom: 16 }}>{successOrderNum}</div>
          <div style={{ background: '#2D1500', borderRadius: 12, padding: '12px 24px', marginBottom: 32, border: '1px solid rgba(255,107,0,0.3)' }}>
            <span style={{ fontSize: 28 }}>⏱</span>
            <span style={{ color: '#FFD4A3', fontSize: 15, marginLeft: 8 }}>30-45 daqiqa</span>
          </div>
          <div style={{ color: '#FFB800', fontSize: 14, marginBottom: 32 }}>{successPoints || '🎁 Ballar hisoblanmoqda...'}</div>
          <button onClick={() => nav('orders')} style={{ width: '100%', padding: 16, borderRadius: 16, border: 'none', background: 'linear-gradient(135deg,#E8001C,#FF6B00)', color: '#fff', fontSize: 16, fontWeight: 800, marginBottom: 12, cursor: 'pointer' }}>📦 Buyurtmamni ko'rish</button>
          <button onClick={() => nav('menu')} style={{ width: '100%', padding: 16, borderRadius: 16, background: '#2D1500', color: '#FFD4A3', border: '1px solid rgba(255,107,0,0.3)', fontSize: 16, fontWeight: 700, cursor: 'pointer' }}>🏠 Bosh sahifaga qaytish</button>
        </div>
      )}

      {/* TRACKING PAGE */}
      {page === 'tracking' && (
        <div id="page-tracking" className="page active" style={{ padding: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20 }}>
            <button onClick={() => nav('orders')}
              style={{ background: '#2D1500', border: 'none', color: '#fff', width: 36, height: 36, borderRadius: 10, cursor: 'pointer', fontSize: 18 }}>
              ←
            </button>
            <h2 style={{ color: '#fff', fontSize: 18, fontWeight: 700 }}>Buyurtma holati</h2>
          </div>

          <div style={{ background: '#2D1500', borderRadius: 16, padding: 16, marginBottom: 16 }}>
            <div style={{ color: '#FFD4A3', fontSize: 13 }}>Buyurtma raqami</div>
            <div style={{ color: '#FFB800', fontSize: 22, fontWeight: 800 }}>#{trackingId}</div>
            <div>{trackingStatus === 'cancelled' && <span style={{ color: '#E8001C', fontWeight: 700 }}>❌ Bekor qilindi</span>}</div>
          </div>

          <div style={{ background: '#2D1500', borderRadius: 16, padding: 16, marginBottom: 16 }}>
            <div>
              {trackingStatus && trackingStatus !== 'cancelled' && trackingSteps.map((step, idx) => {
                const s = stepLabels[step];
                const isDone = idx <= currentStepIdx;
                const isCurrent = idx === currentStepIdx;
                return (
                  <div key={step} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 0', borderBottom: idx < trackingSteps.length - 1 ? '1px solid rgba(255,107,0,0.1)' : undefined }}>
                    <div style={{
                      width: 44, height: 44, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 20,
                      background: isCurrent ? 'linear-gradient(135deg,#E8001C,#FF6B00)' : isDone ? '#00C853' : '#2D1500',
                      boxShadow: isCurrent ? '0 0 20px rgba(255,107,0,0.5)' : 'none',
                      animation: isCurrent ? 'pulse 1.5s infinite' : undefined
                    }}>
                      {s.icon}
                    </div>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontWeight: 700, color: isDone ? '#fff' : '#666' }}>{s.label}</div>
                      {s.time && isCurrent && <div style={{ fontSize: 12, color: '#FF6B00' }}>{s.time}</div>}
                    </div>
                    {isDone && <div style={{ color: '#00C853', fontSize: 20 }}>✓</div>}
                  </div>
                );
              })}
            </div>
          </div>

          {showRating && (
            <div style={{ background: '#2D1500', borderRadius: 16, padding: 16, textAlign: 'center' }}>
              <div style={{ color: '#fff', fontWeight: 700, marginBottom: 12 }}>⭐ Xizmatni baholang</div>
              <div style={{ display: 'flex', justifyContent: 'center', gap: 8 }}>
                {[5, 4, 3, 2, 1].map(r => (
                  <button key={r} onClick={() => rateOrder(r)} style={{ fontSize: 28, background: 'none', border: 'none', cursor: 'pointer' }}>⭐</button>
                ))}
              </div>
            </div>
          )}

          <button onClick={() => nav('menu')}
            style={{ width: '100%', padding: 14, borderRadius: 14, background: '#2D1500', color: '#FFD4A3', fontSize: 15, cursor: 'pointer', border: '1px solid rgba(255,107,0,0.3)', marginTop: 8 }}>
            🏠 Bosh sahifaga qaytish
          </button>
        </div>
      )}

      {/* CONTACT PAGE */}
      <div id="page-contact" className={`page${page === 'contact' ? ' active' : ''}`} style={{ padding: 16 }}>
        <h2 style={{ fontWeight: 900, marginBottom: 20 }}>📞 Kontakt</h2>
        <div className="card" style={{ marginBottom: 16 }}>
          <div className="card-body" style={{ textAlign: 'center' }}>
            <div style={{ fontSize: 28, fontWeight: 800 }}>🍔 FOOD CITY</div>
            <div style={{ fontSize: 14, color: 'var(--text2)', marginTop: 8 }}>😉 Biz bilan oʻzgacha ta'mni his qilasiz</div>
          </div>
        </div>
        <div className="card" style={{ marginBottom: 16 }}>
          <div className="card-body" style={{ textAlign: 'center' }}>
            <div style={{ fontSize: 14 }}>🕐 Ish vaqti: 09:00 dan 01:00 gacha</div>
          </div>
        </div>
        <div className="card">
          <div className="card-body" style={{ textAlign: 'center' }}>
            <div style={{ fontSize: 14, marginBottom: 8 }}>👇🏻 Buyurtma berish uchun:</div>
            <a href="tel:+998946719009" style={{ color: 'var(--accent)', textDecoration: 'none' }}>☎️ +94-671-90-09</a><br />
            <a href="tel:+998956729009" style={{ color: 'var(--accent)', textDecoration: 'none' }}>☎️ +95-672-90-09</a>
          </div>
        </div>
      </div>

      {/* CART BAR */}
      {page === 'menu' && cartCount > 0 && (
        <div className="cart-bar" onClick={() => nav('cart')}>
          <div className="cart-bar-left">
            <span>🛍</span>
            <span>{cartCount} ta mahsulot</span>
          </div>
          <div className="cart-bar-mid">Savatchani ko'rish</div>
          <div className="cart-bar-right">{cartTotal.toLocaleString()} so'm</div>
        </div>
      )}

      {/* NAVBAR */}
      <div className="navbar">
        {([
          { key: 'menu', icon: '🏠', label: 'Menu' },
          { key: 'orders', icon: '📦', label: 'Buyurtmalar' },
          { key: 'wishlist', icon: '❤️', label: 'Saqlangan' },
          { key: 'profile', icon: '👤', label: 'Profil' },
          { key: 'contact', icon: '📞', label: 'Kontakt' }
        ] as { key: Page; icon: string; label: string }[]).map(n => (
          <div key={n.key} className={`nav-item${page === n.key ? ' active' : ''}`} onClick={() => nav(n.key)}>
            <i>{n.icon}</i>
            <span>{n.label}</span>
            <div className="nav-dot"></div>
          </div>
        ))}
      </div>

      {/* AVATAR SELECTOR MODAL */}
      {avatarModalOpen && (
        <div id="avatar-modal" style={{ display: 'flex', position: 'fixed', inset: 0, zIndex: 1000, background: 'rgba(0,0,0,0.8)', alignItems: 'flex-end', justifyContent: 'center' }}
          onClick={e => { if (e.target === e.currentTarget) setAvatarModalOpen(false); }}>
          <div style={{ background: '#1C1C1E', borderRadius: '24px 24px 0 0', width: '100%', maxHeight: '85vh', overflowY: 'auto', padding: '20px 16px 40px' }}>
            <div style={{ width: 40, height: 4, background: '#444', borderRadius: 2, margin: '0 auto 20px' }}></div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
              <h3 style={{ color: '#fff', fontSize: 18, fontWeight: 700, margin: 0 }}>🎭 Avatar tanlang</h3>
              <button onClick={() => setAvatarModalOpen(false)} style={{ background: '#2D1500', border: 'none', color: '#FFD4A3', width: 32, height: 32, borderRadius: 8, cursor: 'pointer', fontSize: 16 }}>✕</button>
            </div>
            <div>
              <div style={{ color: '#FFD4A3', fontSize: 13, fontWeight: 600, marginBottom: 10, textTransform: 'uppercase', letterSpacing: 1 }}>👨 Erkaklar</div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5,1fr)', gap: 8, marginBottom: 20 }}>
                {AVATARS.filter(a => a.id.startsWith('m')).map(a => (
                  <AvatarCell key={a.id} avatar={a} selected={a.id === avatarId} onSelect={selectAvatar} />
                ))}
              </div>
              <div style={{ color: '#FFD4A3', fontSize: 13, fontWeight: 600, marginBottom: 10, textTransform: 'uppercase', letterSpacing: 1 }}>👩 Ayollar</div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5,1fr)', gap: 8 }}>
                {AVATARS.filter(a => a.id.startsWith('f')).map(a => (
                  <AvatarCell key={a.id} avatar={a} selected={a.id === avatarId} onSelect={selectAvatar} />
                ))}
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function AvatarCell({ avatar, selected, onSelect }: { avatar: Avatar; selected: boolean; onSelect: (id: string) => void }) {
  return (
    <div className="avatar-grid-item" onClick={() => onSelect(avatar.id)}
      style={{ background: selected ? 'rgba(255,107,0,0.2)' : 'rgba(255,255,255,0.03)', border: `2px solid ${selected ? '#FF6B00' : 'transparent'}` }}>
      <div style={{ width: 50, height: 50, borderRadius: '50%', margin: '0 auto 4px', background: avatar.bg, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 26, boxShadow: selected ? '0 0 12px rgba(255,107,0,0.5)' : undefined }}>
        {avatar.emoji}
      </div>
      <div style={{ fontSize: 9, color: '#888', lineHeight: 1.2 }}>{avatar.label}</div>
    </div>
  );
}
