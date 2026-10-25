import assert from 'node:assert/strict'
import { createHmac } from 'node:crypto'
import test from 'node:test'

import {
  consumePinAttempt,
  createSession,
  getAssetKey,
  hashPin,
  isReadOnlyPreviewRequest,
  publicAssetUrl,
  rateLimitPinAttempt,
  readSession,
  validThemeConfig,
} from './index.js'
import worker from './index.js'

const assetId = '12345678-1234-1234-1234-123456789abc'
const theme = {
  backgroundColor: '#0e0f12',
  backgroundImage: '',
  backgroundFit: 'cover',
  backgroundPosition: 'center',
  backgroundRepeat: 'no-repeat',
  fixedBackground: false,
  mainTextColor: '#f3eede',
  mainTextFont: 'system',
  accentColor: '#d9ad52',
  panelBackgroundColor: '#0e0f12',
  customFonts: [],
}

test('PIN HMAC remains compatible with the previous SHA-256 construction', async () => {
  const pin = '0427'
  const pepper = 'unit-test-pepper'
  const expected = createHmac('sha256', pepper).update(pin).digest('hex')
  assert.equal(await hashPin(pin, pepper), expected)
})

test('signed sessions preserve Unicode names and reject tampering or expiry', async () => {
  const env = { SESSION_SECRET: 'unit-test-session-secret' }
  const now = 1_800_000_000_000
  const identity = { id: 'admin-1', name: 'Zoë ♠', isSuperAdmin: false }
  const token = await createSession(identity, env, now)
  assert.deepEqual(await readSession(token, env, now), { ...identity, expiresAt: now + 8 * 60 * 60 * 1000 })
  assert.equal(await readSession(`${token}x`, env, now), null)
  assert.equal(await readSession(token, env, now + 8 * 60 * 60 * 1000), null)
})

test('legacy Supabase URLs and new worker asset paths resolve only to valid bucket keys', () => {
  const legacy = `https://project-id.supabase.co/storage/v1/object/public/spadez-content/theme-fonts/${assetId}.woff2`
  assert.equal(getAssetKey(legacy), `theme-fonts/${assetId}.woff2`)
  assert.equal(publicAssetUrl(legacy), `/assets/theme-fonts/${assetId}.woff2`)
  assert.equal(getAssetKey(`/assets/${assetId}.png`), `${assetId}.png`)
  assert.equal(getAssetKey('https://attacker.example/theme-fonts/font.woff2'), '')
  assert.equal(getAssetKey('https://project-id.supabase.co/storage/v1/object/public/other/file.png'), '')
  assert.equal(getAssetKey('/assets/../wrangler.toml'), '')
  assert.equal(getAssetKey(`/assets/theme-fonts/${assetId}.woff2`, 'theme-fonts/'), `theme-fonts/${assetId}.woff2`)
})

test('theme validation accepts migrated legacy and Worker URLs for configured custom fonts', () => {
  const legacyFont = `https://project-id.supabase.co/storage/v1/object/public/spadez-content/theme-fonts/${assetId}.woff2`
  const legacyTheme = {
    ...theme,
    backgroundImage: `https://project-id.supabase.co/storage/v1/object/public/spadez-content/theme-background/${assetId}.png`,
    mainTextFont: `custom:${assetId}`,
    customFonts: [{ id: assetId, name: 'Test Font', format: 'woff2', url: legacyFont }],
  }
  assert.ok(validThemeConfig(legacyTheme))
  const workerTheme = {
    ...legacyTheme,
    backgroundImage: `/assets/theme-background/${assetId}.png`,
    customFonts: [{ ...legacyTheme.customFonts[0], url: `/assets/theme-fonts/${assetId}.woff2` }],
  }
  assert.ok(validThemeConfig(workerTheme))
  assert.equal(validThemeConfig({ ...workerTheme, backgroundImage: 'https://attacker.example/bg.png' }), null)
})

test('PIN attempt limiter uses one atomic upsert and returns the D1 allow decision', async () => {
  const calls = []
  const db = {
    prepare(sql) {
      return {
        bind(...values) {
          calls.push({ sql, values })
          return { first: async () => ({ allowed: 0 }) }
        },
      }
    },
  }
  assert.equal(await consumePinAttempt(db, 'fingerprint-digest', '2026-10-25T07:00:00.000Z'), false)
  assert.equal(calls.length, 1)
  assert.match(calls[0].sql, /ON CONFLICT \(fingerprint\) DO UPDATE/i)
  assert.match(calls[0].sql, /datetime\(.*'-15 minutes'\)/s)
  assert.match(calls[0].sql, /RETURNING attempts <= 10 AS allowed/i)
  assert.deepEqual(calls[0].values, [
    'fingerprint-digest',
    '2026-10-25T07:00:00.000Z',
    '2026-10-25T07:00:00.000Z',
    '2026-10-25T07:00:00.000Z',
  ])
})

test('rate limiting checks trusted Cloudflare IP and legacy forwarded fingerprint atomically', async () => {
  const statements = []
  const db = {
    prepare(sql) {
      return {
        bind(...values) {
          statements.push({ sql, values })
          return { first: async () => ({ allowed: 1 }) }
        },
      }
    },
    async batch(batchStatements) {
      assert.equal(batchStatements.length, 2)
      assert.equal(statements.length, 2)
      return [{ results: [{ allowed: 1 }] }, { results: [{ allowed: 1 }] }]
    },
  }
  const env = { DB: db, PIN_PEPPER: 'unit-test-pepper' }
  const request = new Request('https://example.test/api/admin/verify', {
    headers: {
      'cf-connecting-ip': '198.51.100.10',
      'x-forwarded-for': '203.0.113.20, 198.51.100.10',
    },
  })
  assert.equal(await rateLimitPinAttempt(request, env, '2026-10-25T07:00:00.000Z'), true)
  assert.equal(statements.length, 2)
  assert.notEqual(statements[0].values[0], statements[1].values[0])
  assert.ok(statements.every(({ sql }) => /ON CONFLICT \(fingerprint\) DO UPDATE/i.test(sql)))
})

test('catalog API keeps multiline data and translates legacy image, logo, background, and font URLs', async () => {
  const imageUrl = `https://project-id.supabase.co/storage/v1/object/public/spadez-content/${assetId}.png`
  const backgroundUrl = `https://project-id.supabase.co/storage/v1/object/public/spadez-content/theme-background/${assetId}.png`
  const fontUrl = `https://project-id.supabase.co/storage/v1/object/public/spadez-content/theme-fonts/${assetId}.woff2`
  const settings = {
    section_config: JSON.stringify({ cards: { label: 'Cards', type: 'custom', fields: ['name', 'description'] } }),
    logo_image: imageUrl,
    theme_config: JSON.stringify({
      ...theme,
      backgroundImage: backgroundUrl,
      mainTextFont: `custom:${assetId}`,
      customFonts: [{ id: assetId, name: 'Test Font', format: 'woff2', url: fontUrl }],
    }),
  }
  const item = {
    id: 'card-one',
    name: 'Card One',
    section: 'cards',
    description: 'First line\n\nSecond line',
    image: imageUrl,
  }
  const env = {
    DB: {
      prepare(sql) {
        if (sql.includes('FROM catalog_items')) {
          return { all: async () => ({ results: [{ id: item.id, section_key: 'cards', data: JSON.stringify(item) }] }) }
        }
        if (sql.includes('FROM catalog_state')) return { first: async () => settings }
        throw new Error('Unexpected test query')
      },
    },
  }
  const response = await worker.fetch(new Request('https://example.test/api/catalog'), env)
  const result = await response.json()
  assert.equal(response.status, 200)
  assert.equal(result.catalog.cards[0].id, 'card-one')
  assert.equal(result.catalog.cards[0].description, item.description)
  assert.equal(result.catalog.cards[0].image, `/assets/${assetId}.png`)
  assert.equal(result.customLogo, `/assets/${assetId}.png`)
  assert.equal(result.themeConfig.backgroundImage, `/assets/theme-background/${assetId}.png`)
  assert.equal(result.themeConfig.customFonts[0].url, `/assets/theme-fonts/${assetId}.woff2`)
})

test('public R2 asset route serves only allowlisted keys', async () => {
  let staticAssetRequested = false
  const env = {
    CONTENT: {
      async get(key) {
        assert.equal(key, `${assetId}.png`)
        const response = new Response('synthetic image')
        return {
          body: response.body,
          httpMetadata: { contentType: 'image/png' },
          writeHttpMetadata(headers) { headers.set('Content-Type', 'image/png') },
        }
      },
    },
    ASSETS: {
      async fetch(request) {
        const path = new URL(request.url).pathname
        if (path !== '/assets/index-test.js') return new Response('Not found', { status: 404 })
        staticAssetRequested = true
        return new Response('export default true', {
          headers: { 'Content-Type': 'text/javascript; charset=utf-8' },
        })
      },
    },
  }
  const allowed = await worker.fetch(new Request(`https://example.test/assets/${assetId}.png`), env)
  assert.equal(allowed.status, 200)
  assert.equal(await allowed.text(), 'synthetic image')
  assert.equal(allowed.headers.get('X-Content-Type-Options'), 'nosniff')
  const viteAsset = await worker.fetch(new Request('https://example.test/assets/index-test.js'), env)
  assert.equal(viteAsset.status, 200)
  assert.match(viteAsset.headers.get('Content-Type'), /javascript/)
  assert.equal(await viteAsset.text(), 'export default true')
  assert.equal(staticAssetRequested, true)
  const rejected = await worker.fetch(new Request('https://example.test/assets/not-an-object.txt'), env)
  assert.equal(rejected.status, 404)
})

test('public R2 assets use immutable browser and edge caching without refetching cached objects', async () => {
  const originalCaches = globalThis.caches
  const stored = new Map()
  let objectReads = 0
  globalThis.caches = {
    default: {
      async match(request) {
        return stored.get(request.url)?.clone()
      },
      async put(request, response) {
        stored.set(request.url, response.clone())
      },
    },
  }
  const env = {
    CONTENT: {
      async get() {
        objectReads += 1
        return {
          body: new Response('synthetic image').body,
          httpMetadata: { contentType: 'image/png' },
          writeHttpMetadata(headers) { headers.set('Content-Type', 'image/png') },
        }
      },
    },
  }
  try {
    const url = `https://example.test/assets/${assetId}.png`
    const first = await worker.fetch(new Request(url), env)
    assert.equal(first.status, 200)
    assert.equal(first.headers.get('Cache-Control'), 'public, max-age=31536000, immutable')
    assert.equal(first.headers.get('CDN-Cache-Control'), 'public, max-age=31536000, immutable')
    assert.equal(await first.text(), 'synthetic image')

    const second = await worker.fetch(new Request(url), env)
    assert.equal(second.status, 200)
    assert.equal(await second.text(), 'synthetic image')
    assert.equal(objectReads, 1)
  } finally {
    if (originalCaches === undefined) delete globalThis.caches
    else globalThis.caches = originalCaches
  }
})

test('preview read-only guard allows only public catalog and safe static reads', () => {
  const preview = { PREVIEW_READ_ONLY: 'true' }
  const production = { PREVIEW_READ_ONLY: 'false' }
  const allowed = [
    new Request('https://preview.test/'),
    new Request('https://preview.test/api/catalog'),
    new Request('https://preview.test/api/catalog/items'),
    new Request('https://preview.test/assets/image.png', { method: 'HEAD' }),
  ]
  for (const request of allowed) assert.equal(isReadOnlyPreviewRequest(request, preview), false)

  const blocked = [
    new Request('https://preview.test/api/admin/verify', { method: 'POST' }),
    new Request('https://preview.test/api/admin/codes'),
    new Request('https://preview.test/api/catalog/settings', { method: 'GET' }),
    new Request('https://preview.test/api/catalog/items', { method: 'POST' }),
    new Request('https://preview.test/api/catalog/items', { method: 'PATCH' }),
    new Request('https://preview.test/api/catalog/items', { method: 'DELETE' }),
    new Request('https://preview.test/api/catalog/image', { method: 'POST' }),
    new Request('https://preview.test/api/catalog/theme-background', { method: 'POST' }),
    new Request('https://preview.test/api/catalog/theme-fonts', { method: 'DELETE' }),
    new Request('https://preview.test/assets/image.png', { method: 'PUT' }),
  ]
  for (const request of blocked) assert.equal(isReadOnlyPreviewRequest(request, preview), true)
  assert.equal(
    isReadOnlyPreviewRequest(new Request('https://production.test/api/admin/verify', { method: 'POST' }), production),
    false,
  )
})

test('preview guard rejects writes before invoking any D1 or R2 binding', async () => {
  let bindingCalled = false
  const env = {
    PREVIEW_READ_ONLY: 'true',
    DB: { prepare() { bindingCalled = true; throw new Error('D1 must not be accessed') } },
    CONTENT: { async put() { bindingCalled = true; throw new Error('R2 put must not be accessed') } },
    ASSETS: { async fetch() { return new Response('static') } },
  }
  const denied = await worker.fetch(
    new Request('https://preview.test/api/catalog/items', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ item: { name: 'test' } }),
    }),
    env,
  )
  assert.equal(denied.status, 403)
  assert.equal(bindingCalled, false)
})
