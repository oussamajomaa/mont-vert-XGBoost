import { Router } from 'express';
import { pool } from '../db.js';
import { requireAuth } from '../auth/auth.middleware.js';
import { createReservationsForItem, executeItem } from '../utils/fefo.js';
import { a } from '../utils/async.js';
import { generateMealPlanPdf } from '../services/pdf.service.js';

const r = Router();


// Créer un plan + lignes (sans IA : l'utilisateur choisit)
r.post('/', requireAuth(['ADMIN', 'KITCHEN']), a(async (req, res) => {
	const { period_start, period_end, items = [] } = req.body;

	try {
		const [pi] = await pool.query(
			'INSERT INTO meal_plan (period_start, period_end, status) VALUES (?,?, "DRAFT")',
			[period_start, period_end]
		)
		const planId = pi.insertId;
		for (const it of items) {
			await pool.query(
				`INSERT INTO meal_plan_item (meal_plan_id, recipe_id, planned_portions)
         		 VALUES (?,?,?)`,
				[planId, it.recipe_id, it.planned_portions]
			);
		}

		res.status(201).json({ id: planId });
	} catch (e) {
		throw e;
	}
}));

/* LISTE paginée + recherche (par dates ou statut) */
r.get('/', requireAuth(), a(async (req, res) => {
	const page = Math.max(1, parseInt(req.query.page || '1', 10));
	const pageSize = Math.min(100, Math.max(1, parseInt(req.query.pageSize || '10', 10)));
	const status = (req.query.status || '').trim().toUpperCase(); // DRAFT/CONFIRMED/EXECUTED
	const from = req.query.from || null; // YYYY-MM-DD
	const to = req.query.to || null;

	const where = [];
	const params = [];
	if (status && ['DRAFT', 'CONFIRMED', 'EXECUTED'].includes(status)) { where.push('mp.status=?'); params.push(status); }
	if (from) { where.push('mp.period_start >= ?'); params.push(from); }
	if (to) { where.push('mp.period_end   <= ?'); params.push(to); }

	const base = `FROM meal_plan mp ${where.length ? 'WHERE ' + where.join(' AND ') : ''}`;
	const [[{ cnt }]] = await pool.query(`SELECT COUNT(*) cnt ${base}`, params);
	const offset = (page - 1) * pageSize;
	const [rows] = await pool.query(
		`SELECT mp.*,
       (SELECT COUNT(*) FROM meal_plan_item mi WHERE mi.meal_plan_id = mp.id) AS items_count
     ${base}
     ORDER BY mp.period_start DESC, mp.id DESC
     LIMIT ? OFFSET ?`,
		[...params, pageSize, offset]
	);
	res.json({ data: rows, total: cnt, page, pageSize });
}));

/* DÉTAIL d’un plan : lignes + noms de recettes */
r.get('/:id/items', requireAuth(), a(async (req, res) => {
	const [rows] = await pool.query(
		`SELECT mi.*, r.name AS recipe_name
     FROM meal_plan_item mi
     JOIN recipe r ON r.id = mi.recipe_id
     WHERE mi.meal_plan_id = ?
     ORDER BY mi.id`, [req.params.id]
	);
	res.json(rows);
}));

/* AJOUT d’une ligne (plat) dans un plan */
r.post('/:id/items', requireAuth(['ADMIN', 'KITCHEN']), a(async (req, res) => {
	const { id } = req.params
	const { recipe_id, planned_portions } = req.body

	// interdit si plan déjà confirmé/exécuté
	const [[mp]] = await pool.query('SELECT status FROM meal_plan WHERE id=?', [id]);
	if (!mp) return res.status(404).json({ error: 'plan not found' });
	if (mp.status !== 'DRAFT') return res.status(409).json({ error: 'plan is not editable (not DRAFT)' });

	const [ins] = await pool.query(
		`INSERT INTO meal_plan_item (meal_plan_id, recipe_id, planned_portions)
     	 VALUES (?,?,?)`, [id, recipe_id, planned_portions]
	);
	res.status(201).json({ id: ins.insertId });
}));

/* SUPPRESSION d'une ligne (seulement si plan DRAFT) */
r.delete('/:planId/items/:itemId', requireAuth(['ADMIN', 'KITCHEN']), a(async (req, res) => {
	const { planId, itemId } = req.params;
	
	// Vérifier que l'item appartient bien au plan
	const [[it]] = await pool.query('SELECT meal_plan_id FROM meal_plan_item WHERE id=?', [itemId]);
	if (!it) return res.status(404).json({ error: 'item not found' });
	if (it.meal_plan_id !== Number(planId)) return res.status(400).json({ error: 'item does not belong to this plan' });
	
	const [[mp]] = await pool.query('SELECT status FROM meal_plan WHERE id=?', [planId]);
	if (!mp || mp.status !== 'DRAFT') return res.status(409).json({ error: 'plan is not editable (not DRAFT)' });

	await pool.query('DELETE FROM meal_plan_item WHERE id=?', [itemId]);
	res.status(204).end();
}));

// CONFIRM = crée les réservations FEFO (statut -> CONFIRMED)
r.post('/:id/confirm', requireAuth(['ADMIN', 'KITCHEN']), a(async (req, res) => {
	const { id } = req.params;
	try {
		const [[plan]] = await pool.query('SELECT status FROM meal_plan WHERE id=? FOR UPDATE', [id]);
		if (!plan) return res.status(404).json({ error: 'plan not found' })
		if (plan.status !== 'DRAFT') return res.status(409).json({ error: 'plan not editable (not DRAFT)' })

		const [items] = await pool.query('SELECT id FROM meal_plan_item WHERE meal_plan_id=?', [id]);

		// 1) statut -> CONFIRMED
		await pool.query('UPDATE meal_plan SET status="CONFIRMED" WHERE id=?', [id]);

		// 2) réservations FEFO
		for (const it of items) {
			await createReservationsForItem(pool, it.id);
		}

		res.json({ message: 'plan confirmed & reservations created' });
	} catch (e) {
		// renvoie une erreur claire si stock insuffisant
		return res.status(400).json({ error: e.message || 'confirmation failed' });
	}
}));

// EXECUTE = consomme FEFO et libère le reste
r.post('/items/:itemId/execute', requireAuth(['ADMIN', 'KITCHEN']), a(async (req, res) => {
	const { itemId } = req.params;
	const { produced_portions } = req.body;

	try {
		// Vérifier que le plan est CONFIRMED (sinon, pas de FEFO garanti)
		const [[st]] = await pool.query(
			`SELECT mp.status
			 FROM meal_plan_item mi
			 JOIN meal_plan mp ON mp.id = mi.meal_plan_id
			 WHERE mi.id=? FOR UPDATE`,
			[itemId]
		);
		if (!st) return res.status(404).json({ error: 'item not found' })
		if (st.status !== 'CONFIRMED') return res.status(409).json({ error: 'plan must be CONFIRMED before execution' })

		await executeItem(pool, Number(itemId), Number(produced_portions), req.user.sub);
		
		res.json({ message: 'item executed' });
	} catch (e) {
		res.status(400).json({ error: e.message || 'execution failed' });
	}
}));


r.get('/:id', requireAuth(), a(async (req, res) => {
	const [[row]] = await pool.query(
		`SELECT mp.*,
         (SELECT COUNT(*) FROM meal_plan_item mi WHERE mi.meal_plan_id=mp.id) AS items_count
     	 FROM meal_plan mp WHERE mp.id=?`, [req.params.id]
	);
	if (!row) return res.status(404).json({ error: 'plan not found' });
	res.json(row);
}));

/**
 * GET /:id/export-pdf
 * Génère et télécharge le PDF du meal plan
 */
r.get('/:id/export-pdf', requireAuth(), a(async (req, res) => {
	const planId = parseInt(req.params.id, 10);
	
	if (isNaN(planId)) {
		return res.status(400).json({ error: 'Invalid plan ID' });
	}
	
	try {
		const pdfBuffer = await generateMealPlanPdf(planId);
		
		res.setHeader('Content-Type', 'application/pdf');
		res.setHeader('Content-Disposition', `attachment; filename="meal-plan-${planId}.pdf"`);
		res.setHeader('Content-Length', pdfBuffer.length);
		
		res.send(pdfBuffer);
	} catch (error) {
		console.error('PDF generation error:', error);
		res.status(500).json({ error: error.message || 'Erreur lors de la génération du PDF' });
	}
}));

export default r;