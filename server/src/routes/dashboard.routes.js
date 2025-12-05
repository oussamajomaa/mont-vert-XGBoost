// server/src/routes/dashboard.routes.js
import { Router } from 'express'
import { pool } from '../db.js'
import { requireAuth } from '../auth/auth.middleware.js'
import { a } from '../utils/async.js'

const r = Router()

r.get('/overview', requireAuth(['ADMIN','KITCHEN','DIRECTOR']), a(async (req, res) => {
  const days = Number(req.query.days || 30)

  // 1) Valeur de stock (actif, non expiré)
  const [[sv]] = await pool.query(
    `SELECT COALESCE(SUM(l.quantity * p.cost),0) AS stock_value
     FROM lot l
     JOIN product p ON p.id=l.product_id
     WHERE l.archived=FALSE AND l.expiry_date >= CURDATE()`
  )

  // 2) Lots qui expirent bientôt
  const [[exp7]]  = await pool.query(
    `SELECT COUNT(*) AS c FROM lot l
     WHERE l.archived=FALSE AND l.quantity>0
       AND l.expiry_date BETWEEN CURDATE() AND DATE_ADD(CURDATE(), INTERVAL 7 DAY)`
  )
  const [[exp14]] = await pool.query(
    `SELECT COUNT(*) AS c FROM lot l
     WHERE l.archived=FALSE AND l.quantity>0
       AND l.expiry_date BETWEEN CURDATE() AND DATE_ADD(CURDATE(), INTERVAL 14 DAY)`
  )

  // 2.bis) Lots déjà périmés (à traiter)
  const [[expiredNow]] = await pool.query(
    `SELECT COUNT(*) AS c FROM lot l
     WHERE l.archived=FALSE AND l.quantity>0 AND l.expiry_date < CURDATE()`
  )

  // 3) Répartition des plans
  const [plans] = await pool.query(`SELECT status, COUNT(*) AS c FROM meal_plan GROUP BY status`)
  const planCounts = { DRAFT:0, CONFIRMED:0, EXECUTED:0 }
  for (const p of plans) planCounts[p.status] = Number(p.c)

  // 4) Séries jour/type avec valeur en euros
  const [series] = await pool.query(
    `SELECT DATE(sm.moved_at) AS d, sm.type,
            ROUND(SUM(sm.quantity * p.cost), 2) AS value_eur
     FROM stock_movement sm
     JOIN lot l ON l.id=sm.lot_id
     JOIN product p ON p.id=l.product_id
     WHERE sm.moved_at >= DATE_SUB(CURDATE(), INTERVAL ? DAY)
     GROUP BY DATE(sm.moved_at), sm.type
     ORDER BY d ASC`, [days]
  )

  // 5) Totaux 30j en euros
  const [totals] = await pool.query(
    `SELECT sm.type, ROUND(SUM(sm.quantity * p.cost), 2) AS value_eur
     FROM stock_movement sm
     JOIN lot l ON l.id=sm.lot_id
     JOIN product p ON p.id=l.product_id
     WHERE sm.moved_at >= DATE_SUB(CURDATE(), INTERVAL ? DAY)
     GROUP BY sm.type`, [days]
  )
  const tmap = { IN:0, OUT:0, ADJUSTMENT:0, LOSS:0 }
  totals.forEach(t => { tmap[t.type] = Number(t.value_eur) })

  // Liste des pertes (30j)
  const [losses] = await pool.query(
    `SELECT sm.id, sm.moved_at, sm.quantity AS qty,
            ROUND(sm.quantity * p.cost, 2) AS cost_eur,
            sm.reason, p.name AS product, l.batch_number, l.expiry_date
     FROM stock_movement sm
     JOIN lot l ON l.id=sm.lot_id
     JOIN product p ON p.id=l.product_id
     WHERE sm.type='LOSS' AND sm.moved_at >= DATE_SUB(CURDATE(), INTERVAL ? DAY)
     ORDER BY sm.moved_at DESC LIMIT 100`, [days]
  )

  // Taux de perte
  const denom = tmap.OUT + tmap.LOSS
  const lossRate = denom > 0 ? Number((tmap.LOSS / denom).toFixed(3)) : 0

  // 6) Top produits consommés (OUT)
  const [topProducts] = await pool.query(
    `SELECT p.id, p.name, p.unit, ROUND(SUM(sm.quantity),3) AS qty
     FROM stock_movement sm
     JOIN lot l ON l.id=sm.lot_id
     JOIN product p ON p.id=l.product_id
     WHERE sm.type='OUT' AND sm.moved_at >= DATE_SUB(CURDATE(), INTERVAL ? DAY)
     GROUP BY p.id, p.name, p.unit
     ORDER BY qty DESC
     LIMIT 8`, [days]
  )

  // 7) Lots proches de DLC (pas périmés)
  const [expiringLots] = await pool.query(
    `SELECT l.id, l.batch_number, l.expiry_date, l.quantity,
            p.name AS product_name, p.unit
     FROM lot l
     JOIN product p ON p.id=l.product_id
     WHERE l.archived=FALSE AND l.quantity>0
       AND l.expiry_date BETWEEN CURDATE() AND DATE_ADD(CURDATE(), INTERVAL 21 DAY)
     ORDER BY l.expiry_date ASC, l.id ASC
     LIMIT 20`
  )

  // 8) Pertes liées aux expirations (tableau 30j)
  const [expiredRows] = await pool.query(
    `SELECT m.id, DATE(m.moved_at) AS moved_date, ROUND(m.quantity,3) AS qty,
            l.id AS lot_id, l.batch_number, l.expiry_date,
            p.name AS product_name, p.unit
     FROM stock_movement m
     JOIN lot l ON l.id = m.lot_id
     JOIN product p ON p.id = l.product_id
     WHERE m.type='LOSS' AND m.reason='EXPIRED'
       AND m.moved_at >= DATE_SUB(CURDATE(), INTERVAL ? DAY)
     ORDER BY m.moved_at DESC, m.id DESC
     LIMIT 100`, [days]
  )

  // 9) Produits en alerte / réappro
  const [lowStock] = await pool.query(
    `WITH res AS (
       SELECT lot_id, SUM(reserved_qty) AS reserved
       FROM reservation rv
       JOIN meal_plan_item mi ON mi.id = rv.meal_plan_item_id
       JOIN meal_plan mp ON mp.id = mi.meal_plan_id
       WHERE mp.status='CONFIRMED' AND mi.produced_portions IS NULL
       GROUP BY lot_id
     )
     SELECT p.id, p.name, p.unit, p.alert_threshold,
            ROUND(COALESCE(SUM(GREATEST(0, l.quantity - IFNULL(res.reserved,0))),0),3) AS available
     FROM product p
     LEFT JOIN lot l ON l.product_id=p.id
                     AND l.archived=FALSE
                     AND l.expiry_date >= CURDATE()
     LEFT JOIN res ON res.lot_id = l.id
     WHERE p.active=TRUE
     GROUP BY p.id, p.name, p.unit, p.alert_threshold
     HAVING p.alert_threshold > 0 AND available <= p.alert_threshold
     ORDER BY (CASE WHEN p.alert_threshold>0 THEN available/p.alert_threshold ELSE 1 END) ASC
     LIMIT 20`
  )

  const [toReplenish] = await pool.query(
    `SELECT p.id, p.name, p.unit,
            IFNULL(SUM(l.quantity),0) AS stock_qty,
            p.alert_threshold
     FROM product p
     LEFT JOIN lot l ON l.product_id = p.id AND l.archived = FALSE
     WHERE p.active = TRUE
     GROUP BY p.id
     HAVING stock_qty < p.alert_threshold
     ORDER BY stock_qty ASC`
  )

  // ========== DONNÉES FEFO ==========

  // 10) Produits à risque (expirent dans ≤7 jours)
  const [atRiskProducts] = await pool.query(`
    SELECT 
      p.id AS product_id,
      p.name AS product_name,
      p.unit,
      p.cost,
      DATEDIFF(l.expiry_date, CURDATE()) AS days_until_expiry,
      GREATEST(0, l.quantity - COALESCE(res.reserved, 0)) AS available
    FROM lot l
    JOIN product p ON p.id = l.product_id
    LEFT JOIN (
      SELECT lot_id, SUM(reserved_qty) AS reserved
      FROM reservation rv
      JOIN meal_plan_item mi ON mi.id = rv.meal_plan_item_id
      JOIN meal_plan mp ON mp.id = mi.meal_plan_id
      WHERE mp.status = 'CONFIRMED' AND mi.produced_portions IS NULL
      GROUP BY lot_id
    ) res ON res.lot_id = l.id
    WHERE l.archived = FALSE
      AND l.quantity > 0
      AND l.expiry_date >= CURDATE()
      AND DATEDIFF(l.expiry_date, CURDATE()) <= 7
    ORDER BY l.expiry_date ASC
  `)

  let totalAtRiskQty = 0
  let totalAtRiskValue = 0
  const uniqueProductsAtRisk = new Set()
  for (const r of atRiskProducts) {
    const available = Number(r.available)
    if (available > 0) {
      totalAtRiskQty += available
      totalAtRiskValue += available * Number(r.cost)
      uniqueProductsAtRisk.add(r.product_id)
    }
  }

  // 11) Top produits gaspillés
  const [topWastedProducts] = await pool.query(`
    SELECT 
      p.id, p.name, p.unit,
      ROUND(SUM(sm.quantity), 3) AS total_loss,
      ROUND(SUM(sm.quantity * p.cost), 2) AS loss_value
    FROM stock_movement sm
    JOIN lot l ON l.id = sm.lot_id
    JOIN product p ON p.id = l.product_id
    WHERE sm.type IN ('LOSS', 'EXPIRED')
      AND sm.moved_at >= DATE_SUB(CURDATE(), INTERVAL ? DAY)
    GROUP BY p.id, p.name, p.unit
    ORDER BY total_loss DESC
    LIMIT 5
  `, [days])

  // 12) Économies FEFO estimées
  const [[fefoUsage]] = await pool.query(`
    SELECT 
      COALESCE(SUM(sm.quantity), 0) AS total_fefo_used,
      COALESCE(SUM(sm.quantity * p.cost), 0) AS total_fefo_value
    FROM stock_movement sm
    JOIN lot l ON l.id = sm.lot_id
    JOIN product p ON p.id = l.product_id
    WHERE sm.type = 'OUT'
      AND sm.meal_plan_item_id IS NOT NULL
      AND sm.moved_at >= DATE_SUB(CURDATE(), INTERVAL ? DAY)
  `, [days])

  const [[currentLossData]] = await pool.query(`
    SELECT 
      COALESCE(SUM(sm.quantity), 0) AS total_qty,
      COALESCE(SUM(sm.quantity * p.cost), 0) AS total_value
    FROM stock_movement sm
    JOIN lot l ON l.id = sm.lot_id
    JOIN product p ON p.id = l.product_id
    WHERE sm.type IN ('LOSS', 'EXPIRED')
      AND sm.moved_at >= DATE_SUB(CURDATE(), INTERVAL ? DAY)
  `, [days])

  const fefoUsed = Number(fefoUsage.total_fefo_used)
  const fefoValue = Number(fefoUsage.total_fefo_value)
  const currentLossQty = Number(currentLossData.total_qty)
  const currentLossValue = Number(currentLossData.total_value)
  
  // Estimation : sans FEFO, on aurait ~15% de pertes en plus
  const estimatedSavingsQty = Math.max(0, fefoUsed * 0.15)
  const estimatedSavingsValue = Math.max(0, fefoValue * 0.15)

  // 13) Comparaison avec période précédente
  const previousStart = new Date()
  previousStart.setDate(previousStart.getDate() - days * 2)
  const currentStart = new Date()
  currentStart.setDate(currentStart.getDate() - days)

  const [[previousLoss]] = await pool.query(`
    SELECT 
      COALESCE(SUM(sm.quantity), 0) AS total_qty,
      COALESCE(SUM(sm.quantity * p.cost), 0) AS total_value
    FROM stock_movement sm
    JOIN lot l ON l.id = sm.lot_id
    JOIN product p ON p.id = l.product_id
    WHERE sm.type IN ('LOSS', 'EXPIRED')
      AND sm.moved_at >= ? AND sm.moved_at < ?
  `, [previousStart, currentStart])

  const previousLossQty = Number(previousLoss.total_qty)
  const previousLossValue = Number(previousLoss.total_value)
  const lossChangePercent = previousLossValue > 0 
    ? ((currentLossValue - previousLossValue) / previousLossValue * 100) 
    : 0

  res.json({
    kpis: {
      stock_value: Number(sv.stock_value),
      lots_expiring_7: Number(exp7.c),
      lots_expiring_14: Number(exp14.c),
      lots_expired_now: Number(expiredNow.c),
      plans: planCounts,
      totals_30d: tmap,
      loss_rate_30d: lossRate,
      expired_share_of_loss_30d: 0
    },
    series,
    topProducts,
    expiringLots,
    expiredRows,
    lowStock,
    losses,
    toReplenish,
    days,
    // ========== DONNÉES FEFO ==========
    fefo: {
      at_risk: {
        products_count: uniqueProductsAtRisk.size,
        total_qty: Number(totalAtRiskQty.toFixed(2)),
        estimated_value: Number(totalAtRiskValue.toFixed(2))
      },
      top_wasted: topWastedProducts.map(p => ({
        id: p.id,
        name: p.name,
        unit: p.unit,
        total_loss: Number(p.total_loss),
        loss_value: Number(p.loss_value)
      })),
      savings: {
        plans_executed: planCounts.EXECUTED,
        qty_consumed_fefo: Number(fefoUsed.toFixed(2)),
        value_consumed_fefo: Number(fefoValue.toFixed(2)),
        estimated_savings_qty: Number(estimatedSavingsQty.toFixed(2)),
        estimated_savings_eur: Number(estimatedSavingsValue.toFixed(2))
      },
      current_loss: {
        qty: Number(currentLossQty.toFixed(2)),
        value: Number(currentLossValue.toFixed(2))
      },
      comparison: {
        previous_loss_qty: Number(previousLossQty.toFixed(2)),
        previous_loss_value: Number(previousLossValue.toFixed(2)),
        change_percent: Number(lossChangePercent.toFixed(1)),
        trend: lossChangePercent < -5 ? 'improving' : lossChangePercent > 5 ? 'worsening' : 'stable'
      }
    }
  })
}))

export default r
