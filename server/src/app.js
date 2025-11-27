import express from 'express'
import cors from 'cors'
import authRoutes from './auth/auth.routes.js'
import productRoutes from './routes/product.routes.js'
import lotRoutes from './routes/lot.routes.js'
import recipeRoutes from './routes/recipe.routes.js'
import mealplanRoutes from './routes/mealplan.routes.js'
import movementRoutes from './routes/movement.routes.js'
import stockRoutes from './routes/stock.routes.js';
import dashboardRoutes from './routes/dashboard.routes.js';
import userRoutes from './routes/user.routes.js';
import aiRoutes from './routes/ai.routes.js';
import alertRoutes from './routes/alert.routes.js';
import mlRoutes from './routes/ml.routes.js';
import { startAlertScheduler } from './cron/scheduler.js';
import cookieParser from 'cookie-parser'


const app = express()
app.use(cookieParser())
app.use(cors({ origin: process.env.CORS_ORIGIN || 'http://localhost:5173', credentials: true }));
app.use(express.json())

app.use('/auth', authRoutes)
app.use('/products', productRoutes)
app.use('/lots', lotRoutes)
app.use('/recipes', recipeRoutes)
app.use('/meal-plans', mealplanRoutes)
app.use('/movements', movementRoutes)
app.use('/stock', stockRoutes);
app.use('/dashboard', dashboardRoutes);
app.use('/users', userRoutes);
app.use('/ai', aiRoutes);
app.use('/alerts', alertRoutes);
app.use('/ml', mlRoutes);

app.use((err, _req, res, _next) => {
    console.error(err)
    res.status(err.status || 500).json({ error: err.message || 'Server error' })
})

// export default app
const port = process.env.PORT || 4000
app.listen(port, () => {
    console.log(`API running on :${port}`)
    
    // Démarrer le scheduler d'alertes si activé
    if (process.env.ENABLE_ALERT_SCHEDULER !== 'false') {
        // Par défaut: tous les jours à 7h00
        const cronExpression = process.env.ALERT_CRON || '0 7 * * *';
        startAlertScheduler(cronExpression);
    }
})