// src/pages/Users.jsx
import { useEffect, useState } from 'react';
import Layout from '../components/Layout';
import api from '../api/axios';
import Pagination from '../components/Pagination';
import Modal from '../components/Modal';
import ConfirmDialog from '../components/ConfirmDialog';
import { useForm } from 'react-hook-form';
import toast from 'react-hot-toast';

const ROLES = ['ADMIN', 'KITCHEN', 'DIRECTOR'];

export default function Users() {
    const [rows, setRows] = useState([]);
    const [page, setPage] = useState(1);
    const [pageSize] = useState(10);
    const [total, setTotal] = useState(0);
    const [q, setQ] = useState('');

    const [openAdd, setOpenAdd] = useState(false);
    const [openEdit, setOpenEdit] = useState(false);
    const [editing, setEditing] = useState(null);
    const [openDel, setOpenDel] = useState(false);
    const [toDelete, setToDelete] = useState(null);

    async function load(p = page) {
        const { data } = await api.get('/users', { params: { page: p, pageSize, q: q || undefined } });
        setRows(data.data); setTotal(data.total); setPage(data.page);
    }
    useEffect(() => { load(1); }, [q]); // recherche instantanée simple
    useEffect(() => { load(page); }, [page]); // pagination

    // ADD
    const { register: regAdd, handleSubmit: handleAdd, reset: resetAdd } = useForm({
        defaultValues: { name: '', email: '', password: '', role: 'KITCHEN', active: true }
    });
    async function onAdd(v) {
        await api.post('/auth/register', { name: v.name, email: v.email, password: v.password, role: v.role });
        toast.success('Utilisateur créé');
        setOpenAdd(false); resetAdd({ name: '', email: '', password: '', role: 'KITCHEN', active: true });
        await load(1);
    }

    // EDIT
    const { register: regEdit, handleSubmit: handleEdit, reset: resetEdit } = useForm({
        defaultValues: { name: '', role: 'KITCHEN', active: true, password: '' }
    });
    function openEditModal(row) {
        setEditing(row);
        resetEdit({ name: row.name, role: row.role, active: row.active, password: '' });
        setOpenEdit(true);
    }
    async function onEdit(v) {
        const payload = { name: v.name, role: v.role, active: !!v.active };
        if (v.password) payload.password = v.password;
        await api.patch(`/users/${editing.id}`, payload);
        toast.success('Utilisateur mis à jour');
        setOpenEdit(false);
        await load(page);
    }

    // DELETE
    function askDelete(row) { setToDelete(row); setOpenDel(true); }
    async function doDelete() {
        await api.delete(`/users/${toDelete.id}`);
        toast.success('Utilisateur supprimé');
        setOpenDel(false); setToDelete(null);
        const newPage = (rows.length === 1 && page > 1) ? page - 1 : page;
        await load(newPage);
    }

    return (
        <Layout>
            <div className="flex items-center justify-between mb-4">
                <h1 className="text-2xl font-semibold">Users</h1>
                <button onClick={() => setOpenAdd(true)} className="bg-slate-800 text-white px-4 py-2 rounded hover:bg-slate-700">Add user</button>
            </div>

            <div className="bg-white p-4 rounded shadow mb-3">
                <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search name/email/role…" className="border rounded px-3 py-2 w-full md:w-96" />
            </div>

            <div className="bg-white rounded shadow overflow-hidden">
                <table className="min-w-full text-sm">
                    <thead className="bg-slate-100">
                        <tr>
                            <th className="text-left px-3 py-2">Name</th>
                            <th className="text-left px-3 py-2">Email</th>
                            <th className="text-left px-3 py-2">Role</th>
                            <th className="text-center px-3 py-2">Active</th>
                            <th className="text-left px-3 py-2">Created</th>
                            <th className="px-3 py-2 w-44">Actions</th>
                        </tr>
                    </thead>
                    <tbody>
                        {rows.map(u => (
                            <tr key={u.id} className="border-t">
                                <td className="px-3 py-2">{u.name}</td>
                                <td className="px-3 py-2">{u.email}</td>
                                <td className="px-3 py-2">{u.role}</td>
                                <td className="px-3 py-2 text-center">
                                    <span className={`px-2 py-0.5 rounded text-xs ${u.active ? 'bg-green-100 text-green-700' : 'bg-slate-200 text-slate-600'}`}>{u.active ? 'Yes' : 'No'}</span>
                                </td>
                                <td className="px-3 py-2">{new Date(u.created_at).toLocaleString()}</td>
                                <td className="px-3 py-2">
                                    <div className="flex gap-2 justify-end">
                                        <button onClick={() => openEditModal(u)} className="px-3 py-1 rounded border hover:bg-slate-50">Edit</button>
                                        <button onClick={() => askDelete(u)} className="px-3 py-1 rounded bg-red-600 text-white hover:bg-red-700">Delete</button>
                                    </div>
                                </td>
                            </tr>
                        ))}
                        {!rows.length && <tr><td className="px-3 py-4 text-slate-500" colSpan={6}>No users.</td></tr>}
                    </tbody>
                </table>
                <div className="p-3 border-t bg-slate-50">
                    <Pagination page={page} pageSize={pageSize} total={total} onChange={setPage} />
                </div>
            </div>

            {/* MODAL ADD */}
            <Modal title="Add user" open={openAdd} onClose={() => setOpenAdd(false)}
                footer={(
                    <div className="flex justify-end gap-2">
                        <button onClick={() => setOpenAdd(false)} className="px-4 py-2 rounded border">Cancel</button>
                        <button form="addUserForm" className="px-4 py-2 rounded bg-slate-800 text-white hover:bg-slate-700">Create</button>
                    </div>
                )}>
                <form id="addUserForm" onSubmit={handleAdd(onAdd)} className="space-y-3">
                    <div>
                        <label className="block text-sm">Name</label>
                        <input {...regAdd('name', { required: true })} className="w-full border rounded px-3 py-2" />
                    </div>
                    <div>
                        <label className="block text-sm">Email</label>
                        <input type="email" {...regAdd('email', { required: true })} className="w-full border rounded px-3 py-2" />
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                        <div>
                            <label className="block text-sm">Role</label>
                            <select {...regAdd('role', { required: true })} className="w-full border rounded px-3 py-2">
                                {ROLES.map(r => <option key={r} value={r}>{r}</option>)}
                            </select>
                        </div>
                        <div>
                            <label className="block text-sm">Password</label>
                            <input type="password" {...regAdd('password', { required: true, minLength: 6 })} className="w-full border rounded px-3 py-2" />
                        </div>
                    </div>
                </form>
            </Modal>

            {/* MODAL EDIT */}
            <Modal title={`Edit user: ${editing?.name || ''}`} open={openEdit} onClose={() => setOpenEdit(false)}
                footer={(
                    <div className="flex justify-end gap-2">
                        <button onClick={() => setOpenEdit(false)} className="px-4 py-2 rounded border">Cancel</button>
                        <button form="editUserForm" className="px-4 py-2 rounded bg-slate-800 text-white hover:bg-slate-700">Save</button>
                    </div>
                )}>
                <form id="editUserForm" onSubmit={handleEdit(onEdit)} className="space-y-3">
                    <div>
                        <label className="block text-sm">Name</label>
                        <input {...regEdit('name', { required: true })} className="w-full border rounded px-3 py-2" />
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                        <div>
                            <label className="block text-sm">Role</label>
                            <select {...regEdit('role', { required: true })} className="w-full border rounded px-3 py-2">
                                {ROLES.map(r => <option key={r} value={r}>{r}</option>)}
                            </select>
                        </div>
                        <div>
                            <label className="block text-sm">New password (optional)</label>
                            <input type="password" {...regEdit('password')} className="w-full border rounded px-3 py-2" placeholder="Leave blank to keep current" />
                        </div>
                    </div>
                    <label className="inline-flex items-center gap-2">
                        <input type="checkbox" {...regEdit('active')} />
                        <span>Active</span>
                    </label>
                </form>
            </Modal>

            {/* CONFIRM DELETE */}
            <ConfirmDialog
                open={openDel}
                title="Delete user"
                message={`Delete "${toDelete?.name}" ?`}
                onCancel={() => { setOpenDel(false); setToDelete(null); }}
                onConfirm={doDelete}
            />
        </Layout>
    );
}
