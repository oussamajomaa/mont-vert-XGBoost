// server/src/services/alert.service.js
import nodemailer from 'nodemailer';
import { pool } from '../db.js';

/**
 * Service d'alertes email pour les produits proches de la DLC
 */

// Configuration du transporteur email
// En production, utiliser un vrai service SMTP (SendGrid, Mailgun, Gmail, etc.)
function createTransporter() {
    // Si les variables d'environnement sont définies, utiliser SMTP réel
    if (process.env.SMTP_HOST) {
        return nodemailer.createTransport({
            host: process.env.SMTP_HOST,
            port: parseInt(process.env.SMTP_PORT || '587'),
            secure: process.env.SMTP_SECURE === 'true',
            auth: {
                user: process.env.SMTP_USER,
                pass: process.env.SMTP_PASS
            }
        });
    }
    
    // Sinon, utiliser Ethereal (emails de test - pas vraiment envoyés)
    // Les emails peuvent être visualisés sur https://ethereal.email
    return null;
}

/**
 * Récupère les produits qui expirent dans les X prochains jours
 */
export async function getExpiringProducts(daysThreshold = 3) {
    const [rows] = await pool.query(`
        SELECT 
            p.id AS product_id,
            p.name AS product_name,
            p.unit,
            p.cost,
            l.id AS lot_id,
            l.batch_number,
            l.expiry_date,
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
          AND DATEDIFF(l.expiry_date, CURDATE()) <= ?
        ORDER BY l.expiry_date ASC, p.name ASC
    `, [daysThreshold]);
    
    // Filtrer les lots avec quantité disponible > 0
    const filtered = rows.filter(r => Number(r.available) > 0);
    
    // Grouper par produit
    const grouped = new Map();
    for (const row of filtered) {
        if (!grouped.has(row.product_id)) {
            grouped.set(row.product_id, {
                product_id: row.product_id,
                product_name: row.product_name,
                unit: row.unit,
                cost: Number(row.cost),
                total_qty: 0,
                total_value: 0,
                earliest_expiry: row.expiry_date,
                days_until_expiry: row.days_until_expiry,
                lots: []
            });
        }
        
        const entry = grouped.get(row.product_id);
        const available = Number(row.available);
        entry.total_qty += available;
        entry.total_value += available * Number(row.cost);
        entry.lots.push({
            lot_id: row.lot_id,
            batch_number: row.batch_number,
            expiry_date: row.expiry_date,
            days_until_expiry: row.days_until_expiry,
            available
        });
    }
    
    return Array.from(grouped.values());
}

/**
 * Récupère les destinataires des alertes (admins et kitchen staff)
 */
export async function getAlertRecipients() {
    const [rows] = await pool.query(`
        SELECT id, name, email, role
        FROM user
        WHERE role IN ('ADMIN', 'KITCHEN')
          AND email IS NOT NULL
          AND email != ''
    `);
    return rows;
}

/**
 * Génère le contenu HTML de l'email d'alerte
 */
export function generateAlertEmailHtml(products, totalValue) {
    const criticalProducts = products.filter(p => p.days_until_expiry <= 1);
    const urgentProducts = products.filter(p => p.days_until_expiry > 1 && p.days_until_expiry <= 3);
    
    const formatDate = (date) => {
        return new Date(date).toLocaleDateString('fr-FR', {
            weekday: 'short',
            day: 'numeric',
            month: 'short'
        });
    };
    
    const productRow = (p) => `
        <tr style="border-bottom: 1px solid #e5e7eb;">
            <td style="padding: 12px; font-weight: 500;">${p.product_name}</td>
            <td style="padding: 12px; text-align: right;">${p.total_qty.toFixed(2)} ${p.unit}</td>
            <td style="padding: 12px; text-align: center;">
                <span style="
                    display: inline-block;
                    padding: 4px 8px;
                    border-radius: 4px;
                    font-size: 12px;
                    font-weight: 600;
                    ${p.days_until_expiry <= 1 
                        ? 'background-color: #fee2e2; color: #dc2626;' 
                        : 'background-color: #fef3c7; color: #d97706;'}
                ">
                    ${p.days_until_expiry === 0 ? "Aujourd'hui" : 
                      p.days_until_expiry === 1 ? "Demain" : 
                      `${p.days_until_expiry} jours`}
                </span>
            </td>
            <td style="padding: 12px; text-align: right; color: #dc2626;">${p.total_value.toFixed(2)} €</td>
        </tr>
    `;
    
    return `
<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; margin: 0; padding: 20px; background-color: #f3f4f6;">
    <div style="max-width: 600px; margin: 0 auto; background-color: white; border-radius: 8px; overflow: hidden; box-shadow: 0 1px 3px rgba(0,0,0,0.1);">
        
        <!-- Header -->
        <div style="background: linear-gradient(135deg, #dc2626 0%, #ea580c 100%); color: white; padding: 24px; text-align: center;">
            <h1 style="margin: 0; font-size: 24px;">⚠️ Alerte DLC - Mont-Vert</h1>
            <p style="margin: 8px 0 0 0; opacity: 0.9;">
                ${products.length} produit(s) expire(nt) bientôt
            </p>
        </div>
        
        <!-- Summary -->
        <div style="padding: 20px; background-color: #fef2f2; border-bottom: 1px solid #fecaca;">
            <div style="display: flex; justify-content: space-around; text-align: center;">
                <div>
                    <div style="font-size: 28px; font-weight: bold; color: #dc2626;">${products.length}</div>
                    <div style="font-size: 12px; color: #6b7280;">Produits</div>
                </div>
                <div>
                    <div style="font-size: 28px; font-weight: bold; color: #dc2626;">${totalValue.toFixed(0)} €</div>
                    <div style="font-size: 12px; color: #6b7280;">Valeur à risque</div>
                </div>
                <div>
                    <div style="font-size: 28px; font-weight: bold; color: #dc2626;">${criticalProducts.length}</div>
                    <div style="font-size: 12px; color: #6b7280;">Critiques (≤1j)</div>
                </div>
            </div>
        </div>
        
        <!-- Critical section -->
        ${criticalProducts.length > 0 ? `
        <div style="padding: 20px;">
            <h2 style="margin: 0 0 16px 0; font-size: 16px; color: #dc2626;">
                🔴 Critiques - Action immédiate requise
            </h2>
            <table style="width: 100%; border-collapse: collapse; font-size: 14px;">
                <thead>
                    <tr style="background-color: #fee2e2;">
                        <th style="padding: 12px; text-align: left;">Produit</th>
                        <th style="padding: 12px; text-align: right;">Quantité</th>
                        <th style="padding: 12px; text-align: center;">Expire</th>
                        <th style="padding: 12px; text-align: right;">Valeur</th>
                    </tr>
                </thead>
                <tbody>
                    ${criticalProducts.map(productRow).join('')}
                </tbody>
            </table>
        </div>
        ` : ''}
        
        <!-- Urgent section -->
        ${urgentProducts.length > 0 ? `
        <div style="padding: 20px; ${criticalProducts.length > 0 ? 'border-top: 1px solid #e5e7eb;' : ''}">
            <h2 style="margin: 0 0 16px 0; font-size: 16px; color: #d97706;">
                🟠 Urgents - À traiter rapidement
            </h2>
            <table style="width: 100%; border-collapse: collapse; font-size: 14px;">
                <thead>
                    <tr style="background-color: #fef3c7;">
                        <th style="padding: 12px; text-align: left;">Produit</th>
                        <th style="padding: 12px; text-align: right;">Quantité</th>
                        <th style="padding: 12px; text-align: center;">Expire</th>
                        <th style="padding: 12px; text-align: right;">Valeur</th>
                    </tr>
                </thead>
                <tbody>
                    ${urgentProducts.map(productRow).join('')}
                </tbody>
            </table>
        </div>
        ` : ''}
        
        <!-- CTA -->
        <div style="padding: 24px; text-align: center; border-top: 1px solid #e5e7eb;">
            <a href="${process.env.APP_URL || 'http://localhost:5173'}/ai-suggestions" 
               style="display: inline-block; background-color: #2563eb; color: white; padding: 12px 24px; border-radius: 6px; text-decoration: none; font-weight: 500;">
                🤖 Voir les suggestions IA
            </a>
            <p style="margin: 16px 0 0 0; font-size: 12px; color: #6b7280;">
                Utilisez les suggestions IA pour créer des plans de repas optimisés
            </p>
        </div>
        
        <!-- Footer -->
        <div style="padding: 16px; background-color: #f9fafb; text-align: center; font-size: 12px; color: #6b7280;">
            <p style="margin: 0;">
                Cette alerte a été générée automatiquement par Mont-Vert<br>
                ${new Date().toLocaleString('fr-FR')}
            </p>
        </div>
    </div>
</body>
</html>
    `;
}

/**
 * Génère le contenu texte de l'email (fallback)
 */
export function generateAlertEmailText(products, totalValue) {
    let text = `⚠️ ALERTE DLC - MONT-VERT\n`;
    text += `================================\n\n`;
    text += `${products.length} produit(s) expire(nt) dans les 3 prochains jours\n`;
    text += `Valeur à risque: ${totalValue.toFixed(2)} €\n\n`;
    
    const critical = products.filter(p => p.days_until_expiry <= 1);
    const urgent = products.filter(p => p.days_until_expiry > 1);
    
    if (critical.length > 0) {
        text += `🔴 CRITIQUES (≤1 jour):\n`;
        text += `-----------------------\n`;
        for (const p of critical) {
            text += `• ${p.product_name}: ${p.total_qty.toFixed(2)} ${p.unit} (${p.total_value.toFixed(2)} €)\n`;
        }
        text += `\n`;
    }
    
    if (urgent.length > 0) {
        text += `🟠 URGENTS (2-3 jours):\n`;
        text += `-----------------------\n`;
        for (const p of urgent) {
            text += `• ${p.product_name}: ${p.total_qty.toFixed(2)} ${p.unit} - expire dans ${p.days_until_expiry}j\n`;
        }
        text += `\n`;
    }
    
    text += `\n→ Consultez les suggestions IA: ${process.env.APP_URL || 'http://localhost:5173'}/ai-suggestions\n`;
    
    return text;
}

/**
 * Envoie les alertes email
 * @returns {Object} Résultat de l'envoi
 */
export async function sendAlertEmails(options = {}) {
    const daysThreshold = options.daysThreshold || 3;
    const testMode = options.testMode || false;
    const testEmail = options.testEmail || null;
    
    // Récupérer les produits à risque
    const products = await getExpiringProducts(daysThreshold);
    
    if (products.length === 0) {
        return {
            success: true,
            sent: false,
            message: 'Aucun produit à risque',
            products_count: 0
        };
    }
    
    // Calculer la valeur totale
    const totalValue = products.reduce((sum, p) => sum + p.total_value, 0);
    
    // Récupérer les destinataires
    let recipients;
    if (testMode && testEmail) {
        recipients = [{ email: testEmail, name: 'Test User' }];
    } else {
        recipients = await getAlertRecipients();
    }
    
    if (recipients.length === 0) {
        return {
            success: false,
            sent: false,
            message: 'Aucun destinataire configuré',
            products_count: products.length
        };
    }
    
    // Créer le transporteur
    let transporter = createTransporter();
    let useEthereal = false;
    
    // Si pas de SMTP configuré, créer un compte Ethereal de test
    if (!transporter) {
        useEthereal = true;
        const testAccount = await nodemailer.createTestAccount();
        transporter = nodemailer.createTransport({
            host: 'smtp.ethereal.email',
            port: 587,
            secure: false,
            auth: {
                user: testAccount.user,
                pass: testAccount.pass
            }
        });
    }
    
    // Générer le contenu
    const html = generateAlertEmailHtml(products, totalValue);
    const text = generateAlertEmailText(products, totalValue);
    
    // Envoyer les emails
    const results = [];
    for (const recipient of recipients) {
        try {
            const info = await transporter.sendMail({
                from: process.env.SMTP_FROM || '"Mont-Vert Alerts" <alerts@mont-vert.local>',
                to: recipient.email,
                subject: `⚠️ Alerte DLC: ${products.length} produit(s) expire(nt) bientôt`,
                text,
                html
            });
            
            results.push({
                email: recipient.email,
                success: true,
                messageId: info.messageId,
                previewUrl: useEthereal ? nodemailer.getTestMessageUrl(info) : null
            });
        } catch (error) {
            results.push({
                email: recipient.email,
                success: false,
                error: error.message
            });
        }
    }
    
    // Log l'alerte dans la base de données
    await pool.query(`
        INSERT INTO alert_log (type, products_count, total_value, recipients_count, sent_at)
        VALUES ('DLC_WARNING', ?, ?, ?, NOW())
    `, [products.length, totalValue, results.filter(r => r.success).length]);
    
    return {
        success: true,
        sent: true,
        products_count: products.length,
        total_value: totalValue,
        recipients_count: recipients.length,
        results,
        useEthereal,
        products // Inclure les produits pour l'affichage
    };
}

export default {
    getExpiringProducts,
    getAlertRecipients,
    sendAlertEmails,
    generateAlertEmailHtml,
    generateAlertEmailText
};
