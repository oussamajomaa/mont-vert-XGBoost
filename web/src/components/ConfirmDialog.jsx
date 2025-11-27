export default function ConfirmDialog({ open, title="Confirm", message, onCancel, onConfirm }) {
  if (!open) return null
  return (
    <div className="fixed inset-0 z-50">
      <div className="absolute inset-0 bg-black/40" onClick={onCancel}/>
      <div className="absolute inset-0 flex items-center justify-center p-4">
        <div className="w-full max-w-md bg-white rounded shadow">
          <div className="px-4 py-3 border-b font-semibold">{title}</div>
          <div className="p-4 text-slate-700">{message}</div>
          <div className="px-4 py-3 border-t bg-slate-50 flex justify-end gap-2">
            <button onClick={onCancel} className="px-4 py-2 rounded border">Cancel</button>
            <button onClick={onConfirm} className="px-4 py-2 rounded bg-red-600 text-white hover:bg-red-700">Delete</button>
          </div>
        </div>
      </div>
    </div>
  )
}
