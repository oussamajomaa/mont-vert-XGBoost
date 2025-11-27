import { Navigate } from 'react-router-dom'
import { useAuth } from './AuthContext'

export default function ProtectedRoute({ children, roles }) {
    const { user } = useAuth()
    if (!user) return <Navigate to="/login" replace />
    if (roles && roles.length && !roles.includes(user.role)) return <Navigate to="/" replace />
    return children
}