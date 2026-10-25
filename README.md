# SpadeZ Blackjack

A React + Vite catalog application served by Cloudflare Workers. The Worker provides the catalog/admin API, D1 persistence, and R2-backed public assets.

## Local development

1. Install Node.js 20+.
2. Install dependencies with `npm install`.
3. Build the frontend with `npm run build`.
4. Start the local Worker runtime with `npm run dev:worker`.

Wrangler runs D1 and R2 locally by default. Local D1 starts empty; do not use `--remote` for local development unless you intend to access the production database.

## Cloudflare resources

`wrangler.toml` binds:

- `DB` to the existing `spadez-blackjack` D1 database.
- `CONTENT` to the existing `spadez-content` R2 bucket.
- `ASSETS` to the Vite `dist/` directory.

The application Worker does not create or migrate these resources. Do not run the migration import SQL again against the populated D1 database.

## Isolated read-only preview

`wrangler.preview.toml` uses the separate Worker name `spadez-blackjack-preview`, explicitly enables `workers.dev`, and binds the existing D1/R2 resources. Its `PREVIEW_READ_ONLY` flag activates a server-side allowlist: only public catalog reads, static asset reads, and allowlisted R2 object reads proceed. Admin login/registry, every other API route, all non-GET/HEAD requests, uploads, and deletes return 403 before a D1 or R2 binding is accessed. Do not remove this flag or use the production config for preview.

Prepare a private local test state from the ignored, already-validated SQL and one synthetic R2 image:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\migration\prepare-preview.ps1
npm run dev:worker -- --config wrangler.preview.toml --local --persist-to migration\.preview-state
```

The setup script uses explicit `--local` flags, refuses to overwrite an existing local preview state, and writes only beneath the Git-ignored `migration/.preview-state/`. The local preview binds to Wrangler's emulator, not the remote database or bucket. The preview Worker can then be tested locally at `http://127.0.0.1:8787`; stop the process with Ctrl+C. The normal automated checks are `npm test`, `npm run lint`, and `npm run build`.

When deployed, the preview Worker still has the existing production D1/R2 bindings, but the server-side allowlist prevents API-mediated writes. Cloudflare D1 and R2 bindings are not configured here with provider-enforced read-only capabilities; this is an application guard, so review it and keep `PREVIEW_READ_ONLY = "true"` in the preview config for every preview version. This preview should not be used to test Admin flows.

## Isolated local Admin testing

`wrangler.admin-test.toml` is for local testing only. It uses a distinct Worker name, a local-only hostname guard, `workers_dev = false`, placeholder D1 ID, and separately named D1/R2 resources. Do not add production resource IDs or bucket names to this file. The Worker rejects requests whose URL host is not loopback, even if the test config is accidentally deployed.

After confirming the validated, Git-ignored `migration/output/d1-import.sql` is present, initialize an isolated local D1/R2 state from it:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\migration\prepare-admin-test.ps1
```

The script refuses to overwrite existing local state, imports the validated backup only into Wrangler's local D1 emulator, adds a synthetic image only to the local R2 emulator, and verifies the four table counts and JSON integrity without printing Admin PIN hashes. The state lives under ignored `migration/.admin-test-state/`; it is separate from the read-only preview's local state. The setup intentionally does not copy or access remote R2 objects.

Generate fresh local-only pepper/session secrets and securely enter a new Super Admin PIN and display name (input is hidden) with:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\migration\configure-admin-test-secrets.ps1
```

The script writes all four values to ignored `.dev.vars` without printing them. The five imported regular Admin hashes still use the old pepper, so their old PINs are intentionally not expected to work locally. Super Admin authentication is independent of those records. New regular Admin PINs created through Super Admin management use the new pepper; the integration test creates a temporary code, logs into it, then removes it without changing the five imported records.

Run local tests with `npm test`, `npm run lint`, and `npm run build`, then start the local-only Worker at `http://127.0.0.1:8788` using `npm run dev:admin-test`. In a second terminal run `powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\migration\test-admin-test.ps1`; it reads the PIN from ignored `.dev.vars` without displaying it. Never use `--remote` with this configuration. Admin changes and uploads affect only the disposable local test state. Stop the local Worker with Ctrl+C. To reset, first inspect and then manually remove only the specific `migration/.admin-test-state/` directory; the setup script will not overwrite it automatically.

This environment covers Super Admin and regular Admin sessions against the imported hashes, catalog edits, permission checks, theme changes, uploads, and session validation. It does not deploy or create any Cloudflare Worker, database, or bucket.

## Worker secrets

The Worker requires these Cloudflare secrets. Type secret values only into a secure Cloudflare prompt; do not put them in source files, frontend variables, chat, or logs:

```powershell
npx wrangler secret put PIN_PEPPER
npx wrangler secret put SESSION_SECRET
npx wrangler secret put SUPER_ADMIN_PIN
npx wrangler secret put SUPER_ADMIN_NAME
```

Do not run `wrangler secret put` until an approved deployment window: it updates the deployed Worker immediately. Configure/stage secrets as part of the reviewed first deployment/version rollout instead.

`PIN_PEPPER` must be the exact original secret used to generate the imported `admin_codes.pin_hash` values. If it is unavailable, existing Admin PINs will not verify; arrange a controlled reset. `SESSION_SECRET` should be a separate high-entropy value. `SUPER_ADMIN_PIN` is a new 4-digit server-side PIN and is not stored in `admin_codes`.

## API behavior

The Worker supports the existing frontend routes:

- `GET|POST|PATCH|DELETE /api/catalog/items`
- `/api/catalog` as a compatibility alias for the items route
- `PATCH|DELETE /api/catalog/settings`
- `POST /api/catalog/image`
- `POST /api/catalog/theme-background`
- `POST|DELETE /api/catalog/theme-fonts`
- `POST /api/admin/verify`
- `GET|POST|DELETE /api/admin/codes`

Only authenticated Admins can edit catalog items and upload item images. Theme, category, and admin-registry management remain Super Admin-only. PIN attempts use one atomic D1 upsert and are limited to 10 per Cloudflare client IP per 15-minute window. Sessions remain HMAC-signed and expire after eight hours.

Recognized Supabase public URLs for `spadez-content` are translated in API responses to same-origin `/assets/...` URLs. The asset route maps only approved UUID-based image/font paths to R2; it does not fetch remote URLs or expose bucket listing. New uploads use unique object keys. Existing R2 objects are not removed by catalog edits, deletions, category removal, or custom-font removal.

The `api/` and `server/` Vercel handlers and `vercel.json` were removed after their route behavior was moved into the Worker. The original `supabase/` directory is retained as historical project material and is not used by the Worker.

## Validation and deployment

Run `npm test`, `npm run lint`, and `npm run build` before deployment. Deployment is intentionally not part of this migration change. Before a later deployment, confirm all Worker secrets above are set in the intended Cloudflare environment and review the R2 object keys referenced by existing catalog records. Then obtain approval before running a deploy command.

### Initial production rollout with secrets staged before public traffic

The initial production Worker does not exist yet. Cloudflare requires the first version to use `wrangler deploy`, which deploys immediately; `wrangler versions upload` cannot create the first Worker. To avoid exposing a version before its secrets exist, use the no-trigger bootstrap config first. It has `workers_dev = false`, `preview_urls = false`, and no D1/R2/assets bindings. The secret helper sends the four local `.dev.vars` values to Wrangler over stdin and creates a secret-only version without deploying it:

```powershell
npm.cmd run build
node_modules\.bin\wrangler.cmd deploy --config wrangler.bootstrap.toml
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\migration\push-production-secrets-version.ps1
node_modules\.bin\wrangler.cmd versions deploy --config wrangler.bootstrap.toml
node_modules\.bin\wrangler.cmd deploy --config wrangler.toml
```

The versions deployment step activates only the secret-only version while the bootstrap Worker has no public triggers or storage bindings. The final production config explicitly enables the Worker's own workers.dev address and declares all four secrets as required, so Wrangler refuses the public deployment if a required secret is absent. Do not use `wrangler secret put` or `wrangler secret bulk` in this staged flow; those commands deploy immediately. The bootstrap Worker creation, secret-version upload/activation, and final public deployment are separate remote changes and each requires approval before execution. No D1 migrations/imports are part of this procedure.
