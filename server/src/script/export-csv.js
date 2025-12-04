/**
 * Script d'export des données d'entraînement ML au format CSV
 * 
 * Usage: node export-csv.js
 * Output: training_data.csv
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import mysql from 'mysql2/promise'

const pool = mysql.createPool({
    host: "localhost",
    user: "osm",
    password: "osm",
    database: "stock_driven",
    waitForConnections: true,
    connectionLimit: 10,
    timezone: 'Z',
    charset: 'utf8mb4'
})

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function exportTrainingDataCSV() {
    console.log('🚀 Export des données d\'entraînement ML (CSV)\n');
    const start = Date.now();

    try {
        // ─────────────────────────────────────────────────────────────────────
        // REQUÊTE 1 : Récupérer l'historique des repas
        // ─────────────────────────────────────────────────────────────────────
        console.log('📊 Étape 1/3 : Récupération de l\'historique des repas...');
        
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
        `);

        console.log(`   ✓ ${items.length} repas récupérés\n`);

        if (items.length === 0) {
            console.log('   ⚠️ Aucun historique trouvé');
            process.exit(0);
        }

        // ─────────────────────────────────────────────────────────────────────
        // REQUÊTE 2 : Récupérer les ingrédients de chaque recette
        // ─────────────────────────────────────────────────────────────────────
        console.log('📊 Étape 2/3 : Récupération des ingrédients par recette...');
        
        const [recipeIngredients] = await pool.query(`
            SELECT 
                ri.recipe_id,
                ri.product_id,
                ri.qty_per_portion as required_qty,
                p.name as product_name
            FROM recipe_item ri
            JOIN product p ON p.id = ri.product_id
            ORDER BY ri.recipe_id
        `);

        // Grouper par recette
        const ingredientsByRecipe = new Map();
        for (const ri of recipeIngredients) {
            if (!ingredientsByRecipe.has(ri.recipe_id)) {
                ingredientsByRecipe.set(ri.recipe_id, []);
            }
            ingredientsByRecipe.get(ri.recipe_id).push({
                product_id: ri.product_id,
                required_qty: Number(ri.required_qty) || 0,
                product_name: ri.product_name
            });
        }

        console.log(`   ✓ ${ingredientsByRecipe.size} recettes avec ingrédients\n`);

        // ─────────────────────────────────────────────────────────────────────
        // REQUÊTE 3 : Récupérer le stock actuel
        // ─────────────────────────────────────────────────────────────────────
        console.log('📊 Étape 3/3 : Récupération du stock actuel...');
        
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
        `);

        // Map pour accès rapide
        const stockMap = new Map();
        for (const s of stockRows) {
            stockMap.set(s.product_id, {
                available_qty: Number(s.available_qty) || 0,
                days_to_expiry: s.days_to_expiry !== null ? Number(s.days_to_expiry) : 999
            });
        }

        console.log(`   ✓ ${stockRows.length} produits en stock\n`);

        // ─────────────────────────────────────────────────────────────────────
        // ASSEMBLAGE DU DATASET
        // ─────────────────────────────────────────────────────────────────────
        console.log('🔧 Assemblage du dataset...');

        const dataset = items.map(item => {
            const dateRef = item.execution_date || item.period_start;
            
            // Parsing des dernières recettes
            let lastRecipes = [0, 0];
            if (item.last_recipe_ids_str) {
                const parts = item.last_recipe_ids_str.split(',').map(Number);
                if (parts.length >= 1) lastRecipes[0] = parts[0] || 0;
                if (parts.length >= 2) lastRecipes[1] = parts[1] || 0;
            }

            // Calcul des features stock pour cette recette
            const ingredients = ingredientsByRecipe.get(item.recipe_id) || [];
            const stockFeatures = calculateRecipeStockFeatures(ingredients, stockMap);

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
            };
        });

        // ─────────────────────────────────────────────────────────────────────
        // GÉNÉRATION CSV
        // ─────────────────────────────────────────────────────────────────────
        console.log('📄 Génération du fichier CSV...');

        const headers = [
            'date',
            'recipe_id',
            'day_of_week',
            'month',
            'week_of_year',
            'planned_portions',
            'last_recipe_1',
            'last_recipe_2',
            'recipe_feasible',
            'availability_score',
            'min_days_to_expiry',
            'nb_missing_ingredients',
            'urgency_score'
        ];

        const rows = dataset.map(row => 
            headers.map(header => row[header] ?? '').join(',')
        );

        const csvContent = [headers.join(','), ...rows].join('\n');

        // ─────────────────────────────────────────────────────────────────────
        // EXPORT CSV
        // ─────────────────────────────────────────────────────────────────────
        const outputPath = path.join(__dirname, 'training_data.csv');
        fs.writeFileSync(outputPath, csvContent);

        const elapsed = ((Date.now() - start) / 1000).toFixed(2);
        const fileSize = (fs.statSync(outputPath).size / 1024).toFixed(2);

        console.log(`\n${'═'.repeat(60)}`);
        console.log('✅ EXPORT TERMINÉ !');
        console.log(`${'═'.repeat(60)}`);
        console.log(`\n📁 Fichier : ${outputPath}`);
        console.log(`📊 Taille : ${fileSize} KB`);
        console.log(`📈 Lignes : ${dataset.length + 1} (header + data)`);
        console.log(`🔢 Colonnes : ${headers.length}`);
        console.log(`⏱️  Temps : ${elapsed}s\n`);

    } catch (error) {
        console.error('\n❌ Erreur :', error.message);
        console.error(error.stack);
        process.exit(1);
    } finally {
        await pool.end();
    }
}

/**
 * Calcule les features de stock pour une recette
 */
function calculateRecipeStockFeatures(ingredients, stockMap) {
    if (ingredients.length === 0) {
        return {
            recipe_feasible: 1,
            availability_score: 1.0,
            min_days_to_expiry: 999,
            nb_missing_ingredients: 0,
            urgency_score: 0
        };
    }

    let nbAvailable = 0;
    let nbMissing = 0;
    let minDaysToExpiry = 999;
    let totalUrgencyScore = 0;

    for (const ingredient of ingredients) {
        const stock = stockMap.get(ingredient.product_id);
        
        if (!stock || stock.available_qty <= 0) {
            nbMissing++;
        } else {
            nbAvailable++;
            
            if (stock.days_to_expiry < minDaysToExpiry) {
                minDaysToExpiry = stock.days_to_expiry;
            }
            
            const urgency = Math.max(0, Math.min(1, 1 - (stock.days_to_expiry / 30)));
            totalUrgencyScore += urgency;
        }
    }

    const totalIngredients = ingredients.length;
    
    return {
        recipe_feasible: nbMissing === 0 ? 1 : 0,
        availability_score: Number((nbAvailable / totalIngredients).toFixed(2)),
        min_days_to_expiry: minDaysToExpiry,
        nb_missing_ingredients: nbMissing,
        urgency_score: nbAvailable > 0 
            ? Number((totalUrgencyScore / nbAvailable).toFixed(2)) 
            : 0
    };
}

// Exécution
exportTrainingDataCSV();