import { requireAdminSession, supabaseRequest } from '../../server/admin.js'
import {
  deleteThemeFont,
  getThemeFontType,
  isThemeFontUrl,
  isValidThemeFont,
  MAX_THEME_FONT_SIZE,
  readThemeFontRequest,
  uploadThemeFont,
} from '../../server/catalog.js'

export const config = { api: { bodyParser: false } }

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

const readThemeConfig = async () => {
  const [settings] = await supabaseRequest('catalog_state?select=theme_config&id=eq.true&limit=1')
  if (!settings) throw new Error('Catalog settings have not been initialized.')
  const themeConfig = { ...DEFAULT_THEME_CONFIG, ...(settings.theme_config || {}) }
  return {
    ...themeConfig,
    customFonts: Array.isArray(themeConfig.customFonts) ? themeConfig.customFonts : [],
  }
}

const saveThemeConfig = async (themeConfig) => {
  const query = new URLSearchParams({ id: 'eq.true', select: 'theme_config' })
  const [saved] = await supabaseRequest(`catalog_state?${query}`, {
    method: 'PATCH',
    headers: { Prefer: 'return=representation' },
    body: { theme_config: themeConfig },
  })
  return saved?.theme_config || null
}

const errorResponse = (response, error) => {
  const status = error.code === 'ADMIN_SESSION_INVALID'
    ? 401
    : error.status || (error.message?.includes('smaller than 3 MB') ? 413 : 502)
  console.error('Theme font operation failed.', { status })
  return response.status(status).json({
    error: error.code === 'ADMIN_SESSION_INVALID'
      ? 'A valid Super Admin session is required.'
      : error.message?.includes('smaller than 3 MB')
        ? error.message
        : 'The custom font operation failed. Please try again.',
  })
}

export default async function handler(request, response) {
  if (!['POST', 'DELETE'].includes(request.method)) {
    return response.status(405).json({ error: 'Method not allowed.' })
  }

  try {
    requireAdminSession(request, true)

    if (request.method === 'POST') {
      const contentType = request.headers['content-type']?.split(';')[0]?.trim().toLowerCase()
      const fontType = getThemeFontType(contentType)
      if (!fontType) return response.status(415).json({ error: 'Choose a WOFF2, WOFF, TTF, or OTF font file.' })

      const name = request.query?.name
      if (typeof name !== 'string' || !name.trim() || name.trim().length > 60) {
        return response.status(400).json({ error: 'Enter a font name up to 60 characters.' })
      }
      const contentLength = Number(request.headers['content-length'] || 0)
      if (contentLength > MAX_THEME_FONT_SIZE) return response.status(413).json({ error: 'Choose a font file smaller than 3 MB.' })

      const bytes = await readThemeFontRequest(request)
      if (bytes.length === 0) return response.status(400).json({ error: 'Choose a font file to upload.' })
      if (!isValidThemeFont(contentType, bytes)) {
        return response.status(415).json({ error: 'The file contents do not match a supported font format.' })
      }

      const currentTheme = await readThemeConfig()
      if (currentTheme.customFonts.length >= 30) {
        return response.status(400).json({ error: 'Remove a custom font before adding another.' })
      }

      const storedFont = await uploadThemeFont(contentType, bytes)
      const font = { ...storedFont, name: name.trim() }
      const nextTheme = { ...currentTheme, customFonts: [...currentTheme.customFonts, font] }
      let savedTheme
      try {
        savedTheme = await saveThemeConfig(nextTheme)
      } catch (error) {
        deleteThemeFont(font.url, font.id).catch((cleanupError) => {
          console.error('Unlinked custom font cleanup failed.', cleanupError.message)
        })
        throw error
      }
      if (!savedTheme) {
        deleteThemeFont(font.url, font.id).catch((error) => {
          console.error('Unlinked custom font cleanup failed.', error.message)
        })
        return response.status(502).json({ error: 'The custom font could not be saved to theme settings.' })
      }
      return response.status(201).json({ font, themeConfig: savedTheme })
    }

    const fontId = request.query?.fontId
    if (typeof fontId !== 'string' || !/^[0-9a-f-]{36}$/i.test(fontId)) {
      return response.status(400).json({ error: 'Choose a valid custom font.' })
    }

    const currentTheme = await readThemeConfig()
    const font = currentTheme.customFonts.find((entry) => entry.id === fontId)
    if (!font) return response.status(404).json({ error: 'That custom font no longer exists.' })
    if (!isThemeFontUrl(font.url, font.id)) return response.status(400).json({ error: 'The custom font storage path is invalid.' })

    const nextTheme = {
      ...currentTheme,
      customFonts: currentTheme.customFonts.filter((entry) => entry.id !== fontId),
      mainTextFont: currentTheme.mainTextFont === `custom:${fontId}` ? 'system' : currentTheme.mainTextFont,
    }
    const savedTheme = await saveThemeConfig(nextTheme)
    if (!savedTheme) return response.status(502).json({ error: 'The font selection could not be safely reset.' })

    await deleteThemeFont(font.url, font.id)
    return response.status(200).json({ removed: true, themeConfig: savedTheme })
  } catch (error) {
    return errorResponse(response, error)
  }
}