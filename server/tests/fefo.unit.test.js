// Test unitaire FEFO
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../src/db.js', () => ({
  pool: {
    query: vi.fn()
  }
}))

import { pool } from '../src/db.js'
import { computeNeedsForItem, executeItem } from '../src/utils/fefo.js'

describe('FEFO', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('T-FEFO-01 - computeNeedsForItem calcule les besoins avec waste_rate', async () => {
    pool.query
      .mockResolvedValueOnce([[{
        id: 10,
        planned_portions: 100,
        recipe_id: 7,
        waste_rate: 10
      }]])
      .mockResolvedValueOnce([[
        { product_id: 1, qty_per_portion: 0.25 },
        { product_id: 2, qty_per_portion: 0.1 }
      ]])

    const result = await computeNeedsForItem(10)

    expect(result.item.planned_portions).toBe(100)
    expect(result.needs).toEqual([
      { product_id: 1, qty_needed: 27.500000000000004 },
      { product_id: 2, qty_needed: 11 }
    ])
  })

  it('T-EXEC-04 - executeItem consomme les réservations par date de péremption croissante puis libère le reste', async () => {
    // IMPORTANT: executeItem appelle d’abord computeNeedsForItem => pool.query
    pool.query
      .mockResolvedValueOnce([[{
        id: 20,
        planned_portions: 100,
        recipe_id: 4,
        waste_rate: 0
      }]])
      .mockResolvedValueOnce([[
        { product_id: 1, qty_per_portion: 1 }
      ]])

    const conn = {
      query: vi.fn()
    }

    conn.query
      // purge réservations expirées
      .mockResolvedValueOnce([{ affectedRows: 0 }])

      // réservations FEFO
      .mockResolvedValueOnce([[
        { id: 101, reserved_qty: 60, lot_id: 11, expiry_date: '2026-03-23' },
        { id: 102, reserved_qty: 40, lot_id: 12, expiry_date: '2026-03-25' }
      ]])

      // delete remaining reservations
      .mockResolvedValueOnce([{ affectedRows: 2 }])

      // update meal_plan_item
      .mockResolvedValueOnce([{ affectedRows: 1 }])

      // update meal_plan if all items executed
      .mockResolvedValueOnce([{ affectedRows: 1 }])

    await executeItem(conn, 20, 80, 999)

    const sqlCalls = conn.query.mock.calls.map(([sql]) =>
      String(sql).replace(/\s+/g, ' ').trim()
    )

    expect(
      sqlCalls.some(sql =>
        sql.includes('ORDER BY') &&
        sql.includes('expiry_date') &&
        sql.includes('ASC')
      )
    ).toBe(true)

    expect(conn.query).toHaveBeenCalledWith(
      'UPDATE lot SET quantity = quantity - ? WHERE id = ?',
      [60, 11]
    )

    expect(conn.query).toHaveBeenCalledWith(
      'UPDATE lot SET quantity = quantity - ? WHERE id = ?',
      [20, 12]
    )

    expect(conn.query).toHaveBeenCalledWith(
      'DELETE FROM reservation WHERE meal_plan_item_id=?',
      [20]
    )
  })
})