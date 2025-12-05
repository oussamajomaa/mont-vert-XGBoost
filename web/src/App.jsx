import { Routes, Route, Navigate } from 'react-router-dom'
import Login from './pages/Login'
import Register from './pages/Register'
import Dashboard from './pages/Dashboard'
import ProtectedRoute from './auth/ProtectedRoute'
import { useAuth } from './auth/AuthContext'
import Products from './pages/Products'
import Lots from './pages/Lots'
import Recipes from './pages/Recipes'
import Movements from './pages/Movements'
import MealPlans from './pages/MealPlans'
import MealPlanDetail from './pages/MealPlanDetail'
import Users from './pages/Users'
import AiSuggestions from './pages/AiSuggestions'
import MlPredictions from './pages/MlPredictions'

export default function App() {
	const { user } = useAuth()

	return (
		<Routes>
			<Route path="/login" element={user ? <Navigate to="/" replace /> : <Login />} />
			<Route path="/" element={<ProtectedRoute><Dashboard /></ProtectedRoute>	} />
			<Route path="/register" element={<ProtectedRoute roles={['ADMIN']}><Register /></ProtectedRoute> } />
			<Route path="/users" element={<ProtectedRoute roles={['ADMIN']}><Users /></ProtectedRoute> } />
			<Route path="/products" element={<ProtectedRoute roles={['ADMIN']}><Products /></ProtectedRoute>} />
			<Route path="/lots" element={<ProtectedRoute roles={['ADMIN', 'KITCHEN']}><Lots /></ProtectedRoute>} />
			<Route path="/recipes" element={<ProtectedRoute roles={['ADMIN']}><Recipes /></ProtectedRoute>} />
			<Route path="/movements" element={<ProtectedRoute roles={['ADMIN']}><Movements /></ProtectedRoute>} />
			<Route path="/meal-plans" element={<ProtectedRoute roles={['ADMIN', 'KITCHEN']}><MealPlans /></ProtectedRoute>} />
			<Route path="/meal-plans/:id" element={<ProtectedRoute roles={['ADMIN', 'KITCHEN']}><MealPlanDetail /></ProtectedRoute>} />
			<Route path="/ai-suggestions" element={<ProtectedRoute roles={['ADMIN', 'KITCHEN']}><AiSuggestions /></ProtectedRoute>} />
			<Route path="/ml-predictions" element={<ProtectedRoute roles={['ADMIN', 'KITCHEN']}><MlPredictions /></ProtectedRoute>} />

			<Route path="*" element={<Navigate to="/" replace />} />
		</Routes>
	)
}
