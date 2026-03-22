
// un test direct, indépendant du reste Test RBAC simple et rentable
import { describe, it, expect, vi } from 'vitest'
import jwt from 'jsonwebtoken'
import { requireAuth } from '../src/auth/auth.middleware.js'

describe('requireAuth', () => {
  it('retourne 401 sans token', () => {
    const req = { headers: {}, cookies: {} }
    const res = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn()
    }
    const next = vi.fn()

    requireAuth(['ADMIN'])(req, res, next)

    expect(res.status).toHaveBeenCalledWith(401)
    expect(next).not.toHaveBeenCalled()
  })

  it('retourne 403 si rôle interdit', () => {
    process.env.JWT_SECRET = 'test-secret'

    const token = jwt.sign({ sub: 1, role: 'KITCHEN' }, process.env.JWT_SECRET)
    const req = {
      headers: { authorization: `Bearer ${token}` },
      cookies: {}
    }
    const res = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn()
    }
    const next = vi.fn()

    requireAuth(['ADMIN'])(req, res, next)

    expect(res.status).toHaveBeenCalledWith(403)
    expect(next).not.toHaveBeenCalled()
  })

  it('laisse passer un ADMIN', () => {
    process.env.JWT_SECRET = 'test-secret'

    const token = jwt.sign({ sub: 1, role: 'ADMIN' }, process.env.JWT_SECRET)
    const req = {
      headers: { authorization: `Bearer ${token}` },
      cookies: {}
    }
    const res = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn()
    }
    const next = vi.fn()

    requireAuth(['ADMIN'])(req, res, next)

    expect(next).toHaveBeenCalled()
    expect(req.user.role).toBe('ADMIN')
  })
})