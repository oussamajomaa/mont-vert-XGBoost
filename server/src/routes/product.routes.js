import { Router } from 'express';
import { pool } from '../db.js';
import { requireAuth } from '../auth/auth.middleware.js';
import { a } from '../utils/async.js';

const r = Router();

// GET paginé + recherche
r.get('/', requireAuth(), a(async (req, res) => {
	const page = Math.max(1, parseInt(req.query.page || '1', 10));
	const pageSize = Math.min(500, Math.max(1, parseInt(req.query.pageSize || '10', 10)));
	const q = (req.query.q || '').trim();

	const where = [];
	const params = [];
	if (q) { where.push('(p.name LIKE ? OR p.unit LIKE ?)'); params.push(`%${q}%`, `%${q}%`); }

	const base = `FROM product p ${where.length ? 'WHERE ' + where.join(' AND ') : ''}`;
	const [[{ cnt }]] = await pool.query(`SELECT COUNT(*) AS cnt ${base}`, params);
	const offset = (page - 1) * pageSize;
	const [rows] = await pool.query(`SELECT p.* ${base} ORDER BY p.name LIMIT ? OFFSET ?`, [...params, pageSize, offset]);

	res.json({ data: rows, total: cnt, page, pageSize });
}));

// CREATE
r.post('/', requireAuth(['ADMIN']), a(async (req, res) => {
	const { name, unit, cost = 0, active = true, alert_threshold = 0 } = req.body;
	await pool.query(
		'INSERT INTO product (name, unit, cost, active, alert_threshold) VALUES (?,?,?,?,?)',
		[name, unit, cost, !!active, alert_threshold]
	);
	res.status(201).json({ message: 'created' });
}));

// UPDATE
r.patch('/:id', requireAuth(['ADMIN']), a(async (req, res) => {
	const { id } = req.params;
	const fields = ['name', 'unit', 'cost', 'active', 'alert_threshold'];
	const sets = [], vals = [];
	fields.forEach(f => { if (f in req.body) { sets.push(`${f}=?`); vals.push(req.body[f]); } });
	if (!sets.length) return res.status(400).json({ error: 'no changes' });
	vals.push(id);
	await pool.query(`UPDATE product SET ${sets.join(', ')} WHERE id=?`, vals);
	res.json({ message: 'updated' });
}));

// DELETE (gère FK en usage)
r.delete('/:id', requireAuth(['ADMIN']), a(async (req, res) => {
	try {
		await pool.query('DELETE FROM product WHERE id=?', [req.params.id]);
		res.status(204).end();
	} catch (e) {
		// MySQL FK: ER_ROW_IS_REFERENCED_2 (1451)
		if (e?.errno === 1451) return res.status(409).json({ error: 'Cannot delete: product in use.' });
		throw e;
	}
}));

export default r;
