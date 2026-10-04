import { requireAdminSession, supabaseRequest } from '../../server/admin.js'
import { deleteImage } from '../../server/catalog.js'

const VALID_FIELDS = new Set([
  'name', 'image', 'description', 'requirement', 'buff', 'requiredPowerups', 'howToObtain', 'completeRules',
])

const validateSectionConfig = (value) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const entries = Object.entries(value)
  if (entries.length < 1 || entries.length > 100) return null
  const result = {}
  for (const [key, meta] of entries) {
    if (!/^[a-z0-9][a-z0-9-]{0,79}$/i.test(key) || !meta || typeof meta !== 'object') return null
    if (typeof meta.label !== 'string' || !meta.label.trim() || meta.label.length > 80) return null
    if (typeof meta.type !== 'string' || meta.type.length > 40) return null
    if (!Array.isArray(meta.fields) || !meta.fields.every((field) => VALID_FIELDS.has(field))) return null
    result[key] = { label: meta.label.trim(), type: meta.type, fields: meta.fields }
  }
  return result
}

const validateLogo = (value) => typeof value === 'string'
  && value.length <= 2048
  && !/^(data:|blob:)/i.test(value.trim())

export default async function handler(request, response) {
  if (request.method !== 'PATCH') return response.status(405).json({ error: 'Method not allowed.' })

  try {
    requireAdminSession(request, true)
    const [current] = await supabaseRequest('catalog_state?select=section_config,logo_image&id=eq.true&limit=1')
    if (!current) return response.status(502).json({ error: 'Catalog settings have not been initialized. Run the updated Supabase schema.' })

    const updates = {}
    if (Object.hasOwn(request.body || {}, 'sectionConfig')) {
      const sectionConfig = validateSectionConfig(request.body.sectionConfig)
      if (!sectionConfig) return response.status(400).json({ error: 'The category configuration is invalid.' })
      updates.section_config = sectionConfig
    }
    if (Object.hasOwn(request.body || {}, 'customLogo')) {
      const customLogo = request.body.customLogo
      if (!validateLogo(customLogo)) return response.status(400).json({ error: 'The logo image reference is invalid.' })
      updates.logo_image = customLogo
    }
    if (Object.keys(updates).length === 0) return response.status(400).json({ error: 'There are no settings to save.' })

    const query = new URLSearchParams({ id: 'eq.true', select: 'section_config,logo_image' })
    const [saved] = await supabaseRequest(`catalog_state?${query}`, {
      method: 'PATCH',
      headers: { Prefer: 'return=representation' },
      body: updates,
    })
    if (!saved) return response.status(502).json({ error: 'The catalog settings could not be confirmed as saved.' })

    if (Object.hasOwn(updates, 'logo_image') && current.logo_image !== saved.logo_image) {
      deleteImage(current.logo_image).catch((error) => console.error('Old logo cleanup failed.', error.message))
    }
    return response.status(200).json({ sectionConfig: saved.section_config, customLogo: saved.logo_image || '' })
  } catch (error) {
    const status = error.code === 'ADMIN_SESSION_INVALID' ? 401 : 502
    console.error('Catalog settings operation failed.', { status: error.status || status })
    return response.status(status).json({
      error: error.code === 'ADMIN_SESSION_INVALID'
        ? 'Your admin session is invalid or has expired.'
        : 'The catalog settings could not be saved. Please try again.',
    })
  }
}