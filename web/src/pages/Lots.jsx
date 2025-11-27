import useDebounce from '../hooks/useDebounce';
import { useEffect, useState } from 'react'
import { useForm } from 'react-hook-form'
import Layout from '../components/Layout'
import Modal from '../components/Modal'
import ConfirmDialog from '../components/ConfirmDialog'
import Pagination from '../components/Pagination'
import api from '../api/axios'
import toast from 'react-hot-toast';

export default function Lots() {
    const [products, setProducts] = useState([])
    const [rows, setRows] = useState([])
    const [page, setPage] = useState(1)
    const [pageSize] = useState(10)
    const [total, setTotal] = useState(0)
    const [q, setQ] = useState('')
    const qDebounced = useDebounce(q, 300);
    const [openForm, setOpenForm] = useState(false)
    const [editing, setEditing] = useState(null)
    const [openConfirm, setOpenConfirm] = useState(false)
    const [toDelete, setToDelete] = useState(null)

    const { register, handleSubmit, reset } = useForm({
        defaultValues: { product_id: '', batch_number: '', expiry_date: '', quantity: '' }
    })

    async function load(p = page, query = q) {
        const [prods, lots] = await Promise.all([
            api.get('/products', { params: { page: 1, pageSize: 1000 } }),
            api.get('/lots', { params: { page: p, pageSize, q: query } })
        ])
        setProducts(prods.data.data || prods.data) // compat (si backend renvoie data.data)
        setRows(lots.data.data)
        setTotal(lots.data.total)
        setPage(lots.data.page)
    }
    useEffect(() => { load(1, qDebounced); }, [qDebounced]);

    function openAdd() {
        setEditing(null)
        reset({ product_id: '', batch_number: '', expiry_date: '', quantity: '' })
        setOpenForm(true)
    }
    function openEdit(row) {
        setEditing(row)
        reset({
            product_id: row.product_id, batch_number: row.batch_number,
            expiry_date: row.expiry_date?.slice(0, 10), quantity: row.quantity
        })
        setOpenForm(true)
    }

    async function onSubmit(v) {
        const payload = {
            product_id: Number(v.product_id),
            batch_number: v.batch_number,
            expiry_date: v.expiry_date,
            quantity: Number(v.quantity)
        }
        if (editing) {
            await api.patch(`/lots/${editing.id}`, payload)
            toast.success('Lot edited')
        } else {
            payload.id = Number(v.id) // création = id requis (UNSIGNED)
            await api.post('/lots', payload)
            toast.success('Lot saved')
        }
        setOpenForm(false)
        await load()
    }

    function askDelete(row) {
        setToDelete(row)
        setOpenConfirm(true)
    }

    async function doDelete() {
        try {
            const res = await api.delete(`/lots/${toDelete.id}`)
            if (res.status === 200 && res.data?.message === 'archived') {
                toast.success('Lot archived');
            } else {
                toast.success('Lot deleted');
            }
            setOpenConfirm(false)
            setToDelete(null)
            const newPage = (rows.length === 1 && page > 1) ? page - 1 : page
            await load(newPage, q)
        } catch (e) {
            // alert(e?.response?.data?.error || 'Cannot delete')
            // console.log(e)
        }
    }

    async function search() { await load(1, q) }

    return (
        <Layout>
            <div className="flex items-center justify-between mb-4">
                <h1 className="text-2xl font-semibold">Lots</h1>
                <button onClick={openAdd} className="bg-slate-800 text-white px-4 py-2 rounded hover:bg-slate-700">Add lot</button>
            </div>

            <div className="bg-white p-4 rounded shadow mb-3 flex items-center gap-2">
                <input value={q} onChange={e => setQ(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && search()}
                    placeholder="Search product/batch…" className="border rounded px-3 py-2 w-full max-w-md" />
                <button onClick={search} className="px-4 py-2 rounded border">Search</button>
            </div>

            <div className="bg-white rounded shadow overflow-hidden">
                <table className="min-w-full text-sm">
                    <thead className="bg-slate-100">
                        <tr>
                            <th className="text-left px-3 py-2">Product</th>
                            <th className="text-left px-3 py-2">Batch</th>
                            <th className="text-left px-3 py-2">Expiry</th>
                            <th className="text-right px-3 py-2">Qty</th>
                            <th className="px-3 py-2 w-40">Actions</th>
                        </tr>
                    </thead>
                    <tbody>
                        {rows.map(l => (
                            <tr key={l.id} className="border-t">
                                <td className="px-3 py-2">{l.product_name}</td>
                                <td className="px-3 py-2">{l.batch_number}</td>
                                <td className="px-3 py-2">{l.expiry_date?.slice(0, 10)}</td>
                                <td className="px-3 py-2 text-right">{Number(l.quantity).toFixed(2)}</td>
                                <td className="px-3 py-2">
                                    <div className="flex gap-2 justify-end">
                                        <button onClick={() => openEdit(l)} className="px-3 py-1 rounded border hover:bg-slate-50">Edit</button>
                                        <button onClick={() => askDelete(l)} className="px-3 py-1 rounded bg-red-600 text-white hover:bg-red-700">Delete</button>
                                    </div>
                                </td>
                            </tr>
                        ))}
                        {!rows.length && <tr><td className="px-3 py-4 text-slate-500" colSpan={6}>No lots.</td></tr>}
                    </tbody>
                </table>
                <div className="p-3 border-t bg-slate-50">
                    <Pagination page={page} pageSize={pageSize} total={total} onChange={(p) => load(p, q)} />
                </div>
            </div>

            {/* Modal Add/Edit */}
            <Modal title={editing ? 'Edit lot' : 'Add lot'} open={openForm} onClose={() => setOpenForm(false)}
                footer={(
                    <div className="flex justify-end gap-2">
                        <button onClick={() => setOpenForm(false)} className="px-4 py-2 rounded border">Cancel</button>
                        <button form="lotForm" className="px-4 py-2 rounded bg-slate-800 text-white hover:bg-slate-700">Save</button>
                    </div>
                )}>
                <form id="lotForm" onSubmit={handleSubmit(onSubmit)} className="space-y-3">
                    <div>
                        <label className="block text-sm">Product</label>
                        <select {...register('product_id', { required: true })} className="w-full border rounded px-3 py-2">
                            <option value="">— Select —</option>
                            {products.map(p => <option key={p.id} value={p.id}>{p.name} ({p.unit})</option>)}
                        </select>
                    </div>
                    <div>
                        <label className="block text-sm">Batch number</label>
                        <input {...register('batch_number', { required: true })} className="w-full border rounded px-3 py-2" />
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                        <div>
                            <label className="block text-sm">Expiry date</label>
                            <input type="date" {...register('expiry_date', { required: true })} className="w-full border rounded px-3 py-2" />
                        </div>
                        <div>
                            <label className="block text-sm">Quantity</label>
                            <input type="number" step="0.01" {...register('quantity', { required: true })} className="w-full border rounded px-3 py-2" />
                        </div>
                    </div>
                </form>
            </Modal>

            {/* Confirm delete */}
            <ConfirmDialog
                open={openConfirm}
                title="Delete lot"
                message={`Are you sure you want to delete lot #${toDelete?.id} (${toDelete?.batch_number}) ?`}
                onCancel={() => { setOpenConfirm(false); setToDelete(null) }}
                onConfirm={doDelete}
            />
        </Layout>
    )
}
