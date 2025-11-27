// server/src/routes/alert.routes.js
import { Router } from 'express';
import { pool } from '../db.js';
import { requireAuth } from '../auth/auth.middleware.js';
import { a } from '../utils/async.js';
import alertService from '../services/alert.service.js';

const r = Router();

/**
 * GET /alerts/expiring
 * Récupère les produits qui expirent bientôt (sans envoyer d'email)
 */
r.get('/expiring', requireAuth(['ADMIN', 'KITCHEN']), a(async (req, res) => {
    const days = parseInt(req.query.days || '3', 10);
    const products = await alertService.getExpiringProducts(days);
    
    const totalValue = products.reduce((sum, p) => sum + p.total_value, 0);
    const criticalCount = products.filter(p => p.days_until_expiry <= 1).length;
    
    res.json({
        days_threshold: days,
        products_count: products.length,
        critical_count: criticalCount,
        total_value: Number(totalValue.toFixed(2)),
        products
    });
}));

/**
 * GET /alerts/recipients
 * Récupère la liste des destinataires des alertes
 */
r.get('/recipients', requireAuth(['ADMIN']), a(async (req, res) => {
    const recipients = await alertService.getAlertRecipients();
    res.json({ recipients });
}));

/**
 * POST /alerts/send
 * Envoie les alertes email manuellement
 */
r.post('/send', requireAuth(['ADMIN']), a(async (req, res) => {
    const { daysThreshold, testMode, testEmail } = req.body;
    
    const result = await alertService.sendAlertEmails({
        daysThreshold: daysThreshold || 3,
        testMode: testMode || false,
        testEmail: testEmail || null
    });
    
    res.json(result);
}));

/**
 * POST /alerts/test
 * Envoie un email de test à l'utilisateur connecté
 */
r.post('/test', requireAuth(['ADMIN', 'KITCHEN']), a(async (req, res) => {
    // Récupérer l'ID utilisateur (essayer différents formats)
    const userId = req.user?.id || req.user?.userId || req.user?.sub;
    
    console.log('req.user:', req.user); // Debug
    
    if (!userId) {
        return res.status(401).json({ 
            error: 'Non authentifié',
            debug: req.user 
        });
    }
    
    // Récupérer l'email depuis la base de données
    const [[user]] = await pool.query(
        'SELECT email FROM user WHERE id = ?', 
        [userId]
    );
    
    const userEmail = user?.email;
    
    if (!userEmail) {
        return res.status(400).json({ 
            error: 'Votre compte n\'a pas d\'email configuré' 
        });
    }
    
    const result = await alertService.sendAlertEmails({
        daysThreshold: 7,
        testMode: true,
        testEmail: userEmail
    });
    
    res.json({
        ...result,
        test_recipient: userEmail
    });
}));

/**
 * GET /alerts/preview
 * Prévisualise le contenu de l'email sans l'envoyer
 */
r.get('/preview', requireAuth(['ADMIN', 'KITCHEN']), a(async (req, res) => {
    const days = parseInt(req.query.days || '3', 10);
    const products = await alertService.getExpiringProducts(days);
    
    if (products.length === 0) {
        return res.json({
            products_count: 0,
            message: 'Aucun produit à risque',
            html: null,
            text: null
        });
    }
    
    const totalValue = products.reduce((sum, p) => sum + p.total_value, 0);
    const html = alertService.generateAlertEmailHtml(products, totalValue);
    const text = alertService.generateAlertEmailText(products, totalValue);
    
    res.json({
        products_count: products.length,
        total_value: Number(totalValue.toFixed(2)),
        html,
        text
    });
}));

export default r;
