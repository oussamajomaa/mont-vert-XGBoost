# """
# Mont-Vert ML Service - Flask API pour XGBoost
# Version avec 11 features (6 temporelles + 5 stock)
# """

# from flask import Flask, request, jsonify
# from flask_cors import CORS
# import pandas as pd
# import xgboost as xgb
# import numpy as np
# import pickle
# import os
# from datetime import datetime

# app = Flask(__name__)
# CORS(app)

# # Chemins - Sauvegarde dans le dossier model/
# BASE_DIR = os.path.dirname(os.path.abspath(__file__))
# MODEL_DIR = os.path.join(BASE_DIR, 'model')
# MODEL_PATH = os.path.join(MODEL_DIR, 'recipe_model.pkl')

# # Créer le dossier model/ s'il n'existe pas
# os.makedirs(MODEL_DIR, exist_ok=True)

# # Variables globales
# model = None
# feature_names = None
# label_encoder = None

# # ═══════════════════════════════════════════════════════════════════════════
# # CHARGEMENT / SAUVEGARDE DU MODÈLE
# # ═══════════════════════════════════════════════════════════════════════════

# def load_model():
#     """Charge le modèle depuis le disque"""
#     global model, feature_names, label_encoder
#     if os.path.exists(MODEL_PATH):
#         with open(MODEL_PATH, 'rb') as f:
#             saved_data = pickle.load(f)
#             model = saved_data['model']
#             feature_names = saved_data['feature_names']
#             label_encoder = saved_data.get('label_encoder')  # Peut être None pour anciens modèles
#         print(f" Modèle chargé : {len(feature_names)} features, {len(label_encoder.classes_) if label_encoder else 0} classes")
#         return True
#     return False

# def save_model(trained_model, features, encoder):
#     """Sauvegarde le modèle sur le disque"""
#     global model, feature_names, label_encoder
#     model = trained_model
#     feature_names = features
#     label_encoder = encoder
    
#     with open(MODEL_PATH, 'wb') as f:
#         pickle.dump({
#             'model': model,
#             'feature_names': feature_names,
#             'label_encoder': label_encoder
#         }, f)
#     print(f" Modèle sauvegardé : {len(feature_names)} features, {len(label_encoder.classes_)} classes")
#     print(f"    Chemin : {MODEL_PATH}")

# # ═══════════════════════════════════════════════════════════════════════════
# # ENTRAÎNEMENT
# # ═══════════════════════════════════════════════════════════════════════════

# @app.route('/train', methods=['POST'])
# def train():
#     """
#     Entraîne le modèle XGBoost
    
#     Body JSON :
#     {
#         "training_data": [
#             {
#                 "date": "2020-01-06",
#                 "recipe_id": 15,
#                 "day_of_week": 0,
#                 "month": 1,
#                 "week_of_year": 1,
#                 "planned_portions": 12,
#                 "last_recipe_1": 22,
#                 "last_recipe_2": 8,
#                 "recipe_feasible": 1,
#                 "availability_score": 1.0,
#                 "min_days_to_expiry": 5,
#                 "nb_missing_ingredients": 0,
#                 "urgency_score": 0.83
#             },
#             ...
#         ]
#     }
#     """
#     try:
#         data = request.json
#         training_data = data.get('training_data', [])
        
#         if not training_data:
#             return jsonify({
#                 'success': False,
#                 'error': 'Aucune donnée d\'entraînement fournie'
#             }), 400
        
#         print(f"\n Entraînement avec {len(training_data)} exemples...")
        
#         # Conversion en DataFrame
#         df = pd.DataFrame(training_data)
        
#         # Colonnes des features (11 au total)
#         feature_columns = [
#             'day_of_week',
#             'month', 
#             'week_of_year',
#             'planned_portions',
#             'last_recipe_1',
#             'last_recipe_2',
#             'recipe_feasible',
#             'availability_score',
#             'min_days_to_expiry',
#             'nb_missing_ingredients',
#             'urgency_score'
#         ]
        
#         # Vérifier que toutes les colonnes existent
#         missing_cols = [col for col in feature_columns if col not in df.columns]
#         if missing_cols:
#             return jsonify({
#                 'success': False,
#                 'error': f'Colonnes manquantes : {missing_cols}'
#             }), 400
        
#         # Préparer X (features) et y (target)
#         X = df[feature_columns].fillna(0)
#         y_raw = df['recipe_id']
        
#         print(f"    Matrice X : {X.shape}")
#         print(f"    Features : {list(X.columns)}")
#         print(f"    Classes uniques : {y_raw.nunique()}")
#         print(f"    Recipe IDs : {sorted(y_raw.unique())}")
        
#         # Encoder les labels (recipe_id → 0-indexed)
#         from sklearn.preprocessing import LabelEncoder
#         label_encoder = LabelEncoder()
#         y = label_encoder.fit_transform(y_raw)
        
#         print(f"    Encodage : {list(y_raw.unique())[:5]} → {list(set(y))[:5]}")
        
#         # Entraîner XGBoost
#         print("    Entraînement XGBoost...")
        
#         xgb_model = xgb.XGBClassifier(
#             n_estimators=100,
#             max_depth=6,
#             learning_rate=0.1,
#             random_state=42,
#             objective='multi:softprob',
#             eval_metric='mlogloss'
#         )
        
#         xgb_model.fit(X, y)
        
#         # Sauvegarder
#         save_model(xgb_model, feature_columns, label_encoder)
        
#         # Calculer l'accuracy
#         train_accuracy = xgb_model.score(X, y) * 100
        
#         # Feature importance
#         importance = xgb_model.feature_importances_
#         feature_importance = {
#             feature_columns[i]: float(importance[i]) 
#             for i in range(len(feature_columns))
#         }
        
#         # Trier par importance
#         sorted_importance = sorted(
#             feature_importance.items(), 
#             key=lambda x: x[1], 
#             reverse=True
#         )
        
#         print(f"\n Entraînement terminé !")
#         print(f"   Accuracy : {train_accuracy:.1f}%")
#         print(f"\n Feature Importance :")
#         for feat, imp in sorted_importance:
#             print(f"   {feat:25s} : {imp*100:5.1f}%")
        
#         return jsonify({
#             'success': True,
#             'metrics': {
#                 'accuracy': round(train_accuracy, 2),
#                 'num_samples': len(training_data),
#                 'num_features': len(feature_columns),
#                 'num_classes': int(y_raw.nunique())
#             },
#             'feature_importance': {k: round(v * 100, 2) for k, v in sorted_importance}
#         })
        
#     except Exception as e:
#         print(f" Erreur d'entraînement : {str(e)}")
#         import traceback
#         traceback.print_exc()
#         return jsonify({
#             'success': False,
#             'error': str(e)
#         }), 500

# # ═══════════════════════════════════════════════════════════════════════════
# # PRÉDICTION
# # ═══════════════════════════════════════════════════════════════════════════

# @app.route('/predict', methods=['POST'])
# def predict():
#     """
#     Génère des prédictions
    
#     Body JSON :
#     {
#         "context": {
#             "date": "2025-01-15",
#             "day_of_week": 1,
#             "month": 1,
#             "week_of_year": 3,
#             "planned_portions": 50,
#             "last_recipe_1": 22,
#             "last_recipe_2": 8,
#             "recipe_feasible": 1,
#             "availability_score": 1.0,
#             "min_days_to_expiry": 30,
#             "nb_missing_ingredients": 0,
#             "urgency_score": 0.5
#         },
#         "num_predictions": 5
#     }
#     """
#     global model, feature_names
    
#     if model is None:
#         if not load_model():
#             return jsonify({
#                 'success': False,
#                 'error': 'Modèle non entraîné'
#             }), 400
    
#     try:
#         data = request.json
#         context = data.get('context', {})
#         num_predictions = data.get('num_predictions', 5)
        
#         # Créer le DataFrame avec les features
#         X = pd.DataFrame([{
#             'day_of_week': context.get('day_of_week', 0),
#             'month': context.get('month', 1),
#             'week_of_year': context.get('week_of_year', 1),
#             'planned_portions': context.get('planned_portions', 50),
#             'last_recipe_1': context.get('last_recipe_1', 0),
#             'last_recipe_2': context.get('last_recipe_2', 0),
#             'recipe_feasible': context.get('recipe_feasible', 1),
#             'availability_score': context.get('availability_score', 1.0),
#             'min_days_to_expiry': context.get('min_days_to_expiry', 30),
#             'nb_missing_ingredients': context.get('nb_missing_ingredients', 0),
#             'urgency_score': context.get('urgency_score', 0.5)
#         }])
        
#         # S'assurer que les colonnes sont dans le bon ordre
#         X = X[feature_names]
        
#         # Prédiction des probabilités
#         probas = model.predict_proba(X)[0]
        
#         # Décoder les classes (indices → recipe_id)
#         if label_encoder:
#             classes = label_encoder.inverse_transform(model.classes_)
#         else:
#             classes = model.classes_
        
#         # Trier par probabilité décroissante
#         top_indices = np.argsort(probas)[::-1][:num_predictions]
        
#         predictions = []
#         for idx in top_indices:
#             prob = float(probas[idx])
            
#             # Déterminer le niveau de confiance
#             if prob >= 0.7:
#                 confidence = 'high'
#             elif prob >= 0.4:
#                 confidence = 'medium'
#             else:
#                 confidence = 'low'
            
#             # Générer des raisons simples (seront remplacées côté Node.js)
#             reasons = []
            
#             # Jour de la semaine
#             days = ['lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi', 'dimanche']
#             day_of_week = context.get('day_of_week', 0)
#             if 0 <= day_of_week <= 6:
#                 reasons.append(f"Adapté pour un {days[day_of_week]}")
            
#             # Note : Les raisons détaillées seront générées côté Node.js
#             # après enrichissement avec les vraies features de stock
            
#             predictions.append({
#                 'recipe_id': int(classes[idx]),
#                 'probability': prob,
#                 'confidence': confidence,
#                 'reasons': reasons
#             })
        
#         return jsonify({
#             'success': True,
#             'predictions': predictions
#         })
        
#     except Exception as e:
#         print(f" Erreur de prédiction : {str(e)}")
#         import traceback
#         traceback.print_exc()
#         return jsonify({
#             'success': False,
#             'error': str(e)
#         }), 500

# # ═══════════════════════════════════════════════════════════════════════════
# # ENDPOINTS UTILITAIRES
# # ═══════════════════════════════════════════════════════════════════════════

# @app.route('/health', methods=['GET'])
# def health():
#     """Vérifie la santé du service"""
#     return jsonify({
#         'status': 'healthy',
#         'service': 'ml-service',
#         'timestamp': datetime.now().isoformat()
#     })

# @app.route('/status', methods=['GET'])
# def status():
#     """Retourne le statut du modèle"""
#     global model, feature_names, label_encoder
    
#     if model is None:
#         load_model()
    
#     num_classes = 0
#     if model is not None:
#         if label_encoder:
#             num_classes = len(label_encoder.classes_)
#         else:
#             num_classes = len(model.classes_)
    
#     return jsonify({
#         'model_loaded': model is not None,
#         'num_features': len(feature_names) if feature_names else 0,
#         'features': feature_names if feature_names else [],
#         'num_classes': num_classes
#     })

# @app.route('/model-info', methods=['GET'])
# def model_info():
#     """Informations détaillées sur le modèle"""
#     global model, feature_names, label_encoder
    
#     if model is None:
#         if not load_model():
#             return jsonify({
#                 'trained': False,  #  Retourner 'trained' pour React
#                 'available': False,
#                 'error': 'Modèle non entraîné'
#             })
    
#     try:
#         importance = model.feature_importances_
#         feature_importance = {
#             feature_names[i]: float(importance[i])  #  Valeur brute (0-1)
#             for i in range(len(feature_names))
#         }
        
#         # Obtenir les recipe_id réels
#         if label_encoder:
#             classes = label_encoder.inverse_transform(model.classes_)
#         else:
#             classes = model.classes_
        
#         return jsonify({
#             'trained': True,  #  Ajouter 'trained' pour React
#             'available': True,
#             'num_features': len(feature_names),
#             'features': feature_names,
#             'num_classes': len(classes),
#             'classes': [int(c) for c in classes],
#             'feature_importance': feature_importance,
#             'model_type': 'XGBClassifier',
#             # Alias pour compatibilité React
#             'features_count': len(feature_names),
#             'classes_count': len(classes)
#         })
        
#     except Exception as e:
#         return jsonify({
#             'trained': False,
#             'available': False,
#             'error': str(e)
#         })

# @app.route('/feature-importance', methods=['GET'])
# def feature_importance_endpoint():
#     """Retourne l'importance des features"""
#     global model, feature_names
    
#     if model is None:
#         if not load_model():
#             return jsonify({
#                 'available': False,
#                 'error': 'Modèle non entraîné'
#             })
    
#     try:
#         importance = model.feature_importances_
#         feature_importance = [
#             {
#                 'feature': feature_names[i],
#                 'importance': float(importance[i])  #  Valeur brute (0-1), React fera *100
#             }
#             for i in range(len(feature_names))
#         ]
        
#         # Trier par importance
#         feature_importance.sort(key=lambda x: x['importance'], reverse=True)
        
#         return jsonify({
#             'available': True,
#             'feature_importance': feature_importance  #  Nom correct pour React
#         })
        
#     except Exception as e:
#         return jsonify({
#             'available': False,
#             'error': str(e)
#         })

# # ═══════════════════════════════════════════════════════════════════════════
# # DÉMARRAGE
# # ═══════════════════════════════════════════════════════════════════════════

# if __name__ == '__main__':
#     print(" Démarrage du service ML Mont-Vert")
#     print("   Features attendues : 11 (6 temporelles + 5 stock)")
#     print(f"    Modèle sauvegardé dans : {MODEL_PATH}")
    
#     # Charger le modèle existant s'il existe
#     if load_model():
#         print(f"    Modèle existant chargé")
#     else:
#         print(f"   ⚠️ Aucun modèle existant - en attente d'entraînement")
    
#     print("\n🌐 Service disponible sur http://localhost:5001")
#     print("   - POST /train              : Entraîner le modèle")
#     print("   - POST /predict            : Obtenir des prédictions")
#     print("   - GET  /health             : Vérifier la santé")
#     print("   - GET  /status             : Statut du modèle")
#     print("   - GET  /model-info         : Infos détaillées")
#     print("   - GET  /feature-importance : Importance des features\n")
    
#     app.run(host='0.0.0.0', port=5001, debug=True)

"""
Mont-Vert ML Service - Flask API pour XGBoost
Version Hybride : Modèle d'Habitudes (6 features) + Filtre Frigo (Règles)
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
MODEL_PATH = os.path.join(MODEL_DIR, 'recipe_model_hybrid.pkl') # Nouveau nom pour éviter les conflits

# Créer le dossier model/ s'il n'existe pas
os.makedirs(MODEL_DIR, exist_ok=True)

# Variables globales
model = None
feature_names = None
label_encoder = None

# ### MODIFICATION : Définition stricte des features d'habitude (Contexte seul)
HABIT_FEATURES = [
    'day_of_week', 
    'month', 
    'week_of_year', 
    'planned_portions',
    'last_recipe_1', 
    'last_recipe_2'
]

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
            label_encoder = saved_data.get('label_encoder') 
        print(f" Modèle Hybride chargé : {len(feature_names)} features d'habitude, {len(label_encoder.classes_) if label_encoder else 0} recettes connues")
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
    Entraîne le modèle XGBoost UNIQUEMENT sur les habitudes (contexte).
    On ignore volontairement les scores de stock (urgency, availability) ici.
    """
    try:
        data = request.json
        training_data = data.get('training_data', [])
        
        if not training_data:
            return jsonify({'success': False, 'error': 'Aucune donnée fournie'}), 400
        
        print(f"\n Entraînement Hybride avec {len(training_data)} exemples...")
        
        # Conversion en DataFrame
        df = pd.DataFrame(training_data)
        
        # ### MODIFICATION : On ne garde que les recettes fréquentes (>1 occurrence)
        # pour éviter les erreurs de classes uniques dans le split
        counts = df['recipe_id'].value_counts()
        valid_recipes = counts[counts > 1].index
        df_filtered = df[df['recipe_id'].isin(valid_recipes)].copy()
        
        print(f"    Filtrage : {len(df)} -> {len(df_filtered)} lignes (recettes récurrentes uniquement)")

        # Vérifier les colonnes
        missing_cols = [col for col in HABIT_FEATURES if col not in df_filtered.columns]
        if missing_cols:
            return jsonify({'success': False, 'error': f'Colonnes manquantes : {missing_cols}'}), 400
        
        # Préparer X (Habitudes uniquement) et y (Target)
        X = df_filtered[HABIT_FEATURES].fillna(0)
        y_raw = df_filtered['recipe_id']
        
        # Encoder les labels
        from sklearn.preprocessing import LabelEncoder
        le = LabelEncoder()
        y = le.fit_transform(y_raw)
        
        print(f"    Matrice X (Habitudes) : {X.shape}")
        
        # Entraîner XGBoost
        # Note : On garde multi:softprob pour avoir les probabilités de chaque plat
        xgb_model = xgb.XGBClassifier(
            n_estimators=100,
            max_depth=5,
            learning_rate=0.05, # Learning rate plus doux pour généraliser
            random_state=42,
            objective='multi:softprob',
            eval_metric='mlogloss'
        )
        
        xgb_model.fit(X, y)
        
        # Sauvegarder
        save_model(xgb_model, HABIT_FEATURES, le)
        
        # Accuracy (Sur les habitudes seulement)
        train_accuracy = xgb_model.score(X, y) * 100
        
        return jsonify({
            'success': True,
            'metrics': {
                'accuracy_context': round(train_accuracy, 2), # Renommé pour clarté
                'num_samples': len(df_filtered),
                'num_classes': int(len(le.classes_))
            }
        })
        
    except Exception as e:
        print(f" Erreur d'entraînement : {str(e)}")
        import traceback
        traceback.print_exc()
        return jsonify({'success': False, 'error': str(e)}), 500

# ═══════════════════════════════════════════════════════════════════════════
# PRÉDICTION (ALGO HYBRIDE)
# ═══════════════════════════════════════════════════════════════════════════

@app.route('/predict', methods=['POST'])
def predict():
    global model, feature_names, label_encoder
    
    if model is None:
        if not load_model():
            return jsonify({'success': False, 'error': 'Modèle non entraîné'}), 400
    
    try:
        data = request.json
        context = data.get('context', {})
        inventory_list = data.get('inventory', [])
        
        # 1. Prédiction Habitude (XGBoost)
        # --------------------------------
        X_input = pd.DataFrame([{col: context.get(col, 0) for col in HABIT_FEATURES}])
        probas = model.predict_proba(X_input)[0]
        
        # Récupération des IDs et conversion stricte en INT
        all_recipe_ids = label_encoder.inverse_transform(range(len(probas)))
        
        df_scores = pd.DataFrame({
            'recipe_id': all_recipe_ids,
            'score_envie': probas
        })
        df_scores['recipe_id'] = df_scores['recipe_id'].astype(int)
        
        # 2. Préparation Frigo
        # --------------------
        if not inventory_list:
            # Si vide, on crée un dataframe vide avec les bonnes colonnes
            df_inventory = pd.DataFrame(columns=['recipe_id', 'availability_score', 'urgency_score'])
        else:
            df_inventory = pd.DataFrame(inventory_list)
            # CRUCIAL : On convertit l'ID en int pour que le merge fonctionne
            if 'recipe_id' in df_inventory.columns:
                df_inventory['recipe_id'] = df_inventory['recipe_id'].astype(int)
            
            # Sécurité si les colonnes manquent
            if 'availability_score' not in df_inventory.columns: df_inventory['availability_score'] = 0.0
            if 'urgency_score' not in df_inventory.columns: df_inventory['urgency_score'] = 0.0

        # 3. Fusion (Le moment critique)
        # ------------------------------
        # On fusionne ce que le modèle pense (df_scores) avec ce qu'il y a dans le frigo (df_inventory)
        df_final = pd.merge(df_scores, df_inventory, on='recipe_id', how='left')
        
        # On remplit les trous (NaN) par 0.0
        df_final['availability_score'] = df_final['availability_score'].fillna(0.0)
        df_final['urgency_score'] = df_final['urgency_score'].fillna(0.0)
        df_final['score_envie'] = df_final['score_envie'].fillna(0.0)

        # 4. Calcul du Score Final
        # ------------------------
        # Vous pouvez ajuster les poids ici (0.4 / 0.3 / 0.3 est un bon début)
        df_final['score_final'] = (
            (df_final['score_envie'] * 0.4) +
            (df_final['availability_score'] * 0.3) +
            (df_final['urgency_score'] * 0.3)
        )
        
        # 5. Construction de la réponse pour le Frontend
        # ----------------------------------------------
        top_recipes = df_final.sort_values('score_final', ascending=False).head(5)
        
        predictions = []
        days = ['lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi', 'dimanche']
        day_name = days[context.get('day_of_week', 0)]

        for _, row in top_recipes.iterrows():
            # Extraction des valeurs propres
            s_final = float(row['score_final'])
            s_envie = float(row['score_envie'])
            s_avail = float(row['availability_score'])
            s_urgent = float(row['urgency_score'])
            
            # Génération des raisons (reasons) comme dans l'ancienne version
            reasons = []
            
            # Raison : Habitude (Le modèle XGBoost)
            if s_envie > 0.15: # Seuil arbitraire
                reasons.append(f"Souvent mangé le {day_name}")
            elif s_envie > 0.05:
                reasons.append(f"Adapté pour un {day_name}")
                
            # Raison : Disponibilité
            if s_avail >= 1.0:
                reasons.append("100% des ingrédients disponibles")
            elif s_avail >= 0.7:
                reasons.append("Majorité des ingrédients en stock")
                
            # Raison : Urgence
            if s_urgent >= 0.8:
                reasons.append("⚠️ Ingrédients à utiliser rapidement !")
            
            # Définition de la "confidence" basée sur le score final
            confidence = 'low'
            if s_final > 0.6: confidence = 'high'
            elif s_final > 0.4: confidence = 'medium'

            predictions.append({
                'recipe_id': int(row['recipe_id']),
                # --- COMPATIBILITÉ ---
                'probability': round(s_final, 4), # On remet 'probability' pour que le frontend s'y retrouve
                # ---------------------
                'score_final': round(s_final, 4),
                'confidence': confidence,
                'details': {
                    'habit_score': round(s_envie, 3),
                    'availability': round(s_avail, 2),
                    'urgency': round(s_urgent, 2)
                },
                'reasons': reasons
            })
            
        return jsonify({
            'success': True,
            'predictions': predictions
        })

    except Exception as e:
        print(f" Erreur predict : {e}")
        import traceback
        traceback.print_exc()
        return jsonify({'success': False, 'error': str(e)}), 500

# ═══════════════════════════════════════════════════════════════════════════
# UTILITAIRES (Health, Status...)
# ═══════════════════════════════════════════════════════════════════════════
@app.route('/model-info', methods=['GET'])
def model_info():
    """Informations détaillées sur le modèle (Requis par le Frontend)"""
    global model, feature_names, label_encoder
    
    if model is None:
        if not load_model():
            return jsonify({
                'trained': False,
                'available': False,
                'error': 'Modèle non entraîné'
            })
    
    try:
        # Récupération de l'importance des features (Habitudes seulement)
        importance = model.feature_importances_
        feature_importance_dict = {
            feature_names[i]: float(importance[i]) 
            for i in range(len(feature_names))
        }
        
        # Récupération des IDs de recettes connus par le modèle
        if label_encoder:
            # On transforme les index (0, 1, 2...) en vrais IDs (15, 20, 25...)
            classes = label_encoder.inverse_transform(range(len(model.classes_)))
        else:
            classes = model.classes_
            
        return jsonify({
            'trained': True,
            'available': True,
            'model_type': 'Hybrid (XGBoost Habits + Rules)',
            'features': feature_names,
            'num_features': len(feature_names),
            'num_classes': len(classes),
            'classes': [int(c) for c in classes],
            'feature_importance': feature_importance_dict,
            # Champs de compatibilité pour votre frontend actuel
            'features_count': len(feature_names),
            'classes_count': len(classes)
        })
        
    except Exception as e:
        print(f"Erreur model-info: {e}")
        return jsonify({
            'trained': False, 
            'available': False, 
            'error': str(e)
        }), 500
    
@app.route('/health', methods=['GET'])
def health():
    return jsonify({'status': 'healthy', 'service': 'mont-vert-hybrid-ml'})

@app.route('/status', methods=['GET'])
def status():
    global model, feature_names, label_encoder
    if model is None: load_model()
    return jsonify({
        'model_loaded': model is not None,
        'model_type': 'Hybrid (Habit XGB + Rules)',
        'num_features_habit': len(feature_names) if feature_names else 0,
        'num_recipes_known': len(label_encoder.classes_) if label_encoder else 0
    })

@app.route('/feature-importance', methods=['GET'])
def feature_importance_endpoint():
    """Retourne l'importance des variables de contexte (Habitudes)"""
    global model, feature_names
    if model is None:
        if not load_model(): return jsonify({'available': False, 'error': 'Modèle non chargé'})
    
    try:
        importance = model.feature_importances_
        data = [
            {'feature': feature_names[i], 'importance': float(importance[i])}
            for i in range(len(feature_names))
        ]
        data.sort(key=lambda x: x['importance'], reverse=True)
        return jsonify({'available': True, 'feature_importance': data})
    except Exception as e:
        return jsonify({'available': False, 'error': str(e)})

if __name__ == '__main__':
    print(" Démarrage du service ML Mont-Vert (Mode Hybride)")
    print(f"    Features Habitude : {HABIT_FEATURES}")
    print(f"    Modèle : {MODEL_PATH}")
    app.run(host='0.0.0.0', port=5001, debug=True)