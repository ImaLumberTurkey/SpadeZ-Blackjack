import { randomUUID } from 'node:crypto'
import { requiredEnv } from './admin.js'

export const STORAGE_BUCKET = 'spadez-content'
export const MAX_IMAGE_SIZE = 3 * 1024 * 1024
export const MAX_THEME_FONT_SIZE = 3 * 1024 * 1024

const IMAGE_TYPES = {
  'image/avif': 'avif',
  'image/gif': 'gif',
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
}

const THEME_FONT_TYPES = {
  'font/woff2': { extension: 'woff2', format: 'woff2', signature: 'wOF2' },
  'font/woff': { extension: 'woff', format: 'woff', signature: 'wOFF' },
  'font/ttf': { extension: 'ttf', format: 'truetype' },
  'font/otf': { extension: 'otf', format: 'opentype', signature: 'OTTO' },
}

const getServiceKey = () => process.env.SUPABASE_SECRET_KEY || requiredEnv('SUPABASE_SERVICE_ROLE_KEY')

const supabaseHeaders = () => {
  const key = getServiceKey()
  const headers = { apikey: key }
  if (!key.startsWith('sb_secret_')) headers.Authorization = `Bearer ${key}`
  return headers
}

export const getThemeFontType = (contentType) => THEME_FONT_TYPES[contentType]

export const isValidThemeFont = (contentType, bytes) => {
  const type = getThemeFontType(contentType)
  if (!type || !bytes || bytes.length < 4) return false
  if (type.extension === 'ttf') {
    return bytes.subarray(0, 4).equals(Buffer.from([0, 1, 0, 0]))
      || bytes.toString('ascii', 0, 4) === 'true'
  }
  return bytes.toString('ascii', 0, 4) === type.signature
}

export const uploadThemeFont = async (contentType, bytes) => {
  const type = getThemeFontType(contentType)
  const id = randomUUID()
  const objectPath = `theme-fonts/${id}.${type.extension}`
  const { image } = await uploadToStorage(contentType, bytes, objectPath)
  return { id, url: image, format: type.format }
}

const themeFontPath = (url, expectedId) => {
  if (typeof url !== 'string') return ''
  const baseUrl = requiredEnv('SUPABASE_URL').replace(/\/$/, '')
  const prefix = `${baseUrl}/storage/v1/object/public/${STORAGE_BUCKET}/theme-fonts/`
  if (!url.startsWith(prefix)) return ''

  const filename = url.slice(prefix.length)
  const match = /^([0-9a-f-]{36})\.(woff2|woff|ttf|otf)$/i.exec(filename)
  if (!match || (expectedId && match[1] !== expectedId)) return ''
  return `theme-fonts/${filename}`
}

export const isThemeFontUrl = (url, expectedId) => Boolean(themeFontPath(url, expectedId))

export const deleteThemeFont = async (url, expectedId) => {
  const objectPath = themeFontPath(url, expectedId)
  if (!objectPath) return

  const baseUrl = requiredEnv('SUPABASE_URL').replace(/\/$/, '')
  const response = await fetch(`${baseUrl}/storage/v1/object/${STORAGE_BUCKET}/${objectPath}`, {
    method: 'DELETE',
    headers: supabaseHeaders(),
  })
  if (!response.ok && response.status !== 404) {
    throw new Error('The custom font could not be removed from Supabase Storage.')
  }
}

export const getImageExtension = (contentType) => IMAGE_TYPES[contentType]

export const publicImageUrl = (objectPath) => {
  const baseUrl = requiredEnv('SUPABASE_URL').replace(/\/$/, '')
  return `${baseUrl}/storage/v1/object/public/${STORAGE_BUCKET}/${objectPath}`
}

const uploadToStorage = async (contentType, bytes, objectPath) => {
  const baseUrl = requiredEnv('SUPABASE_URL').replace(/\/$/, '')
  const response = await fetch(`${baseUrl}/storage/v1/object/${STORAGE_BUCKET}/${objectPath}`, {
    method: 'POST',
    headers: {
      ...supabaseHeaders(),
      'Content-Type': contentType,
      'x-upsert': 'false',
    },
    body: bytes,
  })
  if (!response.ok) throw new Error('The image could not be saved to Supabase Storage.')
  return { image: publicImageUrl(objectPath), objectPath }
}

export const uploadImage = async (contentType, bytes) => {
  const objectPath = `${randomUUID()}.${getImageExtension(contentType)}`
  return uploadToStorage(contentType, bytes, objectPath)
}

export const uploadThemeBackgroundImage = async (contentType, bytes) => {
  const objectPath = `theme-background/${randomUUID()}.${getImageExtension(contentType)}`
  return uploadToStorage(contentType, bytes, objectPath)
}

const themeBackgroundPath = (image) => {
  if (typeof image !== 'string') return ''
  const baseUrl = requiredEnv('SUPABASE_URL').replace(/\/$/, '')
  const prefix = `${baseUrl}/storage/v1/object/public/${STORAGE_BUCKET}/theme-background/`
  if (!image.startsWith(prefix)) return ''

  const filename = image.slice(prefix.length)
  return /^[0-9a-f-]{36}\.(avif|gif|jpg|png|webp)$/i.test(filename)
    ? `theme-background/${filename}`
    : ''
}

export const isThemeBackgroundImage = (image) => Boolean(themeBackgroundPath(image))

export const deleteThemeBackgroundImage = async (image) => {
  const objectPath = themeBackgroundPath(image)
  if (!objectPath) return

  const baseUrl = requiredEnv('SUPABASE_URL').replace(/\/$/, '')
  const response = await fetch(`${baseUrl}/storage/v1/object/${STORAGE_BUCKET}/${objectPath}`, {
    method: 'DELETE',
    headers: supabaseHeaders(),
  })
  if (!response.ok && response.status !== 404) {
    throw new Error('The old theme background could not be removed from Supabase Storage.')
  }
}

export const deleteImage = async (image) => {
  if (typeof image !== 'string') return
  const baseUrl = requiredEnv('SUPABASE_URL').replace(/\/$/, '')
  const prefix = `${baseUrl}/storage/v1/object/public/${STORAGE_BUCKET}/`
  if (!image.startsWith(prefix)) return

  const objectPath = image.slice(prefix.length)
  if (!/^[0-9a-f-]{36}\.(avif|gif|jpg|png|webp)$/i.test(objectPath)) return

  const response = await fetch(`${baseUrl}/storage/v1/object/${STORAGE_BUCKET}/${objectPath}`, {
    method: 'DELETE',
    headers: supabaseHeaders(),
  })
  if (!response.ok && response.status !== 404) {
    throw new Error('The old image could not be removed from Supabase Storage.')
  }
}

export const readImageRequest = async (request) => {
  const chunks = []
  let total = 0
  for await (const chunk of request) {
    total += chunk.length
    if (total > MAX_IMAGE_SIZE) throw new Error('Choose an image smaller than 3 MB.')
    chunks.push(chunk)
  }
  return Buffer.concat(chunks, total)
}

export const readThemeFontRequest = async (request) => {
  const chunks = []
  let total = 0
  for await (const chunk of request) {
    total += chunk.length
    if (total > MAX_THEME_FONT_SIZE) throw new Error('Choose a font file smaller than 3 MB.')
    chunks.push(chunk)
  }
  return Buffer.concat(chunks, total)
}