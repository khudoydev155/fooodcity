# 🍔 Food City — Deploy Qo'llanmasi (To'liq)

Bu hujjat loyihani **noldan** to'liq ishga tushirish bo'yicha bosqichma-bosqich qo'llanma. Ketma-ketlikni buzmasdan bajaring.

---

## 📐 Arxitektura — 3 ta mustaqil qism

Loyiha uchta alohida bo'lakdan iborat, ular bir-biri bilan URL orqali bog'lanadi:

| Qism | Nima | Qayerda ishlaydi |
|------|------|------------------|
| **1. Ma'lumotlar bazasi** | PostgreSQL + Storage + Realtime | Supabase |
| **2. Backend (API + bot)** | Python/aiogram, REST API va Telegram webhook | Railway (Docker) |
| **3. Frontend** | React + TypeScript (mijoz + admin) | Vercel yoki Netlify (statik) |

> **Muhim:** Backend frontendni o'z ichida tarqatmaydi. Frontend alohida statik hosting'ga chiqariladi. Ular bir-birini faqat URL orqali topadi.

**Bog'lanish sxemasi:**
```
Foydalanuvchi (Telegram)
      │
      ▼
Frontend (Vercel)  ──API so'rovlari──►  Backend (Railway)  ──►  Supabase (DB)
   index.html                              REST API
   admin.html                              Telegram webhook
```

---

## ✅ Boshlashdan oldin kerak bo'ladi

- [ ] Telegram hisobi (bot yaratish uchun)
- [ ] [Supabase](https://supabase.com) hisobi (bepul)
- [ ] [Railway](https://railway.app) hisobi (backend uchun)
- [ ] [Vercel](https://vercel.com) yoki [Netlify](https://netlify.com) hisobi (frontend uchun)
- [ ] GitHub hisobi (kodni Railway/Vercel'ga ulash uchun)
- [ ] Kompyuterda o'rnatilgan: **Node.js 18+** va **Git**

---

## 1️⃣ QADAM — Supabase (ma'lumotlar bazasi)

### 1.1. Loyiha yaratish
1. [supabase.com](https://supabase.com) → **New Project**.
2. Nom, kuchli **database parol** (saqlab qo'ying) va region tanlang.
3. Loyiha tayyor bo'lguncha ~2 daqiqa kuting.

### 1.2. SQL skriptlarni ISHGA TUSHIRISH (ketma-ketlik muhim!)
**Supabase Dashboard → SQL Editor → New query** oynasida quyidagi fayllarni **shu tartibda** birma-bir joylashtirib **Run** bosing:

| № | Fayl | Vazifasi |
|---|------|----------|
| 1 | `supabase/schema.sql` | Jadvallarni yaratadi (users, orders, menu_items...) |
| 2 | `supabase/migrations/001_phase1_foundation.sql` | Kategoriya/kod tizimi, triggerlar |
| 3 | `supabase/rls_policies.sql` | Xavfsizlik siyosatlari (RLS) |
| 4 | `supabase/migrations/002_order_atomic_and_rating.sql` | ⚠️ **Buyurtma tranzaksiyasi + baholash** (yangi, majburiy!) |
| 5 | `supabase/seed.sql` | Namuna taomlar (ixtiyoriy — test uchun) |

> ⚠️ **002 migratsiyani albatta bajaring.** Busiz buyurtma berish, ball hisoblash va baholash ishlamaydi.

### 1.3. Storage bucket yaratish (taom rasmlari uchun)
1. **Storage → New bucket**.
2. Nom: `menu-images` (aynan shunday).
3. **Public bucket** belgisini **yoqing** (rasmlar hammaga ko'rinishi uchun).

### 1.4. Realtime yoqish (menyu jonli yangilanishi uchun)
1. **Database → Replication** (yoki **Realtime**).
2. `menu_items` jadvalini toping va Realtime'ni **yoqing**.

### 1.5. Kalitlarni nusxalash
**Project Settings → API** bo'limidan quyidagilarni yozib oling — keyingi qadamlarda kerak:
- **Project URL** — `https://xxxxx.supabase.co`
- **anon public** kaliti — `eyJ...` (frontendda ishlatiladi, ochiq)
- **service_role** kaliti — `eyJ...` (⚠️ **maxfiy!** faqat backendda)

---

## 2️⃣ QADAM — Telegram bot yaratish

1. Telegramda [@BotFather](https://t.me/BotFather) ni oching.
2. `/newbot` → nom va username bering → **BOT_TOKEN** ni oling (`123456:ABC...`).
3. `/setdomain` → botni tanlang → frontend domeningizni kiriting (masalan `your-app.vercel.app`).
   - Bu **admin panelidagi Telegram Login** ishlashi uchun majburiy.
4. O'zingizning **Telegram ID** raqamingizni oling ([@userinfobot](https://t.me/userinfobot) orqali) — bu superadmin bo'ladi.

---

## 3️⃣ QADAM — Backend (Railway)

### 3.1. Kodni GitHub'ga yuklash
Agar hali qilmagan bo'lsangiz, loyihani GitHub repozitoriysiga push qiling.

### 3.2. Railway loyihasi
1. [railway.app](https://railway.app) → **New Project → Deploy from GitHub repo** → repozitoriyangizni tanlang.
2. Railway `Dockerfile` ni avtomatik topadi va build qiladi.

### 3.3. Muhit o'zgaruvchilari (.env / Variables)
Railway'da **Variables** bo'limiga quyidagilarni kiriting:

```env
# ── Asosiy ──
BOT_TOKEN=123456:ABC...                    # BotFather bergan token
SUPABASE_URL=https://xxxxx.supabase.co     # 1.5-qadam
SUPABASE_SERVICE_KEY=eyJ...                # service_role (MAXFIY!)
SUPABASE_ANON_KEY=eyJ...                   # anon public

# ── URL manzillar ──
MINI_APP_URL=https://your-app.vercel.app/index.html
ADMIN_PANEL_URL=https://your-app.vercel.app/admin.html
WEBHOOK_URL=https://your-backend.up.railway.app   # Railway bergan domen

# ── Xavfsizlik ──
WEBHOOK_SECRET=<tasodifiy_uzun_maxfiy_satr>       # masalan: openssl rand -hex 16
ADMIN_PIN=<6_xonali_maxfiy_pin>                   # ⚠️ "123456" QOLDIRMANG! (pastga qarang)

# ── Adminlar ──
ADMIN_CHAT_ID=123456789                            # Sizning Telegram ID
SUPERADMIN_IDS=[123456789]                          # JSON ro'yxat: [id1, id2]
```

> ⚠️ **ADMIN_PIN haqida muhim ogohlantirish:** Agar `ADMIN_PIN` ni o'rnatmasangiz yoki `123456` qoldirsangiz, xavfsizlik uchun **PIN orqali kirish avtomatik o'chiriladi** (faqat Telegram login ishlaydi). Real 6 xonali maxfiy kod kiriting.

### 3.4. Backend domenini olish
Railway → **Settings → Networking → Generate Domain**. Chiqgan URL (masalan `https://foodcity-production.up.railway.app`) — bu sizning **API_BASE** manzilingiz. Yozib oling.

### 3.5. Telegram webhook o'rnatish
Backend ishga tushgach, brauzerda quyidagi manzilni oching (o'zingiznikini qo'ying):
```
https://api.telegram.org/bot<BOT_TOKEN>/setWebhook?url=https://<BACKEND_DOMEN>/webhook/<WEBHOOK_SECRET>&secret_token=<WEBHOOK_SECRET>
```
`{"ok":true,"result":true...}` javobi kelsa — webhook o'rnatildi.

Tekshirish: `https://<BACKEND_DOMEN>/health` → `{"status":"ok"}` qaytishi kerak.

---

## 4️⃣ QADAM — Frontend (Vercel/Netlify)

### 4.1. ⚠️ Kodda 3 ta manzilni o'zgartirish (build'dan OLDIN!)
Frontendda ba'zi qiymatlar kodga yozilgan. Ularni **o'zingiznikiga** almashtiring:

**`miniapp-react/src/customer/config.ts`:**
```ts
export const API_BASE = "https://<SIZNING_BACKEND_DOMENI>";   // 3.4-qadam
const SUPABASE_URL = "https://xxxxx.supabase.co";             // 1.5-qadam
const SUPABASE_KEY = "eyJ...";                                 // anon public kaliti
```

**`miniapp-react/src/admin/api.ts`:**
```ts
export const API_BASE = "https://<SIZNING_BACKEND_DOMENI>";   // 3.4-qadam
```

**`miniapp-react/src/admin/App.tsx`** (Telegram login widgeti):
```ts
script.setAttribute('data-telegram-login', 'SIZNING_BOT_USERNAME');  // @ belgisiz
```

### 4.2. Lokal build (tekshirish uchun ixtiyoriy)
```bash
cd miniapp-react
npm install
npm run build          # tsc (tip tekshiruvi) + vite build
```
Natija `miniapp-react/dist/` papkasida: `index.html` + `admin.html` + `assets/`.

### 4.3. Vercel'ga deploy
1. [vercel.com](https://vercel.com) → **Add New → Project** → GitHub repo'ni tanlang.
2. **Build sozlamalari:**
   - **Root Directory:** `miniapp-react`
   - **Framework Preset:** Vite
   - **Build Command:** `npm run build`
   - **Output Directory:** `dist`
3. **Deploy** bosing.
4. Chiqgan domen (masalan `https://your-app.vercel.app`) — mijoz `.../index.html`, admin `.../admin.html`.

> **Netlify uchun** ham xuddi shunday: Base directory = `miniapp-react`, Build command = `npm run build`, Publish directory = `miniapp-react/dist`.

---

## 5️⃣ QADAM — BotFather'da menyu tugmasi

1. [@BotFather](https://t.me/BotFather) → `/setmenubutton` → botni tanlang.
2. URL: `https://your-app.vercel.app/index.html`
3. Tugma matni: masalan `🍔 Buyurtma berish`.

Endi foydalanuvchilar botdagi tugma orqali mini-appni ochadi.

---

## 🔒 Xavfsizlik — deploydan keyin tekshiring

- [ ] `ADMIN_PIN` real maxfiy qiymatga o'rnatilgan (`123456` emas).
- [ ] `SUPABASE_SERVICE_KEY` **faqat** Railway Variables'da (frontendda emas, GitHub'da emas).
- [ ] `WEBHOOK_SECRET` uzun va tasodifiy.
- [ ] Supabase RLS siyosatlari yoqilgan (`rls_policies.sql` bajarilgan).
- [ ] Frontendda faqat **anon** kalit bor (service_role emas).
- [ ] `SUPERADMIN_IDS` da faqat ishonchli adminlar.

**Kiritilgan himoyalar:** IDOR himoyasi (buyurtma/profil faqat egasiga), initData tasdiqlash + eskirish tekshiruvi, timing-safe PIN, webhook secret-token, so'rov chastotasi cheklovi (rate-limit).

---

## 🧪 Yakuniy sinov ro'yxati

1. `https://<BACKEND>/health` → `ok`.
2. Botni oching → mini-app ochiladimi, menyu yuklanadimi.
3. Taom savatga qo'shiladimi, manzil kiritib buyurtma bериladimi.
4. Admin panel (`/admin.html`) → PIN yoki Telegram bilan kirish.
5. Dashboard grafiklar, buyurtma statusini o'zgartirish, menyu qo'shish.
6. Yangi buyurtma kelganda adminda ovozli signal.

---

## 🔄 Yangilanish chiqarish (keyinchalik)

Kodni o'zgartirgach:
- **Backend:** GitHub'ga push → Railway avtomatik qayta build qiladi.
- **Frontend:** GitHub'ga push → Vercel avtomatik qayta deploy qiladi.
- **Ma'lumotlar bazasi o'zgarsa:** yangi `supabase/migrations/*.sql` faylini SQL Editor'da qo'lda bajaring.

---

## 🆘 Muammolarni bartaraf qilish

| Muammo | Sabab / Yechim |
|--------|----------------|
| Mini-app ochilmaydi, oq ekran | `API_BASE` yoki Supabase URL/kalit `config.ts` da noto'g'ri. Brauzer konsolini (F12) tekshiring. |
| Menyu bo'sh | `seed.sql` bajarilmagan yoki `SUPABASE_ANON_KEY` xato. |
| Buyurtma "Unauthorized" beradi | Mini-app Telegramdan tashqarida ochilgan (initData yo'q). Bot tugmasi orqali oching. |
| Buyurtma bermaydi / ball ishlamaydi | `002_order_atomic_and_rating.sql` bajarilmagan. |
| Admin Telegram login ishlamaydi | BotFather'da `/setdomain` qilinmagan yoki `data-telegram-login` noto'g'ri. |
| PIN "o'chirilgan" deydi | `ADMIN_PIN` o'rnatilmagan yoki `123456`. Railway Variables'ga real PIN qo'ying. |
| Rasm yuklanmaydi | Supabase'da `menu-images` bucket yo'q yoki Public emas. |
| Webhook ishlamaydi | `setWebhook` URL yoki `secret_token` noto'g'ri. `getWebhookInfo` bilan tekshiring. |
| Menyu jonli yangilanmaydi | Supabase'da `menu_items` uchun Realtime yoqilmagan. |

Webhook holatini tekshirish:
```
https://api.telegram.org/bot<BOT_TOKEN>/getWebhookInfo
```

---

## 📁 Muhim fayllar xaritasi

```
fooodcity/
├── bot/                      # Backend (Python/aiogram)
│   ├── bot.py                # Kirish nuqtasi, server ishga tushirish
│   ├── config.py             # .env o'zgaruvchilari
│   └── api/                  # REST API endpointlar
├── miniapp-react/            # Frontend (React + TypeScript) ← DEPLOY SHU
│   ├── src/customer/         # Mijoz ilovasi (config.ts da API_BASE!)
│   ├── src/admin/            # Admin panel (api.ts da API_BASE!)
│   └── dist/                 # Build natijasi (Vercel shu papkani tarqatadi)
├── miniapp/                  # ⚠️ Eski HTML versiya (ishlatilmaydi, zaxira)
├── supabase/
│   ├── schema.sql            # 1-navbatda
│   ├── rls_policies.sql      # 3-navbatda
│   ├── seed.sql              # 5-navbatda
│   └── migrations/           # 001 → 2-navbatda, 002 → 4-navbatda
├── Dockerfile                # Backend build (Railway)
└── railway.toml              # Railway sozlamalari
```

> **Eslatma:** `miniapp/` (eski toza HTML versiya) endi ishlatilmaydi — barcha ish `miniapp-react/` da. Uni deploy qilmang.
