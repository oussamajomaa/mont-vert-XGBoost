// src/pages/MealPlanDetail.jsx
import { useEffect, useMemo, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import Layout from '../components/Layout';
import Modal from '../components/Modal';
import ConfirmDialog from '../components/ConfirmDialog';
import api from '../api/axios';
import { useForm } from 'react-hook-form';
import useDebounce from '../hooks/useDebounce';
import { useAuth } from '../auth/AuthContext';
import toast from 'react-hot-toast';

function FeasibilityBadge({ ok }) {
    return (
        <span className={`px-2 py-0.5 rounded text-xs ${ok ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
            {ok ? 'Feasible' : 'Insufficient stock'}
        </span>
    );
}

export default function MealPlanDetail() {
    const { id } = useParams();
    const planId = Number(id);
    const navigate = useNavigate();
    const { user } = useAuth();

    const [plan, setPlan] = useState(null);
    const [items, setItems] = useState([]);
    const [recipes, setRecipes] = useState([]);
    const [exportingPdf, setExportingPdf] = useState(false);

    // Modals
    const [openAddItem, setOpenAddItem] = useState(false);
    const [openExec, setOpenExec] = useState(false);
    const [execItem, setExecItem] = useState(null);
    const [openDeleteItem, setOpenDeleteItem] = useState(false);
    const [toDeleteItem, setToDeleteItem] = useState(null);

    // Charger plan + items
    async function loadAll() {
        const [{ data: list }, { data: itemsData }] = await Promise.all([
            api.get('/meal-plans', { params: { page: 1, pageSize: 1, status: '', from: undefined, to: undefined } }), // on ne s'en sert pas, c'est juste pour consistence
            api.get(`/meal-plans/${planId}/items`)
        ]);
        // Récup le plan (via petit GET direct)
        const { data: plansPage } = await api.get('/meal-plans', { params: { page: 1, pageSize: 1000 } });
        const p = (plansPage.data || []).find(x => x.id === planId);
        setPlan(p || null);
        setItems(itemsData || []);
    }

    useEffect(() => { (async () => { await loadAll(); })(); }, [planId]);

    // Confirmation du plan
    async function confirmPlan() {
        try {
            await api.post(`/meal-plans/${planId}/confirm`);
            await loadAll();
            // alert('Plan confirmé. Réservations FEFO créées.');
            toast.success('Plan confirmé. Réservations FEFO créées.');
        } catch (e) {
            // alert(e?.response?.data?.error || 'Confirm failed (stock insuffisant ?)');
            // console.log(e)
        }
    }

    // Export PDF
    async function exportPdf() {
        setExportingPdf(true);
        try {
            const response = await api.get(`/meal-plans/${planId}/export-pdf`, {
                responseType: 'blob'
            });
            
            // Créer un lien de téléchargement
            const blob = new Blob([response.data], { type: 'application/pdf' });
            const url = window.URL.createObjectURL(blob);
            const link = document.createElement('a');
            link.href = url;
            link.download = `meal-plan-${planId}.pdf`;
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            window.URL.revokeObjectURL(url);
            
            toast.success('PDF téléchargé !');
        } catch (e) {
            console.error('PDF export error:', e);
            toast.error('Erreur lors de l\'export PDF');
        } finally {
            setExportingPdf(false);
        }
    }

    // Exécuter une ligne
    const { register: regExec, handleSubmit: handleExec, reset: resetExec } = useForm({ defaultValues: { produced_portions: '' } });
    function askExecute(row) {
        setExecItem(row);
        resetExec({ produced_portions: row.planned_portions });
        setOpenExec(true);
    }
    async function onExecute(values) {
        try {
            await api.post(`/meal-plans/items/${execItem.id}/execute`, { produced_portions: Number(values.produced_portions) });
            setOpenExec(false);
            await loadAll();
            // alert('Ligne exécutée (sorties FEFO enregistrées).');
            toast.success('Ligne exécutée (sorties FEFO enregistrées).');
        } catch (e) { 
            // alert('Execution failed'); 
            console.log(e);
            toast.error(e?.response?.data?.error || "Execution failed");
        }
    }

    // Suppression d’un item (déjà bloquée côté serveur hors DRAFT)
    function askDeleteItem(row) { setToDeleteItem(row); setOpenDeleteItem(true); }
    async function doDeleteItem() {
        try {
            await api.delete(`/meal-plans/${planId}/items/${toDeleteItem.id}`);
            setOpenDeleteItem(false); setToDeleteItem(null);
            await loadAll();
            toast.success('Plat supprimé du plan');
        } catch (e) { 
            console.log(e);
            toast.error(e?.response?.data?.error || 'Suppression échouée');
        }
    }

    // --- Modal : ajouter un plat ---
    const { register: regItem, handleSubmit: handleItem, watch: watchItem, reset: resetItem } = useForm({
        defaultValues: { recipe_id: '', planned_portions: '' }
    });
    const watchRecipeId = watchItem('recipe_id');
    const watchPortions = Number(watchItem('planned_portions') || 0);

    // Charger recettes pour le select
    useEffect(() => {
        (async () => {
            const { data } = await api.get('/recipes', { params: { page: 1, pageSize: 1000 } });
            setRecipes(data.data);
        })();
    }, []);

    // Calcul de faisabilité
    const [feasibility, setFeasibility] = useState({ ok: false, detail: [], loading: false });
    useEffect(() => {
        let cancelled = false;
        async function compute() {
            const recipeId = Number(watchRecipeId);
            const portions = Number(watchPortions);
            if (!plan || !recipeId || !portions) { setFeasibility({ ok: false, detail: [], loading: false }); return; }
            setFeasibility(f => ({ ...f, loading: true }));

            const { data: lines } = await api.get(`/recipes/${recipeId}/items`);
            const r = recipes.find(x => x.id === recipeId);
            const wasteRate = r ? Number(r.waste_rate || 0) : 0;

            const checks = await Promise.all(lines.map(async li => {
                const { data: av } = await api.get('/stock/available', { params: { product_id: li.product_id } });
                const need = Number(li.qty_per_portion) * portions * (1 + wasteRate / 100);
                return {
                    product_id: li.product_id,
                    product_name: li.product_name,
                    unit: li.unit,
                    need,
                    available: Number(av.available || 0),
                    deficit: Math.max(0, need - Number(av.available || 0))
                };
            }));
            const ok = checks.every(c => c.deficit <= 0);
            if (!cancelled) setFeasibility({ ok, detail: checks, loading: false });
        }
        compute();
        return () => { cancelled = true; };
    }, [watchRecipeId, watchPortions, plan, recipes]);

    // Ajout d’un plat (mode normal)
    async function onAddItem(values) {
        await api.post(`/meal-plans/${planId}/items`, {
            recipe_id: Number(values.recipe_id),
            planned_portions: Number(values.planned_portions)
        });
        setOpenAddItem(false); resetItem({ recipe_id: '', planned_portions: '' });
        await loadAll();
    }

    // Ajout d’un plat (mode FORCER) — visible si ADMIN et faisabilité fausse
    async function onForceAdd() {
        const v = { recipe_id: Number(watchRecipeId), planned_portions: Number(watchPortions) };
        if (!v.recipe_id || !v.planned_portions) return;
        await api.post(`/meal-plans/${planId}/items`, v);
        setOpenAddItem(false); resetItem({ recipe_id: '', planned_portions: '' });
        await loadAll();
        // alert('Plat ajouté en mode forcé (non faisable actuellement). La confirmation échouera tant que le stock ne suffira pas.');
        toast.success('Plat ajouté en mode forcé (non faisable actuellement). La confirmation échouera tant que le stock ne suffira pas.');
    }

    return (
        <Layout>
            <div className="flex items-center justify-between mb-4">
                <button onClick={() => navigate('/meal-plans')} className="px-3 py-2 rounded border">← Back</button>
                <div className="text-right">
                    <div className="text-2xl font-semibold">Meal Plan #{planId}</div>
                    <div className="text-slate-500">{plan?.period_start} → {plan?.period_end} · Status: {plan?.status}</div>
                </div>
            </div>

            <div className="bg-white rounded shadow">
                <div className="p-4 border-b flex items-center justify-between">
                    <div className="text-sm text-slate-600">Détails du plan et actions</div>
                    <div className="flex items-center gap-2">
                        {/* Export PDF - toujours visible */}
                        <button 
                            onClick={exportPdf}
                            disabled={exportingPdf || !items.length}
                            className="px-3 py-2 rounded border bg-slate-100 hover:bg-slate-200 disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                            {exportingPdf ? '⏳ Export...' : '📄 Export PDF'}
                        </button>
                        
                        {plan?.status === 'DRAFT' && (
                            <>
                                <button onClick={() => setOpenAddItem(true)} className="px-3 py-2 rounded border">Add dish</button>
                                <button onClick={confirmPlan} disabled={!items.length}
                                    className={`px-3 py-2 rounded ${items.length ? 'bg-emerald-600 text-white hover:bg-emerald-700' : 'bg-slate-200 text-slate-500 cursor-not-allowed'}`}>
                                    Confirm (reserve FEFO)
                                </button>
                            </>
                        )}
                    </div>
                </div>

                <div className="p-4">
                    <table className="min-w-full text-sm">
                        <thead className="bg-slate-100">
                            <tr>
                                <th className="text-left px-3 py-2">Recipe</th>
                                <th className="text-right px-3 py-2">Planned</th>
                                <th className="text-right px-3 py-2">Produced</th>
                                <th className="text-left px-3 py-2">Status</th>
                                <th className="px-3 py-2 w-48">Actions</th>
                            </tr>
                        </thead>
                        <tbody>
                            {items.map(it => {
                                const done = it.produced_portions != null;
                                return (
                                    <tr key={it.id} className="border-t">
                                        <td className="px-3 py-2">{it.recipe_name}</td>
                                        <td className="px-3 py-2 text-right">{it.planned_portions}</td>
                                        <td className="px-3 py-2 text-right">{done ? it.produced_portions : <span className="text-slate-400">—</span>}</td>
                                        <td className="px-3 py-2">{done ? <span className="px-2 py-0.5 rounded text-xs bg-blue-100 text-blue-700">Executed</span> : <span className="px-2 py-0.5 rounded text-xs bg-amber-100 text-amber-800">Pending</span>}</td>
                                        <td className="px-3 py-2">
                                            <div className="flex gap-2 justify-end">
                                                {plan?.status === 'DRAFT' && !done && (
                                                    <button onClick={() => askDeleteItem(it)} className="px-3 py-1 rounded border hover:bg-slate-50">Delete</button>
                                                )}

                                                {plan?.status === 'CONFIRMED' && !done && (
                                                    <button onClick={() => askExecute(it)} className="px-3 py-1 rounded bg-slate-800 text-white hover:bg-slate-700">Execute</button>
                                                )}
                                            </div>
                                        </td>
                                    </tr>
                                );
                            })}
                            {!items.length && <tr><td className="px-3 py-4 text-slate-500" colSpan={5}>No items yet.</td></tr>}
                        </tbody>
                    </table>
                </div>
            </div>

            {/* MODAL: Ajouter un plat */}
            <Modal
                title="Add dish to plan"
                open={openAddItem}
                onClose={() => setOpenAddItem(false)}
                footer={
                    <div className="flex justify-between items-center gap-2">
                        <div className="flex items-center gap-2">
                            <FeasibilityBadge ok={feasibility.ok} />
                            {!feasibility.ok && user?.role === 'ADMIN' && (
                                <button type="button" onClick={onForceAdd}
                                    className="px-3 py-2 rounded bg-red-600 text-white hover:bg-red-700"
                                    title="Ajouter quand même (la confirmation du plan pourra échouer)">
                                    Force add
                                </button>
                            )}
                        </div>
                        <div className="flex gap-2">
                            <button onClick={() => setOpenAddItem(false)} className="px-4 py-2 rounded border">Cancel</button>
                            <button form="addItemForm"
                                className={`px-4 py-2 rounded ${feasibility.ok ? 'bg-slate-800 text-white hover:bg-slate-700' : 'bg-slate-200 text-slate-500 cursor-not-allowed'}`}
                                disabled={!feasibility.ok}>
                                Add
                            </button>
                        </div>
                    </div>
                }
            >
                <form id="addItemForm" onSubmit={handleItem(onAddItem)} className="space-y-3">
                    <div>
                        <label className="block text-sm">Recipe</label>
                        <select {...regItem('recipe_id', { required: true })} className="w-full border rounded px-3 py-2">
                            <option value="">— Select —</option>
                            {recipes.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
                        </select>
                    </div>
                    <div>
                        <label className="block text-sm">Planned portions</label>
                        <input type="number" min={1} {...regItem('planned_portions', { required: true })} className="w-full border rounded px-3 py-2" />
                    </div>

                    <div className="mt-2">
                        <div className="text-xs text-slate-500 mb-2">Computed from current lots (FEFO) and existing reservations.</div>
                        <div className="max-h-[40vh] overflow-y-auto border rounded">
                            <table className="min-w-full text-sm">
                                <thead className="bg-slate-50 sticky top-0">
                                    <tr>
                                        <th className="text-left px-3 py-2">Product</th>
                                        <th className="text-right px-3 py-2">Need</th>
                                        <th className="text-right px-3 py-2">Available</th>
                                        <th className="text-right px-3 py-2">Deficit</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {feasibility.detail.map((d, i) => (
                                        <tr key={i} className="border-t">
                                            <td className="px-3 py-2">{d.product_name} <span className="text-slate-400 text-xs">({d.unit})</span></td>
                                            <td className="px-3 py-2 text-right">{d.need.toFixed(3)}</td>
                                            <td className="px-3 py-2 text-right">{d.available.toFixed(3)}</td>
                                            <td className={`px-3 py-2 text-right ${d.deficit > 0 ? 'text-red-600' : ''}`}>{d.deficit.toFixed(3)}</td>
                                        </tr>
                                    ))}
                                    {!feasibility.detail.length && (
                                        <tr><td className="px-3 py-4 text-slate-500" colSpan={4}>Select a recipe and portions.</td></tr>
                                    )}
                                </tbody>
                            </table>
                        </div>
                    </div>
                </form>
            </Modal>

            {/* MODAL: Exécuter une ligne */}
            <Modal
                title={`Execute: ${execItem?.recipe_name || ''}`}
                open={openExec}
                onClose={() => setOpenExec(false)}
                footer={
                    <div className="flex justify-end gap-2">
                        <button onClick={() => setOpenExec(false)} className="px-4 py-2 rounded border">Cancel</button>
                        <button form="execForm" className="px-4 py-2 rounded bg-slate-800 text-white hover:bg-slate-700">Execute</button>
                    </div>
                }
            >
                <form id="execForm" onSubmit={handleExec(onExecute)} className="space-y-3">
                    <div>
                        <div className="text-sm text-slate-600 mb-2">Planned: {execItem?.planned_portions}</div>
                        <label className="block text-sm">Produced portions</label>
                        <input type="number" min={0} {...regExec('produced_portions', { required: true })} className="w-full border rounded px-3 py-2" />
                    </div>
                </form>
            </Modal>

            {/* CONFIRM delete item */}
            <ConfirmDialog
                open={openDeleteItem}
                title="Delete dish"
                message={`Remove "${toDeleteItem?.recipe_name}" from this plan?`}
                onCancel={() => { setOpenDeleteItem(false); setToDeleteItem(null); }}
                onConfirm={doDeleteItem}
            />
        </Layout>
    );
}