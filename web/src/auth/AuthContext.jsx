
import { createContext, useContext, useEffect, useState } from 'react'
import api from '../api/axios'


const AuthCtx = createContext(null)
export const useAuth = () => useContext(AuthCtx)

export default function AuthProvider({ children }) {
    const [user, setUser] = useState(() => {
        const raw = localStorage.getItem('user')
        return raw ? JSON.parse(raw) : null
    })

    async function login(email, password) {
        const { data } = await api.post('/auth/login', { email, password })
        setUser(data.user)
        localStorage.setItem('user', JSON.stringify(data.user))
    }

    async function logout() {
        try { await api.post('/auth/logout'); } catch { }
        localStorage.removeItem('user');
        setUser(null);
    }

    async function register({ name, email, password, role }) {
        await api.post('/auth/register', { name, email, password, role })
    }

    return (
        <AuthCtx.Provider value={{ user, login, logout, register }}>
            {children}
        </AuthCtx.Provider>
    )
}