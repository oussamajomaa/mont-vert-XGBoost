// server/src/cron/scheduler.js
import cron from 'node-cron'
import alertService from '../services/alert.service.js'

/**
 * Planificateur de tâches automatiques
 */

let alertJob = null

/**
 * Démarre le job d'alertes quotidiennes
 * Par défaut: tous les jours à 7h00
 */
export function startAlertScheduler(cronExpression = '0 7 * * *') {
    // Arrêter l'ancien job s'il existe
    if (alertJob) {
        alertJob.stop()
    }
    
    console.log(`📧 Alert scheduler started: ${cronExpression}`)
    
    alertJob = cron.schedule(cronExpression, async () => {
        console.log(`[${new Date().toISOString()}] Running daily DLC alert check...`)
        
        try {
            const result = await alertService.sendAlertEmails({
                daysThreshold: 3
            })
            
            if (result.sent) {
                console.log(` Alerts sent: ${result.products_count} products, ${result.recipients_count} recipients`)
            } else {
                console.log(` No alerts needed: ${result.message}`)
            }
        } catch (error) {
            console.error(' Error sending alerts:', error)
        }
    }, {
        timezone: 'Europe/Paris' // Ajuster selon la timezone
    })
    
    return alertJob
}

/**
 * Arrête le scheduler
 */
export function stopAlertScheduler() {
    if (alertJob) {
        alertJob.stop()
        alertJob = null
        console.log('📧 Alert scheduler stopped')
    }
}

/**
 * Vérifie si le scheduler est actif
 */
export function isSchedulerRunning() {
    return alertJob !== null
}

export default {
    startAlertScheduler,
    stopAlertScheduler,
    isSchedulerRunning
}
