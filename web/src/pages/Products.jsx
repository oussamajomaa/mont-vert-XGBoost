import useDebounce from '../hooks/useDebounce';
import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import Layout from '../components/Layout';
import Modal from '../components/Modal';
import ConfirmDialog from '../components/ConfirmDialog';
import Pagination from '../components/Pagination';
import api from '../api/axios';
import toast from 'react-hot-toast';

export default function Products() {
    const [items, setItems] = useState([]);
    const [page, setPage] = useState(1);
    const [pageSize] = useState(10);
    const [total, setTotal] = useState(0);
    const [q, setQ] = useState('');
    const [openForm, setOpenForm] = useState(false);
    const [editing, setEditing] = useState(null);
    const [openConfirm, setOpenConfirm] = useState(false);
    const [toDelete, setToDelete] = useState(null);
    const qDebounced = useDebounce(q, 300);

    const { register, handleSubmit, reset } = useForm({
        defaultValues: { name: '', unit: 'kg', cost: 0, alert_threshold: 0, active: true }
    });

    async function load(p = page, query = q) {
        const { data } = await api.get('/products', { params: { page: p, pageSize, q: query } });
        setItems(data.data); setTotal(data.total); setPage(data.page);
    }

    useEffect(() => { load(1, qDebounced); }, [qDebounced]); // recharge à chaque frappe (debounce)


    function openAdd() {
        setEditing(null);
        reset({ name: '', unit: 'kg', cost: 0, alert_threshold: 0, active: true });
        setOpenForm(true);
    }
    function openEdit(row) {
        setEditing(row);
        reset({
            name: row.name, unit: row.unit, cost: row.cost,
            alert_threshold: row.alert_threshold, active: !!row.active
        });
        setOpenForm(true);
    }

    async function onSubmit(values) {
        values.cost = Number(values.cost || 0);
        values.alert_threshold = Number(values.alert_threshold || 0);
        values.active = !!values.active;
        if (editing) {
            await api.patch(`/products/${editing.id}`, values)
            toast.success('Product edited')

        } else {
            await api.post('/products', values)
            toast.success('Lot added')
        }
        setOpenForm(false);
        await load();
    }

    function askDelete(row) { setToDelete(row); setOpenConfirm(true); }
    async function doDelete() {
        try {
            await api.delete(`/products/${toDelete.id}`)
            toast.success('Product deleted')
            setOpenConfirm(false); setToDelete(null);
            // si on supprime le dernier de la page, revenir à page-1 si nécessaire
            const newPage = (items.length === 1 && page > 1) ? page - 1 : page;
            await load(newPage, q);
        } catch (e) {
            // alert(e?.response?.data?.error || 'Cannot delete');
            // console.log(e)
        }
    }

    async function search() { await load(1, q); }

    return (
        <Layout>
            <div className="flex items-center justify-between mb-4">
                <h1 className="text-2xl font-semibold">Products</h1>
                <button onClick={openAdd} className="bg-slate-800 text-white px-4 py-2 rounded hover:bg-slate-700">Add product</button>
            </div>

            <div className="bg-white p-4 rounded shadow mb-3 flex items-center gap-2">
                <input value={q} onChange={e => setQ(e.target.value)}
                    placeholder="Search name/unit…" className="border rounded px-3 py-2 w-full max-w-md" />
                {/* <button onClick={search} className="px-4 py-2 rounded border">Search</button> */}
            </div>

            <div className="bg-white rounded shadow overflow-hidden">
                <table className="min-w-full text-sm">
                    <thead className="bg-slate-100">
                        <tr>
                            <th className="text-left px-3 py-2">Name</th>
                            <th className="text-left px-3 py-2">Unit</th>
                            <th className="text-right px-3 py-2">Cost</th>
                            <th className="text-right px-3 py-2">Alert</th>
                            <th className="px-3 py-2">Active</th>
                            <th className="px-3 py-2 w-40">Actions</th>
                        </tr>
                    </thead>
                    <tbody>
                        {items.map(row => (
                            <tr key={row.id} className="border-t">
                                <td className="px-3 py-2">{row.name}</td>
                                <td className="px-3 py-2">{row.unit}</td>
                                <td className="px-3 py-2 text-right">{Number(row.cost).toFixed(3)}</td>
                                <td className="px-3 py-2 text-right">{Number(row.alert_threshold).toFixed(2)}</td>
                                <td className="px-3 py-2 text-center">
                                    <span className={`px-2 py-0.5 rounded text-xs ${row.active ? 'bg-green-100 text-green-700' : 'bg-slate-200 text-slate-600'}`}>
                                        {row.active ? 'Yes' : 'No'}
                                    </span>
                                </td>
                                <td className="px-3 py-2">
                                    <div className="flex gap-2 justify-end">
                                        <button onClick={() => openEdit(row)} className="px-3 py-1 rounded border hover:bg-slate-50">Edit</button>
                                        <button onClick={() => askDelete(row)} className="px-3 py-1 rounded bg-red-600 text-white hover:bg-red-700">Delete</button>
                                    </div>
                                </td>
                            </tr>
                        ))}
                        {!items.length && <tr><td className="px-3 py-4 text-slate-500" colSpan={6}>No products.</td></tr>}
                    </tbody>
                </table>
                <div className="p-3 border-t bg-slate-50">
                    <Pagination page={page} pageSize={pageSize} total={total} onChange={(p) => load(p, q)} />
                </div>
            </div>

            {/* Modal Add/Edit */}
            <Modal title={editing ? 'Edit product' : 'Add product'} open={openForm} onClose={() => setOpenForm(false)}
                footer={(
                    <div className="flex justify-end gap-2">
                        <button onClick={() => setOpenForm(false)} className="px-4 py-2 rounded border">Cancel</button>
                        <button form="productForm" className="px-4 py-2 rounded bg-slate-800 text-white hover:bg-slate-700">Save</button>
                    </div>
                )}>
                <form id="productForm" onSubmit={handleSubmit(onSubmit)} className="space-y-3">
                    <div>
                        <label className="block text-sm">Name</label>
                        <input {...register('name', { required: true })} className="w-full border rounded px-3 py-2" />
                    </div>
                    <div>
                        <label className="block text-sm">Unit</label>
                        <input {...register('unit', { required: true })} className="w-full border rounded px-3 py-2" placeholder="kg / L / piece" />
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                        <div>
                            <label className="block text-sm">Cost</label>
                            <input type="number" step="0.001" {...register('cost')} className="w-full border rounded px-3 py-2" />
                        </div>
                        <div>
                            <label className="block text-sm">Alert threshold</label>
                            <input type="number" step="0.01" {...register('alert_threshold')} className="w-full border rounded px-3 py-2" />
                        </div>
                    </div>
                    <label className="inline-flex items-center gap-2">
                        <input type="checkbox" {...register('active')} />
                        <span>Active</span>
                    </label>
                </form>
            </Modal>

            {/* Confirm delete */}
            <ConfirmDialog
                open={openConfirm}
                title="Delete product"
                message={`Are you sure you want to delete "${toDelete?.name}" ?`}
                onCancel={() => { setOpenConfirm(false); setToDelete(null); }}
                onConfirm={doDelete}
            />
        </Layout>
    );
}
