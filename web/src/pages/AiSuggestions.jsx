// web/src/pages/AiSuggestions.jsx
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import Layout from '../components/Layout'
import api from '../api/axios'
import toast from 'react-hot-toast'

export default function AiSuggestions() {
    const [data, setData] = useState(null)
    const [loading, setLoading] = useState(true)
    const [portions, setPortions] = useState(10)
    const [limit, setLimit] = useState(10)
    const [creating, setCreating] = useState(false)
    const [draftPlan, setDraftPlan] = useState(null) // Plan DRAFT actuel
    const [draftItems, setDraftItems] = useState([]) // Recettes déjà dans le plan
    const [maxPortions, setMaxPortions] = useState({}) // Portions max par recette
    const navigate = useNavigate()

    // Charger les suggestions
    async function load() {
        setLoading(true)
        try {
            const { data } = await api.get('/ai/suggestions', {
                params: { portions, limit }
            })
            setData(data)

            // Charger les portions max pour les recettes réalisables
            if (data?.suggestions) {
                const feasible = data.suggestions.filter(s => s.feasible)
                loadMaxPortions(feasible)
            }
        } catch (e) {
            toast.error('Erreur lors du chargement des suggestions')
        } finally {
            setLoading(false)
        }
    }

    // Charger les portions max pour chaque recette
    async function loadMaxPortions(suggestions) {
        const newMaxPortions = {}

        // Charger en parallèle (max 5 à la fois pour éviter trop de requêtes)
        const chunks = []
        for (let i = 0; i < suggestions.length; i += 5) {
            chunks.push(suggestions.slice(i, i + 5))
        }

        for (const chunk of chunks) {
            await Promise.all(chunk.map(async (sug) => {
                try {
                    const { data } = await api.get(`/ai/suggestions/recipe/${sug.recipe_id}`)
                    newMaxPortions[sug.recipe_id] = data
                } catch (e) {
                    console.error(`Erreur portions max recette ${sug.recipe_id}:`, e)
                }
            }))
        }

        setMaxPortions(newMaxPortions)
    }

    // Charger le plan DRAFT actuel (s'il existe)
    async function loadDraftPlan() {
        try {
            const today = new Date().toISOString().split('T')[0]
            const { data: plansResponse } = await api.get('/meal-plans', {
                params: { status: 'DRAFT' }
            })

            const draftPlanToday = plansResponse.data?.find(plan => {
                const planDate = plan.period_start.split('T')[0]
                return planDate === today
            })

            if (draftPlanToday) {
                setDraftPlan(draftPlanToday)
                // Charger les items du plan
                const { data: items } = await api.get(`/meal-plans/${draftPlanToday.id}/items`)
                setDraftItems(items)
            } else {
                setDraftPlan(null)
                setDraftItems([])
            }
        } catch (e) {
            console.error('Erreur chargement plan DRAFT:', e)
        }
    }

    async function addToPlan(suggestion) {
        if (creating) return

        setCreating(true)
        try {
            const today = new Date().toISOString().split('T')[0]

            let planId

            if (draftPlan) {
                // Ajouter au plan DRAFT existant
                planId = draftPlan.id

                // Vérifier si la recette existe déjà
                const alreadyExists = draftItems.some(item => item.recipe_id === suggestion.recipe_id)

                if (alreadyExists) {
                    toast.error(`${suggestion.recipe_name} est déjà dans le plan`)
                    setCreating(false)
                    return
                }

                await api.post(`/meal-plans/${planId}/items`, {
                    recipe_id: suggestion.recipe_id,
                    planned_portions: suggestion.portions
                })

                toast.success(`${suggestion.recipe_name} ajouté au plan`)
            } else {
                // Créer un nouveau plan DRAFT
                const { data: plan } = await api.post('/meal-plans', {
                    period_start: today,
                    period_end: today,
                    items: [
                        {
                            recipe_id: suggestion.recipe_id,
                            planned_portions: suggestion.portions
                        }
                    ]
                })

                planId = plan.id
                toast.success(`Plan créé avec ${suggestion.recipe_name}`)
            }

            // Recharger le plan DRAFT (mise à jour du compteur)
            await loadDraftPlan()

        } catch (e) {
            console.error(e)
            toast.error('Erreur lors de l\'ajout au plan')
        } finally {
            setCreating(false)
        }
    }

    // Vérifier si une recette est déjà dans le plan
    function isInPlan(recipeId) {
        return draftItems.some(item => item.recipe_id === recipeId)
    }

    useEffect(() => {
        load()
        loadDraftPlan()
    }, [])

    useEffect(() => {
        load()
    }, [portions, limit])

    if (loading) return <Layout><div className="text-slate-500">Chargement des suggestions IA...</div></Layout>
    if (!data) return <Layout><div className="text-red-600">Aucune donnée disponible</div></Layout>

    const { stats, suggestions, at_risk_products } = data
    const feasibleSuggestions = suggestions.filter(s => s.feasible)
    const unfeasibleSuggestions = suggestions.filter(s => !s.feasible)

    return (
        <Layout>
            <div className="mb-6">
                <h1 className="text-2xl font-semibold mb-2">🤖 Suggestions IA (FEFO)</h1>
                <p className="text-slate-600 text-sm">
                    Recommandations de plats basées sur le stock disponible et les dates de péremption
                </p>
            </div>

            {/* Bandeau Plan DRAFT */}
            {draftPlan && (
                <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 mb-6 flex items-center justify-between">
                    <div className="flex items-center gap-3">
                        <span className="text-2xl">📋</span>
                        <div>
                            <div className="font-semibold text-blue-800">
                                Plan en cours : {draftItems.length} plat{draftItems.length > 1 ? 's' : ''}
                            </div>
                            <div className="text-sm text-blue-600">
                                {draftItems.map(it => it.recipe_name).join(', ') || 'Aucun plat'}
                            </div>
                        </div>
                    </div>
                    <div className="flex gap-2">
                        <button
                            onClick={() => navigate(`/meal-plans/${draftPlan.id}`)}
                            className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 transition"
                        >
                            Voir le plan →
                        </button>
                    </div>
                </div>
            )}

            {/* Controls */}
            <div className="bg-white rounded shadow p-4 mb-6">
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <div>
                        <label className="block text-sm font-medium text-slate-700 mb-1">
                            Nombre de portions
                        </label>
                        <input
                            type="number"
                            min="1"
                            max="100"
                            value={portions}
                            onChange={(e) => setPortions(Math.max(1, parseInt(e.target.value) || 10))}
                            className="w-full px-3 py-2 border border-slate-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
                        />
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-slate-700 mb-1">
                            Nombre de suggestions
                        </label>
                        <input
                            type="number"
                            min="1"
                            max="50"
                            value={limit}
                            onChange={(e) => setLimit(Math.max(1, Math.min(50, parseInt(e.target.value) || 10)))}
                            className="w-full px-3 py-2 border border-slate-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
                        />
                    </div>
                    <div className="flex items-end">
                        <button
                            onClick={load}
                            className="w-full px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 transition"
                        >
                            🔄 Actualiser
                        </button>
                    </div>
                </div>
            </div>

            {/* Stats Cards */}
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
                <StatCard title="Suggestions totales" value={stats.total_suggestions} />
                <StatCard title="Réalisables" value={stats.feasible} color="green" />
                <StatCard title="Avec ingrédients urgents" value={stats.with_urgent_ingredients} color="orange" />
                <StatCard title="Produits à risque" value={stats.at_risk_products} color="red" />
            </div>

            {/* Main Content Grid */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-6">
                {/* Feasible Suggestions */}
                <div className="lg:col-span-2">
                    <div className="bg-white rounded shadow">
                        <div className="p-4 border-b">
                            <h2 className="font-semibold text-lg">✅ Plats réalisables ({feasibleSuggestions.length})</h2>
                            <p className="text-sm text-slate-600">Triés par score FEFO (priorité aux produits expirant bientôt)</p>
                        </div>
                        <div className="divide-y max-h-[600px] overflow-y-auto">
                            {feasibleSuggestions.map((sug, idx) => (
                                <SuggestionCard
                                    key={sug.recipe_id}
                                    suggestion={sug}
                                    rank={idx + 1}
                                    onAddToPlan={addToPlan}
                                    disabled={creating}
                                    inPlan={isInPlan(sug.recipe_id)}
                                    maxPortionsData={maxPortions[sug.recipe_id]}
                                />
                            ))}
                            {feasibleSuggestions.length === 0 && (
                                <div className="p-8 text-center text-slate-500">
                                    Aucune recette réalisable avec le stock actuel
                                </div>
                            )}
                        </div>
                    </div>

                    {/* Unfeasible Suggestions */}
                    {unfeasibleSuggestions.length > 0 && (
                        <div className="bg-white rounded shadow mt-6">
                            <div className="p-4 border-b">
                                <h2 className="font-semibold text-lg">❌ Plats non réalisables ({unfeasibleSuggestions.length})</h2>
                                <p className="text-sm text-slate-600">Stock insuffisant</p>
                            </div>
                            <div className="divide-y max-h-[400px] overflow-y-auto">
                                {unfeasibleSuggestions.map((sug) => (
                                    <UnfeasibleCard key={sug.recipe_id} suggestion={sug} />
                                ))}
                            </div>
                        </div>
                    )}
                </div>

                {/* At Risk Products Sidebar */}
                <div className="lg:col-span-1">
                    <div className="bg-white rounded shadow sticky top-4">
                        <div className="p-4 border-b">
                            <h2 className="font-semibold text-lg">⚠️ Produits à risque</h2>
                            <p className="text-sm text-slate-600">Expire dans ≤ 7 jours</p>
                        </div>
                        <div className="divide-y max-h-[600px] overflow-y-auto">
                            {at_risk_products.map((prod) => (
                                <AtRiskProductCard key={`${prod.product_id}-${prod.lot_id}`} product={prod} />
                            ))}
                            {at_risk_products.length === 0 && (
                                <div className="p-6 text-center text-slate-500 text-sm">
                                    ✅ Aucun produit à risque
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            </div>
        </Layout>
    )
}

function StatCard({ title, value, color = 'blue' }) {
    const colors = {
        blue: 'text-blue-600',
        green: 'text-green-600',
        orange: 'text-orange-600',
        red: 'text-red-600'
    }

    return (
        <div className="bg-white rounded shadow p-4">
            <div className="text-sm text-slate-500">{title}</div>
            <div className={`text-2xl font-semibold ${colors[color]}`}>{value}</div>
        </div>
    )
}

function SuggestionCard({ suggestion, rank, onAddToPlan, disabled, inPlan, maxPortionsData }) {
    const { recipe_name, fefo_score, urgent_ingredients, total_ingredients, reason, lots_to_use } = suggestion

    const getScoreColor = (score) => {
        if (score >= 70) return 'bg-red-100 text-red-700 border-red-300'
        if (score >= 40) return 'bg-orange-100 text-orange-700 border-orange-300'
        return 'bg-green-100 text-green-700 border-green-300'
    }

    const getUrgencyIcon = (urgentCount) => {
        if (urgentCount >= 3) return '🔴'
        if (urgentCount >= 1) return '🟠'
        return '🟢'
    }

    const maxPortions = maxPortionsData?.max_portions || 0
    const limitingIngredient = maxPortionsData?.limiting_ingredient?.product_name || null

    return (
        <div className={`p-4 transition ${inPlan ? 'bg-green-50 border-l-4 border-green-500' : 'hover:bg-slate-50'}`}>
            <div className="flex items-start justify-between mb-2">
                <div className="flex items-center gap-3">
                    <div className="text-2xl font-bold text-slate-400">#{rank}</div>
                    <div>
                        <div className="font-semibold text-lg flex items-center gap-2">
                            {getUrgencyIcon(urgent_ingredients)}
                            {recipe_name}
                            {inPlan && <span className="text-xs bg-green-600 text-white px-2 py-0.5 rounded">Dans le plan</span>}
                        </div>
                        <div className="text-sm text-slate-600">{reason}</div>
                    </div>
                </div>
                <div className="flex flex-col items-end gap-1">
                    <div className={`px-3 py-1 rounded border font-semibold text-sm ${getScoreColor(fefo_score)}`}>
                        Score: {fefo_score}
                    </div>
                    {/* Portions max */}
                    {maxPortionsData && (
                        <div className="text-xs text-slate-500 text-right">
                            <span className="font-semibold text-blue-600">{maxPortions}</span> portions max
                            {limitingIngredient && (
                                <div className="text-xs text-slate-400">
                                    (limité par {limitingIngredient})
                                </div>
                            )}
                        </div>
                    )}
                </div>
            </div>

            {/* Lots urgents à utiliser */}
            {lots_to_use.length > 0 && (
                <div className="mt-3 bg-slate-50 rounded p-3">
                    <div className="text-xs font-semibold text-slate-600 mb-2">
                        🔖 Lots à consommer en priorité :
                    </div>
                    <div className="space-y-1">
                        {lots_to_use.slice(0, 5).map((lot, idx) => (
                            <div key={idx} className="text-xs text-slate-700 flex justify-between">
                                <span>• {lot.product_name}</span>
                                <span className={lot.days_until_expiry <= 3 ? 'text-red-600 font-semibold' : 'text-slate-500'}>
                                    {lot.qty_used.toFixed(2)} ({lot.days_until_expiry}j restants)
                                </span>
                            </div>
                        ))}
                        {lots_to_use.length > 5 && (
                            <div className="text-xs text-slate-500 italic">
                                ... et {lots_to_use.length - 5} autres lot(s)
                            </div>
                        )}
                    </div>
                </div>
            )}

            <div className="mt-3 flex items-center justify-between">
                <div className="text-xs text-slate-500">
                    {urgent_ingredients > 0 && (
                        <span className="text-orange-600 font-medium">
                            {urgent_ingredients}/{total_ingredients} ingrédients urgents
                        </span>
                    )}
                    {urgent_ingredients === 0 && (
                        <span className="text-green-600">
                            Aucune urgence
                        </span>
                    )}
                </div>
                {inPlan ? (
                    <span className="text-xs px-3 py-1 bg-green-100 text-green-700 rounded">
                        ✓ Ajouté
                    </span>
                ) : (
                    <button
                        onClick={() => onAddToPlan(suggestion)}
                        disabled={disabled}
                        className="text-xs px-3 py-1 bg-blue-600 text-white rounded hover:bg-blue-700 transition disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                        {disabled ? '⏳ Ajout...' : 'Ajouter au plan'}
                    </button>
                )}
            </div>
        </div>
    )
}

function UnfeasibleCard({ suggestion }) {
    const { recipe_name, missing_ingredients } = suggestion

    return (
        <div className="p-4 opacity-60">
            <div className="font-semibold text-slate-700 mb-2">❌ {recipe_name}</div>
            <div className="text-sm text-red-600">
                {missing_ingredients.length} ingrédient(s) manquant(s) :
            </div>
            <ul className="text-xs text-slate-600 mt-1 space-y-1">
                {missing_ingredients.slice(0, 3).map((ing, idx) => (
                    <li key={idx}>
                        • {ing.product_name}: manque {ing.deficit.toFixed(2)} {ing.unit}
                    </li>
                ))}
                {missing_ingredients.length > 3 && (
                    <li className="text-slate-500 italic">... et {missing_ingredients.length - 3} autre(s)</li>
                )}
            </ul>
        </div>
    )
}

function AtRiskProductCard({ product }) {
    const { product_name, unit, days_until_expiry, available, expiry_date } = product

    const getUrgencyColor = (days) => {
        if (days <= 2) return 'border-l-4 border-red-500 bg-red-50'
        if (days <= 5) return 'border-l-4 border-orange-500 bg-orange-50'
        return 'border-l-4 border-yellow-500 bg-yellow-50'
    }

    const formatDate = (date) => {
        return new Date(date).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' })
    }

    return (
        <div className={`p-3 ${getUrgencyColor(days_until_expiry)}`}>
            <div className="font-semibold text-sm text-slate-800">{product_name}</div>
            <div className="text-xs text-slate-600 mt-1">
                {available.toFixed(2)} {unit} disponible
            </div>
            <div className="text-xs font-semibold mt-2">
                {days_until_expiry <= 2 ? (
                    <span className="text-red-600">⏰ Expire dans {days_until_expiry}j</span>
                ) : (
                    <span className="text-orange-600">📅 DLC: {formatDate(expiry_date)}</span>
                )}
            </div>
        </div>
    )
}