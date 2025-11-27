import { NavLink } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext'

const LinkItem = ({ to, icon, children }) => (
    <NavLink
        to={to}
        className={({ isActive }) =>
            `flex items-center gap-3 px-4 py-2 rounded hover:bg-slate-700 ${isActive ? 'bg-slate-700 text-white' : 'text-slate-200'}`
        }
    >
        <span className="w-5 text-center">{icon}</span>
        <span>{children}</span>
    </NavLink>
)

export default function Sidebar() {
    const { user, logout } = useAuth()
    const role = user?.role

    return (
        <aside className="fixed left-0 top-0 h-screen w-64 bg-slate-900 text-slate-100 border-r border-slate-800 overflow-y-auto">
            <div className="px-4 py-4 text-lg font-semibold flex items-center gap-2">
                <span>🌿</span>
                <span>Mont‑Vert</span>
            </div>
            <div className='flex flex-col justify-between   h-[calc(100vh-60px)] pt-6'>
                <nav className="px-2 pb-6 space-y-1">
                    <LinkItem to="/" icon="📊">Dashboard</LinkItem>

                    {(role === 'ADMIN' || role === 'KITCHEN') && (
                        <>
                            <div className="mt-3 text-xs uppercase text-slate-400 px-4">Stock & Recettes</div>
                            <LinkItem to="/products" icon="📦">Products</LinkItem>
                            <LinkItem to="/lots" icon="🏷️">Lots</LinkItem>
                            <LinkItem to="/recipes" icon="📖">Recipes</LinkItem>
                            <div className="mt-3 text-xs uppercase text-slate-400 px-4">Plans</div>
                            <LinkItem to="/meal-plans" icon="📅">Meal Plans</LinkItem>
                            <LinkItem to="/ai-suggestions" icon="💡">Suggestions FEFO</LinkItem>
                            <LinkItem to="/ml-predictions" icon="🤖">Prédictions IA</LinkItem>
                        </>
                    )}

                    {role === 'ADMIN' && (
                        <>
                            <div className="mt-3 text-xs uppercase text-slate-400 px-4">Admin</div>
                            <LinkItem to="/movements" icon="🔄">Movements</LinkItem>
                            <LinkItem to="/users" icon="👥">Users</LinkItem>
                        </>
                    )}

                    {role === 'DIRECTOR' && (
                        <>
                            <div className="mt-3 text-xs uppercase text-slate-400 px-4">Reports</div>
                            <LinkItem to="/reports" icon="📈">Alerts & KPIs</LinkItem>
                        </>
                    )}
                </nav>

                <div className="p-3 border-t border-slate-700">
                    {user ? (
                        <div className="flex items-center justify-between">
                            <span className="text-sm text-slate-300 flex items-center gap-2">
                                <span>👤</span>
                                {user.name} · {user.role}
                            </span>
                            <button
                                onClick={logout}
                                className="text-sm bg-slate-700 hover:bg-slate-600 px-3 py-1 rounded"
                            >Logout</button>
                        </div>
                    ) : (
                        <LinkItem to="/login" icon="🔐">Login</LinkItem>
                    )}
                </div>
            </div>
        </aside>
    )
}