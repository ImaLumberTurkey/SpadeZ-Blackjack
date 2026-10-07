import { randomUUID } from 'node:crypto'
import { requiredEnv } from './admin.js'

export const STORAGE_BUCKET = 'spadez-content'
export const MAX_IMAGE_SIZE = 3 * 1024 * 1024

const IMAGE_TYPES = {
  'image/avif': 'avif',
  'image/gif': 'gif',
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
}

const getServiceKey = () => process.env.SUPABASE_SECRET_KEY || requiredEnv('SUPABASE_SERVICE_ROLE_KEY')

const supabaseHeaders = () => {
  const key = getServiceKey()
  const headers = { apikey: key }
  if (!key.startsWith('sb_secret_')) headers.Authorization = `Bearer ${key}`
  return headers
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