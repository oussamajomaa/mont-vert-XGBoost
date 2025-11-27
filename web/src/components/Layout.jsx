import Sidebar from './Sidebar'

export default function Layout({ children }) {
    return (
        <div className="min-h-screen bg-slate-50">
            {/* Sidebar fixe */}
            <Sidebar />
            {/* Contenu -> décalé et scrollable */}
            <main className="ml-64 h-screen overflow-y-auto">
                <div className="p-4 md:p-6 max-w-7xl mx-auto">
                    {children}
                </div>
            </main>
        </div>
    )
}
