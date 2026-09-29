import { useState, useEffect, useLayoutEffect, useRef, useCallback, useMemo } from 'react';
import { Bell, Bike, Headset, Home, Info, Languages, Mail, Menu as MenuIcon, Moon, ShoppingCart, Store, Sun, Tag, Truck, X } from 'lucide-react';
import { API_BASE, tg, supabaseClient, user, lang, strings, categoryGradients, DEFAULT_GRADIENT, DELIVERY_FEE, authHeaders, menuItemImageUrl } from './config';
import { AVATARS, AVATAR_KEY, saveAvatar } from './avatars';
import { t } from './i18n';
import type { MenuItem, Category, Cart, AppliedCoupon, UserOrder, OrderStatus, Profile, Avatar, Promotion } from './types';

interface TrackingPayment {
  method: 'cash' | 'card_transfer';
  status: 'pending' | 'paid' | 'rejected';
  receiptUrl: string | null;
  total: number;
}

type Page = 'menu' | 'cart' | 'orders' | 'wishlist' | 'profile' | 'contact' | 'success' | 'tracking';
type OrdersState = UserOrder[] | null | 'error' | 'no-auth';
type FulfillmentMode = 'delivery' | 'pickup';

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
  const [menuLoading, setMenuLoading] = useState(true);
  const [menuError, setMenuError] = useState('');
  const [promotions, setPromotions] = useState<Promotion[]>([]);
  const [activeBannerIndex, setActiveBannerIndex] = useState(0);
  const [bannerDirection, setBannerDirection] = useState<'next' | 'previous'>('next');
  const [selectedProduct, setSelectedProduct] = useState<MenuItem | null>(null);
  const [selectedStoryIndex, setSelectedStoryIndex] = useState<number | null>(null);
  const [showMenuDrawer, setShowMenuDrawer] = useState(false);
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
  const [paymentMethod, setPaymentMethod] = useState<'cash' | 'card_transfer'>('cash');
  const [ordering, setOrdering] = useState(false);
  const [orders, setOrders] = useState<OrdersState>(null);
  const [profile, setProfile] = useState<Profile>({ points: 0, orders: 0, spent: 0 });
  const [phoneVerified, setPhoneVerified] = useState<boolean | null>(null);
  const [phoneNumber, setPhoneNumber] = useState<string | null>(null);
  const [fulfillmentMode, setFulfillmentMode] = useState<FulfillmentMode>('delivery');
  const [cancelOrderId, setCancelOrderId] = useState<string | null>(null);
  const [cancellingOrderId, setCancellingOrderId] = useState<string | null>(null);
  const [theme, setTheme] = useState<'light' | 'dark'>(() =>
    localStorage.getItem('foodcity-theme') === 'dark' ? 'dark' : 'light'
  );
  const [successOrderNum, setSuccessOrderNum] = useState('');
  const [successPoints, setSuccessPoints] = useState<string | null>(null);
  const [trackingId, setTrackingId] = useState<string | null>(null);
  const [trackingStatus, setTrackingStatus] = useState<OrderStatus | null>(null);
  const [trackingPayment, setTrackingPayment] = useState<TrackingPayment | null>(null);
  const [paymentInfo, setPaymentInfo] = useState<{ card_number: string; card_holder: string } | null>(null);
  const [paymentInfoLoading, setPaymentInfoLoading] = useState(false);
  const [paymentInfoError, setPaymentInfoError] = useState('');
  const [receiptUploading, setReceiptUploading] = useState(false);
  const [showRating, setShowRating] = useState(false);
  const [avatarModalOpen, setAvatarModalOpen] = useState(false);
  const [avatarId, setAvatarId] = useState<string>(() => localStorage.getItem(AVATAR_KEY) || 'm1');
  const [useTelegramPhoto, setUseTelegramPhoto] = useState(() =>
    Boolean(tg.initDataUnsafe?.user?.photo_url) && localStorage.getItem('foodcity-profile-photo') !== 'avatar'
  );
  const [cartBump, setCartBump] = useState(false);

  const toastTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const trackingInterval = useRef<ReturnType<typeof setInterval> | null>(null);
  const receiptInputRef = useRef<HTMLInputElement>(null);
  const geo = useRef<{ lat: number | null; lon: number | null }>({ lat: null, lon: null });
  const pageRef = useRef<Page>(page);
  const menuLoadController = useRef<AbortController | null>(null);
  const bannerTouchStart = useRef<number | null>(null);
  pageRef.current = page;

  const avatar: Avatar = AVATARS.find(a => a.id === avatarId) || AVATARS[0];
  const telegramPhoto = useTelegramPhoto ? tg.initDataUnsafe?.user?.photo_url : undefined;

  useLayoutEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem('foodcity-theme', theme);
  }, [theme]);

  const showToast = useCallback((msg: string) => {
    setToast({ msg, show: true });
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(t => ({ ...t, show: false })), 2500);
  }, []);

  const loadMenu = useCallback(async (): Promise<void> => {
    menuLoadController.current?.abort();
    const controller = new AbortController();
    menuLoadController.current = controller;
    setMenuLoading(true);
    setMenuError('');
    try {
      const res = await fetch(`${API_BASE}/api/menu`, { signal: controller.signal });
      if (!res.ok) throw new Error(`Menyu serverida xatolik (${res.status})`);
      const payload: unknown = await res.json();
      if (!Array.isArray(payload)) throw new Error("Menyu ma'lumotlari noto'g'ri formatda");
      const items = (payload as MenuItem[]).map(item => ({
        ...item,
        image_url: menuItemImageUrl(item)
      }));
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
      if (controller.signal.aborted) return;
      console.error('Menu load error:', e);
      setMenuError(e instanceof Error ? e.message : "Menyuni yuklab bo'lmadi");
    } finally {
      if (!controller.signal.aborted) setMenuLoading(false);
    }
  }, []);

  // INIT
  useEffect(() => {
    void loadMenu();
    void fetch(`${API_BASE}/api/promotions`)
      .then(async response => {
        if (!response.ok) throw new Error(`Promolar serverida xatolik (${response.status})`);
        const payload: unknown = await response.json();
        if (!Array.isArray(payload)) throw new Error("Promo ma'lumotlari noto'g'ri formatda");
        setPromotions(payload as Promotion[]);
      })
      .catch(error => console.warn('Promotions load failed:', error));
    const fullscreen = tg.requestFullscreen;
    if (fullscreen && tg.isVersionAtLeast('8.0')) {
      try {
        fullscreen.call(tg);
      } catch (error) {
        console.warn('Telegram fullscreen request was not accepted:', error);
      }
    }
    const init = () => {
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
    return () => {
      menuLoadController.current?.abort();
      clearTimeout(safety);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadMenu]);

  useEffect(() => {
    const refreshProfileOnReturn = () => {
      if (document.visibilityState === 'visible') loadProfile();
    };
    document.addEventListener('visibilitychange', refreshProfileOnReturn);
    return () => document.removeEventListener('visibilitychange', refreshProfileOnReturn);
    // loadProfile uses stable module-level Telegram/auth data and React state setters.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // SUPABASE REALTIME
  useEffect(() => {
    const channel = supabaseClient
      .channel('menu_changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'menu_items' }, (payload) => {
        setMenuItems(prev => {
          if (payload.eventType === 'INSERT') {
            const inserted = payload.new as MenuItem;
            return [...prev, { ...inserted, image_url: menuItemImageUrl(inserted) }];
          }
          if (payload.eventType === 'UPDATE') {
            const updated = payload.new as MenuItem;
            return prev.map(i => i.id === updated.id
              ? { ...i, ...updated, image_url: menuItemImageUrl({ ...i, ...updated }) }
              : i);
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

  const deliveryFee = fulfillmentMode === 'delivery' ? DELIVERY_FEE : 0;
  const total = subtotal + deliveryFee - discount - pointsUsed;
  const orderDisabled = !((fulfillmentMode === 'pickup' || address.trim().length > 5) && Object.keys(cart).length > 0) || ordering;

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
    try {
      const res = await fetch(`${API_BASE}/api/coupon/validate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ code, subtotal: sub })
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
    if (phoneVerified === false) {
      tg.showPopup(
        {
          title: "📱 Telefon raqamini tasdiqlang",
          message: "Buyurtma berishdan oldin botga o'tib, Telegram so'rovi orqali o'z telefon raqamingizni ulashing.",
          buttons: [{ id: "share-phone", type: "default", text: "Botga o'tish" }]
        },
        (buttonId) => {
          if (buttonId === "share-phone") {
            tg.openTelegramLink("https://t.me/foood_city_official_bot?start=share_phone");
          }
        }
      );
      return;
    }

    tg.HapticFeedback.impactOccurred('heavy');
    setOrdering(true);

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
    const delivery_fee = fulfillmentMode === 'delivery' ? DELIVERY_FEE : 0;

    const payload = {
      items,
      subtotal: sub,
      delivery_fee,
      discount: disc,
      loyalty_points_used: ptsUsed,
      total: Math.trunc(sub + delivery_fee - disc - ptsUsed),
      coupon_code: appliedCoupon ? appliedCoupon.code : null,
      delivery_address: fulfillmentMode === 'pickup' ? t('pickupDetails', lang) : address,
      fulfillment_mode: fulfillmentMode,
      note,
      language: lang,
      payment_method: paymentMethod
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
        return;
      }

      if (response.status === 428) {
        setPhoneVerified(false);
        tg.showPopup(
          {
            title: "📱 Telefon raqamini tasdiqlang",
            message: "Buyurtma berish uchun botdagi so'rov orqali o'z telefon raqamingizni ulashing.",
            buttons: [{ id: "share-phone", type: "default", text: "Botga o'tish" }]
          },
          (buttonId) => {
            if (buttonId === "share-phone") {
              tg.openTelegramLink("https://t.me/foood_city_official_bot?start=share_phone");
            }
          }
        );
        setOrdering(false);
        return;
      }

      const result: { success?: boolean; error?: string; order?: { id: string; points_earned?: number } } = await response.json();
      if (response.ok && result.success && result.order) {
        createConfetti();
        setCart({});
        setOrdering(false);
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
      const res = await fetch(`${API_BASE}/api/order/${cleanId}/status`, { headers: authHeaders() });
      if (!res.ok) return;
      const data: {
        status?: OrderStatus; error?: string;
        payment_method?: 'cash' | 'card_transfer'; payment_status?: 'pending' | 'paid' | 'rejected';
        payment_receipt_url?: string | null; total?: number;
      } = await res.json();
      if (!data || data.error || !data.status) return;
      setTrackingStatus(data.status);
      setTrackingPayment({
        method: data.payment_method || 'cash',
        status: data.payment_status || 'pending',
        receiptUrl: data.payment_receipt_url || null,
        total: data.total || 0
      });
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
    setTrackingPayment(null);
    setShowRating(false);
    setPage('tracking');
    window.scrollTo(0, 0);
    if (trackingInterval.current) clearInterval(trackingInterval.current);
    updateTracking(cleanId);
    trackingInterval.current = setInterval(() => updateTracking(cleanId), 10000);
  }

  useEffect(() => () => { if (trackingInterval.current) clearInterval(trackingInterval.current); }, []);

  useEffect(() => {
    if (paymentMethod === 'card_transfer' || trackingPayment?.method === 'card_transfer') {
      void loadPaymentInfo();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paymentMethod, trackingPayment?.method]);

  // TO'LOV: karta rekvizitlari va chek yuklash
  async function loadPaymentInfo(): Promise<void> {
    setPaymentInfoLoading(true);
    setPaymentInfoError('');
    try {
      const res = await fetch(`${API_BASE}/api/payment-info`, { headers: authHeaders() });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const info: { card_number?: string; card_holder?: string } = await res.json();
      setPaymentInfo({
        card_number: info.card_number || '',
        card_holder: info.card_holder || '',
      });
    } catch (e) {
      console.error('Payment info error:', e);
      setPaymentInfoError("Karta ma'lumotlarini yuklab bo'lmadi. Internetni tekshirib, qayta urinib ko'ring.");
    } finally {
      setPaymentInfoLoading(false);
    }
  }

  async function copyCardNumber(): Promise<void> {
    if (!paymentInfo?.card_number) return;
    const digits = paymentInfo.card_number.replace(/\D/g, '');
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(digits);
      } else {
        const temporaryInput = document.createElement('textarea');
        temporaryInput.value = digits;
        temporaryInput.style.position = 'fixed';
        temporaryInput.style.opacity = '0';
        document.body.appendChild(temporaryInput);
        temporaryInput.select();
        const copied = document.execCommand('copy');
        temporaryInput.remove();
        if (!copied) throw new Error('Clipboard access is unavailable');
      }
      showToast('📋 Karta raqami nusxalandi');
    } catch (e) {
      console.error('Card number copy failed:', e);
      showToast("❌ Karta raqamini nusxalab bo'lmadi");
    }
  }

  async function uploadReceipt(file: File): Promise<void> {
    if (!trackingId) return;
    if (!file.type.startsWith('image/')) { showToast("❌ Faqat rasm yuklang"); return; }
    if (file.size > 8 * 1024 * 1024) { showToast("❌ Rasm 8 MB dan katta"); return; }
    setReceiptUploading(true);
    try {
      const form = new FormData();
      form.append('receipt', file);
      const res = await fetch(`${API_BASE}/api/order/${trackingId}/payment-receipt`, {
        method: 'POST', headers: authHeaders(), body: form
      });
      const data: { success?: boolean; error?: string } = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || 'Yuklanmadi');
      showToast("✅ Chek yuborildi, admin tekshiradi");
      updateTracking(trackingId);
    } catch (e) {
      showToast("❌ " + ((e instanceof Error && e.message) || "Chek yuborilmadi"));
    } finally {
      setReceiptUploading(false);
    }
  }

  async function rateOrder(rating: number): Promise<void> {
    try {
      const res = await fetch(`${API_BASE}/api/order/${trackingId}/rate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ rating })
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      showToast("⭐ Bahoyingiz uchun rahmat!");
      setShowRating(false);
    } catch (e) {
      console.error('Rate error:', e);
      showToast("❌ Bahoni yuborib bo'lmadi, qayta urinib ko'ring");
    }
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

  async function confirmOrderCancellation(): Promise<void> {
    if (!cancelOrderId || cancellingOrderId) return;
    const orderId = cancelOrderId.replace(/^#/, '');
    setCancellingOrderId(orderId);
    try {
      const response = await fetch(`${API_BASE}/api/user/orders/${encodeURIComponent(orderId)}/cancel`, {
        method: 'POST',
        headers: authHeaders(),
      });
      const result: { error?: string; success?: boolean } = await response.json();
      if (response.status === 409) throw new Error(t('cancelNotAllowed', lang));
      if (!response.ok || !result.success) throw new Error(result.error || t('loadFailed', lang));
      setCancelOrderId(null);
      showToast(`✅ ${t('cancelSuccess', lang)}`);
      await fetchOrders();
      loadProfile();
    } catch (error) {
      console.error('Order cancellation failed:', error);
      showToast(error instanceof Error ? error.message : t('loadFailed', lang));
    } finally {
      setCancellingOrderId(null);
    }
  }

  // PROFILE
  async function loadProfile(): Promise<void> {
    const telegramUser = tg.initDataUnsafe?.user;
    const userId = telegramUser?.id || user?.id;
    if (userId && userId !== 111111) {
      try {
        const response = await fetch(`${API_BASE}/api/user/profile`, { headers: authHeaders() });
        if (!response.ok) throw new Error(`Profil API xatosi (${response.status})`);
        const data: {
          loyalty_points?: number;
          total_orders?: number;
          total_spent?: number;
          phone_verified?: boolean;
          phone_number?: string | null;
        } = await response.json();
        setProfile({
          points: data.loyalty_points || 0,
          orders: data.total_orders || 0,
          spent: data.total_spent || 0
        });
        setUserPoints(data.loyalty_points || 0);
        setPhoneVerified(data.phone_verified === true);
        setPhoneNumber(data.phone_verified ? data.phone_number || null : null);
      } catch (error) {
        console.error('Profile load failed:', error);
      }
    }
  }

  function changeLang(e: React.ChangeEvent<HTMLSelectElement>): void {
    const selected = e.currentTarget.value;
    if (selected !== 'uz' && selected !== 'ru' && selected !== 'en') return;
    localStorage.setItem('lang', selected);
    window.location.reload();
  }

  function selectAvatar(id: string): void {
    saveAvatar(id);
    localStorage.setItem('foodcity-profile-photo', 'avatar');
    setUseTelegramPhoto(false);
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
  const stories = promotions.filter(promotion => promotion.kind === 'story');
  const banners = promotions.filter(promotion => promotion.kind === 'banner');
  const visibleBanner = banners.length ? banners[activeBannerIndex % banners.length] : null;
  const changeBanner = (index: number, direction: 'next' | 'previous') => {
    setBannerDirection(direction);
    setActiveBannerIndex((index + banners.length) % banners.length);
  };
  const localizedPromotion = (promotion: Promotion, field: 'title' | 'subtitle'): string => {
    const value = promotion[`${field}_${lang}` as 'title_uz' | 'title_ru' | 'title_en' | 'subtitle_uz' | 'subtitle_ru' | 'subtitle_en'];
    return value || promotion[`${field}_uz` as 'title_uz' | 'title_ru' | 'title_en' | 'subtitle_uz' | 'subtitle_ru' | 'subtitle_en'] || '';
  };

  useEffect(() => {
    if (banners.length < 2) return;
    const timer = setInterval(() => {
      setBannerDirection('next');
      setActiveBannerIndex(index => (index + 1) % banners.length);
    }, 3000);
    return () => clearInterval(timer);
  }, [banners.length]);

  useEffect(() => {
    if (activeBannerIndex >= banners.length) setActiveBannerIndex(0);
  }, [activeBannerIndex, banners.length]);

  useEffect(() => {
    if (selectedStoryIndex === null) return;
    const timer = setTimeout(() => {
      setSelectedStoryIndex(index => {
        if (index === null || index + 1 >= stories.length) return null;
        return index + 1;
      });
    }, 5000);
    return () => clearTimeout(timer);
  }, [selectedStoryIndex, stories.length]);

  useEffect(() => {
    if (!selectedProduct && selectedStoryIndex === null && !showMenuDrawer) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setSelectedProduct(null);
        setSelectedStoryIndex(null);
        setShowMenuDrawer(false);
      }
    };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [selectedProduct, selectedStoryIndex, showMenuDrawer]);

  const orderStatusMap: Record<string, { label: string; color: string }> = {
    'new': { label: `🆕 ${t('statusNew', lang)}`, color: '#FFB800' },
    'confirmed': { label: `✅ ${t('statusConfirmed', lang)}`, color: '#00C853' },
    'cooking': { label: `👨‍🍳 ${t('statusCooking', lang)}`, color: '#FF6B00' },
    'delivering': { label: `🛵 ${t('statusDelivering', lang)}`, color: '#2196F3' },
    'delivered': { label: `✅ ${t('statusDelivered', lang)}`, color: '#00C853' },
    'cancelled': { label: `❌ ${t('statusCancelled', lang)}`, color: '#E8001C' }
  };

  function renderCardAction(i: MenuItem) {
    const qty = cart[i.id]?.qty || 0;
    if (!i.is_available) {
      return <div style={{ color: 'var(--primary)', fontSize: 11, fontWeight: 900 }}>Mavjud emas</div>;
    }
    if (qty === 0) {
      return <button className="btn-add" onClick={event => { event.stopPropagation(); addCart(i.id); }}>+</button>;
    }
    return (
      <div className="qty-controls" onClick={event => event.stopPropagation()}>
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

      {showMenuDrawer && (
        <div className="app-drawer-backdrop" onClick={() => setShowMenuDrawer(false)}>
          <section className="app-drawer" role="dialog" aria-modal="true" aria-label="Ilova menyusi"
            onClick={event => event.stopPropagation()}>
            <header className="app-drawer-header">
              <h2>{t('drawerTitle', lang)}</h2>
              <button onClick={() => setShowMenuDrawer(false)} aria-label="Menyuni yopish"><X size={24} /></button>
            </header>
            <nav className="app-drawer-links">
              <button onClick={() => { nav('menu'); setShowMenuDrawer(false); }}><Home /><span>{t('home', lang)}</span></button>
              <button onClick={() => {
                setShowMenuDrawer(false);
                document.querySelector('.hero-banner')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
              }}><Tag /><span>{t('promotions', lang)}</span></button>
              <button onClick={() => { nav('orders'); setShowMenuDrawer(false); }}><Bell /><span>{t('myOrders', lang)}</span></button>
              <button onClick={() => { nav('cart'); setShowMenuDrawer(false); }}><Truck /><span>{t('deliveryCart', lang)}</span></button>
              <button onClick={() => { nav('contact'); setShowMenuDrawer(false); }}><Mail /><span>{t('contact', lang)}</span></button>
              <button onClick={() => { nav('profile'); setShowMenuDrawer(false); }}><Info /><span>{t('profileSettings', lang)}</span></button>
              <div className="drawer-setting-row">
                <Languages />
                <span>{t('language', lang)}</span>
                <select value={lang} onChange={changeLang} aria-label="Ilova tili">
                  <option value="uz">O‘zbekcha</option>
                  <option value="ru">Русский</option>
                  <option value="en">English</option>
                </select>
              </div>
              <div className="drawer-setting-row drawer-theme-row">
                {theme === 'dark' ? <Sun /> : <Moon />}
                <span>{t('appearance', lang)}</span>
                <button type="button" className="drawer-theme-toggle" onClick={() => setTheme(current => current === 'dark' ? 'light' : 'dark')}>
                  {t(theme === 'dark' ? 'lightMode' : 'darkMode', lang)}
                </button>
              </div>
              <div className="drawer-setting-row drawer-contact"><Headset /><a href="tel:+998946719009">+998 94 671-90-09</a></div>
            </nav>
          </section>
        </div>
      )}

      {/* MENU PAGE */}
      <div id="page-menu" className={`page menu-page${page === 'menu' ? ' active' : ''}`}>
        <div className="header">
          <div className="header-top">
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <button className="header-profile-btn" type="button" onClick={() => nav('profile')} aria-label="Profilni ochish">
                {telegramPhoto
                  ? <img src={telegramPhoto} alt="" referrerPolicy="no-referrer" />
                  : <span className="header-avatar-emoji" aria-hidden="true">{avatar.emoji}</span>}
              </button>
              <div className="brand">🍔 FOOOD CITY</div>
            </div>
            <div className="header-actions">
              <button className={`cart-icon-btn${cartBump ? ' bump' : ''}`} type="button" onClick={() => nav('cart')} aria-label={`Savatchani ochish${cartCount > 0 ? `, ${cartCount} mahsulot` : ''}`}>
                <ShoppingCart aria-hidden="true" />
                {cartCount > 0 && (
                <span className="badge">{cartCount}</span>
              )}
              </button>
              <button className="menu-profile-btn" type="button" onClick={() => setShowMenuDrawer(true)} aria-label="Ilova menyusini ochish"><MenuIcon aria-hidden="true" /></button>
            </div>
          </div>
          <FulfillmentSelector mode={fulfillmentMode} onChange={setFulfillmentMode} />
        </div>

        {stories.length > 0 && (
          <section className="stories-section" aria-label="Stories">
            <div className="section-kicker">YANGILIKLAR</div>
            <div className="stories-row">
              {stories.map((story, index) => (
                <button className="story-item" key={story.id} onClick={() => setSelectedStoryIndex(index)}>
                  <span className="story-ring"><img src={story.image_url} alt="" loading="lazy" /></span>
                  <span>{localizedPromotion(story, 'title')}</span>
                </button>
              ))}
            </div>
          </section>
        )}

        <section className="hero-banner" aria-label="Aksiyalar">
          {visibleBanner ? (
            <button key={visibleBanner.id} className={`hero-banner-image slide-${bannerDirection}`}
              onTouchStart={event => { bannerTouchStart.current = event.changedTouches[0]?.clientX ?? null; }}
              onTouchEnd={event => {
                const startX = bannerTouchStart.current;
                bannerTouchStart.current = null;
                if (startX === null || banners.length < 2) return;
                const deltaX = event.changedTouches[0]?.clientX - startX;
                if (deltaX < -45) {
                  event.preventDefault();
                  changeBanner(activeBannerIndex + 1, 'next');
                } else if (deltaX > 45) {
                  event.preventDefault();
                  changeBanner(activeBannerIndex - 1, 'previous');
                }
              }}
              onClick={() => {
              if (visibleBanner.link_url) window.open(visibleBanner.link_url, '_blank', 'noopener,noreferrer');
            }} style={{ backgroundImage: `url("${visibleBanner.image_url}")` }}
              aria-label={localizedPromotion(visibleBanner, 'title')}>
              {(localizedPromotion(visibleBanner, 'title') || localizedPromotion(visibleBanner, 'subtitle')) && (
                <span className="banner-caption">
                  <strong>{localizedPromotion(visibleBanner, 'title')}</strong>
                  <small>{localizedPromotion(visibleBanner, 'subtitle')}</small>
                </span>
              )}
            </button>
          ) : (
            <div className="hero-banner-fallback">
              <div><span>BUGUNGI TANLOV</span><strong>Ta’mi yodda qoladigan<br />lahzalar shu yerdan boshlanadi</strong></div>
              <span className="fallback-emoji">🍔</span>
            </div>
          )}
          {banners.length > 1 && (
            <div className="banner-dots" aria-label="Banner tanlash">
              {banners.map((banner, index) => (
                <button key={banner.id} className={index === activeBannerIndex % banners.length ? 'active' : ''}
                  onClick={() => changeBanner(index, index > activeBannerIndex ? 'next' : 'previous')}
                  aria-label={`${index + 1}-banner`} aria-current={index === activeBannerIndex % banners.length ? 'true' : undefined} />
              ))}
            </div>
          )}
        </section>

        <div className="search-container">
          <span className="search-icon">🔍</span>
          <input type="text" className="search-bar" placeholder={strings[lang].search}
            value={search} onChange={e => setSearch(e.target.value)} />
        </div>

        <div className="tabs">
          <div className={`tab${currentCat === 'all' ? ' active' : ''}`} onClick={() => setCat('all')}>{t('allCategories', lang)}</div>
          {categories.map(c => (
            <div key={c.id} className={`tab${currentCat === c.id ? ' active' : ''}`} onClick={() => setCat(c.id)}>
              {c.emoji || ''} {(c[`name_${lang}`] as string | undefined) || c.name_uz}
            </div>
          ))}
        </div>

        <section className="menu-results">
          <h2>{currentCat === 'all' ? t('menuTitle', lang) : (categories.find(category => category.id === currentCat)?.[`name_${lang}` as 'name_uz' | 'name_ru' | 'name_en'] || categories.find(category => category.id === currentCat)?.name_uz)}</h2>
          {menuError ? (
            <div className="menu-load-state error-state" role="alert">
              <strong>{t('menuUnavailable', lang)}</strong>
              <span>{menuError}</span>
              <button onClick={() => void loadMenu()}>{t('retry', lang)}</button>
            </div>
          ) : menuLoading ? (
            <div className="menu-load-state">{t('menuLoading', lang)}</div>
          ) : filteredMenu.length === 0 ? (
            <div className="menu-load-state">{t('emptyCategory', lang)}</div>
          ) : null}
          <div className="menu-grid" style={{ paddingBottom: cartCount > 0 ? 150 : 90 }}>
          {!menuError && !menuLoading && filteredMenu.map(i => (
            <div className="card" key={i.id} onClick={() => setSelectedProduct(i)}>
              <button className="card-media" onClick={() => setSelectedProduct(i)} aria-label={`${nameFor(i)} tafsilotlarini ochish`}>
                <div className="card-top">
                  {i.image_url
                    ? <img src={i.image_url} className="card-img" alt="" loading="lazy" />
                    : <div className="card-placeholder" style={{ background: gradFor(i) }}>{i.emoji || '🍔'}</div>}
                  {i.badge && <div className="card-badge">{i.badge}</div>}
                </div>
              </button>
              <button className="card-fav" aria-label={wishlist.includes(i.id) ? 'Saqlanganlardan olib tashlash' : 'Saqlanganlarga qo‘shish'}
                onClick={event => { event.stopPropagation(); toggleFav(i.id); }}>
                {wishlist.includes(i.id) ? '❤️' : '🤍'}
              </button>
              <div className="card-body">
                <button className="card-info" onClick={() => setSelectedProduct(i)} aria-label={`${nameFor(i)} tafsilotlarini ochish`}>
                  <div className="card-title">{nameFor(i)}</div>
                  <div className="card-desc">{(i[`description_${lang}`] as string | undefined) || ''}</div>
                </button>
                <div className="card-footer">
                  <div className="card-price">{i.price.toLocaleString()} so'm</div>
                  {renderCardAction(i)}
                </div>
              </div>
            </div>
          ))}
          </div>
        </section>
      </div>

      {/* CART PAGE */}
      <div id="page-cart" className={`page${page === 'cart' ? ' active' : ''}`} style={{ paddingBottom: 160 }}>
        <div className="header" style={{ marginBottom: 20, paddingBottom: 20 }}>
          <div className="header-top">
            <div className="brand" onClick={() => nav('menu')} style={{ cursor: 'pointer' }}>← 🛒 {t('cartTitle', lang)}</div>
          </div>
        </div>

        <FulfillmentSelector mode={fulfillmentMode} onChange={setFulfillmentMode} variant="cart" />
        <div className="cart-list">
          {cartValues.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '80px 20px', color: 'var(--text2)', fontWeight: 700 }}>{t('emptyCart', lang)} 🛒</div>
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
              <input type="text" className="promo-input" placeholder={t('promoCode', lang)}
                value={couponCode} onChange={e => setCouponCode(e.target.value)} />
              <button className="promo-btn" onClick={applyCoupon}>{t('apply', lang)}</button>
            </div>
            <p style={{ fontSize: 12, marginTop: -15, marginBottom: 15, color: couponMsg.color || undefined }}>{couponMsg.text}</p>

            {userPoints > 0 && (
              <div style={{ background: 'rgba(255,184,0,0.1)', padding: 12, borderRadius: 16, marginBottom: 20 }}>
                <p style={{ fontSize: 14, marginBottom: 8 }}>💎 {t('balance', lang)}: <span>{userPoints}</span> {t('pointsLabel', lang)}</p>
                <label style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 14, fontWeight: 700 }}>
                  <input type="checkbox" checked={usePoints} onChange={e => setUsePoints(e.target.checked)} /> {t('redeemPoints', lang)}
                </label>
              </div>
            )}

            {fulfillmentMode === 'delivery' ? (
              <div className="address-section">
                <div className="address-label">📍 {t('deliveryAddress', lang)} *</div>
                <button className="btn-location" onClick={requestLocation}>{t('shareLocation', lang)}</button>
                <input type="text" id="address-input" className="promo-input" placeholder={t('addressPlaceholder', lang)}
                  value={address} disabled={addressDisabled} onChange={e => setAddress(e.target.value)} />
              </div>
            ) : (
              <div className="pickup-confirmation"><Store aria-hidden="true" /><span>{t('pickupDetails', lang)}</span></div>
            )}

            <div className="payment-section">
              <div className="address-label">💳 {t('paymentMethod', lang)}</div>
              <div className="payment-options">
                <button type="button"
                  className={`payment-option${paymentMethod === 'cash' ? ' active' : ''}`}
                  onClick={() => setPaymentMethod('cash')}>
                  <span className="payment-option-icon">💵</span>
                  <span className="payment-option-title">{t('cash', lang)}</span>
                  <span className="payment-option-sub">{t('cashDelivery', lang)}</span>
                </button>
                <button type="button"
                  className={`payment-option${paymentMethod === 'card_transfer' ? ' active' : ''}`}
                  onClick={() => setPaymentMethod('card_transfer')}>
                  <span className="payment-option-icon">💳</span>
                  <span className="payment-option-title">{t('cardTransfer', lang)}</span>
                  <span className="payment-option-sub">{t('transferReceipt', lang)}</span>
                </button>
              </div>
              {paymentMethod === 'card_transfer' && (
                <div className="payment-card-panel">
                  <p className="payment-hint">
                    Buyurtma bergach, jami summani quyidagi kartaga o'tkazing va chekni buyurtma holati oynasidan yuboring.
                  </p>
                  {paymentInfoLoading && <div className="payment-card-message">⏳ Karta ma'lumotlari yuklanmoqda...</div>}
                  {!paymentInfoLoading && paymentInfoError && (
                    <div className="payment-card-message payment-card-error">
                      {paymentInfoError}
                      <button type="button" className="payment-retry" onClick={() => void loadPaymentInfo()}>
                        Qayta urinish
                      </button>
                    </div>
                  )}
                  {!paymentInfoLoading && !paymentInfoError && paymentInfo?.card_number && (
                    <div className="payment-card">
                      <div className="payment-card-brand">FOOD CITY <span>VISA / HUMO</span></div>
                      <div className="payment-card-number">{paymentInfo.card_number}</div>
                      <div className="payment-card-footer">
                        <span>{paymentInfo.card_holder || 'KARTA EGASI'}</span>
                        <button type="button" className="payment-copy" onClick={() => void copyCardNumber()}>
                          📋 Nusxalash
                        </button>
                      </div>
                    </div>
                  )}
                  {!paymentInfoLoading && !paymentInfoError && !paymentInfo?.card_number && (
                    <div className="payment-card-message payment-card-error">
                      Karta raqami hozircha mavjud emas. Iltimos, do'kon bilan bog'laning.
                    </div>
                  )}
                </div>
              )}
            </div>

            <div style={{ marginBottom: 20 }}>
              <input type="text" className="promo-input" style={{ width: '100%' }} placeholder={t('orderNote', lang)}
                value={note} onChange={e => setNote(e.target.value)} />
            </div>

            <div className="summary-card-new">
              <div className="summary-row"><span>{t('products', lang)}</span><span>{subtotal.toLocaleString()} so'm</span></div>
              <div className="summary-row"><span>{fulfillmentMode === 'pickup' ? t('pickup', lang) : t('deliveryFee', lang)}</span><span>{deliveryFee.toLocaleString()} so'm</span></div>
              {appliedCoupon && (
                <div className="summary-row" style={{ color: 'var(--success)' }}><span>Chegirma</span><span>-{discount.toLocaleString()} so'm</span></div>
              )}
              {usePoints && (
                <div className="summary-row" style={{ color: 'var(--accent)' }}><span>Ballar</span><span>-{pointsUsed.toLocaleString()} so'm</span></div>
              )}
              <div className="summary-total">
                <span>{t('total', lang)}:</span>
                <span className="total-golden">{total.toLocaleString()} so'm</span>
              </div>
            </div>

            <button className="btn-order" onClick={placeOrder} disabled={orderDisabled}>{ordering ? t('sending', lang) : t('placeOrder', lang)}</button>
          </div>
        )}
      </div>

      {/* ORDERS PAGE */}
      <div id="page-orders" className={`page${page === 'orders' ? ' active' : ''}`}>
        <h2 className="page-heading">{t('ordersTitle', lang)}</h2>
        <div id="orders-list">
          {orders === null && <div className="orders-message">⏳ {t('loading', lang)}</div>}
          {orders === 'no-auth' && <div className="orders-message">⚠️ {t('telegramLogin', lang)}</div>}
          {orders === 'error' && (
            <div className="orders-message">
              <div style={{ fontSize: 48, marginBottom: 12 }}>📦</div>
              <div className="orders-error">{t('loadFailed', lang)}</div>
              <button onClick={fetchOrders}
                className="orders-retry">
                🔄 {t('retry', lang)}
              </button>
            </div>
          )}
          {Array.isArray(orders) && orders.length === 0 && (
            <div className="orders-message empty-orders">
              <div style={{ fontSize: 64, marginBottom: 16 }}>📦</div>
              <div className="empty-orders-title">{t('noOrders', lang)}</div>
              <div>{t('firstOrder', lang)}</div>
              <button onClick={() => nav('menu')}
                className="orders-retry">
                🍔 {t('menuCta', lang)}
              </button>
            </div>
          )}
          {Array.isArray(orders) && orders.map(order => {
            const status = orderStatusMap[order.status] || { label: order.status, color: '#FFD4A3' };
            const date = new Date(order.created_at).toLocaleDateString('uz-UZ', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
            const items = Array.isArray(order.items) ? order.items : [];
            return (
              <div key={order.id} className="order-card" onClick={() => showOrderTracking(order.id)}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                  <span className="order-card-id">#{order.id}</span>
                  <span style={{ fontSize: 12, fontWeight: 700, color: status.color, background: status.color + '22', padding: '4px 10px', borderRadius: 50 }}>
                    {status.label}
                  </span>
                </div>
                <div style={{ marginBottom: 10 }}>
                  {items.map((i, idx) => (
                    <div key={idx} className="order-card-item">• {i[`name_${lang}` as 'name_uz' | 'name_ru' | 'name_en'] || i.name_uz || i.name_ru || i.name || 'Taom'} ×{i.qty || 1}</div>
                  ))}
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 10, borderTop: '1px solid rgba(255,255,255,0.05)', paddingTop: 10 }}>
                  <span className="order-card-date">{date}</span>
                  <span className="order-card-total">{(order.total || 0).toLocaleString()} so'm</span>
                  <span className="order-card-status">{t('orderStatus', lang)} →</span>
                </div>
                {order.status === 'new' && (
                  <button className="order-cancel-button" type="button" disabled={cancellingOrderId === order.id}
                    onClick={event => { event.stopPropagation(); setCancelOrderId(order.id); }}>
                    {cancellingOrderId === order.id ? t('cancelling', lang) : t('cancelOrder', lang)}
                  </button>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* WISHLIST PAGE */}
      <div id="page-wishlist" className={`page${page === 'wishlist' ? ' active' : ''}`}>
        <h2 className="page-heading">❤️ {t('wishlistTitle', lang)}</h2>
        <div className="menu-grid">
          {menuItems.filter(i => wishlist.includes(i.id)).length === 0 && (
            <p style={{ gridColumn: '1/-1', textAlign: 'center', padding: 40, color: 'var(--text2)' }}>{t('emptyWishlist', lang)}</p>
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
            {telegramPhoto
              ? <img className="telegram-profile-photo" src={telegramPhoto} alt={`${fullName} profili`} referrerPolicy="no-referrer" />
              : <span className="avatar-emoji">{avatar.emoji}</span>}
            <div style={{ position: 'absolute', bottom: 2, right: 2, width: 24, height: 24, borderRadius: '50%', background: '#FF6B00', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, color: '#fff' }}>✏️</div>
          </div>
          <div style={{ fontSize: 20, fontWeight: 800, color: 'var(--text)' }}>{fullName}</div>
          <div style={{ color: 'var(--accent-text)', fontSize: 14, marginTop: 2 }}>{telegramUser?.username ? '@' + telegramUser.username : ''}</div>
          <div className="profile-phone">
            {phoneNumber
            ? <><span>{t('phoneShare', lang)}</span><strong>{phoneNumber}</strong><span className="phone-verified">{t('verifiedPhone', lang)}</span></>
              : phoneVerified
              ? <span className="phone-verified">{t('verifiedPhone', lang)}</span>
              : <><span>{t('phoneShare', lang)}</span><button type="button" onClick={() => tg.openTelegramLink('https://t.me/foood_city_official_bot?start=share_phone')}>{t('share', lang)}</button></>}
          </div>
        </div>

        <div className="summary-card">
          <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 4 }}>
            <div style={{ textAlign: 'center', flex: 1 }}>
              <div style={{ fontSize: 12, color: 'var(--text2)' }}>{t('profileOrders', lang)}</div>
              <div style={{ fontSize: 18, fontWeight: 900, color: 'var(--text)' }}>{profile.orders}</div>
            </div>
            <div style={{ textAlign: 'center', flex: 1 }}>
              <div style={{ fontSize: 12, color: 'var(--text2)' }}>{t('spent', lang)}</div>
              <div style={{ fontSize: 18, fontWeight: 900, color: 'var(--text)' }}>{profile.spent.toLocaleString()} so'm</div>
            </div>
          </div>
          <p style={{ marginTop: 16, color: 'var(--accent-text)', fontWeight: 800, textAlign: 'center' }}>💎 {profile.points} {t('pointsLabel', lang)}</p>
          <div style={{ height: 1, background: 'var(--border)', margin: '20px 0' }}></div>
          <p style={{ fontWeight: 700, marginBottom: 12, color: 'var(--text)' }}>{t('selectLanguage', lang)}:</p>
          <select className="promo-input" style={{ width: '100%' }} defaultValue={lang} onChange={changeLang}>
            <option value="uz">🇺🇿 O'zbekcha</option>
            <option value="ru">🇷🇺 Русский</option>
            <option value="en">🇬🇧 English</option>
          </select>
          <div className="theme-setting">
            <div>
              <strong>{t(theme === 'dark' ? 'darkMode' : 'lightMode', lang)}</strong>
              <span>{t('switchTheme', lang)}</span>
            </div>
            <button type="button" className="theme-toggle" onClick={() => setTheme(current => current === 'dark' ? 'light' : 'dark')}
              aria-label={t(theme === 'dark' ? 'lightMode' : 'darkMode', lang)} aria-pressed={theme === 'dark'}>
              {theme === 'dark' ? <Sun aria-hidden="true" /> : <Moon aria-hidden="true" />}
              <span>{t(theme === 'dark' ? 'lightMode' : 'darkMode', lang)}</span>
            </button>
          </div>
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
        <div id="page-tracking" className="page tracking-page active">
          <div className="tracking-header">
            <button type="button" className="tracking-back-button" aria-label="Buyurtmalarga qaytish" onClick={() => nav('orders')}>
              ←
            </button>
            <h2 className="tracking-title">Buyurtma holati</h2>
          </div>

          <div style={{ background: '#2D1500', borderRadius: 16, padding: 16, marginBottom: 16 }}>
            <div style={{ color: '#FFD4A3', fontSize: 13 }}>Buyurtma raqami</div>
            <div style={{ color: '#FFB800', fontSize: 22, fontWeight: 800 }}>#{trackingId}</div>
            <div>{trackingStatus === 'cancelled' && <span style={{ color: '#E8001C', fontWeight: 700 }}>❌ Bekor qilindi</span>}</div>
          </div>

          {trackingPayment && trackingStatus !== 'cancelled' && (
            <div style={{ background: '#2D1500', borderRadius: 16, padding: 16, marginBottom: 16 }}>
              <div style={{ color: '#FFD4A3', fontSize: 13, marginBottom: 6 }}>💳 To'lov</div>
              {trackingPayment.method === 'cash' ? (
                <div style={{ color: '#fff', fontWeight: 700 }}>
                  💵 Naqd pul — {trackingPayment.total.toLocaleString()} so'm yetkazilganda kuryerga beriladi
                </div>
              ) : trackingPayment.status === 'paid' ? (
                <div style={{ color: '#00C853', fontWeight: 700 }}>✅ To'lov qabul qilindi</div>
              ) : (
                <div>
                  <div style={{ color: '#fff', fontWeight: 700, marginBottom: 8 }}>
                    {trackingPayment.status === 'rejected'
                      ? "❌ Chek qabul qilinmadi. Iltimos, to'g'ri chekni qayta yuboring."
                      : trackingPayment.receiptUrl
                        ? "⏳ Chek yuborildi, admin tekshirmoqda..."
                        : `Quyidagi kartaga ${trackingPayment.total.toLocaleString()} so'm o'tkazing:`}
                  </div>
                  {(!trackingPayment.receiptUrl || trackingPayment.status === 'rejected') && (
                    <>
                      {paymentInfoLoading ? (
                        <div className="payment-card-message">⏳ Karta ma'lumotlari yuklanmoqda...</div>
                      ) : paymentInfo && paymentInfo.card_number ? (
                        <div className="payment-card">
                          <div className="payment-card-brand">FOOD CITY <span>VISA / HUMO</span></div>
                          <div className="payment-card-number">{paymentInfo.card_number}</div>
                          <div className="payment-card-footer">
                            <span>{paymentInfo.card_holder || 'KARTA EGASI'}</span>
                            <button type="button" className="payment-copy" onClick={() => void copyCardNumber()}>
                              📋 Nusxalash
                            </button>
                          </div>
                        </div>
                      ) : (
                        <div style={{ color: '#FFD4A3', fontSize: 13, marginBottom: 12 }}>
                          {paymentInfoError || "Karta raqami hali kiritilmagan. Iltimos, do'kon bilan bog'laning."}
                          {paymentInfoError && (
                            <button type="button" className="payment-retry" onClick={() => void loadPaymentInfo()}>
                              Qayta urinish
                            </button>
                          )}
                        </div>
                      )}
                      <button type="button" className="receipt-upload-button"
                        disabled={receiptUploading}
                        onClick={() => receiptInputRef.current?.click()}>
                        {receiptUploading ? '⏳ Yuklanmoqda...' : '📤 Chek (skrinshot) yuborish'}
                      </button>
                      <input
                        ref={receiptInputRef}
                        className="receipt-file-input"
                        type="file"
                        accept="image/*"
                        aria-label="To'lov chekini tanlash"
                        disabled={receiptUploading}
                        onChange={e => {
                          const input = e.currentTarget;
                          const file = input.files?.[0];
                          input.value = '';
                          if (file) void uploadReceipt(file);
                        }}
                      />
                    </>
                  )}
                </div>
              )}
            </div>
          )}

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
      <div id="page-contact" className={`page${page === 'contact' ? ' active' : ''}`}>
        <h2 className="page-heading">📞 {t('contactTitle', lang)}</h2>
        <div className="contact-intro card">
          <div className="card-body">
            <div className="contact-brand">🍔 FOOD CITY</div>
            <p>{t('contactIntro', lang)}</p>
            <span className="contact-hours">🕐 {t('openingHours', lang)}</span>
          </div>
        </div>
        <section className="contact-links" aria-label={t('contactTitle', lang)}>
          <a className="contact-link-card" href="tel:+998946719009">
            <span>☎️</span><span><strong>{t('orderByPhone', lang)}</strong><small>+998 94 671-90-09</small></span>
          </a>
          <a className="contact-link-card" href="tel:+998956729009">
            <span>📞</span><span><strong>{t('orderByPhone', lang)}</strong><small>+998 95 672-90-09</small></span>
          </a>
          <a className="contact-link-card" href="https://www.instagram.com/fooodcity_official/" target="_blank" rel="noopener noreferrer">
            <span>📸</span><span><strong>{t('instagram', lang)}</strong><small>@fooodcity_official</small></span>
          </a>
          <a className="contact-link-card" href="https://t.me/foood_city_official_bot" target="_blank" rel="noopener noreferrer">
            <span>✈️</span><span><strong>{t('telegram', lang)}</strong><small>@foood_city_official_bot</small></span>
          </a>
        </section>
        <section className="faq-section">
          <h3>{t('faq', lang)}</h3>
          <details><summary>{t('faqDeliveryQ', lang)}</summary><p>{t('faqDeliveryA', lang)}</p></details>
          <details><summary>{t('faqCancelQ', lang)}</summary><p>{t('faqCancelA', lang)}</p></details>
          <details><summary>{t('faqPaymentQ', lang)}</summary><p>{t('faqPaymentA', lang)}</p></details>
          <details><summary>{t('faqPickupQ', lang)}</summary><p>{t('faqPickupA', lang)}</p></details>
          <details><summary>{t('faqPhoneQ', lang)}</summary><p>{t('faqPhoneA', lang)}</p></details>
          <a href="tel:+998946719009">{t('faqMore', lang)}</a>
        </section>
      </div>

      {cancelOrderId && (
        <div className="cancel-confirm-backdrop" role="presentation"
          onClick={() => { if (!cancellingOrderId) setCancelOrderId(null); }}>
          <section className="cancel-confirm-card" role="dialog" aria-modal="true" aria-labelledby="cancel-confirm-title"
            onClick={event => event.stopPropagation()}>
            <h2 id="cancel-confirm-title">{t('confirmCancelTitle', lang)}</h2>
            <p>{t('confirmCancelBody', lang)}</p>
            <div>
              <button type="button" className="cancel-keep-button" disabled={!!cancellingOrderId} onClick={() => setCancelOrderId(null)}>
                {t('keepOrder', lang)}
              </button>
              <button type="button" className="cancel-confirm-button" disabled={!!cancellingOrderId} onClick={() => void confirmOrderCancellation()}>
                {cancellingOrderId ? t('cancelling', lang) : t('confirmCancel', lang)}
              </button>
            </div>
          </section>
        </div>
      )}

      {selectedProduct && (
        <div className="product-sheet-backdrop" onClick={() => setSelectedProduct(null)}>
          <section className="product-sheet" role="dialog" aria-modal="true" aria-label={nameFor(selectedProduct)}
            onClick={event => event.stopPropagation()}>
            <div className="product-sheet-image">
              {selectedProduct.image_url
                ? <img src={selectedProduct.image_url} alt={nameFor(selectedProduct)} />
                : <div style={{ background: gradFor(selectedProduct) }}>{selectedProduct.emoji || '🍽'}</div>}
              <button className="product-sheet-fav" onClick={() => toggleFav(selectedProduct.id)}
                aria-label={wishlist.includes(selectedProduct.id) ? 'Saqlanganlardan olib tashlash' : 'Saqlanganlarga qo‘shish'}>
                {wishlist.includes(selectedProduct.id) ? '❤️' : '♡'}
              </button>
              <button className="product-sheet-close" onClick={() => setSelectedProduct(null)} aria-label="Yopish">×</button>
            </div>
            <div className="product-sheet-content">
              <span className="product-sheet-category">{selectedProduct.categories?.emoji || '🍴'} {selectedProduct.categories?.[`name_${lang}` as 'name_uz' | 'name_ru' | 'name_en'] || selectedProduct.categories?.name_uz || 'Food City'}</span>
              <h2>{nameFor(selectedProduct)}</h2>
              <p>{(selectedProduct[`description_${lang}`] as string | undefined) || selectedProduct.description_uz || 'Yangi tayyorlangan, mazali taom.'}</p>
              {selectedProduct.is_available ? (
                <div className="product-sheet-bottom">
                  <div className="product-sheet-quantity">
                    <button onClick={() => updateQty(selectedProduct.id, -1)} disabled={!cart[selectedProduct.id]} aria-label="Miqdorni kamaytirish">−</button>
                    <span>{cart[selectedProduct.id]?.qty || 0}</span>
                    <button onClick={() => {
                      if (cart[selectedProduct.id]) updateQty(selectedProduct.id, 1);
                      else addCart(selectedProduct.id);
                    }} aria-label="Miqdorni oshirish">+</button>
                  </div>
                  <button className="product-sheet-add" onClick={() => {
                    if (!cart[selectedProduct.id]) addCart(selectedProduct.id);
                    setSelectedProduct(null);
                  }}>
                    Savatga · {((cart[selectedProduct.id]?.qty || 1) * selectedProduct.price).toLocaleString()} so‘m
                  </button>
                </div>
              ) : <div className="product-unavailable">Hozircha mavjud emas</div>}
            </div>
          </section>
        </div>
      )}

      {selectedStoryIndex !== null && stories[selectedStoryIndex] && (
        <div className="story-viewer" role="dialog" aria-modal="true" onClick={() => setSelectedStoryIndex(null)}>
          <div className="story-viewer-card" onClick={event => event.stopPropagation()}>
            <img src={stories[selectedStoryIndex].image_url} alt={localizedPromotion(stories[selectedStoryIndex], 'title')} />
            <div className="story-progress">
              {stories.map((story, index) => <span key={story.id} className={index <= selectedStoryIndex ? 'seen' : ''} />)}
            </div>
            <button className="story-viewer-close" onClick={() => setSelectedStoryIndex(null)} aria-label="Storyni yopish">×</button>
            {selectedStoryIndex > 0 && <button className="story-prev" onClick={() => setSelectedStoryIndex(index => index === null ? 0 : index - 1)} aria-label="Oldingi story">‹</button>}
            {selectedStoryIndex < stories.length - 1 && <button className="story-next" onClick={() => setSelectedStoryIndex(index => index === null ? 0 : index + 1)} aria-label="Keyingi story">›</button>}
            <div className="story-viewer-caption">
              <strong>{localizedPromotion(stories[selectedStoryIndex], 'title')}</strong>
              <span>{localizedPromotion(stories[selectedStoryIndex], 'subtitle')}</span>
            </div>
          </div>
        </div>
      )}

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
          { key: 'menu', icon: '🏠', label: t('navMenu', lang) },
          { key: 'orders', icon: '📦', label: t('navOrders', lang) },
          { key: 'wishlist', icon: '❤️', label: t('navSaved', lang) },
          { key: 'profile', icon: '👤', label: t('navProfile', lang) },
          { key: 'contact', icon: '📞', label: t('navContact', lang) }
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
              {tg.initDataUnsafe?.user?.photo_url && (
                <button type="button" className="telegram-photo-option" onClick={() => {
                  localStorage.removeItem('foodcity-profile-photo');
                  setUseTelegramPhoto(true);
                  setAvatarModalOpen(false);
                }}>
                  <img src={tg.initDataUnsafe.user.photo_url} alt="" referrerPolicy="no-referrer" />
                  {t('useTelegramPhoto', lang)}
                </button>
              )}
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

function FulfillmentSelector({ mode, onChange, variant }: {
  mode: FulfillmentMode;
  onChange: (mode: FulfillmentMode) => void;
  variant?: 'cart';
}) {
  return (
    <div className={`fulfillment-selector${variant === 'cart' ? ' cart-page-fulfillment' : ''}`} role="group" aria-label={t('delivery', lang)}>
      <button type="button" className={mode === 'delivery' ? 'active' : ''} aria-pressed={mode === 'delivery'} onClick={() => onChange('delivery')}>
        <Bike aria-hidden="true" /><span>{t('delivery', lang)}</span>
      </button>
      <button type="button" className={mode === 'pickup' ? 'active' : ''} aria-pressed={mode === 'pickup'} onClick={() => onChange('pickup')}>
        <Store aria-hidden="true" /><span>{t('pickup', lang)}</span>
      </button>
    </div>
  );
}
