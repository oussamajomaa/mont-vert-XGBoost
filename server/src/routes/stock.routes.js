// server/src/routes/stock.routes.js
import { Router } from 'express';
import { pool } from '../db.js';
import { requireAuth } from '../auth/auth.middleware.js';
import { a } from '../utils/async.js';

const r = Router();

/* GET /stock/available?product_id=123
   Retourne lots triés par expiry_date (FEFO) + totaux (on_hand, reserved, available) */
r.get('/available', requireAuth(), a(async (req, res) => {
    const product_id = Number(req.query.product_id);
    if (!product_id) return res.status(400).json({ error: 'product_id required' });

    const [lots] = await pool.query(
        `SELECT l.id, l.expiry_date, l.quantity,
            GREATEST(0, l.quantity - IFNULL(res.reserved,0)) AS available
            FROM lot l
            LEFT JOIN (
            SELECT lot_id, SUM(reserved_qty) AS reserved
            FROM reservation rv
            JOIN meal_plan_item mi ON mi.id = rv.meal_plan_item_id
            JOIN meal_plan mp ON mp.id = mi.meal_plan_id
            WHERE mp.status='CONFIRMED' AND mi.produced_portions IS NULL
            GROUP BY lot_id
            ) res ON res.lot_id = l.id
            WHERE l.product_id=?
            AND l.archived=FALSE
            AND l.expiry_date >= CURDATE()
            ORDER BY l.expiry_date ASC, l.id ASC`,
            [product_id]
    );

    const on_hand = lots.reduce((s, x) => s + Number(x.quantity), 0);
    const available = lots.reduce((s, x) => s + Number(x.available), 0);
    const reserved = on_hand - available;

    res.json({ product_id, on_hand, reserved, available, lots });
}));

export default r;
