"""
Mont-Vert ML Service
Flask API pour les prédictions de repas avec XGBoost
"""

from flask import Flask, request, jsonify
from flask_cors import CORS
import pandas as pd
import numpy as np
import joblib
import os
from datetime import datetime, timedelta
import json

app = Flask(__name__)
CORS(app)

# Chemins
MODEL_PATH = os.path.join(os.path.dirname(__file__), 'model', 'xgboost_model.pkl')
LABEL_ENCODER_PATH = os.path.join(os.path.dirname(__file__), 'model', 'label_encoder.pkl')
FEATURE_COLUMNS_PATH = os.path.join(os.path.dirname(__file__), 'model', 'feature_columns.json')

# Variables globales pour le modèle
model = None
label_encoder = None
feature_columns = None


def load_model():
    """Charge le modèle XGBoost et le label encoder"""
    global model, label_encoder, feature_columns
    
    if os.path.exists(MODEL_PATH):
        model = joblib.load(MODEL_PATH)
        print(f"Modèle chargé depuis {MODEL_PATH}")
    else:
        print(f"Modèle non trouvé: {MODEL_PATH}")
        model = None
    
    if os.path.exists(LABEL_ENCODER_PATH):
        label_encoder = joblib.load(LABEL_ENCODER_PATH)
        print(f"Label encoder chargé")
    else:
        label_encoder = None
    
    if os.path.exists(FEATURE_COLUMNS_PATH):
        with open(FEATURE_COLUMNS_PATH, 'r') as f:
            feature_columns = json.load(f)
        print(f"{len(feature_columns)} features chargées")
    else:
        feature_columns = None


@app.route('/health', methods=['GET'])
def health():
    """Endpoint de santé"""
    return jsonify({
        'status': 'ok',
        'model_loaded': model is not None,
        'timestamp': datetime.now().isoformat()
    })


@app.route('/predict', methods=['POST'])
def predict():
    """
    Prédit les meilleures recettes basées sur le stock actuel
    
    Input JSON:
    {
        "date": "2025-11-26",
        "planned_portions": 50,
        "stock": [
            {"product_id": 1, "available_qty": 10.5, "days_to_expiry": 3},
            ...
        ],
        "recipes": [
            {"id": 1, "name": "Pâtes carbonara"},
            ...
        ],
        "last_recipes": [5, 3]  // IDs des 2 dernières recettes servies
    }
    
    Output JSON:
    {
        "predictions": [
            {
                "recipe_id": 1,
                "recipe_name": "Pâtes carbonara",
                "probability": 0.85,
                "confidence": "high",
                "reasons": ["Utilise jambon (expire dans 2j)", "Populaire le lundi"]
            },
            ...
        ],
        "model_info": {
            "version": "1.0",
            "trained_on": "2025-11-26"
        }
    }
    """
    global model, label_encoder, feature_columns
    
    if model is None:
        return jsonify({
            'error': 'Modèle non entraîné. Veuillez d\'abord entraîner le modèle.',
            'predictions': []
        }), 400
    
    try:
        data = request.get_json()
        
        # Extraire les données
        date_str = data.get('date', datetime.now().strftime('%Y-%m-%d'))
        planned_portions = data.get('planned_portions', 50)
        stock = data.get('stock', [])
        recipes = data.get('recipes', [])
        last_recipes = data.get('last_recipes', [0, 0])
        
        # Parser la date
        date = datetime.strptime(date_str, '%Y-%m-%d')
        
        # Construire le vecteur de features
        features = {
            'day_of_week': date.weekday(),
            'month': date.month,
            'week_of_year': date.isocalendar()[1],
            'planned_portions': planned_portions,
            'last_recipe_1': last_recipes[0] if len(last_recipes) > 0 else 0,
            'last_recipe_2': last_recipes[1] if len(last_recipes) > 1 else 0,
        }
        
        # Ajouter les features de stock
        for item in stock:
            pid = item['product_id']
            features[f'stock_{pid}'] = item.get('available_qty', 0)
            features[f'days_to_expiry_{pid}'] = item.get('days_to_expiry', 30)
        
        # Créer le DataFrame avec les bonnes colonnes
        df = pd.DataFrame([features])
        
        # S'assurer que toutes les colonnes du modèle sont présentes
        for col in feature_columns:
            if col not in df.columns:
                df[col] = 0
        
        # Garder seulement les colonnes attendues dans le bon ordre
        df = df[feature_columns]
        
        # Prédiction
        probabilities = model.predict_proba(df)[0]
        
        # Mapper les classes aux recettes
        predictions = []
        recipe_map = {r['id']: r['name'] for r in recipes}
        
        for idx, prob in enumerate(probabilities):
            if prob > 0.01:  # Filtrer les très faibles probabilités
                recipe_id = label_encoder.inverse_transform([idx])[0]
                recipe_name = recipe_map.get(recipe_id, f"Recette #{recipe_id}")
                
                # Déterminer le niveau de confiance
                if prob >= 0.7:
                    confidence = 'high'
                elif prob >= 0.4:
                    confidence = 'medium'
                else:
                    confidence = 'low'
                
                # Générer les raisons
                reasons = generate_reasons(recipe_id, stock, date, recipes)
                
                predictions.append({
                    'recipe_id': int(recipe_id),
                    'recipe_name': recipe_name,
                    'probability': round(float(prob), 4),
                    'confidence': confidence,
                    'reasons': reasons
                })
        
        # Trier par probabilité décroissante
        predictions.sort(key=lambda x: x['probability'], reverse=True)
        
        # Garder le top 5
        predictions = predictions[:5]
        
        return jsonify({
            'predictions': predictions,
            'model_info': {
                'version': '1.0',
                'features_count': len(feature_columns),
                'date_predicted': date_str
            }
        })
        
    except Exception as e:
        return jsonify({
            'error': str(e),
            'predictions': []
        }), 500


def generate_reasons(recipe_id, stock, date, recipes):
    """Génère des explications pour la recommandation"""
    reasons = []
    
    # Jour de la semaine
    days = ['lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi', 'dimanche']
    day_name = days[date.weekday()]
    reasons.append(f"Adapté pour un {day_name}")
    
    # Produits urgents
    urgent_products = [s for s in stock if s.get('days_to_expiry', 30) <= 3]
    if urgent_products:
        product_names = [f"produit #{p['product_id']}" for p in urgent_products[:2]]
        reasons.append(f"Utilise des produits urgents")
    
    return reasons


@app.route('/train', methods=['POST'])
def train():
    """
    Entraîne le modèle XGBoost avec les données fournies
    
    Input JSON:
    {
        "training_data": [
            {
                "date": "2025-11-20",
                "recipe_id": 1,
                "planned_portions": 50,
                "stock": [...],
                "last_recipes": [5, 3]
            },
            ...
        ]
    }
    """
    global model, label_encoder, feature_columns
    
    try:
        data = request.get_json()
        training_data = data.get('training_data', [])
        
        if len(training_data) < 10:
            return jsonify({
                'error': f'Pas assez de données pour entraîner (minimum 10, reçu {len(training_data)})',
                'success': False
            }), 400
        
        # Préparer les données
        rows = []
        for record in training_data:
            date = datetime.strptime(record['date'], '%Y-%m-%d')
            
            row = {
                'day_of_week': date.weekday(),
                'month': date.month,
                'week_of_year': date.isocalendar()[1],
                'planned_portions': record.get('planned_portions', 50),
                'last_recipe_1': record.get('last_recipes', [0, 0])[0] if record.get('last_recipes') else 0,
                'last_recipe_2': record.get('last_recipes', [0, 0])[1] if len(record.get('last_recipes', [])) > 1 else 0,
                'recipe_id': record['recipe_id']
            }
            
            # Ajouter les features de stock
            for item in record.get('stock', []):
                pid = item['product_id']
                row[f'stock_{pid}'] = item.get('available_qty', 0)
                row[f'days_to_expiry_{pid}'] = item.get('days_to_expiry', 30)
            
            rows.append(row)
        
        df = pd.DataFrame(rows)
        
        # Remplir les NaN avec 0
        df = df.fillna(0)
        
        # Séparer features et target
        target = df['recipe_id']
        features_df = df.drop('recipe_id', axis=1)
        
        # Encoder les labels
        from sklearn.preprocessing import LabelEncoder
        label_encoder = LabelEncoder()
        y = label_encoder.fit_transform(target)
        
        # Sauvegarder les colonnes de features
        feature_columns = list(features_df.columns)
        
        # Entraîner XGBoost
        from xgboost import XGBClassifier
        
        model = XGBClassifier(
            n_estimators=100,
            max_depth=6,
            learning_rate=0.1,
            objective='multi:softprob',
            random_state=42,
            use_label_encoder=False,
            eval_metric='mlogloss'
        )
        
        model.fit(features_df, y)
        
        # Sauvegarder le modèle
        joblib.dump(model, MODEL_PATH)
        joblib.dump(label_encoder, LABEL_ENCODER_PATH)
        
        with open(FEATURE_COLUMNS_PATH, 'w') as f:
            json.dump(feature_columns, f)
        
        # Calculer les métriques
        from sklearn.model_selection import cross_val_score
        accuracy = model.score(features_df, y)
        
        return jsonify({
            'success': True,
            'message': 'Modèle entraîné avec succès',
            'metrics': {
                'samples': len(training_data),
                'features': len(feature_columns),
                'classes': len(label_encoder.classes_),
                'accuracy': round(accuracy, 4)
            },
            'model_path': MODEL_PATH
        })
        
    except Exception as e:
        import traceback
        return jsonify({
            'error': str(e),
            'traceback': traceback.format_exc(),
            'success': False
        }), 500


@app.route('/model-info', methods=['GET'])
def model_info():
    """Retourne les informations sur le modèle actuel"""
    global model, label_encoder, feature_columns
    
    if model is None:
        return jsonify({
            'trained': False,
            'message': 'Aucun modèle entraîné'
        })
    
    return jsonify({
        'trained': True,
        'features_count': len(feature_columns) if feature_columns else 0,
        'classes_count': len(label_encoder.classes_) if label_encoder else 0,
        'feature_names': feature_columns[:20] if feature_columns else [],  # Top 20
        'model_type': 'XGBClassifier'
    })


@app.route('/feature-importance', methods=['GET'])
def feature_importance():
    """Retourne l'importance des features"""
    global model, feature_columns
    
    if model is None:
        return jsonify({'error': 'Modèle non entraîné'}), 400
    
    importance = model.feature_importances_
    
    # Créer un dictionnaire feature -> importance
    importance_dict = []
    for idx, col in enumerate(feature_columns):
        importance_dict.append({
            'feature': col,
            'importance': round(float(importance[idx]), 4)
        })
    
    # Trier par importance décroissante
    importance_dict.sort(key=lambda x: x['importance'], reverse=True)
    
    return jsonify({
        'feature_importance': importance_dict[:15]  # Top 15
    })


if __name__ == '__main__':
    load_model()
    print("🚀 Mont-Vert ML Service démarré sur http://localhost:5001")
    app.run(host='0.0.0.0', port=5001, debug=True)
