const DEFAULT_THEME_CONFIG = {
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

const ITEM_FIELDS = [
  'name',
  'image',
  'description',
  'requirement',
  'buff',
  'requiredPowerups',
  'howToObtain',
  'completeRules',
  'tint',
  'section',
  'type',
]

const MULTILINE_FIELDS = new Set([
  'description',
  'requirement',
  'buff',
  'requiredPowerups',
  'howToObtain',
  'completeRules',
])

const VALID_SECTION_FIELDS = new Set([
  'name',
  'image',
  'description',
  'requirement',
  'buff',
  'requiredPowerups',
  'howToObtain',
  'completeRules',
])

const IMAGE_TYPES = new Map([
  ['image/avif', 'avif'],
  ['image/gif', 'gif'],
  ['image/jpeg', 'jpg'],
  ['image/png', 'png'],
  ['image/webp', 'webp'],
])

const FONT_TYPES = new Map([
  ['font/woff2', { extension: 'woff2', format: 'woff2', signature: 'wOF2' }],
  ['font/woff', { extension: 'woff', format: 'woff', signature: 'wOFF' }],
  ['font/ttf', { extension: 'ttf', format: 'truetype' }],
  ['font/otf', { extension: 'otf', format: 'opentype', signature: 'OTTO' }],
])

const MAX_IMAGE_SIZE = 3 * 1024 * 1024
const MAX_FONT_SIZE = 3 * 1024 * 1024
const MAX_JSON_SIZE = 1024 * 1024
const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'
const ASSET_KEY_PATTERN = new RegExp(
  `^(?:${UUID}\\.(?:avif|gif|jpg|png|webp)|theme-background/${UUID}\\.(?:avif|gif|jpg|png|webp)|theme-fonts/${UUID}\\.(?:woff2|woff|ttf|otf))$`,
  'i',
)

const json = (data, status = 200, headers = {}) => Response.json(data, {
  status,
  headers: { 'Cache-Control': 'no-store, max-age=0', ...headers },
})

const errorResponse = (message, status) => json({ error: message }, status)

const safeEqual = (left, right) => {
  if (typeof left !== 'string' || typeof right !== 'string' || left.length !== right.length) return false
  let difference = 0
  for (let index = 0; index < left.length; index += 1) {
    difference |= left.charCodeAt(index) ^ right.charCodeAt(index)
  }
  return difference === 0
}

const bytesToHex = (bytes) => Array.from(bytes, (value) => value.toString(16).padStart(2, '0')).join('')

const encodeBase64Url = (value) => {
  const bytes = new TextEncoder().encode(value)
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '')
}

const decodeBase64Url = (value) => {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) return null
  const base64 = value.replaceAll('-', '+').replaceAll('_', '/')
  const binary = atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, '='))
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0))
  return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
}

const hmac = async (value, secret) => {
  if (typeof secret !== 'string' || !secret) throw new Error('Required Worker secret is not configured.')
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  return bytesToHex(new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(value))))
}

export const hashPin = (pin, pepper) => hmac(pin, pepper)

export const getAssetKey = (value, expectedPrefix = '') => {
  if (typeof value !== 'string') return ''
  let key = ''
  if (value.startsWith('/assets/')) {
    key = value.slice('/assets/'.length)
  } else {
    let url
    try {
      url = new URL(value)
    } catch {
      return ''
    }
    if (
      url.protocol !== 'https:'
      || url.port
      || url.username
      || url.password
      || !/^[a-z0-9-]+\.supabase\.co$/i.test(url.hostname)
    ) return ''
    const prefix = '/storage/v1/object/public/spadez-content/'
    if (!url.pathname.startsWith(prefix) || url.search || url.hash) return ''
    key = url.pathname.slice(prefix.length)
  }
  if (!ASSET_KEY_PATTERN.test(key) || (expectedPrefix && !key.startsWith(expectedPrefix))) return ''
  return key
}

export const publicAssetUrl = (value) => {
  const key = getAssetKey(value)
  return key ? `/assets/${key}` : value
}

const mapItemAssets = (item) => ({
  ...item,
  image: publicAssetUrl(item.image),
})

const mapThemeAssets = (theme) => ({
  ...theme,
  backgroundImage: publicAssetUrl(theme.backgroundImage),
  customFonts: Array.isArray(theme.customFonts)
    ? theme.customFonts.map((font) => ({ ...font, url: publicAssetUrl(font.url) }))
    : [],
})

const mapSettingsAssets = (settings) => ({
  ...settings,
  logo_image: publicAssetUrl(settings.logo_image || ''),
  theme_config: mapThemeAssets(settings.theme_config || DEFAULT_THEME_CONFIG),
})

const parseJsonColumn = (value) => {
  if (typeof value === 'string') return JSON.parse(value)
  return value
}

const getSettings = async (env) => {
  const row = await env.DB.prepare(
    'SELECT section_config, logo_image, theme_config FROM catalog_state WHERE id = 1',
  ).first()
  if (!row) throw new Error('Catalog settings have not been initialized.')
  return {
    section_config: parseJsonColumn(row.section_config),
    logo_image: row.logo_image,
    theme_config: parseJsonColumn(row.theme_config),
  }
}

const readRequestBytes = async (request, limit) => {
  const declaredLength = Number(request.headers.get('content-length') || 0)
  if (declaredLength > limit) throw new RangeError('Request body exceeds the allowed file size.')
  if (!request.body) return new Uint8Array()
  const reader = request.body.getReader()
  const chunks = []
  let total = 0
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.byteLength
    if (total > limit) {
      await reader.cancel()
      throw new RangeError('Request body exceeds the allowed file size.')
    }
    chunks.push(value)
  }
  const result = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    result.set(chunk, offset)
    offset += chunk.byteLength
  }
  return result
}

const readJson = async (request) => {
  const bytes = await readRequestBytes(request, MAX_JSON_SIZE)
  try {
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes))
  } catch {
    return null
  }
}

const sessionSignature = (payload, env) => hmac(payload, env.SESSION_SECRET)

export const createSession = async (identity, env, now = Date.now()) => {
  const payload = encodeBase64Url(JSON.stringify({
    ...identity,
    expiresAt: now + 8 * 60 * 60 * 1000,
  }))
  return `${payload}.${await sessionSignature(payload, env)}`
}

export const readSession = async (token, env, now = Date.now()) => {
  if (typeof token !== 'string') return null
  const [payload, signature, extra] = token.split('.')
  if (!payload || !signature || extra) return null
  if (!safeEqual(signature, await sessionSignature(payload, env))) return null
  try {
    const session = JSON.parse(decodeBase64Url(payload))
    if (
      typeof session.name !== 'string'
      || !Number.isFinite(session.expiresAt)
      || session.expiresAt <= now
      || typeof session.isSuperAdmin !== 'boolean'
      || (!session.isSuperAdmin && typeof session.id !== 'string')
    ) return null
    return session
  } catch {
    return null
  }
}

const requireAdminSession = async (request, env, superAdminOnly = false) => {
  const authorization = request.headers.get('authorization') || ''
  const token = authorization.startsWith('Bearer ') ? authorization.slice(7) : ''
  const session = token ? await readSession(token, env) : null
  if (!session || (superAdminOnly && !session.isSuperAdmin)) {
    const error = new Error('Your admin session is invalid or has expired.')
    error.code = 'ADMIN_SESSION_INVALID'
    throw error
  }
  return session
}

export const consumePinAttempt = async (db, fingerprint, now) => {
  const result = await db.prepare(PIN_ATTEMPT_UPSERT).bind(fingerprint, now, now, now).first()
  if (!result || ![0, 1, false, true].includes(result.allowed)) {
    throw new Error('PIN rate-limit state could not be confirmed.')
  }
  return Boolean(result.allowed)
}

const PIN_ATTEMPT_UPSERT = `
  INSERT INTO admin_pin_attempts (fingerprint, window_started_at, attempts)
  VALUES (?, ?, 1)
  ON CONFLICT (fingerprint) DO UPDATE SET
    window_started_at = CASE
      WHEN datetime(admin_pin_attempts.window_started_at) <= datetime(?, '-15 minutes')
        THEN excluded.window_started_at
      ELSE admin_pin_attempts.window_started_at
    END,
    attempts = CASE
      WHEN datetime(admin_pin_attempts.window_started_at) <= datetime(?, '-15 minutes')
        THEN 1
      ELSE admin_pin_attempts.attempts + 1
    END
  RETURNING attempts <= 10 AS allowed
`

export const rateLimitPinAttempt = async (request, env, now = new Date().toISOString()) => {
  const trustedAddress = request.headers.get('cf-connecting-ip') || 'unknown'
  const forwardedAddress = request.headers.get('x-forwarded-for')?.split(',')[0].trim() || 'unknown'
  const addresses = new Set([trustedAddress, forwardedAddress])
  const fingerprints = await Promise.all([...addresses].map((address) => hmac(address, env.PIN_PEPPER)))
  const statements = fingerprints.map((fingerprint) => env.DB.prepare(PIN_ATTEMPT_UPSERT)
    .bind(fingerprint, now, now, now))
  const results = statements.length === 1
    ? [await statements[0].first()]
    : (await env.DB.batch(statements)).map((result) => result.results?.[0])
  if (results.some((result) => !result || ![0, 1, false, true].includes(result.allowed))) {
    throw new Error('PIN rate-limit state could not be confirmed.')
  }
  return results.every((result) => Boolean(result.allowed))
}

export const isReadOnlyPreviewRequest = (request, env) => {
  if (env.PREVIEW_READ_ONLY !== 'true') return false
  const { pathname } = new URL(request.url)
  const isReadMethod = request.method === 'GET' || request.method === 'HEAD'
  if (!isReadMethod) return true
  if (pathname.startsWith('/api/')) {
    return request.method !== 'GET'
      || !['/api/catalog', '/api/catalog/items'].includes(pathname)
  }
  return false
}

export const isAdminTestHostAllowed = (request, env) => {
  if (env.ADMIN_TEST_LOCAL_ONLY !== 'true') return true
  const { hostname } = new URL(request.url)
  return ['localhost', '127.0.0.1', '[::1]', '::1'].includes(hostname.toLowerCase())
}

const jsonBody = async (request) => {
  const body = await readJson(request)
  return body && typeof body === 'object' && !Array.isArray(body) ? body : null
}

const isConstraintError = (error) => /unique constraint|primary key/i.test(String(error?.message || ''))

const isValidItemId = (id) => typeof id === 'string' && /^[a-z0-9][a-z0-9_-]{0,120}$/i.test(id)

const itemFromRequest = (raw, sectionConfig, id) => {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const section = typeof raw.section === 'string' ? raw.section : ''
  const definition = sectionConfig[section]
  const name = typeof raw.name === 'string' ? raw.name.trim() : ''
  if (!definition || !name || name.length > 200) return null

  const item = { id, section, type: definition.type || 'custom', name }
  for (const field of ITEM_FIELDS) {
    if (field === 'id' || field === 'section' || field === 'type' || field === 'name') continue
    const value = raw[field]
    if (value === undefined) continue
    if (typeof value !== 'string' || value.length > (field === 'image' ? 2048 : 20000)) return null
    if (field === 'image' && /^(data:|blob:)/i.test(value.trim())) return null
    item[field] = MULTILINE_FIELDS.has(field) ? value : value.trim()
  }

  const rawMessages = raw.messages ?? {}
  if (!rawMessages || typeof rawMessages !== 'object' || Array.isArray(rawMessages)) return null
  item.messages = {}
  for (const tab of definition.messageTabs ?? []) {
    const message = rawMessages[tab.key] ?? ''
    if (typeof message !== 'string' || message.length > 20000) return null
    item.messages[tab.key] = message
  }
  item.image ||= '✦'
  item.tint ||= 'gold'
  return item
}

const validSectionConfig = (value) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const entries = Object.entries(value)
  if (entries.length < 1 || entries.length > 100) return null
  const result = {}
  for (const [key, meta] of entries) {
    if (!/^[a-z0-9][a-z0-9-]{0,79}$/i.test(key) || !meta || typeof meta !== 'object' || Array.isArray(meta)) return null
    if (typeof meta.label !== 'string' || !meta.label.trim() || meta.label.length > 80) return null
    if (typeof meta.type !== 'string' || meta.type.length > 40) return null
    if (!Array.isArray(meta.fields) || !meta.fields.every((field) => VALID_SECTION_FIELDS.has(field))) return null
    const tabs = meta.messageTabs ?? []
    if (!Array.isArray(tabs) || tabs.length > 12) return null
    const keys = new Set()
    for (const tab of tabs) {
      if (!tab || typeof tab !== 'object' || Array.isArray(tab)) return null
      if (typeof tab.key !== 'string' || !/^[a-z0-9][a-z0-9-]{0,79}$/i.test(tab.key)) return null
      if (typeof tab.label !== 'string' || !tab.label.trim() || tab.label.length > 60 || keys.has(tab.key)) return null
      keys.add(tab.key)
    }
    result[key] = {
      label: meta.label.trim(),
      type: meta.type,
      fields: meta.fields,
      messageTabs: tabs.map((tab) => ({ key: tab.key, label: tab.label.trim() })),
    }
  }
  return result
}

export const validThemeConfig = (value) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const mainTextColor = value.mainTextColor ?? DEFAULT_THEME_CONFIG.mainTextColor
  const mainTextFont = value.mainTextFont ?? DEFAULT_THEME_CONFIG.mainTextFont
  const accentColor = value.accentColor ?? DEFAULT_THEME_CONFIG.accentColor
  const panelBackgroundColor = value.panelBackgroundColor ?? DEFAULT_THEME_CONFIG.panelBackgroundColor
  const customFonts = value.customFonts ?? []
  const customFontIdMatch = typeof mainTextFont === 'string'
    ? /^custom:([0-9a-f-]{36})$/i.exec(mainTextFont)
    : null
  const builtInFont = ['system', 'arial', 'georgia', 'trebuchet', 'courier'].includes(mainTextFont)
  if (typeof value.backgroundColor !== 'string' || !/^#[\da-f]{6}$/i.test(value.backgroundColor)) return null
  if (typeof value.backgroundImage !== 'string') return null
  if (value.backgroundImage && !getAssetKey(value.backgroundImage, 'theme-background/')) return null
  if (!['cover', 'contain', 'auto', 'width'].includes(value.backgroundFit)) return null
  if (!['center', 'top', 'bottom'].includes(value.backgroundPosition)) return null
  if (!['no-repeat', 'repeat'].includes(value.backgroundRepeat)) return null
  if (typeof value.fixedBackground !== 'boolean') return null
  if (typeof mainTextColor !== 'string' || !/^#[\da-f]{6}$/i.test(mainTextColor)) return null
  if (!builtInFont && !customFontIdMatch) return null
  if (typeof accentColor !== 'string' || !/^#[\da-f]{6}$/i.test(accentColor)) return null
  if (typeof panelBackgroundColor !== 'string' || !/^#[\da-f]{6}$/i.test(panelBackgroundColor)) return null
  if (!Array.isArray(customFonts) || customFonts.length > 30) return null
  const ids = new Set()
  for (const font of customFonts) {
    if (!font || typeof font !== 'object' || Array.isArray(font)) return null
    if (typeof font.id !== 'string' || !new RegExp(`^${UUID}$`, 'i').test(font.id) || ids.has(font.id.toLowerCase())) return null
    if (typeof font.name !== 'string' || !font.name.trim() || font.name.length > 60) return null
    const key = getAssetKey(font.url, 'theme-fonts/')
    if (!key || !key.toLowerCase().startsWith(`theme-fonts/${font.id.toLowerCase()}.`)) return null
    if (!['woff2', 'woff', 'truetype', 'opentype'].includes(font.format)) return null
    ids.add(font.id.toLowerCase())
  }
  if (!builtInFont && !ids.has(customFontIdMatch[1].toLowerCase())) return null
  return {
    backgroundColor: value.backgroundColor,
    backgroundImage: value.backgroundImage,
    backgroundFit: value.backgroundFit,
    backgroundPosition: value.backgroundPosition,
    backgroundRepeat: value.backgroundRepeat,
    fixedBackground: value.fixedBackground,
    mainTextColor,
    mainTextFont,
    accentColor,
    panelBackgroundColor,
    customFonts,
  }
}

const validLogo = (value) => typeof value === 'string'
  && value.length <= 2048
  && !/^(data:|blob:)/i.test(value.trim())

const routeCatalogItems = async (request, env) => {
  if (request.method === 'GET') {
    const [rows, settings] = await Promise.all([
      env.DB.prepare('SELECT id, section_key, data FROM catalog_items ORDER BY created_at ASC').all(),
      getSettings(env),
    ])
    const catalog = Object.fromEntries(Object.keys(settings.section_config).map((key) => [key, []]))
    for (const row of rows.results) {
      const section = row.section_key
      if (!catalog[section]) catalog[section] = []
      catalog[section].push(mapItemAssets({ ...parseJsonColumn(row.data), id: row.id, section }))
    }
    const mapped = mapSettingsAssets(settings)
    return json({
      catalog,
      sectionConfig: settings.section_config,
      customLogo: mapped.logo_image,
      themeConfig: mapped.theme_config,
    })
  }

  await requireAdminSession(request, env)
  if (request.method === 'POST') {
    const body = await jsonBody(request)
    if (!body) return errorResponse('Enter a valid catalog item.', 400)
    const settings = await getSettings(env)
    const id = crypto.randomUUID()
    const item = itemFromRequest(body.item, settings.section_config, id)
    if (!item) return errorResponse('Enter a valid item for an existing category.', 400)
    await env.DB.prepare(
      'INSERT INTO catalog_items (id, section_key, data) VALUES (?, ?, ?)',
    ).bind(id, item.section, JSON.stringify(item)).run()
    return json({ item: mapItemAssets(item) }, 201)
  }

  if (request.method === 'PATCH') {
    const body = await jsonBody(request)
    if (!body || !isValidItemId(body.id)) return errorResponse('Choose a valid catalog item.', 400)
    const existing = await env.DB.prepare('SELECT id FROM catalog_items WHERE id = ?').bind(body.id).first()
    if (!existing) return errorResponse('That catalog item no longer exists.', 404)
    const settings = await getSettings(env)
    const item = itemFromRequest(body.item, settings.section_config, body.id)
    if (!item) return errorResponse('Enter a valid item for an existing category.', 400)
    const result = await env.DB.prepare(
      `UPDATE catalog_items
       SET section_key = ?, data = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
       WHERE id = ?`,
    ).bind(item.section, JSON.stringify(item), body.id).run()
    if (!result.meta.changes) return errorResponse('That catalog item no longer exists.', 404)
    return json({ item: mapItemAssets(item) })
  }

  if (request.method === 'DELETE') {
    const body = await jsonBody(request)
    if (!body || !isValidItemId(body.id)) return errorResponse('Choose a valid catalog item.', 400)
    const result = await env.DB.prepare('DELETE FROM catalog_items WHERE id = ?').bind(body.id).run()
    if (!result.meta.changes) return errorResponse('That catalog item no longer exists.', 404)
    return json({ removed: true })
  }
  return errorResponse('Method not allowed.', 405)
}

const routeCatalogSettings = async (request, env) => {
  if (!['PATCH', 'DELETE'].includes(request.method)) return errorResponse('Method not allowed.', 405)
  await requireAdminSession(request, env, true)
  const current = await getSettings(env)
  const body = await jsonBody(request)
  if (!body) return errorResponse('Enter valid settings.', 400)

  if (request.method === 'DELETE') {
    const sectionKey = body.sectionKey
    const currentConfig = current.section_config
    if (typeof sectionKey !== 'string' || !Object.hasOwn(currentConfig, sectionKey)) {
      return errorResponse('That category no longer exists.', 404)
    }
    if (Object.keys(currentConfig).length <= 1) return errorResponse('At least one category must remain.', 400)
    const nextConfig = { ...currentConfig }
    delete nextConfig[sectionKey]
    const categoryItems = await env.DB.prepare(
      'SELECT id FROM catalog_items WHERE section_key = ?',
    ).bind(sectionKey).all()
    const statements = [
      env.DB.prepare('UPDATE catalog_state SET section_config = ?, updated_at = strftime(\'%Y-%m-%dT%H:%M:%fZ\', \'now\') WHERE id = 1')
        .bind(JSON.stringify(nextConfig)),
      env.DB.prepare('DELETE FROM catalog_items WHERE section_key = ?').bind(sectionKey),
    ]
    await env.DB.batch(statements)
    return json({ sectionConfig: nextConfig, deletedItems: categoryItems.results.length })
  }

  const updates = {}
  if (Object.hasOwn(body, 'sectionConfig')) {
    const sectionConfig = validSectionConfig(body.sectionConfig)
    if (!sectionConfig) return errorResponse('The category configuration is invalid.', 400)
    updates.section_config = JSON.stringify(sectionConfig)
  }
  if (Object.hasOwn(body, 'customLogo')) {
    if (!validLogo(body.customLogo)) return errorResponse('The logo image reference is invalid.', 400)
    updates.logo_image = body.customLogo
  }
  if (Object.hasOwn(body, 'themeConfig')) {
    const themeConfig = validThemeConfig(body.themeConfig)
    if (!themeConfig) return errorResponse('The theme configuration is invalid.', 400)
    updates.theme_config = JSON.stringify(themeConfig)
  }
  const updateColumns = Object.keys(updates)
  if (!updateColumns.length) return errorResponse('There are no settings to save.', 400)
  const assignments = updateColumns.map((column) => `${column} = ?`)
  assignments.push("updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')")
  await env.DB.prepare(`UPDATE catalog_state SET ${assignments.join(', ')} WHERE id = 1`)
    .bind(...updateColumns.map((column) => updates[column])).run()
  const saved = await getSettings(env)
  const mapped = mapSettingsAssets(saved)
  return json({
    sectionConfig: saved.section_config,
    customLogo: mapped.logo_image,
    themeConfig: mapped.theme_config,
  })
}

const routeAdminVerify = async (request, env) => {
  if (request.method !== 'POST') return errorResponse('Method not allowed.', 405)
  const body = await jsonBody(request)
  const pin = typeof body?.pin === 'string' ? body.pin.trim() : ''
  if (!/^\d{4}$/.test(pin)) return errorResponse('Enter a 4-digit PIN.', 400)
  const allowed = await rateLimitPinAttempt(request, env)
  if (!allowed) return errorResponse('Too many attempts. Try again in 15 minutes.', 429)

  const hashedPin = await hashPin(pin, env.PIN_PEPPER)
  const superAdminPin = env.SUPER_ADMIN_PIN
  if (typeof superAdminPin !== 'string' || !/^\d{4}$/.test(superAdminPin)) {
    throw new Error('Super Admin PIN is not configured correctly.')
  }
  const superAdminHash = await hashPin(superAdminPin, env.PIN_PEPPER)
  let identity
  if (safeEqual(hashedPin, superAdminHash)) {
    identity = { name: env.SUPER_ADMIN_NAME || 'Super Admin', isSuperAdmin: true }
  } else {
    const admin = await env.DB.prepare(
      'SELECT id, name FROM admin_codes WHERE pin_hash = ? LIMIT 1',
    ).bind(hashedPin).first()
    if (!admin) return errorResponse('That PIN was not found in the admin registry.', 401)
    identity = { id: admin.id, name: admin.name, isSuperAdmin: false }
  }
  return json({ admin: { ...identity, token: await createSession(identity, env) } })
}

const routeAdminCodes = async (request, env) => {
  await requireAdminSession(request, env, true)
  if (request.method === 'GET') {
    const result = await env.DB.prepare(
      'SELECT id, name, created_at FROM admin_codes ORDER BY created_at DESC',
    ).all()
    return json({ admins: result.results })
  }
  if (request.method === 'POST') {
    const body = await jsonBody(request)
    const name = typeof body?.name === 'string' ? body.name.trim() : ''
    const pin = typeof body?.pin === 'string' ? body.pin.trim() : ''
    if (!name || name.length > 80 || !/^\d{4}$/.test(pin)) {
      return errorResponse('Enter a name and a 4-digit PIN.', 400)
    }
    const admin = { id: crypto.randomUUID(), name, pin_hash: await hashPin(pin, env.PIN_PEPPER) }
    try {
      await env.DB.prepare('INSERT INTO admin_codes (id, name, pin_hash) VALUES (?, ?, ?)')
        .bind(admin.id, admin.name, admin.pin_hash).run()
    } catch (error) {
      if (isConstraintError(error)) return errorResponse('That PIN is already assigned to another admin.', 409)
      throw error
    }
    return json({ admin: { id: admin.id, name: admin.name } }, 201)
  }
  if (request.method === 'DELETE') {
    const body = await jsonBody(request)
    const id = typeof body?.id === 'string' ? body.id : ''
    if (!new RegExp(`^${UUID}$`, 'i').test(id)) return errorResponse('Choose a valid admin entry.', 400)
    const result = await env.DB.prepare('DELETE FROM admin_codes WHERE id = ?').bind(id).run()
    if (!result.meta.changes) return errorResponse('That admin entry no longer exists.', 404)
    return json({ removed: true })
  }
  return errorResponse('Method not allowed.', 405)
}

const getImageBytes = async (request, limit) => {
  const contentLength = Number(request.headers.get('content-length') || 0)
  if (contentLength > limit) throw new RangeError('Choose a file smaller than 3 MB.')
  const bytes = await readRequestBytes(request, limit)
  if (!bytes.length) throw new TypeError('Choose a file to upload.')
  return bytes
}

const uploadObject = async (env, key, bytes, contentType) => {
  const object = await env.CONTENT.put(key, bytes, {
    onlyIf: { etagDoesNotMatch: '*' },
    httpMetadata: { contentType },
  })
  if (!object) throw new Error('Generated storage key already exists; refusing to overwrite it.')
  return `/assets/${key}`
}

const routeImageUpload = async (request, env, superAdminOnly = false) => {
  if (request.method !== 'POST') return errorResponse('Method not allowed.', 405)
  await requireAdminSession(request, env, superAdminOnly)
  const contentType = (request.headers.get('content-type') || '').split(';')[0].trim().toLowerCase()
  const extension = IMAGE_TYPES.get(contentType)
  if (!extension) return errorResponse('Upload a PNG, JPEG, WebP, GIF, or AVIF image.', 415)
  const bytes = await getImageBytes(request, MAX_IMAGE_SIZE)
  const objectPath = superAdminOnly ? `theme-background/${crypto.randomUUID()}.${extension}` : `${crypto.randomUUID()}.${extension}`
  const image = await uploadObject(env, objectPath, bytes, contentType)
  return json({ image }, 201)
}

const validFontFile = (type, bytes) => {
  const config = FONT_TYPES.get(type)
  if (!config || bytes.length < 4) return false
  if (config.extension === 'ttf') {
    return (bytes[0] === 0 && bytes[1] === 1 && bytes[2] === 0 && bytes[3] === 0)
      || new TextDecoder('ascii').decode(bytes.subarray(0, 4)) === 'true'
  }
  return new TextDecoder('ascii').decode(bytes.subarray(0, 4)) === config.signature
}

const readTheme = async (env) => {
  const settings = await getSettings(env)
  return { ...DEFAULT_THEME_CONFIG, ...settings.theme_config, customFonts: settings.theme_config.customFonts || [] }
}

const saveTheme = async (env, theme) => {
  await env.DB.prepare(
    "UPDATE catalog_state SET theme_config = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = 1",
  ).bind(JSON.stringify(theme)).run()
  const settings = await getSettings(env)
  return mapThemeAssets(settings.theme_config || DEFAULT_THEME_CONFIG)
}

const routeThemeFonts = async (request, env, url) => {
  await requireAdminSession(request, env, true)
  if (request.method === 'POST') {
    const contentType = (request.headers.get('content-type') || '').split(';')[0].trim().toLowerCase()
    const fontType = FONT_TYPES.get(contentType)
    if (!fontType) return errorResponse('Choose a WOFF2, WOFF, TTF, or OTF font file.', 415)
    const name = url.searchParams.get('name') || ''
    if (!name.trim() || name.trim().length > 60) return errorResponse('Enter a font name up to 60 characters.', 400)
    const bytes = await getImageBytes(request, MAX_FONT_SIZE)
    if (!validFontFile(contentType, bytes)) return errorResponse('The file contents do not match a supported font format.', 415)
    const currentTheme = await readTheme(env)
    if (currentTheme.customFonts.length >= 30) return errorResponse('Remove a custom font before adding another.', 400)
    const id = crypto.randomUUID()
    const key = `theme-fonts/${id}.${fontType.extension}`
    const imageUrl = await uploadObject(env, key, bytes, contentType)
    const font = { id, url: imageUrl, format: fontType.format, name: name.trim() }
    const savedTheme = await saveTheme(env, { ...currentTheme, customFonts: [...currentTheme.customFonts, font] })
    return json({ font, themeConfig: savedTheme }, 201)
  }
  if (request.method === 'DELETE') {
    const fontId = url.searchParams.get('fontId') || ''
    if (!new RegExp(`^${UUID}$`, 'i').test(fontId)) return errorResponse('Choose a valid custom font.', 400)
    const currentTheme = await readTheme(env)
    const font = currentTheme.customFonts.find((entry) => entry.id === fontId)
    if (!font) return errorResponse('That custom font no longer exists.', 404)
    const key = getAssetKey(font.url, 'theme-fonts/')
    if (!key || !key.toLowerCase().startsWith(`theme-fonts/${font.id.toLowerCase()}.`)) {
      return errorResponse('The custom font storage path is invalid.', 400)
    }
    const nextTheme = {
      ...currentTheme,
      customFonts: currentTheme.customFonts.filter((entry) => entry.id !== fontId),
      mainTextFont: currentTheme.mainTextFont === `custom:${fontId}` ? 'system' : currentTheme.mainTextFont,
    }
    const savedTheme = await saveTheme(env, nextTheme)
    return json({ removed: true, themeConfig: savedTheme })
  }
  return errorResponse('Method not allowed.', 405)
}

const routePublicAsset = async (request, env, pathname) => {
  if (request.method !== 'GET' && request.method !== 'HEAD') return errorResponse('Method not allowed.', 405)
  let key
  try {
    key = decodeURIComponent(pathname.slice('/assets/'.length))
  } catch {
    return errorResponse('Asset not found.', 404)
  }
  if (!ASSET_KEY_PATTERN.test(key)) return env.ASSETS.fetch(request)
  const cache = request.method === 'GET' ? globalThis.caches?.default : null
  const cacheKey = new Request(request.url, { method: 'GET' })
  if (cache) {
    try {
      const cached = await cache.match(cacheKey)
      if (cached) return cached
    } catch (error) {
      console.warn('Public R2 asset edge-cache lookup failed.', error instanceof Error ? error.name : 'Unknown error')
    }
  }
  const object = await env.CONTENT.get(key)
  if (!object) return errorResponse('Asset not found.', 404)
  const headers = new Headers({
    'Cache-Control': 'public, max-age=31536000, immutable',
    'CDN-Cache-Control': 'public, max-age=31536000, immutable',
    'Content-Type': object.httpMetadata?.contentType || 'application/octet-stream',
    'X-Content-Type-Options': 'nosniff',
  })
  object.writeHttpMetadata(headers)
  headers.set('Cache-Control', 'public, max-age=31536000, immutable')
  headers.set('CDN-Cache-Control', 'public, max-age=31536000, immutable')
  headers.set('X-Content-Type-Options', 'nosniff')
  const response = new Response(request.method === 'HEAD' ? null : object.body, { headers })
  if (cache) {
    try {
      await cache.put(cacheKey, response.clone())
    } catch (error) {
      console.warn('Public R2 asset edge-cache store failed.', error instanceof Error ? error.name : 'Unknown error')
    }
  }
  return response
}

const routeApi = async (request, env, url) => {
  const path = url.pathname === '/api/catalog' ? '/api/catalog/items' : url.pathname
  try {
    if (path === '/api/catalog/items') return await routeCatalogItems(request, env)
    if (path === '/api/catalog/settings') return await routeCatalogSettings(request, env)
    if (path === '/api/admin/verify') return await routeAdminVerify(request, env)
    if (path === '/api/admin/codes') return await routeAdminCodes(request, env)
    if (path === '/api/catalog/image') return await routeImageUpload(request, env)
    if (path === '/api/catalog/theme-background') return await routeImageUpload(request, env, true)
    if (path === '/api/catalog/theme-fonts') return await routeThemeFonts(request, env, url)
    return errorResponse('Not found.', 404)
  } catch (error) {
    if (error.code === 'ADMIN_SESSION_INVALID') return errorResponse(error.message, 401)
    if (error instanceof RangeError) return errorResponse('Choose a file smaller than 3 MB.', 413)
    if (error instanceof TypeError) return errorResponse(error.message, 400)
    console.error('Worker request failed.', { path, method: request.method })
    if (path === '/api/admin/verify') {
      return errorResponse('Admin sign-in is temporarily unavailable. Please try again.', 502)
    }
    return errorResponse('The request could not be completed. Please try again.', 502)
  }
}

export default {
  async fetch(request, env) {
    if (!isAdminTestHostAllowed(request, env)) {
      return errorResponse('The Admin test environment is available only on this computer.', 403)
    }
    if (isReadOnlyPreviewRequest(request, env)) {
      return errorResponse('This preview is read-only. Admin and write operations are disabled.', 403)
    }
    const url = new URL(request.url)
    if (url.pathname.startsWith('/assets/')) return routePublicAsset(request, env, url.pathname)
    if (url.pathname.startsWith('/api/')) return routeApi(request, env, url)
    return env.ASSETS.fetch(request)
  },
}
