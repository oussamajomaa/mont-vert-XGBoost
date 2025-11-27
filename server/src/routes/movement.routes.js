import { Router } from 'express';
import { pool } from '../db.js';
import { requireAuth } from '../auth/auth.middleware.js';
import { a } from '../utils/async.js';

const r = Router();

// GET /movements?page=&pageSize=&q=&type=&from=&to=&product_id=&lot_id=&user_id=&plan_id=
r.get('/', requireAuth(['ADMIN']), a(async (req, res) => {
  const page = Math.max(1, parseInt(req.query.page || '1', 10));
  const pageSize = Math.min(100, Math.max(1, parseInt(req.query.pageSize || '10', 10)));

  const q = (req.query.q || '').trim();
  const type = (req.query.type || '').trim().toUpperCase();
  const product_id = req.query.product_id ? Number(req.query.product_id) : null;
  const lot_id = req.query.lot_id ? Number(req.query.lot_id) : null;
  const user_id = req.query.user_id ? Number(req.query.user_id) : null;
  const plan_id = req.query.plan_id ? Number(req.query.plan_id) : null;
  const from = req.query.from || null; // 'YYYY-MM-DD'
  const to = req.query.to || null;     // 'YYYY-MM-DD'

  const where = [];
  const params = [];

  if (q) {
    where.push('(p.name LIKE ? OR l.batch_number LIKE ? OR u.name LIKE ? OR r.name LIKE ?)');
    params.push(`%${q}%`, `%${q}%`, `%${q}%`, `%${q}%`);
  }
  if (type && ['IN','OUT','ADJUSTMENT','LOSS'].includes(type)) { where.push('m.type = ?'); params.push(type); }
  if (product_id) { where.push('p.id = ?'); params.push(product_id); }
  if (lot_id) { where.push('l.id = ?'); params.push(lot_id); }
  if (user_id) { where.push('u.id = ?'); params.push(user_id); }
  if (plan_id) { where.push('mp.id = ?'); params.push(plan_id); }
  if (from) { where.push('m.moved_at >= ?'); params.push(from); }
  if (to) { where.push('m.moved_at < DATE_ADD(?, INTERVAL 1 DAY)'); params.push(to); }

  const base = `
    FROM stock_movement m
    JOIN lot l ON l.id = m.lot_id
    JOIN product p ON p.id = l.product_id
    JOIN user u ON u.id = m.user_id
    LEFT JOIN meal_plan_item mi ON mi.id = m.meal_plan_item_id
    LEFT JOIN meal_plan mp ON mp.id = mi.meal_plan_id
    LEFT JOIN recipe r ON r.id = mi.recipe_id
    ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
  `;

  const [[{ cnt }]] = await pool.query(`SELECT COUNT(*) AS cnt ${base}`, params);
  const offset = (page - 1) * pageSize;

  const [rows] = await pool.query(
    `SELECT m.id, m.type, m.moved_at, m.quantity, m.reason,
            l.id AS lot_id, l.batch_number, l.expiry_date,
            p.id AS product_id, p.name AS product_name, p.unit,
            u.id AS user_id, u.name AS user_name,
            mi.id AS meal_plan_item_id, mp.id AS meal_plan_id,
            r.name AS recipe_name
     ${base}
     ORDER BY m.moved_at DESC, m.id DESC
     LIMIT ? OFFSET ?`,
    [...params, pageSize, offset]
  );

  res.json({ data: rows, total: cnt, page, pageSize });
}));

export default r;
