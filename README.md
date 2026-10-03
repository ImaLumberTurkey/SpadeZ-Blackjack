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

## Backend integration notes

- Keep Supabase or other service credentials out of frontend code.
- The admin sign-in flow is purposely built to require a trusted backend verification step. No hard-coded PIN success state is included.
- A future secure session can be plugged into the `verifyAdminPin` service and the admin status bar logic in App.jsx without exposing private keys.
- Super Admin vs Admin permission boundaries should remain server-side enforced.

## Production build

The Vite production build is configured via the default scripts in package.json.
