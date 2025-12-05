// server/src/routes/maintenance.routes.js
import { Router } from 'express'
import { pool } from '../db.js'
import { requireAuth } from '../auth/auth.middleware.js'
import { a as asyncHandler } from '../utils/async.js'

const r = Router()

// POST /maintenance/stock-snapshot/run
// Prend un snapshot du stock actuel dans stock_snapshot
r.post(
    '/stock-snapshot/run',
    requireAuth(['ADMIN']),
    asyncHandler(async (req, res) => {
        // 1) On récupère le stock actuel par produit
        const [rows] = await pool.query(
            `
      SELECT 
        p.id AS product_id,
        COALESCE(SUM(l.quantity), 0) AS available_qty,
        IFNULL(MIN(DATEDIFF(l.expiry_date, CURDATE())), 999) AS days_to_expiry
      FROM product p
      LEFT JOIN lot l
        ON l.product_id = p.id
       AND l.archived = FALSE
      GROUP BY p.id
      `
        )

        const today = new Date().toISOString().slice(0, 10)

        // 2) On insère/écrase le snapshot du jour
        for (const row of rows) {
            await pool.query(
                `
        INSERT INTO stock_snapshot (snapshot_date, product_id, available_qty, days_to_expiry)
        VALUES (?,?,?,?)
        ON DUPLICATE KEY UPDATE
          available_qty = VALUES(available_qty),
          days_to_expiry = VALUES(days_to_expiry)
        `,
                [today, row.product_id, row.available_qty, row.days_to_expiry]
            )
        }

        res.json({ snapshot_date: today, count: rows.length })
    })
)

export default r
