/**
 * ML Service - Intégration avec le microservice Python XGBoost
 * Gère l'export des données d'entraînement et les appels de prédiction
 */

import { pool } from '../db.js';

const ML_SERVICE_URL = process.env.ML_SERVICE_URL || 'http://localhost:5001';

/**
 * Exporte les données d'entraînement depuis la base de données
 * Récupère l'historique des meal plans exécutés avec le contexte du stock
 */
export async function exportTrainingData() {
    // Récupérer tous les meal_plan_items exécutés avec leur contexte
    const [items] = await pool.query(`
        SELECT 
            mpi.id as item_id,
            mpi.recipe_id,
            mpi.planned_portions,
            mpi.produced_portions,
            mpi.execution_date,
            mp.period_start,
            mp.id as meal_plan_id
        FROM meal_plan_item mpi
        JOIN meal_plan mp ON mp.id = mpi.meal_plan_id
        WHERE mp.status = 'EXECUTED'
        AND mpi.produced_portions IS NOT NULL
        ORDER BY mpi.execution_date ASC
    `);

    if (items.length === 0) {
        return [];
    }

    // Pour chaque item, reconstruire le contexte du stock au moment de l'exécution
    const trainingData = [];

    for (const item of items) {
        // Récupérer le stock disponible simplifié (snapshot actuel)
        const [stockSnapshot] = await pool.query(`
            SELECT 
                p.id as product_id,
                p.name as product_name,
                COALESCE(SUM(l.quantity), 0) as available_qty,
                MIN(DATEDIFF(l.expiry_date, CURDATE())) as days_to_expiry
            FROM product p
            LEFT JOIN lot l ON l.product_id = p.id 
                AND l.archived = FALSE 
                AND l.expiry_date >= CURDATE()
            GROUP BY p.id, p.name
            HAVING available_qty > 0
        `);

        // Récupérer les 2 dernières recettes servies avant cette date
        const executionDate = item.execution_date || item.period_start;
        const [lastRecipes] = await pool.query(`
            SELECT recipe_id FROM (
                SELECT mpi2.recipe_id, MAX(COALESCE(mpi2.execution_date, mp2.period_start)) as last_date
                FROM meal_plan_item mpi2
                JOIN meal_plan mp2 ON mp2.id = mpi2.meal_plan_id
                WHERE mp2.status = 'EXECUTED'
                AND COALESCE(mpi2.execution_date, mp2.period_start) < ?
                GROUP BY mpi2.recipe_id
                ORDER BY last_date DESC
                LIMIT 2
            ) sub
        `, [executionDate]);

        const lastRecipeIds = lastRecipes.map(r => r.recipe_id);

        trainingData.push({
            date: (item.execution_date || item.period_start).toISOString().split('T')[0],
            recipe_id: item.recipe_id,
            planned_portions: item.planned_portions,
            stock: stockSnapshot.map(s => ({
                product_id: s.product_id,
                available_qty: Number(s.available_qty),
                days_to_expiry: Math.max(0, Number(s.days_to_expiry) || 30)
            })),
            last_recipes: lastRecipeIds
        });
    }

    return trainingData;
}

/**
 * Génère des données d'entraînement synthétiques si pas assez de données réelles
 */
export async function generateSyntheticData(count = 100) {
    // Récupérer toutes les recettes
    const [recipes] = await pool.query('SELECT id FROM recipe');
    if (recipes.length === 0) {
        throw new Error('Aucune recette trouvée');
    }

    // Récupérer tous les produits
    const [products] = await pool.query('SELECT id FROM product');

    const syntheticData = [];
    const recipeIds = recipes.map(r => r.id);

    for (let i = 0; i < count; i++) {
        // Date aléatoire dans les 6 derniers mois
        const date = new Date();
        date.setDate(date.getDate() - Math.floor(Math.random() * 180));

        // Recette aléatoire (avec biais vers certains jours)
        const dayOfWeek = date.getDay();
        let recipeId;
        
        // Simuler des patterns : certaines recettes plus fréquentes certains jours
        if (dayOfWeek === 1 && Math.random() > 0.5) { // Lundi
            recipeId = recipeIds[0 % recipeIds.length];
        } else if (dayOfWeek === 5 && Math.random() > 0.5) { // Vendredi
            recipeId = recipeIds[Math.min(1, recipeIds.length - 1)];
        } else {
            recipeId = recipeIds[Math.floor(Math.random() * recipeIds.length)];
        }

        // Stock aléatoire
        const stock = products.map(p => ({
            product_id: p.id,
            available_qty: Math.random() * 50 + 5,
            days_to_expiry: Math.floor(Math.random() * 14) + 1
        }));

        // Dernières recettes
        const lastRecipes = [
            recipeIds[Math.floor(Math.random() * recipeIds.length)],
            recipeIds[Math.floor(Math.random() * recipeIds.length)]
        ];

        syntheticData.push({
            date: date.toISOString().split('T')[0],
            recipe_id: recipeId,
            planned_portions: Math.floor(Math.random() * 50) + 20,
            stock,
            last_recipes: lastRecipes
        });
    }

    return syntheticData;
}

/**
 * Entraîne le modèle ML
 */
export async function trainModel() {
    // Exporter les données réelles
    let trainingData = await exportTrainingData();

    // Si pas assez de données, générer des données synthétiques
    if (trainingData.length < 50) {
        console.log(`⚠️ Seulement ${trainingData.length} données réelles, génération de données synthétiques...`);
        const syntheticData = await generateSyntheticData(100 - trainingData.length);
        trainingData = [...trainingData, ...syntheticData];
    }

    console.log(`📊 Entraînement avec ${trainingData.length} échantillons...`);

    // Appeler le service Python pour l'entraînement
    const response = await fetch(`${ML_SERVICE_URL}/train`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ training_data: trainingData })
    });

    if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Erreur lors de l\'entraînement');
    }

    return await response.json();
}

/**
 * Prédit les meilleures recettes basées sur le stock actuel
 */
export async function predictRecipes(date, plannedPortions) {
    // Récupérer le stock actuel avec DLC
    const [stock] = await pool.query(`
        SELECT 
            p.id as product_id,
            p.name as product_name,
            COALESCE(SUM(GREATEST(0, l.quantity - IFNULL(res.reserved, 0))), 0) as available_qty,
            MIN(DATEDIFF(l.expiry_date, CURDATE())) as days_to_expiry
        FROM product p
        LEFT JOIN lot l ON l.product_id = p.id 
            AND l.archived = FALSE 
            AND l.expiry_date >= CURDATE()
        LEFT JOIN (
            SELECT lot_id, SUM(reserved_qty) as reserved
            FROM reservation rv
            JOIN meal_plan_item mi ON mi.id = rv.meal_plan_item_id
            JOIN meal_plan mp ON mp.id = mi.meal_plan_id
            WHERE mp.status = 'CONFIRMED' AND mi.produced_portions IS NULL
            GROUP BY lot_id
        ) res ON res.lot_id = l.id
        GROUP BY p.id, p.name
        HAVING available_qty > 0
    `);

    // Récupérer toutes les recettes
    const [recipes] = await pool.query('SELECT id, name FROM recipe');

    // Récupérer les 2 dernières recettes servies
    const [lastRecipes] = await pool.query(`
        SELECT recipe_id FROM (
            SELECT mpi.recipe_id, MAX(COALESCE(mpi.execution_date, mp.period_start)) as last_date
            FROM meal_plan_item mpi
            JOIN meal_plan mp ON mp.id = mpi.meal_plan_id
            WHERE mp.status = 'EXECUTED'
            GROUP BY mpi.recipe_id
            ORDER BY last_date DESC
            LIMIT 2
        ) sub
    `);

    const lastRecipeIds = lastRecipes.map(r => r.recipe_id);

    // Appeler le service Python pour la prédiction
    const response = await fetch(`${ML_SERVICE_URL}/predict`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            date: date || new Date().toISOString().split('T')[0],
            planned_portions: plannedPortions || 50,
            stock: stock.map(s => ({
                product_id: s.product_id,
                product_name: s.product_name,
                available_qty: Number(s.available_qty),
                days_to_expiry: Math.max(0, Number(s.days_to_expiry) || 30)
            })),
            recipes: recipes.map(r => ({ id: r.id, name: r.name })),
            last_recipes: lastRecipeIds
        })
    });

    if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Erreur lors de la prédiction');
    }

    const result = await response.json();

    // Enrichir les prédictions avec les données de stock
    for (const pred of result.predictions) {
        // Récupérer les ingrédients de la recette
        const [ingredients] = await pool.query(`
            SELECT ri.product_id, p.name as product_name, ri.qty_per_portion
            FROM recipe_item ri
            JOIN product p ON p.id = ri.product_id
            WHERE ri.recipe_id = ?
        `, [pred.recipe_id]);

        pred.ingredients = ingredients;

        // Trouver les produits urgents utilisés
        pred.urgent_products = [];
        for (const ing of ingredients) {
            const stockItem = stock.find(s => s.product_id === ing.product_id);
            if (stockItem && stockItem.days_to_expiry <= 5) {
                pred.urgent_products.push({
                    product_id: stockItem.product_id,
                    product_name: stockItem.product_name,
                    days_to_expiry: stockItem.days_to_expiry
                });
            }
        }

        // Générer des raisons plus précises
        pred.reasons = [];
        if (pred.urgent_products.length > 0) {
            pred.reasons.push(`Utilise ${pred.urgent_products.length} produit(s) urgent(s)`);
            const urgentNames = pred.urgent_products.slice(0, 2).map(p => p.product_name);
            pred.reasons.push(`Priorité : ${urgentNames.join(', ')}`);
        }

        const days = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'];
        const dayName = days[new Date(date).getDay()];
        pred.reasons.push(`Recommandé pour ${dayName}`);
    }

    return result;
}

/**
 * Vérifie la santé du service ML
 */
export async function checkMLServiceHealth() {
    try {
        const response = await fetch(`${ML_SERVICE_URL}/health`, {
            method: 'GET',
            timeout: 5000
        });
        
        if (!response.ok) {
            return { status: 'error', message: 'Service ML non disponible' };
        }
        
        return await response.json();
    } catch (error) {
        return { 
            status: 'error', 
            message: `Impossible de contacter le service ML: ${error.message}`,
            url: ML_SERVICE_URL
        };
    }
}

/**
 * Récupère les informations sur le modèle
 */
export async function getModelInfo() {
    try {
        const response = await fetch(`${ML_SERVICE_URL}/model-info`);
        if (!response.ok) {
            throw new Error('Service ML non disponible');
        }
        return await response.json();
    } catch (error) {
        return { trained: false, error: error.message };
    }
}

/**
 * Récupère l'importance des features
 */
export async function getFeatureImportance() {
    try {
        const response = await fetch(`${ML_SERVICE_URL}/feature-importance`);
        if (!response.ok) {
            throw new Error('Service ML non disponible');
        }
        return await response.json();
    } catch (error) {
        return { feature_importance: [], error: error.message };
    }
}