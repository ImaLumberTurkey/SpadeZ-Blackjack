# SpadeZ Blackjack

A polished React + Vite collection-guide for the SpadeZ Blackjack game catalog. The app includes a casino-inspired catalog, searchable filters, item detail modals, and an admin-ready editing flow designed for a future authenticated backend.

## Local setup

1. Install Node.js 20+.
2. In this project root, run:
   npm install
3. Start dev mode:
   npm run dev
4. Build for production:
   npm run build

## Project structure

- src/App.jsx — layout, catalog data, filtering, detail modal, and admin workflows.
- src/App.css — dark casino styling, responsive cards, and modals.
- src/index.css — global resets and page-level theme.
- public/ — static assets and future logo/image placeholders.
- README.md — setup and backend notes.

## Logo and art

The app uses a simple gold-toned placeholder logo and CSS-generated art blocks so the layout works even before official game assets are available. Replace the placeholder mark in the header and the card artwork values in the seed catalog with final image assets when they are ready.

## Shared admin PIN setup (Vercel + Supabase)

Admin PINs are verified and managed by Vercel API routes and stored as keyed hashes in Supabase. They are no longer stored in browser local storage. Catalog edits, category configuration, and uploaded logos still use browser local storage and are not shared between visitors.

1. Create a Supabase project and run `supabase/schema.sql` in its SQL Editor. Rerun it after schema updates; its setup statements are safe to apply again.
2. In Vercel project settings, add these Environment Variables for Production (and Preview if needed):
   - `SUPABASE_URL`: the Supabase project URL.
   - `SUPABASE_SECRET_KEY`: the `sb_secret_...` key. The existing `SUPABASE_SERVICE_ROLE_KEY` setting is also supported for legacy `service_role` JWT keys or for an `sb_secret_...` key already entered there. Keep either value server-side; never prefix it with `VITE_`.
   - `SUPER_ADMIN_PIN`: your new 4-digit super-admin PIN. Do not reuse the old published `1242` PIN.
   - `SUPER_ADMIN_NAME`: the super-admin display name.
   - `PIN_PEPPER`: a private random value used to hash stored PINs.
   - `SESSION_SECRET`: a separate private random value used to sign admin sessions.
3. Generate two separate random values locally with `node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"` and use one for each secret variable above. Do not commit them or send them in chat.
4. Redeploy the Vercel project after saving the variables. Add admin PINs again from the super-admin panel; existing browser-local PINs are not migrated.

The database schema limits sign-in attempts to 10 per IP per 15-minute window. Free Supabase projects may pause after a week of inactivity. Only server API routes use the service-role key; the browser receives short-lived signed sessions.

Local Vite dev mode does not run Vercel API routes. Use Vercel's `vercel dev` command to test the admin API locally, or test a Vercel Preview deployment.

## Production build

The Vite production build is configured via the default scripts in package.json.
