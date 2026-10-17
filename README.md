# Food City 🍔 - Telegram Mini App Platform

A production-grade fast food ordering platform built as a white-label SaaS on Telegram Mini Apps. Supports 3 languages natively (Uzbek, Russian, English), full admin panel, cart, FSM-based F&B menu wizard, caching, Webhooks, loyalty points, coupons, Supabase storage, PostgreSQL RL policies. 

## Stack
- Python 3.11, aiogram 3.7.0, aiohttp 3.9
- Telegram Mini Apps (Frontend: Pure HTML/JS/CSS without frameworks)
- Database: Supabase (PostgreSQL) + Storage
- Deploy: Docker + Railway

## Project Structure
- `/miniapp`: Customer and Admin frontend SPAs. Hosted anywhere (Vercel/Netlify/Github Pages) or served statically.
- `/bot`: aiogram bot using aiohttp for webhook routing + REST API for the admin dashboard.
- `/supabase`: SQL initialization scripts (Schema, policies, data).

## Deployment

1. **Supabase Setup**:
   - Create a project on [Supabase](https://supabase.com).
   - Go to SQL Editor -> run `supabase/schema.sql`
   - Run `supabase/rls_policies.sql` to secure the database.
   - Run `supabase/seed.sql` to insert demo items.
   - Run all SQL migrations in `supabase/migrations/` in numeric order.
   - Go to Storage -> Create bucket `menu-images` -> make it **Public**.

2. **Frontend Deployment**:
   - Deploy `miniapp/` folder to Vercel/Netlify/GitHub Pages.
   - Take the URLs: e.g. `https://your-app.vercel.app/index.html` and `.../admin.html`

3. **BotFather Setup**:
   - Get your Bot Token.
   - `/setmenubutton` -> Link to your Web App `https://your-app.vercel.app/index.html`

4. **Bot Configuration (.env)**:
   Rename `.env.example` to `.env` and fill the keys:
   ```env
   BOT_TOKEN=123:ABC
   SUPABASE_URL=https://your-db.supabase.co
   SUPABASE_SERVICE_KEY=eyJ...
   SUPABASE_ANON_KEY=eyJ...
   MINI_APP_URL=https://your-app.vercel.app/index.html
   ADMIN_PANEL_URL=https://your-app.vercel.app/admin.html
   ADMIN_CHAT_ID=YOUR_TELEGRAM_ID
   SUPERADMIN_IDS=YOUR_TELEGRAM_ID
   WEBHOOK_URL=https://your-backend-railway.app
   WEBHOOK_SECRET=random_secure_string_12345
   PORT=8000
   ```

5. **Deploy Backend (Railway)**:
   - Connect GitHub Repo to Railway.
   - Ensure variables are passed into Railway environment.
   - The app will automatically set its own webhook on startup via `bot.py`.
   - Healthcheck is implemented on `/health`.
   
## Local Development

The local web app and Telegram bot can use the Supabase project configured in
`.env`. Local polling leaves the Telegram webhook untouched. From the repository
root, run the backend and bot together in PowerShell:

```powershell
$env:LOCAL_POLLING = "true"
$env:WEBHOOK_URL = ""
python -m bot.bot
```

In a second terminal, run the customer and admin apps:

```powershell
cd miniapp-react
npm install
npm run dev
```

Open the Vite URL for the customer app and `/admin.html` for the admin panel.
The admin panel uses hash-based navigation so its sections continue to load
correctly when the page is refreshed or opened directly.
The `miniapp-react/.env.local` file sets `VITE_API_BASE` to the local backend.
Do not enable `LOCAL_POLLING` in production; it runs the bot using local
long-polling instead of configuring Telegram's webhook.

The Orders page refreshes every 10 seconds and new orders are also sent to the
configured admin Telegram chat. Dashboard analytics refresh every 30 seconds,
count only payment-confirmed, non-cancelled orders as revenue, exclude
cancelled orders from product totals, and show order-status counts for the
selected date range. Assigning an order to a courier sends the
courier a Telegram message with the customer contact, order items, payment
details, and a map link for the delivery address. Apply
`supabase/migrations/003_courier_assignment.sql` first, and ensure the courier
has started the bot so Telegram can deliver the message.

The admin dashboard reports payment-confirmed revenue separately from
outstanding payment value, alongside average paid order value, active and
delivered orders, unique buyers, delivery rate, cancellation rate, and
repeat-customer share. Payment confirmation is available to PIN-based admins;
the audit user remains empty for PIN sessions because those sessions do not
map to a `users` row.

Before using the phone-verification flow or card-transfer payments, apply
`supabase/migrations/005_phone_verification_and_card_payment.sql` in the
Supabase SQL Editor after migrations 001–004. Existing phone numbers are
deliberately not trusted; customers must share their own contact in the
Telegram bot. The migration also restricts the order-creation RPC to the
backend service role so clients cannot bypass contact verification.

Apply `supabase/migrations/006_promotional_content.sql` after migrations 001–005
to enable customer Mini App stories and home-page banners. Admins can upload
and order story/banner images from **Stories & Banner** in the admin panel;
uploaded images are converted to WEBP and stored in the existing public
`menu-images` Supabase Storage bucket.

Apply `supabase/migrations/007_customer_order_cancellation.sql` after migration
006 to enable customer cancellation of orders that are still in the **New**
state. Cancellation is atomic with loyalty-point and coupon-use corrections;
accepted orders must be cancelled by contacting the restaurant.

### Testing from a phone

`localhost` on a phone points to the phone itself, not the development PC.
For Telegram Mini Apps, use an HTTPS tunnel to the Vite server; Vite proxies
`/api` and `/health` to the local backend:

```powershell
cloudflared tunnel --url http://127.0.0.1:5173
```

Copy the generated `https://...trycloudflare.com` address, then restart the
local polling bot with that address:

```powershell
$env:LOCAL_POLLING = "true"
$env:WEBHOOK_URL = ""
$env:MINI_APP_URL = "https://<tunnel-host>.trycloudflare.com"
$env:ADMIN_PANEL_URL = "https://<tunnel-host>.trycloudflare.com/admin.html"
python -m bot.bot
```

In Telegram, send `/start` again and open the new **Buyurtma berish** button.
The quick-tunnel URL changes when the tunnel restarts. Anyone with its URL can
reach the local development app while the tunnel is running; stop the tunnel
when phone testing is finished.
On localhost and temporary tunnel domains, the admin login opens on the PIN
tab. Telegram's login widget only works when the exact public domain is
registered for the bot; use the configured admin PIN for temporary URLs.
Use a private six-digit `ADMIN_PIN`; the insecure default PINs are rejected by
the backend.
For local-backend administration from a phone, open that same tunnel origin
with `/admin.html` appended. The separately deployed Vercel admin requires a
deployed backend with the matching `/api/auth/*` and `/api/admin/*` routes.

## Admin Roles
- **superadmin**: Full access (stats, menu, coupons, broadcast users)
- **admin**: Edit menu, see orders
- **staff**: View orders and change statuses only

To give superadmin access outside of the `.env` configuration, insert into DB:
```sql
INSERT INTO admins (user_id, role) VALUES (111111111, 'superadmin');
```

## Adding Menu Items
You can add menu items two ways:
1. Telegram Bot: `/menu_add` command. It uses FSM state.
2. Web Admin Panel: Navigate to "Menyu" -> "+ Yangi taom".

## To'lov Tizimlari: Click & Payme (Avtomatlashtirilgan & Xavfsiz)

Loyihada **Click** va **Payme** to'lov tizimlari to'liq integratsiya qilingan. Soxta cheklar xavfi 100% bartaraf etilgan: to'lovlar server-to-server webhook, raqamli imzo (HMAC/MD5) va DB summasi asosida avtomatik tasdiqlanadi.

### 1. Supabase Migratsiyasi
Supabase SQL Editor'da yangi migratsiyani yurgizing:
`supabase/migrations/008_click_payme_integration.sql`

### 2. Click Merchant sozlamalari
Click kabinetida (merchant.click.uz) quyidagi Webhook manzillarini kiriting:
- **Prepare URL**: `https://<sizning-backend-domeningiz>/api/payments/click/prepare`
- **Complete URL**: `https://<sizning-backend-domeningiz>/api/payments/click/complete`

`.env` faylida yoki Admin Panel -> Sozlamalar bo'limida kalitlarni kiriting:
```env
CLICK_SERVICE_ID=...
CLICK_MERCHANT_ID=...
CLICK_SECRET_KEY=...
CLICK_MERCHANT_USER_ID=...
```

### 3. Payme Business sozlamalari
Payme Business kabinetida (business.payme.uz) endpoint manzilini kiriting:
- **Endpoint URL**: `https://<sizning-backend-domeningiz>/api/payments/payme`

`.env` faylida yoki Admin Panel -> Sozlamalar bo'limida kalitlarni kiriting:
```env
PAYME_MERCHANT_ID=...
PAYME_SECRET_KEY=...
PAYME_TEST_MODE=true  # Production uchun false
```

### 4. Mijoz to'lov jarayoni (UX)
Mijoz savatda **Click** yoki **Payme** ni tanlab "Buyurtma berish" tugmasini bosishi bilanoq, Telegram Mini App ichidan to'g'ridan-to'g'ri Click/Payme ilovasiga o'tadi va 1 ta bosishda to'lovni tasdiqlaydi. Chek yuklash talab etilmaydi! To'lov tushishi bilan oshxona va adminga darhol avtomatik bildirishnoma boradi.

