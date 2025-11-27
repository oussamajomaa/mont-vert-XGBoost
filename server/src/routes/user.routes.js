// server/src/routes/user.routes.js
import { Router } from 'express';
import { pool } from '../db.js';
import { requireAuth } from '../auth/auth.middleware.js';
import { a } from '../utils/async.js';
import bcrypt from 'bcrypt';

const r = Router();

// LIST paginée + recherche
r.get('/', requireAuth(['ADMIN']), a(async (req, res) => {
    const page = Math.max(1, parseInt(req.query.page || '1', 10));
    const pageSize = Math.min(100, Math.max(1, parseInt(req.query.pageSize || '10', 10)));
    const q = (req.query.q || '').trim();

    const where = [];
    const params = [];
    if (q) { where.push('(u.name LIKE ? OR u.email LIKE ? OR u.role LIKE ?)'); params.push(`%${q}%`, `%${q}%`, `%${q}%`); }

    const base = `FROM user u ${where.length ? 'WHERE ' + where.join(' AND ') : ''}`;
    const [[{ cnt }]] = await pool.query(`SELECT COUNT(*) AS cnt ${base}`, params);
    const [rows] = await pool.query(
        `SELECT u.id, u.name, u.email, u.role, u.active, u.created_at
     ${base} ORDER BY u.created_at DESC LIMIT ? OFFSET ?`,
        [...params, pageSize, (page - 1) * pageSize]
    );
    res.json({ data: rows, total: cnt, page, pageSize });
}));

// UPDATE (name, role, active, password?)
r.patch('/:id', requireAuth(['ADMIN']), a(async (req, res) => {
    const { id } = req.params;
    const { name, role, active, password } = req.body;

    // on évite de rendre inactif/retirer le rôle du dernier admin
    if (role || active === false) {
        const [[{ admins }]] = await pool.query(`SELECT COUNT(*) AS admins FROM user WHERE role='ADMIN' AND active=TRUE`);
        const [[me]] = await pool.query(`SELECT role, active FROM user WHERE id=?`, [id]);
        if (!me) return res.status(404).json({ error: 'not found' });
        const becomesNonAdmin = role && role !== 'ADMIN';
        const becomesInactive = active === false;
        if (admins <= 1 && (me.role === 'ADMIN') && (becomesNonAdmin || becomesInactive)) {
            return res.status(409).json({ error: 'Cannot demote or deactivate the last active ADMIN' });
        }
    }

    const sets = [], vals = [];
    if (name !== undefined) { sets.push('name=?'); vals.push(name); }
    if (role !== undefined) { sets.push('role=?'); vals.push(role); }
    if (active !== undefined) { sets.push('active=?'); vals.push(!!active); }
    if (password) {
        const hash = await bcrypt.hash(password, Number(process.env.BCRYPT_ROUNDS || 10));
        sets.push('password=?'); vals.push(hash);
    }
    if (!sets.length) return res.status(400).json({ error: 'no changes' });
    vals.push(id);

    await pool.query(`UPDATE user SET ${sets.join(', ')} WHERE id=?`, vals);
    res.json({ message: 'updated' });
}));

// DELETE (pas soi-même, pas le dernier admin)
r.delete('/:id', requireAuth(['ADMIN']), a(async (req, res) => {
    const { id } = req.params;
    if (Number(id) === Number(req.user.sub)) {
        return res.status(409).json({ error: 'You cannot delete yourself' });
    }
    const [[u]] = await pool.query(`SELECT role, active FROM user WHERE id=?`, [id]);
    if (!u) return res.status(404).json({ error: 'not found' });

    if (u.role === 'ADMIN' && u.active) {
        const [[{ admins }]] = await pool.query(`SELECT COUNT(*) AS admins FROM user WHERE role='ADMIN' AND active=TRUE`);
        if (admins <= 1) return res.status(409).json({ error: 'Cannot delete the last active ADMIN' });
    }
    await pool.query(`DELETE FROM user WHERE id=?`, [id]);
    res.status(204).end();
}));

export default r;
