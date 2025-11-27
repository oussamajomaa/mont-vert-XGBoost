// server/src/services/suggestion.service.js
import { pool } from '../db.js';

/**
 * Récupère le stock disponible par produit (FEFO), en excluant les réservations actives.
 * Retourne un Map: product_id -> { available, lots: [{ lot_id, qty, expiry_date, days_until_expiry }] }
 */
export async function getAvailableStockByProduct() {
    const [rows] = await pool.query(`
        SELECT 
            l.product_id,
            l.id AS lot_id,
            l.expiry_date,
            DATEDIFF(l.expiry_date, CURDATE()) AS days_until_expiry,
            GREATEST(0, l.quantity - IFNULL(res.reserved, 0)) AS available
        FROM lot l
        LEFT JOIN (
            SELECT lot_id, SUM(reserved_qty) AS reserved
            FROM reservation rv
            JOIN meal_plan_item mi ON mi.id = rv.meal_plan_item_id
            JOIN meal_plan mp ON mp.id = mi.meal_plan_id
            WHERE mp.status = 'CONFIRMED' AND mi.produced_portions IS NULL
            GROUP BY lot_id
        ) res ON res.lot_id = l.id
        WHERE l.archived = FALSE
          AND l.expiry_date >= CURDATE()
          AND l.quantity > 0
        ORDER BY l.product_id, l.expiry_date ASC
    `);

    const stockMap = new Map();

    for (const row of rows) {
        const pid = row.product_id;
        if (!stockMap.has(pid)) {
            stockMap.set(pid, { available: 0, lots: [] });
        }
        const entry = stockMap.get(pid);
        const qty = Number(row.available);
        if (qty > 0) {
            entry.available += qty;
            entry.lots.push({
                lot_id: row.lot_id,
                qty,
                expiry_date: row.expiry_date,
                days_until_expiry: Number(row.days_until_expiry)
            });
        }
    }

    return stockMap;
}

/**
 * Récupère toutes les recettes avec leurs ingrédients
 */
export async function getAllRecipesWithItems() {
    const [recipes] = await pool.query(`
        SELECT r.id, r.name, r.base_portions, r.waste_rate
        FROM recipe r
        ORDER BY r.name
    `);

    const [items] = await pool.query(`
        SELECT ri.recipe_id, ri.product_id, ri.qty_per_portion, p.name AS product_name, p.unit
        FROM recipe_item ri
        JOIN product p ON p.id = ri.product_id
        ORDER BY ri.recipe_id, ri.id
    `);

    // Grouper les items par recette
    const itemsByRecipe = new Map();
    for (const it of items) {
        if (!itemsByRecipe.has(it.recipe_id)) {
            itemsByRecipe.set(it.recipe_id, []);
        }
        itemsByRecipe.get(it.recipe_id).push({
            product_id: it.product_id,
            product_name: it.product_name,
            unit: it.unit,
            qty_per_portion: Number(it.qty_per_portion)
        });
    }

    return recipes.map(r => ({
        id: r.id,
        name: r.name,
        base_portions: r.base_portions,
        waste_rate: Number(r.waste_rate),
        items: itemsByRecipe.get(r.id) || []
    }));
}

/**
 * Calcule les suggestions de plats basées sur le stock disponible et la priorité FEFO.
 * 
 * @param {number} portions - Nombre de portions à préparer (défaut: 10)
 * @param {number} limit - Nombre max de suggestions (défaut: 10)
 * @returns {Array} Liste de suggestions triées par score FEFO décroissant
 */
export async function getSuggestions(portions = 10, limit = 10) {
    const stockMap = await getAvailableStockByProduct();
    const recipes = await getAllRecipesWithItems();

    const suggestions = [];

    for (const recipe of recipes) {
        if (recipe.items.length === 0) continue;

        const wasteFactor = 1 + recipe.waste_rate / 100;
        let feasible = true;
        let fefoScore = 0;
        let totalIngredients = recipe.items.length;
        let urgentIngredients = 0;
        const missingIngredients = [];
        const usedLots = [];

        for (const item of recipe.items) {
            const needed = item.qty_per_portion * portions * wasteFactor;
            const stock = stockMap.get(item.product_id);

            if (!stock || stock.available < needed) {
                feasible = false;
                const available = stock?.available || 0;
                missingIngredients.push({
                    product_id: item.product_id,
                    product_name: item.product_name,
                    unit: item.unit,
                    needed: Number(needed.toFixed(4)),
                    available: Number(available.toFixed(4)),
                    deficit: Number((needed - available).toFixed(4))
                });
            } else {
                // Calculer le score FEFO : on simule la consommation FEFO
                let remaining = needed;
                for (const lot of stock.lots) {
                    if (remaining <= 0) break;
                    const take = Math.min(remaining, lot.qty);
                    if (take > 0) {
                        // Score basé sur l'urgence : plus le lot expire tôt, plus le score est élevé
                        // Formule : score += (quantité utilisée / quantité totale) * (1 / (jours + 1))
                        const urgencyWeight = 1 / (lot.days_until_expiry + 1);
                        fefoScore += (take / needed) * urgencyWeight * 100;

                        // Compter les ingrédients urgents (≤ 7 jours)
                        if (lot.days_until_expiry <= 7) {
                            urgentIngredients++;
                        }

                        usedLots.push({
                            lot_id: lot.lot_id,
                            product_id: item.product_id,
                            product_name: item.product_name,
                            qty_used: Number(take.toFixed(4)),
                            days_until_expiry: lot.days_until_expiry,
                            expiry_date: lot.expiry_date
                        });

                        remaining -= take;
                    }
                }
            }
        }

        // Normaliser le score FEFO par le nombre d'ingrédients
        const normalizedScore = totalIngredients > 0 ? fefoScore / totalIngredients : 0;

        suggestions.push({
            recipe_id: recipe.id,
            recipe_name: recipe.name,
            portions,
            feasible,
            fefo_score: Number(normalizedScore.toFixed(2)),
            urgent_ingredients: urgentIngredients,
            total_ingredients: totalIngredients,
            missing_ingredients: missingIngredients,
            lots_to_use: feasible ? usedLots.filter(l => l.days_until_expiry <= 14) : [], // Afficher seulement les lots urgents
            reason: feasible
                ? urgentIngredients > 0
                    ? `${urgentIngredients} ingrédient(s) expire(nt) dans ≤7 jours`
                    : 'Stock suffisant'
                : `Manque ${missingIngredients.length} ingrédient(s)`
        });
    }

    // Trier : faisables d'abord, puis par score FEFO décroissant
    suggestions.sort((a, b) => {
        if (a.feasible !== b.feasible) return b.feasible - a.feasible;
        return b.fefo_score - a.fefo_score;
    });

    return suggestions.slice(0, limit);
}

/**
 * Récupère les produits avec stock proche de la DLC pour lesquels aucune recette n'est faisable.
 * Utile pour identifier les produits à risque de perte.
 */
export async function getAtRiskProducts(daysThreshold = 7) {
    const [rows] = await pool.query(`
        SELECT 
            p.id, p.name, p.unit,
            l.id AS lot_id,
            l.batch_number,
            l.expiry_date,
            DATEDIFF(l.expiry_date, CURDATE()) AS days_until_expiry,
            GREATEST(0, l.quantity - IFNULL(res.reserved, 0)) AS available
        FROM product p
        JOIN lot l ON l.product_id = p.id
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
          AND DATEDIFF(l.expiry_date, CURDATE()) <= ?
        ORDER BY l.expiry_date ASC, p.name
    `, [daysThreshold]);

    return rows.map(r => ({
        product_id: r.id,
        product_name: r.name,
        unit: r.unit,
        lot_id: r.lot_id,
        batch_number: r.batch_number,
        expiry_date: r.expiry_date,
        days_until_expiry: r.days_until_expiry,
        available: Number(r.available)
    }));
}

/**
 * Calcule le nombre maximum de portions réalisables pour une recette donnée.
 */
export async function getMaxPortionsForRecipe(recipeId) {
    const stockMap = await getAvailableStockByProduct();
    const recipes = await getAllRecipesWithItems();
    const recipe = recipes.find(r => r.id === recipeId);

    if (!recipe || recipe.items.length === 0) {
        return { recipe_id: recipeId, max_portions: 0, limiting_ingredient: null };
    }

    const wasteFactor = 1 + recipe.waste_rate / 100;
    let maxPortions = Infinity;
    let limitingIngredient = null;

    for (const item of recipe.items) {
        const stock = stockMap.get(item.product_id);
        const available = stock?.available || 0;
        const qtyPerPortion = item.qty_per_portion * wasteFactor;

        if (qtyPerPortion > 0) {
            const possiblePortions = Math.floor(available / qtyPerPortion);
            if (possiblePortions < maxPortions) {
                maxPortions = possiblePortions;
                limitingIngredient = {
                    product_id: item.product_id,
                    product_name: item.product_name,
                    unit: item.unit,
                    available: Number(available.toFixed(4)),
                    qty_per_portion: Number(qtyPerPortion.toFixed(4))
                };
            }
        }
    }

    return {
        recipe_id: recipeId,
        recipe_name: recipe.name,
        max_portions: maxPortions === Infinity ? 0 : maxPortions,
        limiting_ingredient: limitingIngredient
    };
}
