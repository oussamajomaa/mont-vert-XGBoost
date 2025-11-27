import { useState, useEffect } from 'react';
import Layout from '../components/Layout';
import api from '../api/axios';
import toast from 'react-hot-toast';

export default function MlPredictions() {
    const [predictions, setPredictions] = useState([]);
    const [loading, setLoading] = useState(false);
    const [training, setTraining] = useState(false);
    const [mlHealth, setMlHealth] = useState(null);
    const [modelInfo, setModelInfo] = useState(null);
    const [featureImportance, setFeatureImportance] = useState([]);
    const [trainingData, setTrainingData] = useState(null);
    
    // Paramètres de prédiction
    const [date, setDate] = useState(new Date().toISOString().split('T')[0]);
    const [portions, setPortions] = useState(50);
    
    // Vérifier la santé du service ML au chargement
    useEffect(() => {
        checkHealth();
        loadModelInfo();
    }, []);

    const checkHealth = async () => {
        try {
            const res = await api.get('/ml/health');
            setMlHealth(res.data);
        } catch (err) {
            setMlHealth({ status: 'error', message: 'Service ML non disponible' });
        }
    };

    const loadModelInfo = async () => {
        try {
            const res = await api.get('/ml/model-info');
            setModelInfo(res.data);
            
            if (res.data.trained) {
                const featRes = await api.get('/ml/feature-importance');
                setFeatureImportance(featRes.data.feature_importance || []);
            }
        } catch (err) {
            console.error('Erreur chargement model info:', err);
        }
    };

    const loadTrainingData = async () => {
        try {
            const res = await api.get('/ml/training-data');
            setTrainingData(res.data);
        } catch (err) {
            toast.error('Erreur chargement données');
        }
    };

    const handleTrain = async () => {
        setTraining(true);
        try {
            const res = await api.post('/ml/train');
            toast.success(`Modèle entraîné ! Accuracy: ${(res.data.metrics.accuracy * 100).toFixed(1)}%`);
            await loadModelInfo();
        } catch (err) {
            toast.error(err.response?.data?.error || 'Erreur entraînement');
        } finally {
            setTraining(false);
        }
    };

    const handlePredict = async () => {
        setLoading(true);
        try {
            const res = await api.post('/ml/predict', { date, planned_portions: portions });
            setPredictions(res.data.predictions || []);
            if (res.data.predictions?.length === 0) {
                toast('Aucune prédiction disponible. Entraînez d\'abord le modèle.', { icon: '⚠️' });
            }
        } catch (err) {
            toast.error(err.response?.data?.error || 'Erreur prédiction');
        } finally {
            setLoading(false);
        }
    };

    const getConfidenceColor = (confidence) => {
        switch (confidence) {
            case 'high': return 'bg-green-100 text-green-800 border-green-300';
            case 'medium': return 'bg-yellow-100 text-yellow-800 border-yellow-300';
            case 'low': return 'bg-red-100 text-red-800 border-red-300';
            default: return 'bg-gray-100 text-gray-800';
        }
    };

    const getConfidenceLabel = (confidence) => {
        switch (confidence) {
            case 'high': return 'Haute confiance';
            case 'medium': return 'Confiance moyenne';
            case 'low': return 'Faible confiance';
            default: return confidence;
        }
    };

    return (
        <Layout>
        <div className="space-y-6">
            {/* Header */}
            <div className="flex justify-between items-center">
                <div>
                    <h1 className="text-2xl font-bold text-gray-900">🤖 Prédictions IA (XGBoost)</h1>
                    <p className="text-gray-600 mt-1">
                        Machine Learning pour prédire les meilleurs plats selon le stock
                    </p>
                </div>
            </div>

            {/* Statut du service ML */}
            <div className={`p-4 rounded-lg border ${mlHealth?.status === 'ok' ? 'bg-green-50 border-green-200' : 'bg-red-50 border-red-200'}`}>
                <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                        <span className={`w-3 h-3 rounded-full ${mlHealth?.status === 'ok' ? 'bg-green-500' : 'bg-red-500'} animate-pulse`}></span>
                        <div>
                            <p className="font-medium">
                                Service ML Python : {mlHealth?.status === 'ok' ? 'Connecté' : 'Non disponible'}
                            </p>
                            {mlHealth?.status !== 'ok' && (
                                <p className="text-sm text-red-600">{mlHealth?.message}</p>
                            )}
                        </div>
                    </div>
                    <button
                        onClick={checkHealth}
                        className="px-3 py-1 text-sm border rounded hover:bg-white"
                    >
                        🔄 Vérifier
                    </button>
                </div>
            </div>

            {/* Section Modèle */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {/* Infos modèle */}
                <div className="bg-white rounded-lg border p-6">
                    <h2 className="text-lg font-semibold mb-4">📊 État du modèle</h2>
                    
                    {modelInfo?.trained ? (
                        <div className="space-y-3">
                            <div className="flex justify-between">
                                <span className="text-gray-600">Statut</span>
                                <span className="px-2 py-1 bg-green-100 text-green-800 rounded text-sm">Entraîné ✓</span>
                            </div>
                            <div className="flex justify-between">
                                <span className="text-gray-600">Features</span>
                                <span className="font-mono">{modelInfo.features_count}</span>
                            </div>
                            <div className="flex justify-between">
                                <span className="text-gray-600">Classes (recettes)</span>
                                <span className="font-mono">{modelInfo.classes_count}</span>
                            </div>
                            <div className="flex justify-between">
                                <span className="text-gray-600">Type</span>
                                <span className="font-mono text-sm">{modelInfo.model_type}</span>
                            </div>
                        </div>
                    ) : (
                        <div className="text-center py-6">
                            <p className="text-gray-500 mb-4">Aucun modèle entraîné</p>
                            <button
                                onClick={loadTrainingData}
                                className="text-blue-600 hover:underline text-sm"
                            >
                                Voir les données disponibles
                            </button>
                        </div>
                    )}

                    <div className="mt-6 pt-4 border-t">
                        <button
                            onClick={handleTrain}
                            disabled={training || mlHealth?.status !== 'ok'}
                            className="w-full py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                        >
                            {training ? (
                                <>
                                    <span className="animate-spin">⏳</span>
                                    Entraînement en cours...
                                </>
                            ) : (
                                <>🎯 Entraîner le modèle</>
                            )}
                        </button>
                    </div>
                </div>

                {/* Feature importance */}
                <div className="bg-white rounded-lg border p-6">
                    <h2 className="text-lg font-semibold mb-4">📈 Importance des features</h2>
                    
                    {featureImportance.length > 0 ? (
                        <div className="space-y-2">
                            {featureImportance.slice(0, 8).map((feat, idx) => (
                                <div key={idx} className="flex items-center gap-2">
                                    <span className="text-xs text-gray-500 w-6">{idx + 1}.</span>
                                    <div className="flex-1">
                                        <div className="flex justify-between text-sm mb-1">
                                            <span className="truncate">{feat.feature}</span>
                                            <span className="text-gray-600">{(feat.importance * 100).toFixed(1)}%</span>
                                        </div>
                                        <div className="h-2 bg-gray-200 rounded-full overflow-hidden">
                                            <div 
                                                className="h-full bg-blue-500 rounded-full"
                                                style={{ width: `${feat.importance * 100}%` }}
                                            />
                                        </div>
                                    </div>
                                </div>
                            ))}
                        </div>
                    ) : (
                        <p className="text-gray-500 text-center py-8">
                            Entraînez le modèle pour voir l'importance des features
                        </p>
                    )}
                </div>
            </div>

            {/* Données d'entraînement */}
            {trainingData && (
                <div className="bg-white rounded-lg border p-6">
                    <h2 className="text-lg font-semibold mb-4">📦 Données d'entraînement</h2>
                    <div className={`p-3 rounded-lg mb-4 ${trainingData.count >= 50 ? 'bg-green-50' : 'bg-yellow-50'}`}>
                        <p>{trainingData.message}</p>
                    </div>
                    {trainingData.data.length > 0 && (
                        <div className="overflow-x-auto">
                            <table className="min-w-full text-sm">
                                <thead className="bg-gray-50">
                                    <tr>
                                        <th className="px-3 py-2 text-left">Date</th>
                                        <th className="px-3 py-2 text-left">Recipe ID</th>
                                        <th className="px-3 py-2 text-left">Portions</th>
                                        <th className="px-3 py-2 text-left">Produits en stock</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {trainingData.data.map((row, idx) => (
                                        <tr key={idx} className="border-t">
                                            <td className="px-3 py-2">{row.date}</td>
                                            <td className="px-3 py-2">{row.recipe_id}</td>
                                            <td className="px-3 py-2">{row.planned_portions}</td>
                                            <td className="px-3 py-2">{row.stock?.length || 0} produits</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    )}
                </div>
            )}

            {/* Section Prédictions */}
            <div className="bg-white rounded-lg border p-6">
                <h2 className="text-lg font-semibold mb-4">🔮 Obtenir des prédictions</h2>
                
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">
                            Date du repas
                        </label>
                        <input
                            type="date"
                            value={date}
                            onChange={(e) => setDate(e.target.value)}
                            className="w-full border rounded-lg px-3 py-2"
                        />
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">
                            Nombre de portions
                        </label>
                        <input
                            type="number"
                            value={portions}
                            onChange={(e) => setPortions(parseInt(e.target.value) || 50)}
                            min="1"
                            max="500"
                            className="w-full border rounded-lg px-3 py-2"
                        />
                    </div>
                    <div className="flex items-end">
                        <button
                            onClick={handlePredict}
                            disabled={loading || !modelInfo?.trained || mlHealth?.status !== 'ok'}
                            className="w-full py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                        >
                            {loading ? (
                                <>
                                    <span className="animate-spin">⏳</span>
                                    Analyse...
                                </>
                            ) : (
                                <>🔮 Prédire</>
                            )}
                        </button>
                    </div>
                </div>

                {!modelInfo?.trained && (
                    <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4 text-center">
                        <p className="text-yellow-800">
                            ⚠️ Veuillez d'abord entraîner le modèle pour obtenir des prédictions
                        </p>
                    </div>
                )}
            </div>

            {/* Résultats des prédictions */}
            {predictions.length > 0 && (
                <div className="space-y-4">
                    <h2 className="text-lg font-semibold">🎯 Recettes recommandées par l'IA</h2>
                    
                    {predictions.map((pred, idx) => (
                        <div 
                            key={pred.recipe_id}
                            className={`bg-white rounded-lg border-2 p-6 ${idx === 0 ? 'border-green-400 shadow-lg' : 'border-gray-200'}`}
                        >
                            <div className="flex items-start justify-between">
                                <div className="flex items-start gap-4">
                                    <div className={`w-12 h-12 rounded-full flex items-center justify-center text-xl font-bold ${idx === 0 ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-600'}`}>
                                        #{idx + 1}
                                    </div>
                                    <div>
                                        <h3 className="text-xl font-semibold">{pred.recipe_name}</h3>
                                        <div className="flex items-center gap-3 mt-2">
                                            <span className={`px-3 py-1 rounded-full text-sm border ${getConfidenceColor(pred.confidence)}`}>
                                                {getConfidenceLabel(pred.confidence)}
                                            </span>
                                            <span className="text-gray-600">
                                                Probabilité : <strong>{(pred.probability * 100).toFixed(1)}%</strong>
                                            </span>
                                        </div>
                                    </div>
                                </div>
                                
                                {idx === 0 && (
                                    <span className="px-3 py-1 bg-green-500 text-white rounded-full text-sm">
                                        🏆 Meilleur choix
                                    </span>
                                )}
                            </div>

                            {/* Raisons */}
                            <div className="mt-4 pl-16">
                                <p className="text-sm text-gray-500 mb-2">Pourquoi cette recommandation :</p>
                                <ul className="space-y-1">
                                    {pred.reasons.map((reason, i) => (
                                        <li key={i} className="flex items-center gap-2 text-sm">
                                            <span className="text-green-500">✓</span>
                                            {reason}
                                        </li>
                                    ))}
                                </ul>
                            </div>

                            {/* Produits urgents */}
                            {pred.urgent_products?.length > 0 && (
                                <div className="mt-4 pl-16">
                                    <p className="text-sm text-gray-500 mb-2">Produits urgents utilisés :</p>
                                    <div className="flex flex-wrap gap-2">
                                        {pred.urgent_products.map((p, i) => (
                                            <span 
                                                key={i}
                                                className="px-2 py-1 bg-orange-100 text-orange-800 rounded text-sm"
                                            >
                                                {p.product_name} ({p.days_to_expiry}j)
                                            </span>
                                        ))}
                                    </div>
                                </div>
                            )}
                        </div>
                    ))}
                </div>
            )}

            {/* Explication de l'algorithme */}
            <div className="bg-gradient-to-r from-purple-50 to-blue-50 rounded-lg border p-6">
                <h2 className="text-lg font-semibold mb-4">💡 Comment fonctionne l'IA ?</h2>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                    <div className="text-center">
                        <div className="text-3xl mb-2">📊</div>
                        <h3 className="font-medium">1. Collecte</h3>
                        <p className="text-sm text-gray-600">
                            Analyse de l'historique des repas, du stock et des dates de péremption
                        </p>
                    </div>
                    <div className="text-center">
                        <div className="text-3xl mb-2">🧠</div>
                        <h3 className="font-medium">2. Apprentissage</h3>
                        <p className="text-sm text-gray-600">
                            XGBoost apprend les patterns : quels plats selon le stock et le jour
                        </p>
                    </div>
                    <div className="text-center">
                        <div className="text-3xl mb-2">🎯</div>
                        <h3 className="font-medium">3. Prédiction</h3>
                        <p className="text-sm text-gray-600">
                            Le modèle prédit les meilleures recettes pour optimiser le stock FEFO
                        </p>
                    </div>
                </div>
            </div>
        </div>
        </Layout>
    );
}