import { requireAdminSession } from '../../server/admin.js'
import { getImageExtension, MAX_IMAGE_SIZE, readImageRequest, uploadImage } from '../../server/catalog.js'

export const config = { api: { bodyParser: false } }

export default async function handler(request, response) {
  if (request.method !== 'POST') return response.status(405).json({ error: 'Method not allowed.' })

  try {
    requireAdminSession(request)
    const contentType = request.headers['content-type']?.split(';')[0]?.trim().toLowerCase()
    if (!getImageExtension(contentType)) {
      return response.status(415).json({ error: 'Upload a PNG, JPEG, WebP, GIF, or AVIF image.' })
    }
    const contentLength = Number(request.headers['content-length'] || 0)
    if (contentLength > MAX_IMAGE_SIZE) return response.status(413).json({ error: 'Choose an image smaller than 3 MB.' })
    const bytes = await readImageRequest(request)
    if (bytes.length === 0) return response.status(400).json({ error: 'Choose an image to upload.' })
    const { image } = await uploadImage(contentType, bytes)
    return response.status(201).json({ image })
  } catch (error) {
    const status = error.code === 'ADMIN_SESSION_INVALID' ? 401 : error.message?.includes('smaller than 3 MB') ? 413 : 502
    console.error('Catalog image upload failed.', { status: error.status || status })
    return response.status(status).json({
      error: error.code === 'ADMIN_SESSION_INVALID'
        ? 'Your admin session is invalid or has expired.'
        : error.message?.includes('smaller than 3 MB')
          ? error.message
          : 'The image could not be uploaded. Please try again.',
    })
  }
}