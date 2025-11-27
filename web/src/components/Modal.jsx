export default function Modal({ title, open, onClose, children, footer }) {
    if (!open) return null
    return (
        <div className="fixed inset-0 z-50">
            <div className="absolute inset-0 bg-black/40" onClick={onClose} />
            <div className="absolute inset-0 flex items-center justify-center p-4">
                <div className="w-full max-w-lg bg-white rounded shadow">
                    <div className="px-4 py-3 border-b flex items-center justify-between">
                        <h3 className="font-semibold">{title}</h3>
                        <button className="text-slate-500 hover:text-slate-700" onClick={onClose}>✕</button>
                    </div>
                    <div className="p-4">{children}</div>
                    {footer && <div className="px-4 py-3 border-t bg-slate-50">{footer}</div>}
                </div>
            </div>
        </div>
    )
}
