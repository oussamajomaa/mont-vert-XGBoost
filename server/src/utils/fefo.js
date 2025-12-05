// utils/fefo.js
import { pool } from '../db.js'
import { q3, gt } from '../utils/num.js'

export async function computeNeedsForItem(itemId) {
	const [[item]] = await pool.query(
		`SELECT mpi.id, mpi.planned_portions, r.id AS recipe_id, r.waste_rate
     FROM meal_plan_item mpi JOIN recipe r ON r.id=mpi.recipe_id
     WHERE mpi.id=?`, [itemId])
	if (!item) throw new Error('meal_plan_item not found')

	const [lines] = await pool.query(
		`SELECT ri.product_id, ri.qty_per_portion
     FROM recipe_item ri WHERE ri.recipe_id=?`, [item.recipe_id])

	const factor = 1 + Number(item.waste_rate || 0) / 100
	const needs = lines.map(li => ({
		product_id: li.product_id,
		qty_needed: Number(li.qty_per_portion) * item.planned_portions * factor
	}))
	return { needs, item }
}

export async function createReservationsForItem(conn, itemId) {
	const { needs } = await computeNeedsForItem(itemId)

	for (const need of needs) {
		let remaining = need.qty_needed
		const [lots] = await conn.query(
			`SELECT l.id,
			GREATEST(0, l.quantity - IFNULL(res.reserved,0)) AS available,
			l.expiry_date
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
			ORDER BY l.expiry_date ASC
			FOR UPDATE`,
			[need.product_id]
		)

		for (const lot of lots) {
			if (remaining <= 0) break
			const take = Math.min(remaining, Number(lot.available))
			if (take > 0) {
				await conn.query(
					`INSERT INTO reservation (reserved_qty, meal_plan_item_id, lot_id)
           VALUES (?,?,?)`,
					[take, itemId, lot.id]
				)
				remaining -= take
			}
		}
		if (remaining > 0) throw new Error(`Not enough stock to reserve for product ${need.product_id}`)
	}
}

/** Consomme FEFO pour CHAQUE produit de la ligne, puis libère toutes les réservations restantes. */
export async function executeItem(conn, itemId, producedPortions, userId) {
	const { needs, item } = await computeNeedsForItem(itemId)
	const ratio = Number(producedPortions) / Number(item.planned_portions || 1)

	for (const need of needs) {
		let remaining = q3(need.qty_needed * ratio)

		// (a) Purge des réservations expirées AVANT de consommer
		await conn.query(
			`DELETE rv FROM reservation rv
			 JOIN lot l ON l.id = rv.lot_id
			 WHERE rv.meal_plan_item_id=? AND l.expiry_date < CURDATE()`,
			[itemId]
		)

		// (b) Consommer d'abord les réservations du produit courant (FEFO)
		const [resRows] = await conn.query(
			`SELECT rv.id, rv.reserved_qty, rv.lot_id, l.expiry_date
             FROM reservation rv
             JOIN lot l ON l.id = rv.lot_id
             WHERE rv.meal_plan_item_id=? 
			 AND l.product_id=?
			 AND l.expiry_date >= CURDATE()
             ORDER BY l.expiry_date ASC
             FOR UPDATE`,
			[itemId, need.product_id]
		)



		for (const r of resRows) {
			if (!gt(remaining)) break
			const can = q3(Number(r.reserved_qty))
			const take = q3(Math.min(remaining, can))
			if (!gt(take)) continue

			await conn.query(`UPDATE lot SET quantity = quantity - ? WHERE id = ?`, [take, r.lot_id])
			await conn.query(
				`INSERT INTO stock_movement (type, quantity, meal_plan_item_id, user_id, lot_id)
         		 VALUES ('OUT', ?, ?, ?, ?)`,
				[take, itemId, userId, r.lot_id]
			)
			await conn.query(`UPDATE reservation SET reserved_qty = reserved_qty - ? WHERE id = ?`, [take, r.id])
			remaining = q3(remaining - take)
		}



		// (c) Compléter si nécessaire sur lots disponibles (hors réservations d'autres items CONFIRMED)
		if (gt(remaining)) {

			const [lots] = await conn.query(
				`SELECT l.id,
						GREATEST(0, l.quantity - IFNULL(res.reserved,0)) AS available,
						l.expiry_date
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
				ORDER BY l.expiry_date ASC
				FOR UPDATE`,
				[need.product_id]
			)

			for (const lot of lots) {
				if (!gt(remaining)) break
				const can = q3(Number(lot.available))
				const take = q3(Math.min(remaining, can))
				if (!gt(take)) continue

				await conn.query(`UPDATE lot SET quantity = quantity - ? WHERE id = ?`, [take, lot.id])
				await conn.query(
					`INSERT INTO stock_movement (type, quantity, meal_plan_item_id, user_id, lot_id)
           			 VALUES ('OUT', ?, ?, ?, ?)`,
					[take, itemId, userId, lot.id]
				)

				remaining = q3(remaining - take)
			}
			const [[prod]] = await conn.query('SELECT name FROM product WHERE id=?', [need.product_id])
			if (gt(remaining)) throw new Error(`Not enough available stock at execution for "${prod?.name || need.product_id}"`)
		}
	}

	// 3) Libérer toutes les réservations restantes de la ligne
	await conn.query(`DELETE FROM reservation WHERE meal_plan_item_id=?`, [itemId])

	// 4) Marquer la ligne exécutée
	await conn.query(
		`UPDATE meal_plan_item SET produced_portions=?, execution_date=CURDATE() WHERE id=?`,
		[producedPortions, itemId]
	)

	// 5) Si toutes les lignes du plan sont exécutées, statut du plan -> EXECUTED
	await conn.query(
		`UPDATE meal_plan mp
    	 JOIN meal_plan_item mi ON mi.meal_plan_id = mp.id
		 SET mp.status='EXECUTED'
		 WHERE mp.id = (SELECT meal_plan_id FROM meal_plan_item WHERE id=?)
         AND NOT EXISTS (
         SELECT 1 FROM meal_plan_item x WHERE x.meal_plan_id=mp.id AND x.produced_portions IS NULL
        )`,
		[itemId]
	)
}
