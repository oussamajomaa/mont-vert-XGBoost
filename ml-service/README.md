# 🤖 Mont-Vert ML Service

Microservice Python Flask pour les prédictions de repas avec XGBoost.

## Architecture

```
┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│   React     │────>│   Node.js   │────>│   Flask     │
│   Frontend  │     │   Backend   │     │   XGBoost   │
└─────────────┘     └─────────────┘     └─────────────┘
     :5173              :4000               :5001
```

## Installation

### 1. Créer l'environnement virtuel

```bash
cd ml-service
python -m venv venv
source venv/bin/activate  # Linux/Mac
# ou: venv\Scripts\activate  # Windows
```

### 2. Installer les dépendances

```bash
pip install -r requirements.txt
```

### 3. Démarrer le service

```bash
python app.py
```

Le service démarre sur http://localhost:5001

## Endpoints API

| Méthode | Endpoint | Description |
|---------|----------|-------------|
| GET | `/health` | Vérifier la santé du service |
| GET | `/model-info` | Informations sur le modèle |
| GET | `/feature-importance` | Importance des features |
| POST | `/train` | Entraîner le modèle |
| POST | `/predict` | Obtenir des prédictions |

## Entraînement

### Format des données d'entraînement

```json
{
  "training_data": [
    {
      "date": "2025-11-20",
      "recipe_id": 1,
      "planned_portions": 50,
      "stock": [
        {"product_id": 1, "available_qty": 10.5, "days_to_expiry": 3},
        {"product_id": 2, "available_qty": 5.0, "days_to_expiry": 7}
      ],
      "last_recipes": [5, 3]
    }
  ]
}
```

### Features utilisées

| Feature | Description |
|---------|-------------|
| `day_of_week` | Jour de la semaine (0-6) |
| `month` | Mois (1-12) |
| `week_of_year` | Semaine de l'année |
| `planned_portions` | Nombre de portions prévues |
| `last_recipe_1` | ID de la dernière recette servie |
| `last_recipe_2` | ID de l'avant-dernière recette |
| `stock_{id}` | Quantité disponible par produit |
| `days_to_expiry_{id}` | Jours avant péremption par produit |

## Prédiction

### Requête

```json
{
  "date": "2025-11-26",
  "planned_portions": 50,
  "stock": [...],
  "recipes": [{"id": 1, "name": "Pâtes carbonara"}, ...],
  "last_recipes": [5, 3]
}
```

### Réponse

```json
{
  "predictions": [
    {
      "recipe_id": 1,
      "recipe_name": "Pâtes carbonara",
      "probability": 0.85,
      "confidence": "high",
      "reasons": ["Utilise jambon (expire dans 2j)"]
    }
  ],
  "model_info": {
    "version": "1.0",
    "features_count": 45
  }
}
```

## Docker

### Build

```bash
docker build -t mont-vert-ml .
```

### Run

```bash
docker run -p 5001:5001 mont-vert-ml
```

## Configuration

Variable d'environnement dans le backend Node.js :

```env
ML_SERVICE_URL=http://localhost:5001
```

## Algorithme

XGBoost (eXtreme Gradient Boosting) est un algorithme de machine learning basé sur les arbres de décision :

1. **Collecte** : Historique des repas + contexte stock
2. **Features** : Jour, stock disponible, DLC, recettes précédentes
3. **Entraînement** : Classification multi-classe (quelle recette ?)
4. **Prédiction** : Probabilités pour chaque recette

### Pourquoi XGBoost ?

- ✅ Performant sur données tabulaires
- ✅ Gère bien les valeurs manquantes
- ✅ Rapide à entraîner
- ✅ Interprétable (feature importance)
- ✅ Pas besoin de GPU
