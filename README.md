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

## Future expansions
- Payment integration: Currently naqd (cash) only. For Payme/Click, modify the frontend cart payload and the backend `create_order` handler inside `customer.py` to generate invoice links using `bot.send_invoice`.

┌──────────────────────────────────────────────────────────────────────┐
