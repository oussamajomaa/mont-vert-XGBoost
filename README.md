# 🌿 Mont-Vert - Documentation Technique Complète

## Table des matières

1. [Vue d'ensemble](#vue-densemble)
2. [Architecture](#architecture)
3. [Base de données](#base-de-données)
4. [Backend (Node.js/Express)](#backend)
5. [Frontend (React)](#frontend)
6. [Fonctionnalités clés](#fonctionnalités-clés)
7. [Installation](#installation)
8. [Configuration](#configuration)
9. [API Reference](#api-reference)

---

## Vue d'ensemble

### Qu'est-ce que Mont-Vert ?

Mont-Vert est une application de **gestion de stock alimentaire** conçue pour les cuisines professionnelles (cantines, restaurants, EHPAD). Elle permet de :

- **Gérer le stock** : Produits, lots avec dates de péremption (DLC)
- **Réduire le gaspillage** : Algorithme FEFO (First Expired, First Out)
- **Planifier les repas** : Création de meal plans avec réservation automatique
- **Suggestions IA** : Recommandations de plats basées sur les produits à risque
- **Alertes automatiques** : Notifications email pour les produits proches de la DLC
- **Tableaux de bord** : Visualisation des KPIs et statistiques

### Stack technique

| Couche | Technologie |
|--------|-------------|
| Frontend | React 18 + Vite + TailwindCSS |
| Backend | Node.js + Express 5 |
| Base de données | MySQL 8 |
| Authentification | JWT (cookies httpOnly) |
| Email | Nodemailer (SMTP) |
| PDF | PDFKit |
| Scheduler | node-cron |

---

## Architecture

```
mont-vert/
├── server/                    # Backend Node.js
│   ├── src/
│   │   ├── app.js            # Point d'entrée Express
│   │   ├── db.js             # Connexion MySQL
│   │   ├── auth/             # Authentification
│   │   │   ├── auth.middleware.js
│   │   │   └── auth.routes.js
│   │   ├── routes/           # Endpoints API
│   │   │   ├── ai.routes.js
│   │   │   ├── alert.routes.js
│   │   │   ├── dashboard.routes.js
│   │   │   ├── lot.routes.js
│   │   │   ├── mealplan.routes.js
│   │   │   ├── movement.routes.js
│   │   │   ├── product.routes.js
│   │   │   ├── recipe.routes.js
│   │   │   ├── stock.routes.js
│   │   │   └── user.routes.js
│   │   ├── services/         # Logique métier
│   │   │   ├── alert.service.js
│   │   │   ├── pdf.service.js
│   │   │   └── suggestion.service.js
│   │   ├── utils/            # Utilitaires
│   │   │   ├── async.js
│   │   │   ├── fefo.js       # Algorithme FEFO
│   │   │   └── num.js
│   │   └── cron/             # Tâches planifiées
│   │       └── scheduler.js
│   └── migrations/           # Scripts SQL
│
└── web/                       # Frontend React
    ├── src/
    │   ├── App.jsx           # Routes principales
    │   ├── main.jsx          # Point d'entrée
    │   ├── api/              # Client HTTP
    │   │   └── axios.js
    │   ├── auth/             # Contexte auth
    │   │   ├── AuthContext.jsx
    │   │   └── ProtectedRoute.jsx
    │   ├── components/       # Composants réutilisables
    │   │   ├── ConfirmDialog.jsx
    │   │   ├── Layout.jsx
    │   │   ├── Modal.jsx
    │   │   ├── Pagination.jsx
    │   │   └── Sidebar.jsx
    │   ├── pages/            # Pages de l'application
    │   │   ├── Dashboard.jsx
    │   │   ├── Products.jsx
    │   │   ├── Lots.jsx
    │   │   ├── Recipes.jsx
    │   │   ├── MealPlans.jsx
    │   │   ├── MealPlanDetail.jsx
    │   │   ├── AiSuggestions.jsx
    │   │   ├── Movements.jsx
    │   │   ├── Users.jsx
    │   │   ├── Login.jsx
    │   │   └── Register.jsx
    │   ├── chart/            # Configuration graphiques
    │   │   └── theme.js
    │   └── hooks/            # Hooks personnalisés
    │       └── useDebounce.js
    └── public/
```

---

## Base de données

### Schéma relationnel

```
┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│   product   │────<│     lot     │────<│ reservation │
└─────────────┘     └─────────────┘     └─────────────┘
       │                   │                   │
       │                   │                   │
       v                   v                   v
┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│ recipe_item │────>│   recipe    │<────│meal_plan_   │
└─────────────┘     └─────────────┘     │    item     │
                                        └─────────────┘
                                               │
                                               v
                                        ┌─────────────┐
                                        │  meal_plan  │
                                        └─────────────┘
                                               │
┌─────────────┐                               │
│    user     │<──────────────────────────────┘
└─────────────┘
       │
       v
┌─────────────┐
│stock_movement│
└─────────────┘
```

### Tables

#### `product` - Catalogue des produits
| Colonne | Type | Description |
|---------|------|-------------|
| id | INT | Clé primaire |
| name | VARCHAR(255) | Nom du produit |
| unit | VARCHAR(50) | Unité (kg, L, pièce, etc.) |
| cost | DECIMAL(10,2) | Coût unitaire en € |
| category | VARCHAR(100) | Catégorie (optionnel) |

#### `lot` - Lots de produits avec DLC
| Colonne | Type | Description |
|---------|------|-------------|
| id | INT | Clé primaire |
| product_id | INT | FK vers product |
| batch_number | VARCHAR(100) | Numéro de lot |
| quantity | DECIMAL(12,3) | Quantité actuelle |
| expiry_date | DATE | Date de péremption (DLC) |
| archived | BOOLEAN | Lot archivé (périmé traité) |
| created_at | TIMESTAMP | Date de création |

#### `recipe` - Recettes
| Colonne | Type | Description |
|---------|------|-------------|
| id | INT | Clé primaire |
| name | VARCHAR(255) | Nom de la recette |
| base_portions | INT | Portions de base |
| waste_rate | DECIMAL(5,2) | Taux de perte (%) |
| instructions | TEXT | Instructions (optionnel) |

#### `recipe_item` - Ingrédients des recettes
| Colonne | Type | Description |
|---------|------|-------------|
| id | INT | Clé primaire |
| recipe_id | INT | FK vers recipe |
| product_id | INT | FK vers product |
| qty_per_portion | DECIMAL(10,4) | Quantité par portion |

#### `meal_plan` - Plans de repas
| Colonne | Type | Description |
|---------|------|-------------|
| id | INT | Clé primaire |
| period_start | DATE | Début de période |
| period_end | DATE | Fin de période |
| status | ENUM | DRAFT, CONFIRMED, EXECUTED |
| created_at | TIMESTAMP | Date de création |

#### `meal_plan_item` - Plats d'un plan
| Colonne | Type | Description |
|---------|------|-------------|
| id | INT | Clé primaire |
| meal_plan_id | INT | FK vers meal_plan |
| recipe_id | INT | FK vers recipe |
| planned_portions | INT | Portions prévues |
| produced_portions | INT | Portions produites (après exécution) |
| execution_date | DATE | Date d'exécution |

#### `reservation` - Réservations FEFO
| Colonne | Type | Description |
|---------|------|-------------|
| id | INT | Clé primaire |
| meal_plan_item_id | INT | FK vers meal_plan_item |
| lot_id | INT | FK vers lot |
| reserved_qty | DECIMAL(12,3) | Quantité réservée |

#### `stock_movement` - Historique des mouvements
| Colonne | Type | Description |
|---------|------|-------------|
| id | INT | Clé primaire |
| type | ENUM | IN, OUT, ADJ, LOSS, EXPIRED |
| quantity | DECIMAL(12,3) | Quantité |
| lot_id | INT | FK vers lot |
| meal_plan_item_id | INT | FK (optionnel) |
| user_id | INT | FK vers user |
| created_at | TIMESTAMP | Date du mouvement |

#### `user` - Utilisateurs
| Colonne | Type | Description |
|---------|------|-------------|
| id | INT | Clé primaire |
| name | VARCHAR(255) | Nom |
| email | VARCHAR(255) | Email (unique) |
| password | VARCHAR(255) | Hash bcrypt |
| role | ENUM | ADMIN, KITCHEN, DIRECTOR |
| active | BOOLEAN | Compte actif |
| created_at | TIMESTAMP | Date de création |

#### `alert_log` - Historique des alertes
| Colonne | Type | Description |
|---------|------|-------------|
| id | INT | Clé primaire |
| type | VARCHAR(50) | Type d'alerte |
| products_count | INT | Nombre de produits |
| total_value | DECIMAL(12,2) | Valeur totale |
| recipients_count | INT | Destinataires |
| sent_at | TIMESTAMP | Date d'envoi |

---

## Backend

### app.js - Point d'entrée

Fichier principal qui configure Express et charge toutes les routes.

```javascript
// Configuration
app.use(cookieParser())           // Parse les cookies (JWT)
app.use(cors({ credentials: true }))  // CORS avec credentials
app.use(express.json())           // Parse JSON

// Routes
app.use('/auth', authRoutes)      // Authentification
app.use('/products', productRoutes)
app.use('/lots', lotRoutes)
app.use('/recipes', recipeRoutes)
app.use('/meal-plans', mealplanRoutes)
app.use('/movements', movementRoutes)
app.use('/stock', stockRoutes)
app.use('/dashboard', dashboardRoutes)
app.use('/users', userRoutes)
app.use('/ai', aiRoutes)          // Suggestions IA
app.use('/alerts', alertRoutes)   // Alertes email

// Démarrage du scheduler
startAlertScheduler('0 7 * * *')  // Alertes à 7h chaque jour
```

### Routes API

#### auth.routes.js - Authentification

| Méthode | Endpoint | Description |
|---------|----------|-------------|
| POST | `/auth/login` | Connexion (retourne cookie JWT) |
| POST | `/auth/register` | Inscription (ADMIN only) |
| POST | `/auth/logout` | Déconnexion (supprime cookie) |

**Middleware `requireAuth(roles)`** : Vérifie le JWT et les rôles autorisés.

#### product.routes.js - Produits

| Méthode | Endpoint | Description |
|---------|----------|-------------|
| GET | `/products` | Liste paginée + recherche |
| GET | `/products/:id` | Détail d'un produit |
| POST | `/products` | Créer un produit |
| PUT | `/products/:id` | Modifier un produit |
| DELETE | `/products/:id` | Supprimer un produit |

#### lot.routes.js - Lots

| Méthode | Endpoint | Description |
|---------|----------|-------------|
| GET | `/lots` | Liste paginée + filtres |
| GET | `/lots/:id` | Détail d'un lot |
| POST | `/lots` | Créer un lot (+ mouvement IN) |
| PUT | `/lots/:id` | Modifier un lot |
| DELETE | `/lots/:id` | Supprimer un lot |
| POST | `/lots/expire` | Traiter les lots périmés |

**Traitement des périmés** (`POST /lots/expire`) :
1. Trouve tous les lots avec `expiry_date < today` et `quantity > 0`
2. Crée un mouvement `EXPIRED` pour chaque lot
3. Met `quantity = 0` et `archived = TRUE`

#### recipe.routes.js - Recettes

| Méthode | Endpoint | Description |
|---------|----------|-------------|
| GET | `/recipes` | Liste avec ingrédients |
| GET | `/recipes/:id` | Détail avec ingrédients |
| POST | `/recipes` | Créer une recette |
| PUT | `/recipes/:id` | Modifier une recette |
| DELETE | `/recipes/:id` | Supprimer une recette |
| GET | `/recipes/:id/lines` | Ingrédients de la recette |

#### mealplan.routes.js - Plans de repas

| Méthode | Endpoint | Description |
|---------|----------|-------------|
| GET | `/meal-plans` | Liste paginée + filtres |
| GET | `/meal-plans/:id` | Détail du plan |
| POST | `/meal-plans` | Créer un plan (DRAFT) |
| GET | `/meal-plans/:id/items` | Items du plan |
| POST | `/meal-plans/:id/items` | Ajouter un plat |
| DELETE | `/meal-plans/:planId/items/:itemId` | Supprimer un plat |
| POST | `/meal-plans/:id/confirm` | Confirmer (réserve FEFO) |
| POST | `/meal-plans/items/:itemId/execute` | Exécuter une ligne |
| GET | `/meal-plans/:id/export-pdf` | Exporter en PDF |

**Cycle de vie d'un plan** :
```
DRAFT → CONFIRMED → EXECUTED
  │         │           │
  │         │           └─ Toutes les lignes exécutées
  │         └─ Réservations FEFO créées
  └─ Ajout/suppression de plats possible
```

#### ai.routes.js - Suggestions IA

| Méthode | Endpoint | Description |
|---------|----------|-------------|
| GET | `/ai/suggestions` | Liste des suggestions triées par score |
| GET | `/ai/suggestions/recipe/:id` | Portions max pour une recette |
| GET | `/ai/at-risk` | Produits à risque (DLC proche) |
| POST | `/ai/create-plan` | Créer un plan automatiquement |

#### alert.routes.js - Alertes email

| Méthode | Endpoint | Description |
|---------|----------|-------------|
| GET | `/alerts/expiring` | Produits expirant bientôt |
| GET | `/alerts/recipients` | Liste des destinataires |
| POST | `/alerts/send` | Envoyer les alertes |
| POST | `/alerts/test` | Envoyer un email de test |
| GET | `/alerts/preview` | Prévisualiser l'email |

#### dashboard.routes.js - Tableaux de bord

| Méthode | Endpoint | Description |
|---------|----------|-------------|
| GET | `/dashboard/overview` | KPIs complets |

**Données retournées** :
- Valeur du stock
- Lots expirant (≤7j, ≤14j, périmés)
- Taux de perte
- Mouvements par jour (graphique)
- Top produits consommés/gaspillés
- Statistiques FEFO (économies estimées)
- Plans par statut

### Services

#### suggestion.service.js - Algorithme de suggestion

Calcule un **score FEFO** pour chaque recette :

```javascript
Score = Σ (poids × urgence)

où:
- poids = quantité nécessaire / quantité totale recette
- urgence = 100 si ≤1j, 75 si ≤3j, 50 si ≤5j, 25 si ≤7j
```

**Fonctions principales** :
- `getSuggestions(portions, limit)` : Retourne les recettes triées par score
- `getMaxPortionsForRecipe(recipeId)` : Calcule le max de portions possibles
- `getAtRiskProducts(days)` : Liste les produits proches de la DLC

#### alert.service.js - Service d'alertes email

- `getExpiringProducts(days)` : Récupère les produits à risque
- `getAlertRecipients()` : Récupère les emails des ADMIN/KITCHEN
- `generateAlertEmailHtml()` : Génère le contenu HTML
- `sendAlertEmails()` : Envoie les emails via SMTP

#### pdf.service.js - Génération de PDF

- `generateMealPlanPdf(planId)` : Génère un PDF avec PDFKit
  - En-tête avec statut
  - Informations du plan
  - Liste des plats avec ingrédients
  - Tableau des réservations FEFO

### Utilitaires

#### fefo.js - Algorithme FEFO

**FEFO = First Expired, First Out**

L'algorithme garantit que les produits avec la DLC la plus proche sont utilisés en premier.

```javascript
// 1. Calcul des besoins
computeNeedsForItem(itemId)
// Retourne la liste des produits nécessaires avec quantités

// 2. Création des réservations
createReservationsForItem(conn, itemId)
// Pour chaque besoin :
//   - Trie les lots par expiry_date ASC
//   - Réserve en partant du lot expirant le plus tôt
//   - Continue jusqu'à avoir assez

// 3. Exécution
executeItem(conn, itemId, producedPortions, userId)
// - Consomme les réservations (FEFO)
// - Crée les mouvements OUT
// - Libère les réservations restantes
// - Marque la ligne comme exécutée
```

---

## Frontend

### App.jsx - Routes principales

```jsx
<Routes>
  <Route path="/login" element={<Login />} />
  
  {/* Routes protégées */}
  <Route element={<ProtectedRoute />}>
    <Route path="/" element={<Dashboard />} />
    <Route path="/products" element={<Products />} />
    <Route path="/lots" element={<Lots />} />
    <Route path="/recipes" element={<Recipes />} />
    <Route path="/meal-plans" element={<MealPlans />} />
    <Route path="/meal-plans/:id" element={<MealPlanDetail />} />
    <Route path="/ai-suggestions" element={<AiSuggestions />} />
    <Route path="/movements" element={<Movements />} />
    <Route path="/users" element={<Users />} />
  </Route>
</Routes>
```

### Pages

#### Dashboard.jsx - Tableau de bord principal

**Sections** :
1. **Alerte produits à risque** (bandeau jaune si produits ≤7j)
2. **KPIs** : Valeur stock, lots ≤7j, lots ≤14j, périmés, taux perte, économies FEFO
3. **Plans par statut** : DRAFT, CONFIRMED, EXECUTED
4. **Graphique mouvements** : IN/OUT/ADJ/LOSS sur 30 jours
5. **Donut répartition** : Types de mouvements
6. **Top produits consommés** : Bar chart
7. **Top produits gaspillés** : Liste avec valeur
8. **Produits à réapprovisionner** : Liste
9. **Impact FEFO** : Plans exécutés, économies estimées
10. **Tableau des pertes** : Détail des pertes 30j
11. **Lots proches DLC** : Liste des lots critiques

**Actions** :
- Bouton "Traiter" les périmés (si lots_expired > 0)
- Bouton "Tester alerte" (ADMIN)
- Lien vers Suggestions IA

#### Products.jsx - Gestion des produits

**Fonctionnalités** :
- Liste paginée avec recherche
- Création/modification via modal
- Affichage : nom, unité, coût, catégorie

#### Lots.jsx - Gestion des lots

**Fonctionnalités** :
- Liste paginée avec filtres
- Filtres : produit, périmés, archivés
- Indicateurs visuels DLC (rouge ≤3j, orange ≤7j)
- Création avec numéro de lot et DLC

#### Recipes.jsx - Gestion des recettes

**Fonctionnalités** :
- Liste avec nombre d'ingrédients
- Modal de création/modification
- Gestion des ingrédients (ajout/suppression dynamique)
- Taux de perte configurable

#### MealPlans.jsx - Liste des plans

**Fonctionnalités** :
- Liste paginée avec filtres (statut, dates)
- Indicateurs de statut colorés
- Lien vers détail

#### MealPlanDetail.jsx - Détail d'un plan

**Sections** :
- En-tête avec période et statut
- Boutons d'action selon statut
- Tableau des plats (recette, portions prévues/produites, statut)

**Actions par statut** :

| Statut | Actions disponibles |
|--------|---------------------|
| DRAFT | Add dish, Confirm, Export PDF |
| CONFIRMED | Execute line, Export PDF |
| EXECUTED | Export PDF (lecture seule) |

**Workflow "Add dish"** :
1. Sélectionner une recette
2. Définir le nombre de portions
3. Vérification de faisabilité en temps réel
4. Option "Forcer" si stock insuffisant (ADMIN)

**Workflow "Execute"** :
1. Cliquer sur "Exec" sur une ligne
2. Confirmer les portions produites
3. L'algorithme FEFO consomme le stock
4. Mouvements OUT créés automatiquement

#### AiSuggestions.jsx - Suggestions IA

**Sections** :
1. **Paramètres** : Portions souhaitées, limite de résultats
2. **Bandeau plan DRAFT** : Si un plan existe pour aujourd'hui
3. **KPIs** : Suggestions totales, réalisables, urgentes, produits à risque
4. **Plats réalisables** : Triés par score FEFO
5. **Plats non réalisables** : Stock insuffisant
6. **Produits à risque** : Sidebar avec DLC

**Carte de suggestion** :
```
┌──────────────────────────────────────────────────────┐
│ #1  🟠 Pâtes carbonara                    Score: 75  │
│     Utilise des produits urgents      42 portions max│
│                                    (limité par Jambon)│
│ ┌──────────────────────────────────────────────────┐ │
│ │ Lots à consommer en priorité :                   │ │
│ │ • Jambon blanc      0.50 kg (2j restants)       │ │
│ │ • Crème fraîche     0.30 L  (5j restants)       │ │
│ └──────────────────────────────────────────────────┘ │
│ 2/5 ingrédients urgents              [Ajouter au plan]│
└──────────────────────────────────────────────────────┘
```

**Actions** :
- "Ajouter au plan" : Ajoute au plan DRAFT existant ou en crée un
- Marquage visuel "Dans le plan" après ajout

#### Movements.jsx - Historique des mouvements

**Fonctionnalités** :
- Liste paginée
- Filtres par type (IN, OUT, ADJ, LOSS, EXPIRED)
- Affichage : date, type, produit, lot, quantité, utilisateur

#### Users.jsx - Gestion des utilisateurs

**Fonctionnalités** :
- Liste des utilisateurs
- Création (ADMIN only)
- Activation/désactivation
- Rôles : ADMIN, KITCHEN, DIRECTOR

### Composants réutilisables

#### Layout.jsx
Structure de base avec Sidebar + contenu.

#### Sidebar.jsx
Menu de navigation avec sections :
- Dashboard
- STOCK & RECETTES (Products, Lots, Recipes)
- PLANS (Meal Plans, Suggestions IA)
- ADMIN (Movements, Users)

#### Modal.jsx
Fenêtre modale réutilisable avec titre et fermeture.

#### ConfirmDialog.jsx
Dialogue de confirmation avec message et boutons Annuler/Confirmer.

#### Pagination.jsx
Composant de pagination avec numéros de page.

### Hooks personnalisés

#### useDebounce.js
Retarde l'exécution d'une valeur (utilisé pour la recherche).

```javascript
const debouncedSearch = useDebounce(search, 300);
// La valeur ne change que 300ms après la dernière frappe
```

### Contexte d'authentification

#### AuthContext.jsx
Fournit :
- `user` : Utilisateur connecté
- `login(email, password)` : Fonction de connexion
- `logout()` : Fonction de déconnexion
- `loading` : État de chargement

#### ProtectedRoute.jsx
Redirige vers `/login` si non authentifié.

---

## Fonctionnalités clés

### 1. Algorithme FEFO

**First Expired, First Out** garantit que les produits avec la DLC la plus proche sont utilisés en priorité.

**Étapes** :

1. **Confirmation du plan** :
   - Pour chaque plat, calcul des besoins (qty × portions × (1 + waste_rate))
   - Pour chaque besoin, réservation FEFO sur les lots disponibles
   - Erreur si stock insuffisant

2. **Exécution d'une ligne** :
   - Consommation des réservations (FEFO)
   - Création des mouvements OUT
   - Si besoin complémentaire, puise dans les lots non réservés
   - Libération des réservations restantes

3. **Protection** :
   - Les lots réservés ne sont pas disponibles pour d'autres plans
   - Les lots périmés sont exclus automatiquement

### 2. Suggestions IA

L'algorithme calcule un **score d'urgence** pour chaque recette :

```
Score = Σ (importance_ingrédient × urgence_DLC)

- importance = part de l'ingrédient dans la recette
- urgence = 100 (≤1j), 75 (≤3j), 50 (≤5j), 25 (≤7j), 0 sinon
```

**Résultat** : Les recettes utilisant le plus de produits urgents sont en tête.

### 3. Alertes automatiques

**Configuration** :
- Scheduler : `0 7 * * *` (7h chaque jour)
- Seuil : Produits expirant dans ≤3 jours
- Destinataires : Utilisateurs ADMIN et KITCHEN avec email

**Contenu de l'email** :
- Résumé (nombre de produits, valeur à risque)
- Section critique (≤1 jour)
- Section urgente (2-3 jours)
- Lien vers les Suggestions IA

### 4. Export PDF

Génère un document PDF professionnel avec :
- En-tête coloré avec statut
- Informations du plan
- Liste des plats avec ingrédients nécessaires
- Tableau des réservations FEFO (si confirmé)
- Pied de page avec date de génération

### 5. Dashboard unifié

Combine toutes les métriques en une seule vue :
- KPIs temps réel
- Graphiques de tendance
- Alertes visuelles
- Actions rapides

---

## Installation

### Prérequis

- Node.js 18+
- MySQL 8+
- npm ou yarn

### 1. Cloner le repository

```bash
git clone https://github.com/oussamajomaa/mont-vert.git
cd mont-vert
```

### 2. Backend

```bash
cd server
npm install
```

**Dépendances principales** :
```json
{
  "express": "^5.x",
  "mysql2": "^3.x",
  "jsonwebtoken": "^9.x",
  "bcrypt": "^5.x",
  "nodemailer": "^6.x",
  "pdfkit": "^0.13.x",
  "node-cron": "^3.x",
  "dotenv": "^16.x",
  "zod": "^3.x"
}
```

### 3. Frontend

```bash
cd web
npm install
```

**Dépendances principales** :
```json
{
  "react": "^18.x",
  "react-router-dom": "^6.x",
  "axios": "^1.x",
  "react-hook-form": "^7.x",
  "react-hot-toast": "^2.x",
  "chart.js": "^4.x",
  "react-chartjs-2": "^5.x",
  "date-fns": "^2.x"
}
```

### 4. Base de données

```sql
CREATE DATABASE stock_driven;
USE stock_driven;

-- Exécuter les migrations
source migrations/001_init.sql;
source migrations/002_xxx.sql;
-- etc.
```

### 5. Configuration

Créer `server/.env` :

```env
# Database
DB_HOST=localhost
DB_USER=root
DB_PASS=password
DB_NAME=stock_driven

# JWT
JWT_SECRET=your-secret-key
JWT_EXPIRES=12h

# Server
PORT=4000
CORS_ORIGIN=http://localhost:5173

# Email (optionnel)
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=your-email@gmail.com
SMTP_PASS=app-password
SMTP_FROM=your-email@gmail.com

# Alerts
ALERT_CRON=0 7 * * *
APP_URL=http://localhost:5173
```

### 6. Démarrage

```bash
# Terminal 1 - Backend
cd server
npm run dev

# Terminal 2 - Frontend
cd web
npm run dev
```

Accéder à : `http://localhost:5173`

---

## Configuration

### Variables d'environnement

| Variable | Défaut | Description |
|----------|--------|-------------|
| `DB_HOST` | localhost | Hôte MySQL |
| `DB_USER` | root | Utilisateur MySQL |
| `DB_PASS` | - | Mot de passe MySQL |
| `DB_NAME` | stock_driven | Nom de la base |
| `JWT_SECRET` | - | Clé secrète JWT |
| `JWT_EXPIRES` | 12h | Durée du token |
| `PORT` | 4000 | Port du serveur |
| `CORS_ORIGIN` | http://localhost:5173 | Origine CORS |
| `SMTP_HOST` | - | Serveur SMTP |
| `SMTP_PORT` | 587 | Port SMTP |
| `SMTP_USER` | - | Utilisateur SMTP |
| `SMTP_PASS` | - | Mot de passe SMTP |
| `SMTP_FROM` | - | Expéditeur email |
| `ALERT_CRON` | 0 7 * * * | Horaire des alertes |
| `APP_URL` | http://localhost:5173 | URL de l'app |
| `ENABLE_ALERT_SCHEDULER` | true | Activer le scheduler |

### Rôles utilisateurs

| Rôle | Permissions |
|------|-------------|
| ADMIN | Toutes les fonctionnalités |
| KITCHEN | Gestion stock, plans, exécution |
| DIRECTOR | Lecture seule (dashboards) |

---

## API Reference

### Authentification

Toutes les routes (sauf `/auth/login`) nécessitent un token JWT valide.

Le token est envoyé via cookie `httpOnly` nommé `token`.

### Format des réponses

**Succès** :
```json
{
  "data": [...],
  "total": 100,
  "page": 1,
  "pageSize": 10
}
```

**Erreur** :
```json
{
  "error": "Message d'erreur"
}
```

### Endpoints détaillés

Voir la section [Routes API](#routes-api) pour la liste complète.

---

## Changelog

### v15 - Export PDF
- Ajout de l'export PDF pour les meal plans
- Génération avec PDFKit

### v14 - Portions max
- Affichage des portions max par recette
- Indication de l'ingrédient limitant

### v13 - Alertes email
- Service d'alertes automatiques
- Scheduler cron (7h chaque jour)
- Email HTML professionnel
- Bouton "Tester alerte" dans le Dashboard

### v12 - Dashboard fusionné
- Intégration des données FEFO dans le Dashboard
- Suppression du Dashboard Gaspillage redondant
- Alerte produits à risque avec lien Suggestions IA
- KPI économies FEFO

### v11 - Améliorations UX
- Bandeau "Plan en cours" avec compteur
- Marquage visuel des plats ajoutés
- Pas de redirection après ajout

### v10 - Module IA FEFO
- Algorithme de scoring FEFO
- Page Suggestions IA
- Ajout rapide au plan
- Création automatique de plan

---

## Support

- **Repository** : https://github.com/oussamajomaa/mont-vert
- **Issues** : Ouvrir une issue sur GitHub

---

*Documentation générée le 26/11/2025 - Mont-Vert v15*