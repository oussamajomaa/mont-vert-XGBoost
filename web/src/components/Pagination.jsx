export default function Pagination({ page, pageSize, total, onChange }) {
    const pages = Math.max(1, Math.ceil(total / pageSize))
    const canPrev = page > 1
    const canNext = page < pages

    return (
        <div className="flex items-center justify-between gap-3 text-sm">
            <div>Page {page} / {pages} · {total} items</div>
            <div className="flex items-center gap-2">
                <button disabled={!canPrev} onClick={() => onChange(page - 1)}
                    className={`px-3 py-1 rounded border ${canPrev ? 'bg-white hover:bg-slate-50' : 'opacity-50 cursor-not-allowed'}`}>Prev</button>
                <button disabled={!canNext} onClick={() => onChange(page + 1)}
                    className={`px-3 py-1 rounded border ${canNext ? 'bg-white hover:bg-slate-50' : 'opacity-50 cursor-not-allowed'}`}>Next</button>
            </div>
        </div>
    )
}
