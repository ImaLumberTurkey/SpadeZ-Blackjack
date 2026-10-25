import assert from 'node:assert/strict'
import test from 'node:test'

import { hashPin, isAdminTestHostAllowed } from './index.js'
import worker from './index.js'

const pepper = 'admin-test-only-pepper'
const superAdminPin = '7193'
const regularAdminPin = '2846'
const sectionConfig = {
  cards: {
    label: 'Cards',
    type: 'card',
    fields: ['name', 'image', 'description'],
    messageTabs: [],
  },
}
const themeConfig = {
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

const createTestBindings = async () => {
  const admins = [{
    id: '11111111-1111-4111-8111-111111111111',
    name: 'Local Regular Admin',
    pin_hash: await hashPin(regularAdminPin, pepper),
    created_at: '2026-01-01T00:00:00.000Z',
  }]
  const items = []
  const objects = new Map()
  let regularHashLookupCount = 0
  const state = {
    section_config: JSON.stringify(sectionConfig),
    logo_image: '',
    theme_config: JSON.stringify(themeConfig),
  }

  const db = {
    prepare(sql) {
      let values = []
      const statement = {
        bind(...bound) {
          values = bound
          return statement
        },
        async first() {
          if (sql.includes('INSERT INTO admin_pin_attempts')) return { allowed: 1 }
                if (sql.includes('SELECT id, name FROM admin_codes WHERE pin_hash')) {
            regularHashLookupCount += 1
            const admin = admins.find((entry) => entry.pin_hash === values[0])
            return admin ? { id: admin.id, name: admin.name } : null
          }
          if (sql.includes('SELECT section_config, logo_image, theme_config FROM catalog_state')) {
            return { ...state }
          }
          if (sql.includes('SELECT id FROM catalog_items WHERE id')) {
            return items.some((item) => item.id === values[0]) ? { id: values[0] } : null
          }
          throw new Error(`Unexpected test query: ${sql}`)
        },
        async all() {
          if (sql.includes('SELECT id, name, created_at FROM admin_codes')) {
            return { results: admins.map(({ id, name, created_at }) => ({ id, name, created_at })) }
          }
          if (sql.includes('SELECT id, section_key, data FROM catalog_items')) {
            return { results: items.map((item) => ({ ...item, data: JSON.stringify(item.data) })) }
          }
          throw new Error(`Unexpected test query: ${sql}`)
        },
        async run() {
          if (sql.includes('INSERT INTO admin_codes')) {
            admins.push({
              id: values[0],
              name: values[1],
              pin_hash: values[2],
              created_at: '2026-01-02T00:00:00.000Z',
            })
            return { meta: { changes: 1 } }
          }
          if (sql.includes('DELETE FROM admin_codes')) {
            const index = admins.findIndex((entry) => entry.id === values[0])
            if (index < 0) return { meta: { changes: 0 } }
            admins.splice(index, 1)
            return { meta: { changes: 1 } }
          }
          if (sql.includes('INSERT INTO catalog_items')) {
            items.push({ id: values[0], section_key: values[1], data: JSON.parse(values[2]) })
            return { meta: { changes: 1 } }
          }
          if (sql.includes('UPDATE catalog_items')) {
            const item = items.find((entry) => entry.id === values[2])
            if (!item) return { meta: { changes: 0 } }
            item.section_key = values[0]
            item.data = JSON.parse(values[1])
            return { meta: { changes: 1 } }
          }
          if (sql.includes('DELETE FROM catalog_items')) {
            const index = items.findIndex((entry) => entry.id === values[0])
            if (index < 0) return { meta: { changes: 0 } }
            items.splice(index, 1)
            return { meta: { changes: 1 } }
          }
          if (sql.includes('UPDATE catalog_state SET')) {
            for (const column of ['section_config', 'logo_image', 'theme_config']) {
              if (sql.includes(`${column} = ?`)) {
                state[column] = values[0]
                break
              }
            }
            return { meta: { changes: 1 } }
          }
          throw new Error(`Unexpected test write: ${sql}`)
        },
      }
      return statement
    },
    async batch(statements) {
      return statements.map(() => ({ results: [{ allowed: 1 }] }))
    },
  }

  return {
    DB: db,
    CONTENT: {
      async put(key, bytes, options) {
        objects.set(key, { bytes: new Uint8Array(bytes), contentType: options.httpMetadata.contentType })
        return { etag: 'local-test-etag' }
      },
    },
    ASSETS: { async fetch() { return new Response('local frontend') } },
    PIN_PEPPER: pepper,
    SESSION_SECRET: 'admin-test-session-signing-key',
    SUPER_ADMIN_PIN: superAdminPin,
    SUPER_ADMIN_NAME: 'Local Super Admin',
    ADMIN_TEST_LOCAL_ONLY: 'true',
    PREVIEW_READ_ONLY: 'false',
    testState: { admins, items, objects, state, get regularHashLookupCount() { return regularHashLookupCount } },
  }
}

const callJson = async (env, path, { method = 'GET', body, token } = {}) => {
  const headers = new Headers()
  if (body !== undefined) headers.set('Content-Type', 'application/json')
  if (token) headers.set('Authorization', `Bearer ${token}`)
  const response = await worker.fetch(new Request(`http://127.0.0.1:8788${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  }), env)
  return { response, body: await response.json() }
}

const signIn = async (env, pin) => {
  const { response, body } = await callJson(env, '/api/admin/verify', {
    method: 'POST',
    body: { pin },
  })
  assert.equal(response.status, 200)
  return body.admin
}

test('Admin test host guard permits loopback only and denies remote hosts', async () => {
  const env = { ADMIN_TEST_LOCAL_ONLY: 'true' }
  for (const host of ['localhost', '127.0.0.1', '[::1]']) {
    assert.equal(isAdminTestHostAllowed(new Request(`http://${host}/`), env), true)
  }
  assert.equal(isAdminTestHostAllowed(new Request('https://admin-test.example.com/'), env), false)

  let bindingAccessed = false
  const response = await worker.fetch(
    new Request('https://admin-test.example.com/api/catalog'),
    {
      ...env,
      DB: { prepare() { bindingAccessed = true; throw new Error('D1 must not be accessed') } },
      ASSETS: { async fetch() { bindingAccessed = true; return new Response('unexpected') } },
    },
  )
  assert.equal(response.status, 403)
  assert.equal(bindingAccessed, false)
})

test('Super Admin and regular Admin logins preserve PIN-hash compatibility and permissions', async () => {
  const env = await createTestBindings()
  const originalAdmin = { ...env.testState.admins[0] }
  const superAdmin = await signIn(env, superAdminPin)
  assert.equal(env.testState.regularHashLookupCount, 0)
  const regularAdmin = await signIn(env, regularAdminPin)

  assert.equal(superAdmin.name, 'Local Super Admin')
  assert.equal(superAdmin.isSuperAdmin, true)
  assert.equal(regularAdmin.name, 'Local Regular Admin')
  assert.equal(regularAdmin.isSuperAdmin, false)
  assert.ok(superAdmin.token)
  assert.ok(regularAdmin.token)

  const regularAdminList = await callJson(env, '/api/admin/codes', { token: regularAdmin.token })
  assert.equal(regularAdminList.response.status, 401)
  const regularThemeChange = await callJson(env, '/api/catalog/settings', {
    method: 'PATCH',
    token: regularAdmin.token,
    body: { themeConfig: { ...themeConfig, accentColor: '#112233' } },
  })
  assert.equal(regularThemeChange.response.status, 401)

  const superAdminList = await callJson(env, '/api/admin/codes', { token: superAdmin.token })
  assert.equal(superAdminList.response.status, 200)
  assert.deepEqual(superAdminList.body.admins.map(({ id, name }) => ({ id, name })), [
    { id: '11111111-1111-4111-8111-111111111111', name: 'Local Regular Admin' },
  ])
  assert.equal(JSON.stringify(superAdminList.body).includes('pin_hash'), false)
  assert.deepEqual(env.testState.admins[0], originalAdmin)
})

test('Super Admin creates a regular Admin hash with the new pepper without changing imported Admins', async () => {
  const env = await createTestBindings()
  const importedAdmin = { ...env.testState.admins[0] }
  const superAdmin = await signIn(env, superAdminPin)
  const added = await callJson(env, '/api/admin/codes', {
    method: 'POST',
    token: superAdmin.token,
    body: { name: 'New Pepper Admin', pin: '5931' },
  })
  assert.equal(added.response.status, 201)
  const createdRecord = env.testState.admins.find((admin) => admin.id === added.body.admin.id)
  assert.ok(createdRecord)
  assert.equal(createdRecord.pin_hash, await hashPin('5931', env.PIN_PEPPER))
  assert.deepEqual(env.testState.admins[0], importedAdmin)

  const createdAdmin = await signIn(env, '5931')
  assert.equal(createdAdmin.name, 'New Pepper Admin')
  assert.equal(createdAdmin.isSuperAdmin, false)
})

test('regular Admin can create and edit catalog items and upload images in the test bucket', async () => {
  const env = await createTestBindings()
  const regularAdmin = await signIn(env, regularAdminPin)
  const created = await callJson(env, '/api/catalog/items', {
    method: 'POST',
    token: regularAdmin.token,
    body: { item: { name: 'Local Test Card', section: 'cards', description: 'Before edit' } },
  })
  assert.equal(created.response.status, 201)
  assert.equal(created.body.item.name, 'Local Test Card')

  const edited = await callJson(env, '/api/catalog/items', {
    method: 'PATCH',
    token: regularAdmin.token,
    body: { id: created.body.item.id, item: { name: 'Edited Test Card', section: 'cards', description: 'After edit' } },
  })
  assert.equal(edited.response.status, 200)
  assert.equal(edited.body.item.description, 'After edit')
  assert.equal(env.testState.items.length, 1)

  const upload = await worker.fetch(new Request('http://127.0.0.1:8788/api/catalog/image', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${regularAdmin.token}`,
      'Content-Type': 'image/png',
    },
    body: new Uint8Array([137, 80, 78, 71]),
  }), env)
  assert.equal(upload.status, 201)
  const uploaded = await upload.json()
  assert.match(uploaded.image, /^\/assets\/[0-9a-f-]+\.png$/i)
  assert.equal(env.testState.objects.size, 1)
})

test('Super Admin can change theme and upload a background; session tampering is rejected', async () => {
  const env = await createTestBindings()
  const superAdmin = await signIn(env, superAdminPin)
  const nextTheme = { ...themeConfig, accentColor: '#123456' }
  const changed = await callJson(env, '/api/catalog/settings', {
    method: 'PATCH',
    token: superAdmin.token,
    body: { themeConfig: nextTheme },
  })
  assert.equal(changed.response.status, 200)
  assert.equal(changed.body.themeConfig.accentColor, '#123456')

  const upload = await worker.fetch(new Request('http://127.0.0.1:8788/api/catalog/theme-background', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${superAdmin.token}`,
      'Content-Type': 'image/png',
    },
    body: new Uint8Array([137, 80, 78, 71]),
  }), env)
  assert.equal(upload.status, 201)
  const uploaded = await upload.json()
  assert.match(uploaded.image, /^\/assets\/theme-background\/[0-9a-f-]+\.png$/i)
  assert.equal(env.testState.objects.size, 1)

  const tampered = await callJson(env, '/api/catalog/items', {
    method: 'POST',
    token: `${superAdmin.token}x`,
    body: { item: { name: 'Must not save', section: 'cards' } },
  })
  assert.equal(tampered.response.status, 401)
  assert.equal(env.testState.items.length, 0)
})
