"""
Mont-Vert ML Service - Flask API pour XGBoost
Version avec 11 features (6 temporelles + 5 stock)
"""

from flask import Flask, request, jsonify
from flask_cors import CORS
import pandas as pd
import xgboost as xgb
import numpy as np
import pickle
import os
from datetime import datetime

app = Flask(__name__)
CORS(app)

# Chemins - Sauvegarde dans le dossier model/
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
MODEL_DIR = os.path.join(BASE_DIR, 'model')
MODEL_PATH = os.path.join(MODEL_DIR, 'recipe_model.pkl')

# Créer le dossier model/ s'il n'existe pas
os.makedirs(MODEL_DIR, exist_ok=True)

# Variables globales
model = None
feature_names = None
label_encoder = None

# ═══════════════════════════════════════════════════════════════════════════
# CHARGEMENT / SAUVEGARDE DU MODÈLE
# ═══════════════════════════════════════════════════════════════════════════

def load_model():
    """Charge le modèle depuis le disque"""
    global model, feature_names, label_encoder
    if os.path.exists(MODEL_PATH):
        with open(MODEL_PATH, 'rb') as f:
            saved_data = pickle.load(f)
            model = saved_data['model']
            feature_names = saved_data['feature_names']
            label_encoder = saved_data.get('label_encoder')  # Peut être None pour anciens modèles
        print(f" Modèle chargé : {len(feature_names)} features, {len(label_encoder.classes_) if label_encoder else 0} classes")
        return True
    return False

def save_model(trained_model, features, encoder):
    """Sauvegarde le modèle sur le disque"""
    global model, feature_names, label_encoder
    model = trained_model
    feature_names = features
    label_encoder = encoder
    
    with open(MODEL_PATH, 'wb') as f:
        pickle.dump({
            'model': model,
            'feature_names': feature_names,
            'label_encoder': label_encoder
        }, f)
    print(f" Modèle sauvegardé : {len(feature_names)} features, {len(label_encoder.classes_)} classes")
    print(f"    Chemin : {MODEL_PATH}")

# ═══════════════════════════════════════════════════════════════════════════
# ENTRAÎNEMENT
# ═══════════════════════════════════════════════════════════════════════════

@app.route('/train', methods=['POST'])
def train():
    """
    Entraîne le modèle XGBoost
    
    Body JSON :
    {
        "training_data": [
            {
                "date": "2020-01-06",
                "recipe_id": 15,
                "day_of_week": 0,
                "month": 1,
                "week_of_year": 1,
                "planned_portions": 12,
                "last_recipe_1": 22,
                "last_recipe_2": 8,
                "recipe_feasible": 1,
                "availability_score": 1.0,
                "min_days_to_expiry": 5,
                "nb_missing_ingredients": 0,
                "urgency_score": 0.83
            },
            ...
        ]
    }
    """
    try:
        data = request.json
        training_data = data.get('training_data', [])
        
        if not training_data:
            return jsonify({
                'success': False,
                'error': 'Aucune donnée d\'entraînement fournie'
            }), 400
        
        print(f"\n Entraînement avec {len(training_data)} exemples...")
        
        # Conversion en DataFrame
        df = pd.DataFrame(training_data)
        
        # Colonnes des features (11 au total)
        feature_columns = [
            'day_of_week',
            'month', 
            'week_of_year',
            'planned_portions',
            'last_recipe_1',
            'last_recipe_2',
            'recipe_feasible',
            'availability_score',
            'min_days_to_expiry',
            'nb_missing_ingredients',
            'urgency_score'
        ]
        
        # Vérifier que toutes les colonnes existent
        missing_cols = [col for col in feature_columns if col not in df.columns]
        if missing_cols:
            return jsonify({
                'success': False,
                'error': f'Colonnes manquantes : {missing_cols}'
            }), 400
        
        # Préparer X (features) et y (target)
        X = df[feature_columns].fillna(0)
        y_raw = df['recipe_id']
        
        print(f"    Matrice X : {X.shape}")
        print(f"    Features : {list(X.columns)}")
        print(f"    Classes uniques : {y_raw.nunique()}")
        print(f"    Recipe IDs : {sorted(y_raw.unique())}")
        
        # Encoder les labels (recipe_id → 0-indexed)
        from sklearn.preprocessing import LabelEncoder
        label_encoder = LabelEncoder()
        y = label_encoder.fit_transform(y_raw)
        
        print(f"    Encodage : {list(y_raw.unique())[:5]} → {list(set(y))[:5]}")
        
        # Entraîner XGBoost
        print("    Entraînement XGBoost...")
        
        xgb_model = xgb.XGBClassifier(
            n_estimators=100,
            max_depth=6,
            learning_rate=0.1,
            random_state=42,
            objective='multi:softprob',
            eval_metric='mlogloss'
        )
        
        xgb_model.fit(X, y)
        
        # Sauvegarder
        save_model(xgb_model, feature_columns, label_encoder)
        
        # Calculer l'accuracy
        train_accuracy = xgb_model.score(X, y) * 100
        
        # Feature importance
        importance = xgb_model.feature_importances_
        feature_importance = {
            feature_columns[i]: float(importance[i]) 
            for i in range(len(feature_columns))
        }
        
        # Trier par importance
        sorted_importance = sorted(
            feature_importance.items(), 
            key=lambda x: x[1], 
            reverse=True
        )
        
        print(f"\n Entraînement terminé !")
        print(f"   Accuracy : {train_accuracy:.1f}%")
        print(f"\n Feature Importance :")
        for feat, imp in sorted_importance:
            print(f"   {feat:25s} : {imp*100:5.1f}%")
        
        return jsonify({
            'success': True,
            'metrics': {
                'accuracy': round(train_accuracy, 2),
                'num_samples': len(training_data),
                'num_features': len(feature_columns),
                'num_classes': int(y_raw.nunique())
            },
            'feature_importance': {k: round(v * 100, 2) for k, v in sorted_importance}
        })
        
    except Exception as e:
        print(f" Erreur d'entraînement : {str(e)}")
        import traceback
        traceback.print_exc()
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500

# ═══════════════════════════════════════════════════════════════════════════
# PRÉDICTION
# ═══════════════════════════════════════════════════════════════════════════

@app.route('/predict', methods=['POST'])
def predict():
    """
    Génère des prédictions
    
    Body JSON :
    {
        "context": {
            "date": "2025-01-15",
            "day_of_week": 1,
            "month": 1,
            "week_of_year": 3,
            "planned_portions": 50,
            "last_recipe_1": 22,
            "last_recipe_2": 8,
            "recipe_feasible": 1,
            "availability_score": 1.0,
            "min_days_to_expiry": 30,
            "nb_missing_ingredients": 0,
            "urgency_score": 0.5
        },
        "num_predictions": 5
    }
    """
    global model, feature_names
    
    if model is None:
        if not load_model():
            return jsonify({
                'success': False,
                'error': 'Modèle non entraîné'
            }), 400
    
    try:
        data = request.json
        context = data.get('context', {})
        num_predictions = data.get('num_predictions', 5)
        
        # Créer le DataFrame avec les features
        X = pd.DataFrame([{
            'day_of_week': context.get('day_of_week', 0),
            'month': context.get('month', 1),
            'week_of_year': context.get('week_of_year', 1),
            'planned_portions': context.get('planned_portions', 50),
            'last_recipe_1': context.get('last_recipe_1', 0),
            'last_recipe_2': context.get('last_recipe_2', 0),
            'recipe_feasible': context.get('recipe_feasible', 1),
            'availability_score': context.get('availability_score', 1.0),
            'min_days_to_expiry': context.get('min_days_to_expiry', 30),
            'nb_missing_ingredients': context.get('nb_missing_ingredients', 0),
            'urgency_score': context.get('urgency_score', 0.5)
        }])
        
        # S'assurer que les colonnes sont dans le bon ordre
        X = X[feature_names]
        
        # Prédiction des probabilités
        probas = model.predict_proba(X)[0]
        
        # Décoder les classes (indices → recipe_id)
        if label_encoder:
            classes = label_encoder.inverse_transform(model.classes_)
        else:
            classes = model.classes_
        
        # Trier par probabilité décroissante
        top_indices = np.argsort(probas)[::-1][:num_predictions]
        
        predictions = []
        for idx in top_indices:
            prob = float(probas[idx])
            
            # Déterminer le niveau de confiance
            if prob >= 0.7:
                confidence = 'high'
            elif prob >= 0.4:
                confidence = 'medium'
            else:
                confidence = 'low'
            
            # Générer des raisons simples (seront remplacées côté Node.js)
            reasons = []
            
            # Jour de la semaine
            days = ['lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi', 'dimanche']
            day_of_week = context.get('day_of_week', 0)
            if 0 <= day_of_week <= 6:
                reasons.append(f"Adapté pour un {days[day_of_week]}")
            
            # Note : Les raisons détaillées seront générées côté Node.js
            # après enrichissement avec les vraies features de stock
            
            predictions.append({
                'recipe_id': int(classes[idx]),
                'probability': prob,
                'confidence': confidence,
                'reasons': reasons
            })
        
        return jsonify({
            'success': True,
            'predictions': predictions
        })
        
    except Exception as e:
        print(f" Erreur de prédiction : {str(e)}")
        import traceback
        traceback.print_exc()
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500

# ═══════════════════════════════════════════════════════════════════════════
# ENDPOINTS UTILITAIRES
# ═══════════════════════════════════════════════════════════════════════════

@app.route('/health', methods=['GET'])
def health():
    """Vérifie la santé du service"""
    return jsonify({
        'status': 'healthy',
        'service': 'ml-service',
        'timestamp': datetime.now().isoformat()
    })

@app.route('/status', methods=['GET'])
def status():
    """Retourne le statut du modèle"""
    global model, feature_names, label_encoder
    
    if model is None:
        load_model()
    
    num_classes = 0
    if model is not None:
        if label_encoder:
            num_classes = len(label_encoder.classes_)
        else:
            num_classes = len(model.classes_)
    
    return jsonify({
        'model_loaded': model is not None,
        'num_features': len(feature_names) if feature_names else 0,
        'features': feature_names if feature_names else [],
        'num_classes': num_classes
    })

@app.route('/model-info', methods=['GET'])
def model_info():
    """Informations détaillées sur le modèle"""
    global model, feature_names, label_encoder
    
    if model is None:
        if not load_model():
            return jsonify({
                'trained': False,  #  Retourner 'trained' pour React
                'available': False,
                'error': 'Modèle non entraîné'
            })
    
    try:
        importance = model.feature_importances_
        feature_importance = {
            feature_names[i]: float(importance[i])  #  Valeur brute (0-1)
            for i in range(len(feature_names))
        }
        
        # Obtenir les recipe_id réels
        if label_encoder:
            classes = label_encoder.inverse_transform(model.classes_)
        else:
            classes = model.classes_
        
        return jsonify({
            'trained': True,  #  Ajouter 'trained' pour React
            'available': True,
            'num_features': len(feature_names),
            'features': feature_names,
            'num_classes': len(classes),
            'classes': [int(c) for c in classes],
            'feature_importance': feature_importance,
            'model_type': 'XGBClassifier',
            # Alias pour compatibilité React
            'features_count': len(feature_names),
            'classes_count': len(classes)
        })
        
    except Exception as e:
        return jsonify({
            'trained': False,
            'available': False,
            'error': str(e)
        })

@app.route('/feature-importance', methods=['GET'])
def feature_importance_endpoint():
    """Retourne l'importance des features"""
    global model, feature_names
    
    if model is None:
        if not load_model():
            return jsonify({
                'available': False,
                'error': 'Modèle non entraîné'
            })
    
    try:
        importance = model.feature_importances_
        feature_importance = [
            {
                'feature': feature_names[i],
                'importance': float(importance[i])  #  Valeur brute (0-1), React fera *100
            }
            for i in range(len(feature_names))
        ]
        
        # Trier par importance
        feature_importance.sort(key=lambda x: x['importance'], reverse=True)
        
        return jsonify({
            'available': True,
            'feature_importance': feature_importance  #  Nom correct pour React
        })
        
    except Exception as e:
        return jsonify({
            'available': False,
            'error': str(e)
        })

# ═══════════════════════════════════════════════════════════════════════════
# DÉMARRAGE
# ═══════════════════════════════════════════════════════════════════════════

if __name__ == '__main__':
    print(" Démarrage du service ML Mont-Vert")
    print("   Features attendues : 11 (6 temporelles + 5 stock)")
    print(f"    Modèle sauvegardé dans : {MODEL_PATH}")
    
    # Charger le modèle existant s'il existe
    if load_model():
        print(f"    Modèle existant chargé")
    else:
        print(f"   ⚠️ Aucun modèle existant - en attente d'entraînement")
    
    print("\n🌐 Service disponible sur http://localhost:5001")
    print("   - POST /train              : Entraîner le modèle")
    print("   - POST /predict            : Obtenir des prédictions")
    print("   - GET  /health             : Vérifier la santé")
    print("   - GET  /status             : Statut du modèle")
    print("   - GET  /model-info         : Infos détaillées")
    print("   - GET  /feature-importance : Importance des features\n")
    
    app.run(host='0.0.0.0', port=5001, debug=True)