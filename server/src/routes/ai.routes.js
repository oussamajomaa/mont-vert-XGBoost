// server/src/routes/ai.routes.js
import { Router } from 'express'
import { requireAuth } from '../auth/auth.middleware.js'
import { a } from '../utils/async.js'
import {
    getSuggestions,
    getAtRiskProducts,
    getMaxPortionsForRecipe
} from '../services/suggestion.service.js'

const r = Router()

/**
 * GET /ai/suggestions
 * Retourne les plats recommandés basés sur le stock disponible et la priorité FEFO.
 * 
 * Query params:
 *   - portions: nombre de portions à préparer (défaut: 10)
 *   - limit: nombre max de suggestions (défaut: 10)
 * 
 * Response:
 *   - suggestions: liste triée par score FEFO décroissant
 *   - at_risk_products: produits avec DLC ≤ 7 jours
 */
r.get('/suggestions', requireAuth(), a(async (req, res) => {
    const portions = Math.max(1, parseInt(req.query.portions || '10', 10))
    const limit = Math.min(50, Math.max(1, parseInt(req.query.limit || '10', 10)))

    const suggestions = await getSuggestions(portions, limit)
    const atRiskProducts = await getAtRiskProducts(7)

    // Statistiques globales
    const feasibleCount = suggestions.filter(s => s.feasible).length
    const urgentCount = suggestions.filter(s => s.feasible && s.urgent_ingredients > 0).length

    res.json({
        params: { portions, limit },
        stats: {
            total_suggestions: suggestions.length,
            feasible: feasibleCount,
            with_urgent_ingredients: urgentCount,
            at_risk_products: atRiskProducts.length
        },
        suggestions,
        at_risk_products: atRiskProducts
    })
}))

/**
 * GET /ai/suggestions/recipe/:id
 * Retourne le nombre maximum de portions réalisables pour une recette.
 */
r.get('/suggestions/recipe/:id', requireAuth(), a(async (req, res) => {
    const recipeId = parseInt(req.params.id, 10)
    if (isNaN(recipeId)) {
        return res.status(400).json({ error: 'Invalid recipe ID' })
    }

    const result = await getMaxPortionsForRecipe(recipeId)
    res.json(result)
}))

/**
 * GET /ai/at-risk
 * Retourne les produits avec stock proche de la DLC.
 * 
 * Query params:
 *   - days: seuil en jours (défaut: 7)
 */
r.get('/at-risk', requireAuth(), a(async (req, res) => {
    const days = Math.max(1, parseInt(req.query.days || '7', 10))
    const products = await getAtRiskProducts(days)

    // Grouper par produit pour avoir une vue consolidée
    const grouped = new Map()
    for (const p of products) {
        if (!grouped.has(p.product_id)) {
            grouped.set(p.product_id, {
                product_id: p.product_id,
                product_name: p.product_name,
                unit: p.unit,
                total_at_risk: 0,
                lots: []
            })
        }
        const entry = grouped.get(p.product_id)
        entry.total_at_risk += p.available
        entry.lots.push({
            lot_id: p.lot_id,
            batch_number: p.batch_number,
            expiry_date: p.expiry_date,
            days_until_expiry: p.days_until_expiry,
            available: p.available
        })
    }

    res.json({
        threshold_days: days,
        products_count: grouped.size,
        lots_count: products.length,
        products: Array.from(grouped.values())
    })
}))

/**
 * POST /ai/simulate
 * Simule la consommation FEFO pour un plan de repas.
 * Utile pour prévisualiser l'impact avant de confirmer un plan.
 * 
 * Body:
 *   - items: [{ recipe_id, portions }]
 */
r.post('/simulate', requireAuth(), a(async (req, res) => {
    const { items = [] } = req.body

    if (!Array.isArray(items) || items.length === 0) {
        return res.status(400).json({ error: 'items array required' })
    }

    const results = []
    let allFeasible = true

    for (const item of items) {
        const { recipe_id, portions = 10 } = item
        const suggestions = await getSuggestions(portions, 100)
        const match = suggestions.find(s => s.recipe_id === recipe_id)

        if (match) {
            results.push({
                recipe_id,
                recipe_name: match.recipe_name,
                portions,
                feasible: match.feasible,
                fefo_score: match.fefo_score,
                missing_ingredients: match.missing_ingredients,
                lots_to_use: match.lots_to_use
            })
            if (!match.feasible) allFeasible = false
        } else {
            results.push({
                recipe_id,
                portions,
                feasible: false,
                error: 'Recipe not found'
            })
            allFeasible = false
        }
    }

    res.json({
        all_feasible: allFeasible,
        items: results
    })
}))

export default r
