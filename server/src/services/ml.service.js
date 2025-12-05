/**
 * Mont-Vert - Service ML avec Features Stock Intelligentes
 * 
 * INNOVATION : 5 features pertinentes PAR RECETTE
 * TOTAL : 11 features
 */

import { pool } from '../db.js'

const ML_SERVICE_URL = process.env.ML_SERVICE_URL || 'http://localhost:5001'

// ═══════════════════════════════════════════════════════════════════════════
// EXPORT DES DONNÉES D'ENTRAÎNEMENT
// ═══════════════════════════════════════════════════════════════════════════

export async function exportTrainingData() {
    console.log(" [ML Service] Extraction des données d'entraînement...")
    const start = Date.now()

    // Récupérer l'historique des repas
    const [items] = await pool.query(`
        SELECT 
            mpi.id as item_id,
            mpi.recipe_id,
            mpi.planned_portions,
            mpi.execution_date,
            mp.period_start,
            WEEKDAY(COALESCE(mpi.execution_date, mp.period_start)) as day_of_week,
            MONTH(COALESCE(mpi.execution_date, mp.period_start)) as month,
            WEEK(COALESCE(mpi.execution_date, mp.period_start)) as week_of_year,
            (
                SELECT SUBSTRING_INDEX(
                    GROUP_CONCAT(sub_mpi.recipe_id ORDER BY COALESCE(sub_mpi.execution_date, sub_mp.period_start) DESC SEPARATOR ','), 
                    ',', 2
                )
                FROM meal_plan_item sub_mpi
                JOIN meal_plan sub_mp ON sub_mp.id = sub_mpi.meal_plan_id
                WHERE sub_mp.status = 'EXECUTED'
                AND COALESCE(sub_mpi.execution_date, sub_mp.period_start) < COALESCE(mpi.execution_date, mp.period_start)
            ) as last_recipe_ids_str
        FROM meal_plan_item mpi
        JOIN meal_plan mp ON mp.id = mpi.meal_plan_id
        WHERE mp.status = 'EXECUTED'
          AND mpi.execution_date IS NOT NULL
        ORDER BY mpi.execution_date ASC
    `)

    console.log(`    ${items.length} repas historiques récupérés`)

    if (items.length === 0) {
        console.log("    Aucun historique trouvé")
        return []
    }

    // Récupérer les ingrédients de chaque recette
    const [recipeIngredients] = await pool.query(`
        SELECT 
            ri.recipe_id,
            ri.product_id,
            ri.qty_per_portion as required_qty,
            p.name as product_name
        FROM recipe_item ri
        JOIN product p ON p.id = ri.product_id
        ORDER BY ri.recipe_id
    `)

    const ingredientsByRecipe = new Map()
    for (const ri of recipeIngredients) {
        if (!ingredientsByRecipe.has(ri.recipe_id)) {
            ingredientsByRecipe.set(ri.recipe_id, [])
        }
        ingredientsByRecipe.get(ri.recipe_id).push({
            product_id: ri.product_id,
            required_qty: Number(ri.required_qty) || 0,
            product_name: ri.product_name
        })
    }

    console.log(`    ${ingredientsByRecipe.size} recettes avec ingrédients`)

    // Récupérer le stock actuel
    const [stockRows] = await pool.query(`
        SELECT 
            p.id as product_id,
            COALESCE(SUM(l.quantity), 0) as available_qty,
            MIN(DATEDIFF(l.expiry_date, CURDATE())) as days_to_expiry
        FROM product p
        LEFT JOIN lot l ON l.product_id = p.id 
            AND l.archived = FALSE 
            AND l.expiry_date >= CURDATE()
        GROUP BY p.id
    `)

    const stockMap = new Map()
    for (const s of stockRows) {
        stockMap.set(s.product_id, {
            available_qty: Number(s.available_qty) || 0,
            days_to_expiry: s.days_to_expiry !== null ? Number(s.days_to_expiry) : 999
        })
    }

    console.log(`    ${stockRows.length} produits en stock`)

    // Assemblage du dataset
    const dataset = items.map(item => {
        const dateRef = item.execution_date || item.period_start

        let lastRecipes = [0, 0]
        if (item.last_recipe_ids_str) {
            const parts = item.last_recipe_ids_str.split(',').map(Number)
            if (parts.length >= 1) lastRecipes[0] = parts[0] || 0
            if (parts.length >= 2) lastRecipes[1] = parts[1] || 0
        }

        const ingredients = ingredientsByRecipe.get(item.recipe_id) || []
        const stockFeatures = calculateRecipeStockFeatures(ingredients, stockMap, item.planned_portions)

        return {
            date: dateRef.toISOString().split('T')[0],
            recipe_id: item.recipe_id,
            day_of_week: item.day_of_week,
            month: item.month,
            week_of_year: item.week_of_year,
            planned_portions: item.planned_portions,
            last_recipe_1: lastRecipes[0],
            last_recipe_2: lastRecipes[1],
            ...stockFeatures
        }
    })

    const elapsed = ((Date.now() - start) / 1000).toFixed(2)
    console.log(`    ${dataset.length} exemples assemblés en ${elapsed}s`)

    return dataset
}

function calculateRecipeStockFeatures(ingredients, stockMap, plannedPortions = 1) {
    if (ingredients.length === 0) {
        return {
            recipe_feasible: 1,
            availability_score: 1.0,
            min_days_to_expiry: 999,
            nb_missing_ingredients: 0,
            urgency_score: 0
        }
    }

    let nbAvailable = 0
    let nbMissing = 0
    let minDaysToExpiry = 999
    let totalUrgencyScore = 0

    for (const ingredient of ingredients) {
        const stock = stockMap.get(ingredient.product_id)

        // Calculer la quantité nécessaire pour le nombre de portions
        const requiredQty = ingredient.required_qty * plannedPortions

        // Vérifier si la quantité disponible est suffisante
        if (!stock || stock.available_qty < requiredQty) {
            nbMissing++
        } else {
            nbAvailable++

            if (stock.days_to_expiry < minDaysToExpiry) {
                minDaysToExpiry = stock.days_to_expiry
            }

            const urgency = Math.max(0, Math.min(1, 1 - (stock.days_to_expiry / 30)))
            totalUrgencyScore += urgency
        }
    }

    const totalIngredients = ingredients.length

    return {
        recipe_feasible: nbMissing === 0 ? 1 : 0,
        availability_score: Number((nbAvailable / totalIngredients).toFixed(2)),
        min_days_to_expiry: minDaysToExpiry,
        nb_missing_ingredients: nbMissing,
        urgency_score: nbAvailable > 0
            ? Number((totalUrgencyScore / nbAvailable).toFixed(2))
            : 0
    }
}

// ═══════════════════════════════════════════════════════════════════════════
// ENTRAÎNEMENT DU MODÈLE
// ═══════════════════════════════════════════════════════════════════════════

export async function trainModel() {
    console.log("\n [ML Service] Démarrage de l'entraînement...")
    const start = Date.now()

    try {
        const trainingData = await exportTrainingData()

        if (trainingData.length === 0) {
            return { success: false, error: "Aucune donnée d'entraînement disponible" }
        }

        console.log(`\n [ML Service] Envoi de ${trainingData.length} exemples à Python...`)

        const response = await fetch(`${ML_SERVICE_URL}/train`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ training_data: trainingData })
        })

        if (!response.ok) {
            const errorText = await response.text()
            throw new Error(`Erreur Python: ${response.status} - ${errorText}`)
        }

        const result = await response.json()

        const elapsed = ((Date.now() - start) / 1000).toFixed(2)
        console.log(`\n [ML Service] Entraînement terminé en ${elapsed}s`)

        return result

    } catch (error) {
        console.error("\n [ML Service] Erreur:", error.message)
        return { success: false, error: error.message }
    }
}

// ═══════════════════════════════════════════════════════════════════════════
// PRÉDICTION
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Génère les raisons de recommandation basées sur les features réelles
 */
function generateReasons(prediction, context) {
    const reasons = []

    // Jour de la semaine
    const days = ['lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi', 'dimanche']
    const dayOfWeek = context.day_of_week
    if (dayOfWeek >= 0 && dayOfWeek <= 6) {
        reasons.push(`Adapté pour un ${days[dayOfWeek]}`)
    }

    // Faisabilité du stock (CRITIQUE)
    if (prediction.recipe_feasible === 1) {
        reasons.push("Tous les ingrédients sont disponibles")
    } else {
        const nbMissing = prediction.nb_missing_ingredients || 0
        if (nbMissing > 0) {
            reasons.push(` ${nbMissing} ingrédient(s) manquant(s)`)
        }
    }

    // Urgence FEFO
    const urgency = prediction.urgency_score || 0
    if (urgency > 0.7) {
        reasons.push("🔴 Utilise des produits proches de la péremption (FEFO)")
    } else if (urgency > 0.4) {
        reasons.push("Optimise l'utilisation du stock")
    }

    // Disponibilité
    const availability = prediction.availability_score || 0
    if (availability >= 0.8 && prediction.recipe_feasible === 1) {
        reasons.push(`${Math.round(availability * 100)}% des ingrédients disponibles`)
    }

    // Jours avant expiration
    const daysToExpiry = prediction.min_days_to_expiry
    if (daysToExpiry !== null && daysToExpiry !== undefined && daysToExpiry <= 3) {
        reasons.push(` Ingrédients expirent dans ${daysToExpiry} jour(s)`)
    }

    return reasons
}

/**
 * Détermine le niveau de confiance
 */
function getConfidence(probability) {
    if (probability >= 0.7) return 'high'
    if (probability >= 0.4) return 'medium'
    return 'low'
}

export async function predict({ date, planned_portions, num_predictions = 5 }) {
    console.log(`\n🔮 [ML Service] Prédiction pour ${date}...`)

    try {
        const predictionContext = await buildPredictionContext(date, planned_portions)

        const response = await fetch(`${ML_SERVICE_URL}/predict`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                context: predictionContext,
                num_predictions: num_predictions * 2  // Demander plus pour avoir du choix après filtrage
            })
        })

        if (!response.ok) {
            throw new Error(`Erreur Python: ${response.status}`)
        }

        const result = await response.json()

        // Enrichir avec les noms ET les features de stock réelles
        if (result.predictions?.length > 0) {
            const recipeIds = result.predictions.map(p => p.recipe_id)
            const [recipes] = await pool.query(
                `SELECT id, name FROM recipe WHERE id IN (?)`,
                [recipeIds]
            )

            const recipeMap = new Map(recipes.map(r => [r.id, r.name]))
            result.predictions = result.predictions.map(p => ({
                ...p,
                recipe_name: recipeMap.get(p.recipe_id) || `Recette #${p.recipe_id}`
            }))

            // ÉTAPE CRITIQUE : Enrichir avec les vraies features de stock
            result.predictions = await enrichPredictionsWithFeasibility(result.predictions, planned_portions)

            console.log('\n [ML Service] Prédictions AVANT réordonnancement :')
            result.predictions.forEach((p, i) => {
                console.log(`   ${i + 1}. ${p.recipe_name}: prob=${(p.probability * 100).toFixed(1)}%, feasible=${p.recipe_feasible}, urgency=${(p.urgency_score || 0).toFixed(2)}, missing=${p.nb_missing_ingredients || 0}`)
            })

            // RÉORDONNANCEMENT FEFO :
            // 1. Recettes faisables en premier
            // 2. Puis urgence (FEFO)
            // 3. Puis probabilité
            result.predictions = result.predictions.sort((a, b) => {
                // Priorité 1 : Faisabilité
                if (a.recipe_feasible !== b.recipe_feasible) {
                    return b.recipe_feasible - a.recipe_feasible
                }
                // Priorité 2 : Urgence (FEFO)
                if (Math.abs(a.urgency_score - b.urgency_score) > 0.1) {
                    return b.urgency_score - a.urgency_score
                }
                // Priorité 3 : Probabilité ML
                return b.probability - a.probability
            })

            console.log('\n [ML Service] Prédictions APRÈS réordonnancement :')
            result.predictions.forEach((p, i) => {
                console.log(`   ${i + 1}. ${p.recipe_name}: prob=${(p.probability * 100).toFixed(1)}%, feasible=${p.recipe_feasible}, urgency=${(p.urgency_score || 0).toFixed(2)}, missing=${p.nb_missing_ingredients || 0}`)
            })

            // Limiter au nombre demandé
            result.predictions = result.predictions.slice(0, num_predictions)

            // RÉGÉNÉRER les reasons et confidence avec les VRAIES features
            result.predictions = result.predictions.map(pred => ({
                ...pred,
                confidence: getConfidence(pred.probability),
                reasons: generateReasons(pred, predictionContext)
            }))
        }

        console.log(`    ${result.predictions?.length || 0} suggestions générées`)
        return result

    } catch (error) {
        console.error(" [ML Service] Erreur:", error.message)
        return { success: false, error: error.message }
    }
}

export async function predictRecipes(date, planned_portions) {
    return predict({ date, planned_portions, num_predictions: 5 })
}

async function buildPredictionContext(date, planned_portions) {
    const predictionDate = new Date(date)

    const [recentRecipes] = await pool.query(`
        SELECT mpi.recipe_id
        FROM meal_plan_item mpi
        JOIN meal_plan mp ON mp.id = mpi.meal_plan_id
        WHERE mp.status = 'EXECUTED' AND mpi.execution_date < ?
        ORDER BY mpi.execution_date DESC
        LIMIT 2
    `, [date])

    //  IMPORTANT : Ces features sont des MOYENNES par défaut
    // Pour une prédiction précise par recette, utiliser enrichPredictionsWithFeasibility()
    return {
        date,
        day_of_week: predictionDate.getDay(),
        month: predictionDate.getMonth() + 1,
        week_of_year: getWeekNumber(predictionDate),
        planned_portions,
        last_recipe_1: recentRecipes[0]?.recipe_id || 0,
        last_recipe_2: recentRecipes[1]?.recipe_id || 0,

        // Features stock par défaut (seront recalculées par recette après prédiction)
        recipe_feasible: 1,
        availability_score: 1.0,
        min_days_to_expiry: 30,
        nb_missing_ingredients: 0,
        urgency_score: 0.5
    }
}

function getWeekNumber(date) {
    const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()))
    const dayNum = d.getUTCDay() || 7
    d.setUTCDate(d.getUTCDate() + 4 - dayNum)
    const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1))
    return Math.ceil((((d - yearStart) / 86400000) + 1) / 7)
}

// ═══════════════════════════════════════════════════════════════════════════
// VÉRIFICATION FAISABILITÉ POST-PRÉDICTION
// ═══════════════════════════════════════════════════════════════════════════

export async function enrichPredictionsWithFeasibility(predictions, planned_portions = 50) {
    if (!predictions || predictions.length === 0) return predictions

    const recipeIds = predictions.map(p => p.recipe_id)

    const [recipeIngredients] = await pool.query(`
        SELECT 
            ri.recipe_id,
            ri.product_id,
            ri.qty_per_portion as required_qty
        FROM recipe_item ri
        WHERE ri.recipe_id IN (?)
    `, [recipeIds])

    const [stockRows] = await pool.query(`
        SELECT 
            p.id as product_id,
            COALESCE(SUM(l.quantity), 0) as available_qty,
            MIN(DATEDIFF(l.expiry_date, CURDATE())) as days_to_expiry
        FROM product p
        LEFT JOIN lot l ON l.product_id = p.id 
            AND l.archived = FALSE 
            AND l.expiry_date >= CURDATE()
        GROUP BY p.id
    `)

    const stockMap = new Map()
    for (const s of stockRows) {
        stockMap.set(s.product_id, {
            available_qty: Number(s.available_qty) || 0,
            days_to_expiry: s.days_to_expiry !== null ? Number(s.days_to_expiry) : 999
        })
    }

    const ingredientsByRecipe = new Map()
    for (const ri of recipeIngredients) {
        if (!ingredientsByRecipe.has(ri.recipe_id)) {
            ingredientsByRecipe.set(ri.recipe_id, [])
        }
        ingredientsByRecipe.get(ri.recipe_id).push({
            product_id: ri.product_id,
            required_qty: Number(ri.required_qty)
        })
    }

    return predictions.map(pred => {
        const ingredients = ingredientsByRecipe.get(pred.recipe_id) || []
        const stockFeatures = calculateRecipeStockFeatures(ingredients, stockMap, planned_portions)

        return {
            ...pred,
            ...stockFeatures
        }
    })
}

// ═══════════════════════════════════════════════════════════════════════════
// SANTÉ ET STATUT DU SERVICE ML
// ═══════════════════════════════════════════════════════════════════════════

export async function checkMLServiceHealth() {
    try {
        const response = await fetch(`${ML_SERVICE_URL}/health`, {
            method: 'GET',
            headers: { 'Content-Type': 'application/json' }
        })

        if (!response.ok) {
            return {
                status: 'error',
                connected: false,
                service_online: false,
                error: `Service returned ${response.status}`
            }
        }

        const health = await response.json()

        // Format compatible avec l'ancien système + nouveau
        return {
            status: 'ok',              // Pour l'ancien système
            connected: true,            // Pour l'ancien système
            service_online: true,       // Pour le nouveau système
            service: health.service,
            timestamp: health.timestamp
        }

    } catch (error) {
        return {
            status: 'error',
            connected: false,
            service_online: false,
            error: error.message
        }
    }
}

export async function getModelStatus() {
    try {
        const response = await fetch(`${ML_SERVICE_URL}/status`)
        if (!response.ok) {
            return { service_online: false, model_loaded: false }
        }
        return { service_online: true, ...(await response.json()) }
    } catch (error) {
        return { service_online: false, model_loaded: false, error: error.message }
    }
}

// ═══════════════════════════════════════════════════════════════════════════
// INFORMATIONS SUR LE MODÈLE
// ═══════════════════════════════════════════════════════════════════════════

export async function getModelInfo() {
    try {
        const response = await fetch(`${ML_SERVICE_URL}/model-info`, {
            method: 'GET',
            headers: { 'Content-Type': 'application/json' }
        })

        if (!response.ok) {
            return {
                available: false,
                error: `Service returned ${response.status}`
            }
        }

        const info = await response.json()
        return {
            available: true,
            ...info
        }

    } catch (error) {
        return {
            available: false,
            error: error.message
        }
    }
}

export async function getFeatureImportance() {
    try {
        const response = await fetch(`${ML_SERVICE_URL}/feature-importance`, {
            method: 'GET',
            headers: { 'Content-Type': 'application/json' }
        })

        if (!response.ok) {
            return {
                available: false,
                error: `Service returned ${response.status}`
            }
        }

        const importance = await response.json()
        return {
            available: true,
            ...importance
        }

    } catch (error) {
        return {
            available: false,
            error: error.message
        }
    }
}

// ═══════════════════════════════════════════════════════════════════════════
// EXPORT PAR DÉFAUT
// ═══════════════════════════════════════════════════════════════════════════

export default {
    exportTrainingData,
    trainModel,
    predict,
    predictRecipes,
    enrichPredictionsWithFeasibility,
    checkMLServiceHealth,
    getModelStatus,
    getModelInfo,
    getFeatureImportance
}