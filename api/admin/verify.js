import {
  allowPinAttempt,
  createSession,
  hashPin,
  requiredEnv,
  safeEqual,
  supabaseRequest,
} from '../../server/admin.js'

export default async function handler(request, response) {
  if (request.method !== 'POST') {
    return response.status(405).json({ error: 'Method not allowed.' })
  }

  const pin = typeof request.body?.pin === 'string' ? request.body.pin.trim() : ''
  if (!/^\d{4}$/.test(pin)) {
    return response.status(400).json({ error: 'Enter a 4-digit PIN.' })
  }

  try {
    const allowed = await allowPinAttempt(request)
    if (!allowed) {
      return response.status(429).json({ error: 'Too many attempts. Try again in 15 minutes.' })
    }

    const hashedPin = hashPin(pin)
    const superAdminPin = requiredEnv('SUPER_ADMIN_PIN')
    let identity

    if (safeEqual(hashedPin, hashPin(superAdminPin))) {
      identity = { name: process.env.SUPER_ADMIN_NAME || 'Super Admin', isSuperAdmin: true }
    } else {
      const query = new URLSearchParams({
        select: 'id,name',
        pin_hash: `eq.${hashedPin}`,
        limit: '1',
      })
      const [admin] = await supabaseRequest(`admin_codes?${query}`)
      if (!admin) return response.status(401).json({ error: 'That PIN was not found in the admin registry.' })
      identity = { id: admin.id, name: admin.name, isSuperAdmin: false }
    }

    return response.status(200).json({ admin: { ...identity, token: createSession(identity) } })
  } catch (error) {
    const databaseCode = /^[0-9A-Z]{5}$/.test(error.code || '') ? error.code : 'unknown'
    console.error('Admin PIN verification failed.', {
      status: error.status || 500,
      code: databaseCode,
    })
    return response.status(502).json({ error: 'Admin sign-in is temporarily unavailable. Please try again.' })
  }
}