// server/src/routes/lot.routes.js
import { Router } from 'express';
import { pool } from '../db.js';
import { requireAuth } from '../auth/auth.middleware.js';
import { a } from '../utils/async.js'
import { q3, gt } from '../utils/num.js'

const r = Router();

// GET paginé + recherche (q sur product.name ou batch_number)
r.get('/', requireAuth(), a(async (req, res) => {
    const page = Math.max(1, parseInt(req.query.page || '1', 10));
    const pageSize = Math.min(100, Math.max(1, parseInt(req.query.pageSize || '10', 10)));
    const q = (req.query.q || '').trim();
    const product_id = req.query.product_id ? Number(req.query.product_id) : null;

    const where = [];
    const params = [];
    if (q) { where.push('(p.name LIKE ? OR l.batch_number LIKE ?)'); params.push(`%${q}%`, `%${q}%`) }
    if (product_id) { where.push('l.product_id = ?'); params.push(product_id); }

    const base = `
            FROM lot l
            JOIN product p ON p.id = l.product_id
            ${where.length ? 'WHERE ' + where.join(' AND ') + ' AND ' : 'WHERE '} l.archived=FALSE
            `;
    const [[{ cnt }]] = await pool.query(`SELECT COUNT(*) AS cnt ${base}`, params);
    const offset = (page - 1) * pageSize;
    const [rows] = await pool.query(
        `SELECT l.*, p.name AS product_name ${base} ORDER BY l.expiry_date ASC, l.id ASC LIMIT ? OFFSET ?`,
        [...params, pageSize, offset]
    );

    res.json({ data: rows, total: cnt, page, pageSize });
}))

// POST /lots/expire  (ADMIN)
r.post('/expire', requireAuth(['ADMIN']), a(async (req, res) => {
    const conn = await pool.getConnection(); await conn.beginTransaction();
    try {
        // lots périmés et non archivés
        const [rows] = await conn.query(
            `SELECT id, quantity FROM lot
       WHERE archived=FALSE AND expiry_date < CURDATE()`
        );

        let lotsProcessed = 0, totalLoss = 0;

        for (const lot of rows) {
            // annuler d'abord les réservations sur ce lot
            await conn.query(`DELETE FROM reservation WHERE lot_id=?`, [lot.id]);

            const qty = q3(lot.quantity);
            if (gt(qty)) {
                // enregistrer la perte
                await conn.query(
                    `INSERT INTO stock_movement (type, quantity, meal_plan_item_id, user_id, lot_id, reason)
           VALUES ('LOSS', ?, NULL, ?, ?, 'EXPIRED')`,
                    [qty, req.user.sub, lot.id]
                );
                // vider le lot
                await conn.query(`UPDATE lot SET quantity=0 WHERE id=?`, [lot.id]);
                totalLoss += qty;
            }
            // archiver pour ne plus l'utiliser
            await conn.query(`UPDATE lot SET archived=TRUE WHERE id=?`, [lot.id]);
            lotsProcessed++;
        }

        await conn.commit(); conn.release();
        res.json({ message: 'expired processed', lotsProcessed, totalLoss });
    } catch (e) { await conn.rollback(); conn.release(); throw e; }
}))

// CREATE (lot + mouvement IN)
r.post('/', requireAuth(['ADMIN']), a(async (req, res) => {
    const { product_id, batch_number, expiry_date, quantity } = req.body;
    const qty = q3(quantity)

    if (qty < 0) return res.status(400).json({ error: 'quantity must be >= 0' })

    try {
        //     const [ins] = await pool.query(
        //         `INSERT INTO lot (product_id, batch_number, expiry_date, quantity)
        //    VALUES (?,?,?,?)`,
        //         [product_id, batch_number, expiry_date, Number(quantity)]
        //     );
        //     const lotId = ins.insertId;
        //     if (Number(quantity) > 0) {
        //         await pool.query(
        //             `INSERT INTO stock_movement (type, quantity, meal_plan_item_id, user_id, lot_id)
        //      VALUES ('IN', ?, NULL, ?, ?)`,
        //             [Number(quantity), req.user.sub, lotId]
        //         );
        //     }

        const [[ex]] = await pool.query(
            `SELECT id FROM lot WHERE product_id=? AND batch_number=? AND expiry_date=? AND archived=FALSE FOR UPDATE`,
            [product_id, batch_number, expiry_date]
        )

        if (ex) {
            if (gt(qty)) {
                await pool.query(`UPDATE lot SET quantity = quantity + ? WHERE id=?`, [qty, ex.id]);
                await pool.query(
                    `INSERT INTO stock_movement (type, quantity, meal_plan_item_id, user_id, lot_id)
                     VALUES ('IN', ?, NULL, ?, ?)`,
                    [qty, req.user.sub, ex.id]
                );
            }
            return res.status(200).json({ message: 'merged', id: ex.id });
        }

        // Sinon, crée un nouveau lot
        const [ins] = await pool.query(
            `INSERT INTO lot (product_id, batch_number, expiry_date, quantity)
             VALUES (?,?,?,?)`,
            [product_id, batch_number, expiry_date, qty]
        );
        if (gt(qty)) {
            await pool.query(
                `INSERT INTO stock_movement (type, quantity, meal_plan_item_id, user_id, lot_id)
                 VALUES ('IN', ?, NULL, ?, ?)`,
                [qty, req.user.sub, ins.insertId]
            );
        }
        res.status(201).json({ message: 'created', id: ins.insertId });

    } catch (e) {
        throw e;
    }
}));

// UPDATE (si quantité change -> mouvement ADJUSTMENT du delta)
r.patch('/:id', requireAuth(['ADMIN']), a(async (req, res) => {
    const { id } = req.params;

    if ('quantity' in req.body && Number(req.body.quantity) < 0) {
        return res.status(400).json({ error: 'quantity must be >= 0' });
    }

    const fields = ['product_id', 'batch_number', 'expiry_date', 'quantity'];
    const sets = [], vals = [];
    fields.forEach(f => { if (f in req.body) { sets.push(`${f}=?`); vals.push(req.body[f]); } });
    if (!sets.length) return res.status(400).json({ error: 'no changes' });

    try {

        const [[prev]] = await pool.query('SELECT quantity FROM lot WHERE id=? FOR UPDATE', [id]);
        if (!prev) return res.status(404).json({ error: 'not found' })

        await pool.query(`UPDATE lot SET ${sets.join(', ')} WHERE id=?`, [...vals, id]);

        if (sets.some(s => s.startsWith('quantity='))) {
            const newQty = q3(req.body.quantity);
            const oldQty = q3(prev.quantity);
            const delta = q3(newQty - oldQty); // SIGNÉ : de 4 -> 0 => delta = -4.000
            if (delta !== 0) {
                await pool.query(
                    `INSERT INTO stock_movement (type, quantity, meal_plan_item_id, user_id, lot_id)
                     VALUES ('ADJUSTMENT', ?, NULL, ?, ?)`,
                    [delta, req.user.sub, id]
                )
            }
        }

        res.json({ message: 'updated' });
    } catch (e) {
        throw e;
    }
}))

// DELETE (autorisé seulement si pas d'historique/réservations et quantité=0)
// server/src/routes/lot.routes.js
r.delete('/:id', requireAuth(['ADMIN']), a(async (req, res) => {
    const { id } = req.params;
    const [[lot]] = await pool.query('SELECT quantity FROM lot WHERE id=?', [id]);
    if (!lot) return res.status(404).json({ error: 'not found' });
    if (Number(lot.quantity) !== 0) return res.status(409).json({ error: 'Set quantity to 0 before delete' });

    const [[{ c1 }]] = await pool.query('SELECT COUNT(*) c1 FROM reservation WHERE lot_id=?', [id]);
    const [[{ c2 }]] = await pool.query('SELECT COUNT(*) c2 FROM stock_movement WHERE lot_id=?', [id]);
    if (c1 > 0) return res.status(409).json({ error: 'Cannot delete: lot has reservations' });

    if (c2 > 0) {
        await pool.query('UPDATE lot SET archived=TRUE WHERE id=?', [id]);
        return res.status(200).json({ message: 'archived' });
    }
    await pool.query('DELETE FROM lot WHERE id=?', [id]);
    return res.status(204).end();
}));


export default r
