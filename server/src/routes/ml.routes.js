/**
 * Routes ML - Endpoints pour les prédictions XGBoost
 */

import { Router } from 'express';
import { requireAuth } from '../auth/auth.middleware.js';
import { a as asyncHandler } from '../utils/async.js';
import {
    trainModel,
    predictRecipes,
    checkMLServiceHealth,
    getModelInfo,
    getFeatureImportance,
    exportTrainingData
} from '../services/ml.service.js';

const router = Router();

/**
 * GET /ml/health
 * Vérifie la santé du service ML Python
 */
router.get('/health', asyncHandler(async (req, res) => {
    const health = await checkMLServiceHealth();
    res.json(health);
}));

/**
 * GET /ml/model-info
 * Informations sur le modèle entraîné
 */
router.get('/model-info', requireAuth(), asyncHandler(async (req, res) => {
    const info = await getModelInfo();
    res.json(info);
}));

/**
 * GET /ml/feature-importance
 * Importance des features du modèle
 */
router.get('/feature-importance', requireAuth(), asyncHandler(async (req, res) => {
    const importance = await getFeatureImportance();
    res.json(importance);
}));

/**
 * POST /ml/train
 * Entraîne le modèle avec les données historiques
 */
router.post('/train', requireAuth('ADMIN'), asyncHandler(async (req, res) => {
    const result = await trainModel();
    res.json(result);
}));

/**
 * POST /ml/predict
 * Prédit les meilleures recettes pour une date donnée
 * Body: { date?: string, planned_portions?: number }
 */
router.post('/predict', requireAuth(), asyncHandler(async (req, res) => {
    const { date, planned_portions } = req.body;
    
    const result = await predictRecipes(
        date || new Date().toISOString().split('T')[0],
        planned_portions || 50
    );
    
    res.json(result);
}));

/**
 * GET /ml/training-data
 * Exporte les données d'entraînement (pour debug/analyse)
 */
router.get('/training-data', requireAuth('ADMIN'), asyncHandler(async (req, res) => {
    const data = await exportTrainingData();
    res.json({
        count: data.length,
        data: data.slice(0, 10), // Limiter à 10 pour la prévisualisation
        message: data.length < 50 
            ? `Seulement ${data.length} données réelles. Des données synthétiques seront générées.`
            : `${data.length} données disponibles pour l'entraînement.`
    });
}));

/**
 * GET /ml/predict/quick
 * Prédiction rapide pour aujourd'hui
 */
router.get('/predict/quick', requireAuth(), asyncHandler(async (req, res) => {
    const portions = parseInt(req.query.portions) || 50;
    const result = await predictRecipes(
        new Date().toISOString().split('T')[0],
        portions
    );
    res.json(result);
}));

export default router;