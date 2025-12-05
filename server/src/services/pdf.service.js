// server/src/services/pdf.service.js
import PDFDocument from 'pdfkit'
import { pool } from '../db.js'

/**
 * Génère un PDF pour un meal plan
 * @param {number} planId - ID du plan
 * @returns {Promise<Buffer>} - Buffer du PDF
 */
export async function generateMealPlanPdf(planId) {
    // Récupérer les données du plan
    const [[plan]] = await pool.query(`
        SELECT mp.*
        FROM meal_plan mp
        WHERE mp.id = ?
    `, [planId])

    if (!plan) {
        throw new Error('Plan non trouvé')
    }

    // Récupérer les items du plan avec détails
    const [items] = await pool.query(`
        SELECT 
            mi.id,
            mi.planned_portions,
            mi.produced_portions,
            r.id as recipe_id,
            r.name as recipe_name,
            r.base_portions,
            r.waste_rate
        FROM meal_plan_item mi
        JOIN recipe r ON r.id = mi.recipe_id
        WHERE mi.meal_plan_id = ?
        ORDER BY mi.id ASC
    `, [planId])

    // Pour chaque item, récupérer les ingrédients nécessaires
    const itemsWithIngredients = await Promise.all(items.map(async (item) => {
        const [ingredients] = await pool.query(`
            SELECT 
                ri.product_id,
                p.name as product_name,
                p.unit,
                ri.qty_per_portion,
                (ri.qty_per_portion * ? * (1 + IFNULL(r.waste_rate, 0) / 100)) as total_needed
            FROM recipe_item ri
            JOIN product p ON p.id = ri.product_id
            JOIN recipe r ON r.id = ri.recipe_id
            WHERE ri.recipe_id = ?
            ORDER BY p.name
        `, [item.planned_portions, item.recipe_id])

        return { ...item, ingredients }
    }))

    // Récupérer les réservations si plan confirmé
    let reservations = []
    if (plan.status === 'CONFIRMED' || plan.status === 'EXECUTED') {
        const [resData] = await pool.query(`
            SELECT 
                rv.id,
                rv.reserved_qty,
                mi.id as item_id,
                r.name as recipe_name,
                l.batch_number,
                l.expiry_date,
                p.name as product_name,
                p.unit
            FROM reservation rv
            JOIN meal_plan_item mi ON mi.id = rv.meal_plan_item_id
            JOIN recipe r ON r.id = mi.recipe_id
            JOIN lot l ON l.id = rv.lot_id
            JOIN product p ON p.id = l.product_id
            WHERE mi.meal_plan_id = ?
            ORDER BY r.name, l.expiry_date
        `, [planId])
        reservations = resData
    }

    // Créer le PDF
    return new Promise((resolve, reject) => {
        try {
            const doc = new PDFDocument({
                size: 'A4',
                margin: 50,
                info: {
                    Title: `Meal Plan #${planId}`,
                    Author: 'Mont-Vert',
                    Subject: 'Plan de repas'
                }
            })

            const chunks = []
            doc.on('data', chunk => chunks.push(chunk))
            doc.on('end', () => resolve(Buffer.concat(chunks)))
            doc.on('error', reject)

            // Couleurs
            const colors = {
                primary: '#2563eb',
                success: '#16a34a',
                warning: '#ea580c',
                danger: '#dc2626',
                gray: '#64748b',
                lightGray: '#f1f5f9'
            }

            // === EN-TÊTE ===
            doc.rect(0, 0, doc.page.width, 100).fill(colors.primary)

            doc.fillColor('white')
                .fontSize(24)
                .font('Helvetica-Bold')
                .text('Mont-Vert', 50, 30)

            doc.fontSize(14)
                .font('Helvetica')
                .text(`Plan de repas #${planId}`, 50, 60)

            // Status badge
            const statusColors = {
                DRAFT: colors.warning,
                CONFIRMED: colors.primary,
                EXECUTED: colors.success
            }
            const statusX = doc.page.width - 150
            doc.roundedRect(statusX, 35, 100, 25, 5)
                .fill(statusColors[plan.status] || colors.gray)
            doc.fillColor('white')
                .fontSize(12)
                .text(plan.status, statusX, 42, { width: 100, align: 'center' })

            // === INFOS DU PLAN ===
            let y = 120

            doc.fillColor(colors.gray)
                .fontSize(10)
                .text('INFORMATIONS', 50, y)

            y += 20
            doc.fillColor('black')
                .fontSize(11)

            const formatDate = (d) => {
                if (!d) return '-'
                return new Date(d).toLocaleDateString('fr-FR', {
                    weekday: 'long',
                    day: 'numeric',
                    month: 'long',
                    year: 'numeric'
                })
            }

            const infoLines = [
                ['Période', `${formatDate(plan.period_start)} au ${formatDate(plan.period_end)}`],
                ['Créé le', formatDate(plan.created_at)],
                ['Nombre de plats', `${items.length} plat(s)`]
            ]

            for (const [label, value] of infoLines) {
                doc.font('Helvetica-Bold').text(label + ' : ', 50, y, { continued: true })
                doc.font('Helvetica').text(value)
                y += 18
            }

            // === PLATS ===
            y += 20
            doc.fillColor(colors.gray)
                .fontSize(10)
                .text('PLATS AU MENU', 50, y)

            y += 20

            for (const item of itemsWithIngredients) {
                // Vérifier si on a besoin d'une nouvelle page
                if (y > doc.page.height - 200) {
                    doc.addPage()
                    y = 50
                }

                // Nom du plat
                doc.fillColor(colors.primary)
                    .fontSize(13)
                    .font('Helvetica-Bold')
                    .text(`> ${item.recipe_name}`, 50, y)

                y += 20

                // Portions
                doc.fillColor('black')
                    .fontSize(10)
                    .font('Helvetica')

                const portionsText = item.produced_portions
                    ? `${item.planned_portions} portions prevues / ${item.produced_portions} produites`
                    : `${item.planned_portions} portions prevues`

                doc.text(portionsText, 70, y)
                y += 15

                // Ingrédients
                if (item.ingredients.length > 0) {
                    doc.fillColor(colors.gray)
                        .fontSize(9)
                        .text('Ingrédients nécessaires :', 70, y)
                    y += 12

                    for (const ing of item.ingredients) {
                        const totalNeeded = Number(ing.total_needed) || 0
                        doc.fillColor('black')
                            .fontSize(9)
                            .text(`• ${ing.product_name}: ${totalNeeded.toFixed(3)} ${ing.unit}`, 80, y)
                        y += 12
                    }
                }

                y += 15
            }

            // === RÉSERVATIONS FEFO ===
            if (reservations.length > 0) {
                if (y > doc.page.height - 150) {
                    doc.addPage()
                    y = 50
                }

                y += 10
                doc.fillColor(colors.gray)
                    .fontSize(10)
                    .text('RÉSERVATIONS FEFO', 50, y)

                y += 20

                // Tableau des réservations
                const tableHeaders = ['Plat', 'Produit', 'Lot', 'Qté', 'DLC']
                const colWidths = [120, 120, 80, 60, 80]
                let x = 50

                // En-tête du tableau
                doc.rect(50, y, doc.page.width - 100, 20).fill(colors.lightGray)
                doc.fillColor(colors.gray).fontSize(9).font('Helvetica-Bold')

                for (let i = 0; i < tableHeaders.length; i++) {
                    doc.text(tableHeaders[i], x + 5, y + 6, { width: colWidths[i] - 10 })
                    x += colWidths[i]
                }
                y += 20

                // Lignes du tableau
                doc.font('Helvetica').fillColor('black').fontSize(8)

                for (const res of reservations.slice(0, 30)) { // Max 30 lignes
                    if (y > doc.page.height - 50) {
                        doc.addPage()
                        y = 50
                    }

                    x = 50
                    const rowData = [
                        res.recipe_name.substring(0, 20),
                        res.product_name.substring(0, 20),
                        res.batch_number || '-',
                        Number(res.reserved_qty || 0).toFixed(3) + ' ' + res.unit,
                        new Date(res.expiry_date).toLocaleDateString('fr-FR')
                    ]

                    for (let i = 0; i < rowData.length; i++) {
                        doc.text(rowData[i], x + 5, y + 3, { width: colWidths[i] - 10 })
                        x += colWidths[i]
                    }

                    // Ligne de séparation
                    doc.strokeColor(colors.lightGray)
                        .moveTo(50, y + 15)
                        .lineTo(doc.page.width - 50, y + 15)
                        .stroke()

                    y += 18
                }

                if (reservations.length > 30) {
                    doc.fillColor(colors.gray)
                        .fontSize(8)
                        .text(`... et ${reservations.length - 30} autres réservations`, 50, y + 5)
                }
            }

            // === PIED DE PAGE ===
            const footerY = doc.page.height - 40
            doc.fillColor(colors.gray)
                .fontSize(8)
                .text(
                    `Généré le ${new Date().toLocaleString('fr-FR')} | Mont-Vert - Gestion de stock alimentaire`,
                    50,
                    footerY,
                    { align: 'center', width: doc.page.width - 100 }
                )

            doc.end()
        } catch (error) {
            reject(error)
        }
    })
}

export default { generateMealPlanPdf }