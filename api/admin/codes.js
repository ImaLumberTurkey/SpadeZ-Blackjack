import { hashPin, requireAdminSession, supabaseRequest } from '../../server/admin.js'

const reportError = (response, error, method) => {
  const status = error.code === 'ADMIN_SESSION_INVALID' ? 401 : 502
  const databaseCode = /^[0-9A-Z]{5}$/.test(error.code || '') ? error.code : 'unknown'
  console.error('Admin code operation failed.', {
    method,
    status: error.status || status,
    code: databaseCode,
  })

  if (error.code === 'ADMIN_SESSION_INVALID') {
    return response.status(401).json({ error: 'Your admin session is invalid or has expired.' })
  }
  if (error.code === '23505') {
    return response.status(409).json({ error: 'That PIN is already assigned to another admin.' })
  }

  const messages = {
    GET: 'Could not load admin accounts. Please try again.',
    POST: 'The admin PIN could not be saved. No PIN was returned as saved. Please try again.',
    DELETE: 'Could not remove that admin account. Please try again.',
  }
  return response.status(status).json({ error: messages[method] || 'The admin request failed. Please try again.' })
}

export default async function handler(request, response) {
  try {
    requireAdminSession(request, true)

    if (request.method === 'GET') {
      const query = new URLSearchParams({ select: 'id,name,created_at', order: 'created_at.desc' })
      const admins = await supabaseRequest(`admin_codes?${query}`)
      return response.status(200).json({ admins })
    }

    if (request.method === 'POST') {
      const name = typeof request.body?.name === 'string' ? request.body.name.trim() : ''
      const pin = typeof request.body?.pin === 'string' ? request.body.pin.trim() : ''
      if (!name || name.length > 80 || !/^\d{4}$/.test(pin)) {
        return response.status(400).json({ error: 'Enter a name and a 4-digit PIN.' })
      }

      const [admin] = await supabaseRequest('admin_codes', {
        method: 'POST',
        headers: { Prefer: 'return=representation' },
        body: { name, pin_hash: hashPin(pin) },
      })

      if (!admin || typeof admin.id !== 'string' || typeof admin.name !== 'string') {
        return response.status(502).json({
          error: 'The admin PIN could not be confirmed as saved. Please try again.',
        })
      }

      return response.status(201).json({ admin: { id: admin.id, name: admin.name } })
    }

    if (request.method === 'DELETE') {
      const id = typeof request.body?.id === 'string' ? request.body.id : ''
      if (!/^[0-9a-f-]{36}$/i.test(id)) {
        return response.status(400).json({ error: 'Choose a valid admin entry.' })
      }

      const query = new URLSearchParams({ id: `eq.${id}`, select: 'id' })
      const [removed] = await supabaseRequest(`admin_codes?${query}`, {
        method: 'DELETE',
        headers: { Prefer: 'return=representation' },
      })
      if (!removed) return response.status(404).json({ error: 'That admin entry no longer exists.' })
      return response.status(200).json({ removed: true })
    }

    return response.status(405).json({ error: 'Method not allowed.' })
  } catch (error) {
    return reportError(response, error, request.method)
  }
}