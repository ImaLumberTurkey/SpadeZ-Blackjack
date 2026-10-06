import { randomUUID } from 'node:crypto'
import { requireAdminSession, supabaseRequest } from '../../server/admin.js'
import { deleteImage } from '../../server/catalog.js'

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

const readSettings = async () => {
  const [settings] = await supabaseRequest('catalog_state?select=section_config,logo_image&id=eq.true&limit=1')
  if (!settings) throw new Error('Catalog settings have not been initialized. Run the updated Supabase schema.')
  return settings
}

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
    item[field] = value.trim()
  }

  item.image ||= '✦'
  item.tint ||= 'gold'
  if (definition.type === 'playingCard') item.description = 'Playing Card'
  return item
}

const itemIdIsValid = (id) => typeof id === 'string' && /^[a-z0-9][a-z0-9_-]{0,120}$/i.test(id)
const databaseErrorCode = (error) => /^[0-9A-Z]{5}$/.test(error.code || '') ? error.code : ''

const reportError = (response, error, method) => {
  const status = error.code === 'ADMIN_SESSION_INVALID' ? 401 : 502
  const databaseCode = databaseErrorCode(error)
  console.error('Catalog operation failed.', {
    method,
    status: error.status || status,
    databaseCode: databaseCode || 'unavailable',
  })
  return response.status(status).json({
    error: error.code === 'ADMIN_SESSION_INVALID'
      ? 'Your admin session is invalid or has expired.'
      : databaseCode
        ? `The catalog save failed (database error ${databaseCode}).`
        : `The catalog request failed (HTTP ${error.status || status}).`,
  })
}

export default async function handler(request, response) {
  try {
    if (request.method === 'GET') {
      response.setHeader('Cache-Control', 'no-store, max-age=0')
      const [rows, settings] = await Promise.all([
        supabaseRequest('catalog_items?select=id,section_key,data&order=created_at.asc'),
        readSettings(),
      ])
      const catalog = Object.fromEntries(Object.keys(settings.section_config).map((key) => [key, []]))
      for (const row of rows) {
        const section = row.section_key
        if (!catalog[section]) catalog[section] = []
        catalog[section].push({ ...row.data, id: row.id, section })
      }
      return response.status(200).json({
        catalog,
        sectionConfig: settings.section_config,
        customLogo: settings.logo_image || '',
      })
    }

    requireAdminSession(request)
    if (request.method === 'POST') {
      const settings = await readSettings()
      const id = randomUUID()
      const item = itemFromRequest(request.body?.item, settings.section_config, id)
      if (!item) return response.status(400).json({ error: 'Enter a valid item for an existing category.' })
      const [saved] = await supabaseRequest('catalog_items', {
        method: 'POST',
        headers: { Prefer: 'return=representation' },
        body: { id, section_key: item.section, data: item },
      })
      if (!saved || saved.id !== id || saved.section_key !== item.section || !saved.data) {
        return response.status(502).json({ error: 'Supabase did not confirm that the catalog item was saved.' })
      }
      return response.status(201).json({ item: { ...saved.data, id: saved.id, section: saved.section_key } })
    }

    if (request.method === 'PATCH') {
      const id = request.body?.id
      if (!itemIdIsValid(id)) return response.status(400).json({ error: 'Choose a valid catalog item.' })
      const query = new URLSearchParams({ id: `eq.${id}`, select: 'id,section_key,data' })
      const [existing] = await supabaseRequest(`catalog_items?${query}`)
      if (!existing) return response.status(404).json({ error: 'That catalog item no longer exists.' })
      const settings = await readSettings()
      const item = itemFromRequest(request.body?.item, settings.section_config, id)
      if (!item) return response.status(400).json({ error: 'Enter a valid item for an existing category.' })
      const [saved] = await supabaseRequest(`catalog_items?${query}`, {
        method: 'PATCH',
        headers: { Prefer: 'return=representation' },
        body: { section_key: item.section, data: item },
      })
      if (!saved) return response.status(404).json({ error: 'That catalog item could not be updated.' })
      if (existing.data.image !== item.image) {
        deleteImage(existing.data.image).catch((cleanupError) => console.error('Old catalog image cleanup failed.', cleanupError.message))
      }
      return response.status(200).json({ item: { ...saved.data, id: saved.id, section: saved.section_key } })
    }

    if (request.method === 'DELETE') {
      const id = request.body?.id
      if (!itemIdIsValid(id)) return response.status(400).json({ error: 'Choose a valid catalog item.' })
      const query = new URLSearchParams({ id: `eq.${id}`, select: 'id,section_key,data' })
      const [existing] = await supabaseRequest(`catalog_items?${query}`)
      if (!existing) return response.status(404).json({ error: 'That catalog item no longer exists.' })
      await supabaseRequest(`catalog_items?${query}`, { method: 'DELETE' })
      deleteImage(existing.data.image).catch((cleanupError) => console.error('Deleted catalog image cleanup failed.', cleanupError.message))
      return response.status(200).json({ removed: true })
    }

    return response.status(405).json({ error: 'Method not allowed.' })
  } catch (error) {
    return reportError(response, error, request.method)
  }
}