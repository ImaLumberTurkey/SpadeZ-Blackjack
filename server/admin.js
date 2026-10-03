import { createHmac, timingSafeEqual } from 'node:crypto'

export const requiredEnv = (name) => {
  const value = process.env[name]
  if (!value) throw new Error(`Missing Vercel environment variable: ${name}`)
  return value
}

const hmac = (value, secret) => createHmac('sha256', secret).update(value).digest('hex')

export const safeEqual = (left, right) => {
  const leftBuffer = Buffer.from(left)
  const rightBuffer = Buffer.from(right)
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer)
}

export const hashPin = (pin) => hmac(pin, requiredEnv('PIN_PEPPER'))

export const supabaseRequest = async (path, { method = 'GET', body, headers = {} } = {}) => {
  const baseUrl = requiredEnv('SUPABASE_URL').replace(/\/$/, '')
  const serviceRoleKey = process.env.SUPABASE_SECRET_KEY || requiredEnv('SUPABASE_SERVICE_ROLE_KEY')
  const requestHeaders = {
    apikey: serviceRoleKey,
    ...headers,
  }

  if (!serviceRoleKey.startsWith('sb_secret_')) {
    requestHeaders.Authorization = `Bearer ${serviceRoleKey}`
  }

  if (body !== undefined) requestHeaders['Content-Type'] = 'application/json'

  const response = await fetch(`${baseUrl}/rest/v1/${path}`, {
    method,
    headers: requestHeaders,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
  const text = await response.text()
  const result = text ? JSON.parse(text) : null

  if (!response.ok) {
    const error = new Error('The Supabase request failed.')
    error.status = response.status
    error.code = result?.code
    throw error
  }

  return result
}

export const allowPinAttempt = async (request) => {
  const forwardedFor = request.headers['x-forwarded-for']
  const address = typeof forwardedFor === 'string' ? forwardedFor.split(',')[0].trim() : 'unknown'
  const fingerprint = hmac(address, requiredEnv('PIN_PEPPER'))
  return supabaseRequest('rpc/consume_admin_pin_attempt', {
    method: 'POST',
    body: { p_fingerprint: fingerprint },
  })
}

const signSession = (payload) => hmac(payload, requiredEnv('SESSION_SECRET'))

export const createSession = (identity) => {
  const payload = Buffer.from(JSON.stringify({
    ...identity,
    expiresAt: Date.now() + 8 * 60 * 60 * 1000,
  })).toString('base64url')
  return `${payload}.${signSession(payload)}`
}

const readSession = (token) => {
  const [payload, signature, extra] = token.split('.')
  if (!payload || !signature || extra) return null

  if (!safeEqual(signature, signSession(payload))) return null

  try {
    const session = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'))
    if (typeof session.name !== 'string' || session.expiresAt <= Date.now()) return null
    return session
  } catch {
    return null
  }
}

export const requireAdminSession = (request, superAdminOnly = false) => {
  const authorization = request.headers.authorization || ''
  const token = authorization.startsWith('Bearer ') ? authorization.slice(7) : ''
  const session = token ? readSession(token) : null

  if (!session || (superAdminOnly && !session.isSuperAdmin)) {
    const error = new Error('Your admin session is invalid or has expired.')
    error.status = 401
    error.code = 'ADMIN_SESSION_INVALID'
    throw error
  }

  return session
}