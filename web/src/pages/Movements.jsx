import { useEffect, useState } from 'react';
import Layout from '../components/Layout';
import Pagination from '../components/Pagination';
import api from '../api/axios';
import useDebounce from '../hooks/useDebounce';

const TypeBadge = ({ t }) => {
    const cls = {
        IN: 'bg-green-100 text-green-700',
        OUT: 'bg-red-100 text-red-700',
        ADJUSTMENT: 'bg-amber-100 text-amber-800',
        LOSS: 'bg-rose-100 text-rose-700'
    }[t] || 'bg-slate-100 text-slate-700';
    return <span className={`px-2 py-0.5 text-xs rounded ${cls}`}>{t}</span>;
};

export default function Movements() {
    const [rows, setRows] = useState([]);
    const [total, setTotal] = useState(0);
    const [page, setPage] = useState(1);
    const [pageSize] = useState(10);

    // filtres
    const [q, setQ] = useState('');
    const qDebounced = useDebounce(q, 300);
    const [type, setType] = useState('');
    const [from, setFrom] = useState('');
    const [to, setTo] = useState('');
    const [productId, setProductId] = useState('');
    const [products, setProducts] = useState([]);

    async function load(p = page) {
        const { data } = await api.get('/movements', {
            params: {
                page: p, pageSize,
                q: qDebounced || undefined,
                type: type || undefined,
                from: from || undefined,
                to: to || undefined,
                product_id: productId || undefined
            }
        });
        setRows(data.data); setTotal(data.total); setPage(data.page);
    }

    // init + produits pour filtre
    useEffect(() => {
        (async () => {
            const res = await api.get('/products', { params: { page: 1, pageSize: 1000 } });
            setProducts(res.data.data || res.data);
            await load(1);
        })();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // rechargements sur changement de filtres
    useEffect(() => { setPage(1); }, [qDebounced, type, from, to, productId]);
    useEffect(() => { load(page); }, [qDebounced, type, from, to, productId, page]); // eslint-disable-line

    return (
        <Layout>
            <h1 className="text-2xl font-semibold mb-4">Stock movements (audit)</h1>

            {/* Filtres */}
            <div className="bg-white rounded shadow p-4 mb-4 grid grid-cols-1 md:grid-cols-6 gap-3">
                <input
                    value={q} onChange={e => setQ(e.target.value)}
                    placeholder="Search product / batch / user / recipe…"
                    className="border rounded px-3 py-2 md:col-span-2"
                />
                <select value={type} onChange={e => setType(e.target.value)} className="border rounded px-3 py-2">
                    <option value="">Type (all)</option>
                    <option>IN</option>
                    <option>OUT</option>
                    <option>ADJUSTMENT</option>
                    <option>LOSS</option>
                </select>
                <select value={productId} onChange={e => setProductId(e.target.value)} className="border rounded px-3 py-2">
                    <option value="">Product (all)</option>
                    {products.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
                <input type="date" value={from} onChange={e => setFrom(e.target.value)} className="border rounded px-3 py-2" />
                <input type="date" value={to} onChange={e => setTo(e.target.value)} className="border rounded px-3 py-2" />
            </div>

            {/* Table */}
            <div className="bg-white rounded shadow overflow-hidden">
                <table className="min-w-full text-sm">
                    <thead className="bg-slate-100">
                        <tr>
                            <th className="text-left px-3 py-2">Date</th>
                            <th className="text-left px-3 py-2">Type</th>
                            <th className="text-left px-3 py-2">Product</th>
                            <th className="text-left px-3 py-2">Lot / Batch</th>
                            <th className="text-right px-3 py-2">Qty</th>
                            <th className="text-left px-3 py-2">User</th>
                            <th className="text-left px-3 py-2">Recipe / Plan</th>
                            <th className="text-left px-3 py-2">Reason</th>
                        </tr>
                    </thead>
                    <tbody>
                        {rows.map(r => {
                            // const signedQty =
                            //     (r.type === 'OUT' || r.type === 'LOSS') ? -Number(r.quantity) : Number(r.quantity)
                            let signedQty = Number(r.quantity)
                            if (r.type === 'OUT' || r.type === 'LOSS') signedQty = -Math.abs(Number(r.quantity))
                            return (
                                <tr key={r.id} className="border-t">
                                    <td className="px-3 py-2">{new Date(r.moved_at).toLocaleString().slice(0,10)}</td>
                                    <td className="px-3 py-2"><TypeBadge t={r.type} /></td>
                                    <td className="px-3 py-2">{r.product_name} <span className="text-slate-400 text-xs">({r.unit})</span></td>
                                    <td className="px-3 py-2">#{r.lot_id} · {r.batch_number} <span className="text-slate-400 text-xs">exp {r.expiry_date?.slice(0, 10)}</span></td>
                                    <td className="px-3 py-2 text-right">{signedQty.toFixed(3)}</td>
                                    <td className="px-3 py-2">{r.user_name}</td>
                                    <td className="px-3 py-2">
                                        {r.recipe_name ? r.recipe_name : <span className="text-slate-400">—</span>}
                                        {r.meal_plan_id ? <span className="text-slate-400 text-xs"> · Plan #{r.meal_plan_id}</span> : null}
                                    </td>
                                    <td className="px-3 py-2">{r.reason || <span className="text-slate-400">—</span>}</td>
                                </tr>
                            );
                        })}
                        {!rows.length && (
                            <tr><td className="px-3 py-4 text-slate-500" colSpan={8}>No movements.</td></tr>
                        )}
                    </tbody>
                </table>
                <div className="p-3 border-t bg-slate-50">
                    <Pagination page={page} pageSize={pageSize} total={total} onChange={(p) => setPage(p)} />
                </div>
            </div>
        </Layout>
    );
}
