// Test d’intégration API ⟺ DB sur meal plan
import { describe, it, expect, vi, beforeEach } from 'vitest'
import request from 'supertest'
import jwt from 'jsonwebtoken'

vi.mock('../src/db.js', () => ({
  pool: {
    query: vi.fn()
  }
}))

vi.mock('../src/utils/fefo.js', () => ({
  createReservationsForItem: vi.fn(),
  executeItem: vi.fn()
}))

import { pool } from '../src/db.js'
import { createReservationsForItem, executeItem } from '../src/utils/fefo.js'
import app from '../src/app.js'

describe('Meal plan API', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.env.JWT_SECRET = 'test-secret'
  })

  function auth(role = 'ADMIN') {
    return `Bearer ${jwt.sign({ sub: 1, role }, process.env.JWT_SECRET)}`
  }

  it('T-RES-03 - confirme un plan et crée les réservations', async () => {
    pool.query
      .mockResolvedValueOnce([[{ status: 'DRAFT' }]])
      .mockResolvedValueOnce([[{ id: 201 }, { id: 202 }]])
      .mockResolvedValueOnce([{ affectedRows: 1 }])

    const res = await request(app)
      .post('/meal-plans/55/confirm')
      .set('Authorization', auth('KITCHEN'))

    expect(res.status).toBe(200)
    expect(createReservationsForItem).toHaveBeenCalledTimes(2)
    expect(createReservationsForItem).toHaveBeenCalledWith(pool, 201)
    expect(createReservationsForItem).toHaveBeenCalledWith(pool, 202)
  })

  it('T-SEC-06 - refuse un KITCHEN sur une route admin-only', async () => {
    const res = await request(app)
      .post('/ml/train')
      .set('Authorization', auth('KITCHEN'))

    expect([401, 403]).toContain(res.status)
  })

  it('T-EXEC-04 - exécution partielle autorisée si plan confirmé', async () => {
    pool.query.mockResolvedValueOnce([[{ status: 'CONFIRMED' }]])

    const res = await request(app)
      .post('/meal-plans/items/88/execute')
      .set('Authorization', auth('ADMIN'))
      .send({ produced_portions: 80 })

    expect(res.status).toBe(200)
    expect(executeItem).toHaveBeenCalledWith(pool, 88, 80, 1)
  })
})