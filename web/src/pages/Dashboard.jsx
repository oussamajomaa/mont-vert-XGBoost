// src/pages/Dashboard.jsx
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import Layout from '../components/Layout'
import api from '../api/axios'
import { Line, Doughnut, Bar } from 'react-chartjs-2'
import {
	Chart as ChartJS,
	LineElement,
	PointElement,
	LinearScale,
	CategoryScale,
	ArcElement,
	BarElement,
	Tooltip,
	Legend,
} from 'chart.js'
import { format, parseISO } from 'date-fns'
import { palette, categorical, commonOptions } from '../chart/theme'
import toast from 'react-hot-toast'
import { useAuth } from '../auth/AuthContext'

ChartJS.register(
	LineElement,
	PointElement,
	LinearScale,
	CategoryScale,
	ArcElement,
	BarElement,
	Tooltip,
	Legend
)

const euro = (v) =>
	new Intl.NumberFormat('fr-FR', {
		style: 'currency',
		currency: 'EUR',
	}).format(v)

export default function Dashboard() {
	const [data, setData] = useState(null)
	const [loading, setLoading] = useState(true)
	const [sendingAlert, setSendingAlert] = useState(false)
	const { user } = useAuth()
	const navigate = useNavigate()

	async function load() {
		setLoading(true)
		const { data } = await api.get('/dashboard/overview', { params: { days: 30 } })
		setData(data)
		setLoading(false)
	}

	async function processExpired() {
		try {
			const { data: res } = await api.post('/lots/expire')
			toast.success(
				`Périmés traités · lots: ${res.lotsProcessed} · pertes: ${Number(
					res.totalLoss
				).toFixed(3)}`
			)
			await load()
		} catch (e) {
			// l'intercepteur axios s'occupe déjà d'afficher l'erreur
		}
	}

	async function sendTestAlert() {
		setSendingAlert(true)
		try {
			const { data: res } = await api.post('/alerts/test')
			if (res.sent) {
				if (res.useEthereal && res.results?.[0]?.previewUrl) {
					toast.success(
						<div>
							<div>Email de test envoyé !</div>
							<a
								href={res.results[0].previewUrl}
								target="_blank"
								rel="noopener noreferrer"
								className="text-blue-600 underline text-sm"
							>
								Voir l'email (Ethereal)
							</a>
						</div>,
						{ duration: 10000 }
					)
				} else {
					toast.success(`Email envoyé à ${res.test_recipient}`)
				}
			} else {
				toast.error(res.message || 'Aucun produit à risque')
			}
		} catch (e) {
			toast.error('Erreur lors de l\'envoi')
		} finally {
			setSendingAlert(false)
		}
	}

	useEffect(() => {
		load()
	}, [])

	if (loading) {
		return (
			<Layout>
				<div className="text-slate-500">Loading…</div>
			</Layout>
		)
	}

	if (!data) {
		return (
			<Layout>
				<div className="text-red-600">No data</div>
			</Layout>
		)
	}

	const { kpis, series, topProducts, expiringLots, losses, toReplenish, fefo } = data

	// ============================
	// Courbe des mouvements (30j, €)
	// ============================
	const seriesNorm = (series || []).map((s) => ({
		...s,
		val:
			s.value_eur != null
				? Number(s.value_eur)
				: s.qty != null
					? Number(s.qty)
					: 0,
	}))

	const days = Array.from(new Set(seriesNorm.map((s) => s.d))).sort()

	const serieType = (type) =>
		days.map((d) => {
			const row = seriesNorm.find((s) => s.d === d && s.type === type)
			return row ? row.val : 0
		})

	const lineData = {
		labels: days.map((d) => format(parseISO(d), 'dd/MM')),
		datasets: [
			{
				label: 'IN €',
				data: serieType('IN'),
				borderColor: palette.in.border,
				backgroundColor: palette.in.bg,
				borderWidth: 2,
				tension: 0.25,
			},
			{
				label: 'OUT €',
				data: serieType('OUT'),
				borderColor: palette.out.border,
				backgroundColor: palette.out.bg,
				borderWidth: 2,
				tension: 0.25,
			},
			{
				label: 'ADJ €',
				data: serieType('ADJUSTMENT'),
				borderColor: palette.adj.border,
				backgroundColor: palette.adj.bg,
				borderWidth: 2,
				tension: 0.25,
			},
			{
				label: 'LOSS €',
				data: serieType('LOSS'),
				borderColor: palette.loss.border,
				backgroundColor: palette.loss.bg,
				borderWidth: 2,
				tension: 0.25,
			},
		],
	}

	const optionsCurrency = {
		...commonOptions,
		scales: {
			...commonOptions.scales,
			y: {
				...commonOptions.scales.y,
				ticks: {
					callback: (v) => euro(v),
				},
			},
		},
	}

	// ============================
	// Donut de répartition
	// ============================
	const totals = kpis.totals_30d || { IN: 0, OUT: 0, ADJUSTMENT: 0, LOSS: 0 }
	const doughLabels = ['IN', 'OUT', 'ADJ', 'LOSS']
	const doughData = {
		labels: doughLabels,
		datasets: [
			{
				data: [totals.IN, totals.OUT, totals.ADJUSTMENT, totals.LOSS],
				backgroundColor: [
					palette.in.border,
					palette.out.border,
					palette.adj.border,
					palette.loss.border,
				],
			},
		],
	}

	// ============================
	// Top produits consommés
	// ============================
	const barData = {
		labels: topProducts.map((p) => p.name),
		datasets: [
			{
				label: 'OUT (30j)',
				data: topProducts.map((p) => Number(p.qty)),
				backgroundColor: topProducts.map(
					(_, i) => categorical[i % categorical.length]
				),
			},
		],
	}

	const lossesList = losses || []
	const replen = toReplenish || []

	// FEFO data
	const atRisk = fefo?.at_risk || { products_count: 0, total_qty: 0, estimated_value: 0 }
	const savings = fefo?.savings || { plans_executed: 0, estimated_savings_eur: 0 }
	const comparison = fefo?.comparison || { change_percent: 0, trend: 'stable' }
	const topWasted = fefo?.top_wasted || []

	return (
		<Layout>
			<h1 className="text-2xl font-semibold mb-4">Dashboard</h1>

			{/* Alerte produits à risque */}
			{atRisk.products_count > 0 && (
				<div className="bg-amber-50 border border-amber-200 rounded-lg p-4 mb-6">
					<div className="flex items-center justify-between">
						<div className="flex items-center gap-3">
							<span className="text-3xl">⚠️</span>
							<div>
								<div className="font-semibold text-amber-800">
									{atRisk.products_count} produit(s) à risque
								</div>
								<div className="text-sm text-amber-600">
									{atRisk.total_qty.toFixed(2)} kg expirent dans ≤7 jours
									(valeur: {euro(atRisk.estimated_value)})
								</div>
							</div>
						</div>
						<div className="flex items-center gap-2">
							{user?.role === 'ADMIN' && (
								<button
									onClick={sendTestAlert}
									disabled={sendingAlert}
									className="px-3 py-2 bg-slate-600 text-white rounded hover:bg-slate-700 transition text-sm disabled:opacity-50"
								>
									{sendingAlert ? '📧 Envoi...' : '📧 Tester alerte'}
								</button>
							)}
							<button
								onClick={() => navigate('/ai-suggestions')}
								className="px-4 py-2 bg-amber-600 text-white rounded hover:bg-amber-700 transition"
							>
								🤖 Suggestions IA →
							</button>
						</div>
					</div>
				</div>
			)}

			{/* KPI cards - Ligne 1 */}
			<div className="grid grid-cols-1 md:grid-cols-6 gap-4 mb-6">
				<Card title="Valeur de stock" value={euro(kpis.stock_value)} />
				<Card title="Lots ≤ 7j" value={kpis.lots_expiring_7} />
				<Card title="Lots ≤ 14j" value={kpis.lots_expiring_14} />

				{/* Lots périmés */}
				<div className="bg-white rounded shadow p-4">
					<div className="text-sm text-slate-500 flex items-center justify-between">
						<span>Lots périmés</span>
						{user?.role === 'ADMIN' && kpis.lots_expired_now > 0 && (
							<button
								onClick={processExpired}
								className="text-xs px-2 py-1 rounded bg-rose-600 text-white hover:bg-rose-700"
							>
								Traiter
							</button>
						)}
					</div>
					<div className="text-2xl font-semibold">{kpis.lots_expired_now}</div>
				</div>

				<Card
					title="Taux de perte (30j)"
					value={`${(kpis.loss_rate_30d * 100).toFixed(1)} %`}
				/>

				{/* Économies FEFO */}
				<div className="bg-white rounded shadow p-4 border-l-4 border-green-500">
					<div className="text-sm text-slate-500">Économies FEFO</div>
					<div className="text-2xl font-semibold text-green-600">
						~{euro(savings.estimated_savings_eur)}
					</div>
					<div className="text-xs text-slate-400">
						{comparison.trend === 'improving' && '↓ Pertes en baisse'}
						{comparison.trend === 'worsening' && '↑ Pertes en hausse'}
						{comparison.trend === 'stable' && '→ Stable'}
						{comparison.change_percent !== 0 && ` (${comparison.change_percent > 0 ? '+' : ''}${comparison.change_percent.toFixed(1)}%)`}
					</div>
				</div>
			</div>

			{/* Plans */}
			<div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
				<Card title="Plans DRAFT" value={kpis.plans.DRAFT} />
				<Card title="Plans CONFIRMED" value={kpis.plans.CONFIRMED} />
				<Card title="Plans EXECUTED" value={kpis.plans.EXECUTED} />
			</div>

			{/* Charts ligne + donut */}
			<div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-6">
				<div className="bg-white rounded shadow p-4 lg:col-span-2">
					<div className="font-semibold mb-2">Mouvements (30j, €)</div>
					<Line data={lineData} options={optionsCurrency} />
				</div>
				<div className="bg-white rounded shadow p-4">
					<div className="font-semibold mb-2">Répartition (30j, €)</div>
					<Doughnut
						data={doughData}
						options={{ ...optionsCurrency, scales: undefined }}
					/>
				</div>
			</div>

			{/* Top produits consommés + Top gaspillés */}
			<div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
				<div className="bg-white rounded shadow p-4">
					<div className="font-semibold mb-2">Top produits consommés (30j)</div>
					<Bar data={barData} options={optionsCurrency} />
				</div>

				{/* Top produits gaspillés */}
				<div className="bg-white rounded shadow p-4">
					<div className="font-semibold mb-2">🗑️ Top produits gaspillés (30j)</div>
					{topWasted.length > 0 ? (
						<div className="space-y-2">
							{topWasted.map((product, idx) => (
								<div key={product.id} className="flex items-center gap-3 p-2 bg-slate-50 rounded">
									<div className={`w-8 h-8 rounded-full flex items-center justify-center text-white font-bold text-sm ${idx === 0 ? 'bg-red-500' : idx === 1 ? 'bg-orange-500' : 'bg-yellow-500'
										}`}>
										{idx + 1}
									</div>
									<div className="flex-1">
										<div className="font-medium text-sm">{product.name}</div>
										<div className="text-xs text-slate-500">{product.unit}</div>
									</div>
									<div className="text-right">
										<div className="font-semibold text-red-600">{product.total_loss.toFixed(2)} {product.unit}</div>
										<div className="text-xs text-slate-500">{euro(product.loss_value)}</div>
									</div>
								</div>
							))}
						</div>
					) : (
						<div className="text-center text-slate-500 py-8">
							✅ Aucune perte enregistrée
						</div>
					)}
				</div>
			</div>

			

			{/* Impact FEFO + Lots proches DLC */}
			<div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
				{/* Impact FEFO */}
				<div className=" from-green-50 to-blue-50 rounded-lg p-6 border border-green-200">
					<div className="flex items-start gap-4">
						<span className="text-4xl">🌱</span>
						<div className="flex-1">
							<h3 className="font-semibold text-lg text-green-800 mb-3">
								Impact du système FEFO
							</h3>
							<div className="grid grid-cols-3 gap-4 text-sm">
								<div>
									<div className="text-green-600 font-semibold text-xl">
										{savings.plans_executed}
									</div>
									<div className="text-slate-600">Plans exécutés</div>
								</div>
								<div>
									<div className="text-green-600 font-semibold text-xl">
										{savings.qty_consumed_fefo?.toFixed(1) || 0} kg
									</div>
									<div className="text-slate-600">Consommés en FEFO</div>
								</div>
								<div>
									<div className="text-green-600 font-semibold text-xl">
										~{euro(savings.estimated_savings_eur)}
									</div>
									<div className="text-slate-600">Économies estimées</div>
								</div>
							</div>
							<p className="text-xs text-slate-500 mt-3">
								Estimation basée sur 15% de pertes évitées grâce au système FEFO
							</p>
						</div>
					</div>
				</div>


				{/* Lots proches de DLC */}
				<div className="bg-white rounded shadow p-4">
					<div className="font-semibold mb-2">Lots proches de DLC</div>
					<table className="min-w-full text-sm">
						<thead className="bg-slate-100">
							<tr>
								<th className="text-left px-3 py-2">Produit</th>
								<th className="text-left px-3 py-2">Lot</th>
								<th className="text-left px-3 py-2">DLC</th>
								<th className="text-right px-3 py-2">Qté</th>
							</tr>
						</thead>
						<tbody>
							{expiringLots && expiringLots.length > 0 ? (
								expiringLots.map((l) => (
									<tr key={l.id} className="border-t">
										<td className="px-3 py-2">
											{l.product_name}{' '}
											<span className="text-slate-400 text-xs">({l.unit})</span>
										</td>
										<td className="px-3 py-2">{l.batch_number}</td>
										<td className="px-3 py-2">
											{String(l.expiry_date).slice(0, 10)}
										</td>
										<td className="px-3 py-2 text-right">
											{Number(l.quantity).toFixed(3)}
										</td>
									</tr>
								))
							) : (
								<tr>
									<td className="px-3 py-4 text-slate-500" colSpan={4}>
										Aucun lot proche de la DLC dans les 7–21 prochains jours.
									</td>
								</tr>
							)}
						</tbody>
					</table>
				</div>
			</div>
			{/* Réappro + Pertes */}
			<div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
				<div className="bg-white rounded shadow p-4">
					<div className="font-semibold mb-2">Produits à réapprovisionner</div>
					<table className="min-w-full text-sm">
						<thead className="bg-slate-100">
							<tr>
								<th className="text-left px-3 py-2">Produit</th>
								<th className="text-right px-3 py-2">Stock actuel</th>
								<th className="text-right px-3 py-2">Seuil alerte</th>
								<th className="text-right px-3 py-2">Manque</th>
							</tr>
						</thead>
						<tbody>
							{replen && replen.length > 0 ? (
								replen.map((r) => {
									const stock = Number(r.stock_qty ?? 0)
									const threshold = Number(r.alert_threshold ?? 0)
									const gap = Math.max(0, threshold - stock)
									return (
										<tr key={r.id} className="border-t">
											<td className="px-3 py-2">
												{r.name}{' '}
												<span className="text-slate-400 text-xs">({r.unit})</span>
											</td>
											<td className="px-3 py-2 text-right">{stock.toFixed(3)}</td>
											<td className="px-3 py-2 text-right">{threshold.toFixed(3)}</td>
											<td className="px-3 py-2 text-right text-red-600">
												{gap > 0 ? gap.toFixed(3) : '—'}
											</td>
										</tr>
									)
								})
							) : (
								<tr>
									<td className="px-3 py-4 text-slate-500" colSpan={4}>
										Aucun produit sous le seuil d'alerte en ce moment.
									</td>
								</tr>
							)}
						</tbody>
					</table>
				</div>
				<div className="bg-white rounded shadow p-4">
					<div className="font-semibold mb-2">Pertes (30j)</div>
					<table className="min-w-full text-sm">
						<thead className="bg-slate-100">
							<tr>
								<th className="text-left px-3 py-2">Date</th>
								<th className="text-left px-3 py-2">Produit</th>
								<th className="text-left px-3 py-2">Lot</th>
								<th className="text-left px-3 py-2">DLC</th>
								<th className="text-right px-3 py-2">Qté</th>
								<th className="text-right px-3 py-2">Coût</th>
								<th className="text-left px-3 py-2">Raison</th>
							</tr>
						</thead>
						<tbody>
							{lossesList.map((l) => (
								<tr key={l.id} className="border-t">
									<td className="px-3 py-2">
										{new Date(l.moved_at).toLocaleString()}
									</td>
									<td className="px-3 py-2">{l.product}</td>
									<td className="px-3 py-2">{l.batch_number}</td>
									<td className="px-3 py-2">
										{String(l.expiry_date).slice(0, 10)}
									</td>
									<td className="px-3 py-2 text-right">
										{Number(l.qty).toFixed(3)}
									</td>
									<td className="px-3 py-2 text-right">
										{euro(Number(l.cost_eur))}
									</td>
									<td className="px-3 py-2">{l.reason || '—'}</td>
								</tr>
							))}
							{!lossesList.length && (
								<tr>
									<td className="px-3 py-4 text-slate-500" colSpan={7}>
										No losses in the last 30 days.
									</td>
								</tr>
							)}
						</tbody>
					</table>
				</div>

			</div>
		</Layout>
	)
}

function Card({ title, value }) {
	return (
		<div className="bg-white rounded shadow p-4">
			<div className="text-sm text-slate-500">{title}</div>
			<div className="text-2xl font-semibold">{value}</div>
		</div>
	)
}
