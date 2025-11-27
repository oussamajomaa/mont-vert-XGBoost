import { useEffect, useMemo, useState } from 'react';
import { useForm, useFieldArray } from 'react-hook-form';
import Layout from '../components/Layout';
import Modal from '../components/Modal';
import ConfirmDialog from '../components/ConfirmDialog';
import Pagination from '../components/Pagination';
import api from '../api/axios';
import useDebounce from '../hooks/useDebounce';

export default function Recipes() {
    const [rows, setRows] = useState([]);
    const [products, setProducts] = useState([]);
    const [page, setPage] = useState(1);
    const [pageSize] = useState(10);
    const [total, setTotal] = useState(0);
    const [q, setQ] = useState('');
    const qDebounced = useDebounce(q, 300);

    const [openForm, setOpenForm] = useState(false);
    const [editing, setEditing] = useState(null);
    const [openConfirm, setOpenConfirm] = useState(false);
    const [toDelete, setToDelete] = useState(null);

    const { register, handleSubmit, control, reset, getValues } = useForm({
        defaultValues: { name: '', base_portions: 10, waste_rate: 0, items: [] }
    });
    const { fields, append, remove, replace } = useFieldArray({ control, name: 'items' });

    async function load(p = page, qq = qDebounced) {
        const [prods, recs] = await Promise.all([
            api.get('/products', { params: { page: 1, pageSize: 1000 } }),
            api.get('/recipes', { params: { page: p, pageSize, q: qq } })
        ]);
        console.log(prods)
        setProducts(prods.data.data || prods.data);
        setRows(recs.data.data)
        setTotal(recs.data.total)
        setPage(recs.data.page)
    }
    // useEffect(() => { load(1, ''); }, []);
    useEffect(() => { load(1, qDebounced); }, [qDebounced]);

    function openAdd() {
        setEditing(null);
        reset({ name: '', base_portions: 10, waste_rate: 0, items: [] });
        setOpenForm(true);
    }
    async function openEdit(row) {
        setEditing(row);
        const { data: items } = await api.get(`/recipes/${row.id}/items`);
        reset({
            name: row.name,
            base_portions: row.base_portions,
            waste_rate: row.waste_rate,
            items: items.map(it => ({ product_id: it.product_id, qty_per_portion: it.qty_per_portion }))
        });
        setOpenForm(true);
    }
    async function onSubmit(values) {
        const payload = {
            name: values.name,
            base_portions: Number(values.base_portions),
            waste_rate: Number(values.waste_rate),
            items: values.items.map(it => ({ product_id: Number(it.product_id), qty_per_portion: Number(it.qty_per_portion) }))
        };
        if (editing) await api.patch(`/recipes/${editing.id}`, payload);
        else await api.post('/recipes', payload);
        setOpenForm(false);
        await load();
    }

    function askDelete(row) { setToDelete(row); setOpenConfirm(true); }
    async function doDelete() {
        try {
            await api.delete(`/recipes/${toDelete.id}`);
            setOpenConfirm(false); setToDelete(null);
            const newPage = (rows.length === 1 && page > 1) ? page - 1 : page;
            await load(newPage, qDebounced);
        } catch (e) { 
            // alert(e?.response?.data?.error || 'Cannot delete'); 
            // console.log(e)
        }
    }

    const productOptions = useMemo(() => products.map(p => ({ value: p.id, label: `${p.name} (${p.unit})` })), [products]);

    return (
        <Layout>
            <div className="flex items-center justify-between mb-4">
                <h1 className="text-2xl font-semibold">Recipes</h1>
                <button onClick={openAdd} className="bg-slate-800 text-white px-4 py-2 rounded hover:bg-slate-700">Add recipe</button>
            </div>

            <div className="bg-white p-4 rounded shadow mb-3 flex items-center gap-2">
                <input value={q} onChange={e => setQ(e.target.value)}
                    placeholder="Search recipe…" className="border rounded px-3 py-2 w-full max-w-md" />
            </div>

            <div className="bg-white rounded shadow overflow-hidden">
                <table className="min-w-full text-sm">
                    <thead className="bg-slate-100">
                        <tr>
                            <th className="text-left px-3 py-2">Name</th>
                            <th className="text-right px-3 py-2">Base portions</th>
                            <th className="text-right px-3 py-2">Waste %</th>
                            <th className="text-right px-3 py-2"># Items</th>
                            <th className="px-3 py-2 w-40">Actions</th>
                        </tr>
                    </thead>
                    <tbody>
                        {rows.map(r => (
                            <tr key={r.id} className="border-t">
                                <td className="px-3 py-2">{r.name}</td>
                                <td className="px-3 py-2 text-right">{r.base_portions}</td>
                                <td className="px-3 py-2 text-right">{Number(r.waste_rate).toFixed(2)}</td>
                                <td className="px-3 py-2 text-right">{r.items_count}</td>
                                <td className="px-3 py-2">
                                    <div className="flex gap-2 justify-end">
                                        <button onClick={() => openEdit(r)} className="px-3 py-1 rounded border hover:bg-slate-50">Edit</button>
                                        <button onClick={() => askDelete(r)} className="px-3 py-1 rounded bg-red-600 text-white hover:bg-red-700">Delete</button>
                                    </div>
                                </td>
                            </tr>
                        ))}
                        {!rows.length && <tr><td className="px-3 py-4 text-slate-500" colSpan={5}>No recipes.</td></tr>}
                    </tbody>
                </table>
                <div className="p-3 border-t bg-slate-50">
                    <Pagination page={page} pageSize={pageSize} total={total} onChange={(p) => load(p, qDebounced)} />
                </div>
            </div>

            {/* Modal Add/Edit */}
            <Modal
                title={editing ? 'Edit recipe' : 'Add recipe'}
                open={openForm}
                onClose={() => setOpenForm(false)}
                footer={(
                    <div className="flex justify-end gap-2">
                        <button onClick={() => setOpenForm(false)} className="px-4 py-2 rounded border">Cancel</button>
                        <button form="recipeForm" className="px-4 py-2 rounded bg-slate-800 text-white hover:bg-slate-700">Save</button>
                    </div>
                )}
            >
                <form id="recipeForm" onSubmit={handleSubmit(onSubmit)} className="space-y-3">
                    <div>
                        <label className="block text-sm">Name</label>
                        <input {...register('name', { required: true })} className="w-full border rounded px-3 py-2" />
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                        <div>
                            <label className="block text-sm">Base portions</label>
                            <input type="number" {...register('base_portions', { required: true, min: 1 })} className="w-full border rounded px-3 py-2" />
                        </div>
                        <div>
                            <label className="block text-sm">Waste %</label>
                            <input type="number" step="0.01" {...register('waste_rate', { required: true, min: 0, max: 100 })} className="w-full border rounded px-3 py-2" />
                        </div>
                    </div>

                    <div className="pt-2">
                        <div className="flex items-center justify-between mb-2">
                            <h3 className="font-semibold">Items</h3>
                            <button type="button" onClick={() => append({ product_id: '', qty_per_portion: '' })}
                                className="px-3 py-1 rounded border">+ Add item</button>
                        </div>
                        {/* zone scrollable pour beaucoup d’items */}
                        <div className="space-y-2 max-h-[50vh] overflow-y-auto pr-1">
                            {fields.map((f, idx) => (
                                <div key={f.id} className="grid grid-cols-12 gap-2 items-end">
                                    <div className="col-span-8">
                                        <label className="block text-sm">Product</label>
                                        <select {...register(`items.${idx}.product_id`, { required: true })}
                                            className="w-full border rounded px-3 py-2">
                                            <option value="">— Select —</option>
                                            {productOptions.map(o => (
                                                <option key={o.value} value={o.value}>{o.label}</option>
                                            ))}
                                        </select>
                                    </div>
                                    <div className="col-span-3">
                                        <label className="block text-sm">Qty/portion</label>
                                        <input type="number" step="0.001" {...register(`items.${idx}.qty_per_portion`, { required: true, min: 0 })}
                                            className="w-full border rounded px-3 py-2" />
                                    </div>
                                    <div className="col-span-1">
                                        <button type="button" onClick={() => remove(idx)}
                                            className="w-full px-2 py-2 rounded bg-red-600 text-white hover:bg-red-700">−</button>
                                    </div>
                                </div>
                            ))}
                            {!fields.length && <p className="text-sm text-slate-500">No items yet.</p>}
                        </div>
                    </div>
                </form>
            </Modal>

            <ConfirmDialog
                open={openConfirm}
                title="Delete recipe"
                message={`Delete "${toDelete?.name}" ?`}
                onCancel={() => { setOpenConfirm(false); setToDelete(null); }}
                onConfirm={doDelete}
            />
        </Layout>
    );
}
