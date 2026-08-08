# PulsePeak

**Application web de planification et de suivi d'entraînement triathlon** (natation · cyclisme · course à pied), pilotée par l'IA.

PulsePeak génère un plan d'entraînement complet à partir du profil de l'athlète (zones, disponibilités, objectifs, niveau de forme), l'adapte semaine après semaine en fonction de ce qui est réellement réalisé, et synchronise automatiquement les activités depuis Strava.

`v1.6.5` · Next.js 16 · React 19 · Supabase · Drizzle ORM · Google Gemini

> **Projet personnel.** Le code est public à titre de vitrine technique, mais il ne s'agit pas d'un projet open source collaboratif : le dépôt est maintenu par un unique auteur et **n'accepte ni contribution, ni issue, ni pull request**. Voir [Licence & contributions](#licence--contributions).

---

## Sommaire

- [Fonctionnalités](#fonctionnalités)
- [Stack technique](#stack-technique)
- [Installation](#installation)
- [Variables d'environnement](#variables-denvironnement)
- [Scripts](#scripts)
- [Architecture](#architecture)
- [Modèle de données](#modèle-de-données)
- [Abonnements & quotas](#abonnements--quotas)
- [Licence & contributions](#licence--contributions)

---

## Fonctionnalités

### Planification IA
- Génération d'un plan complet **plan → blocs (mésocycles) → semaines → séances** via Gemini
- Périodisation automatique (Base / Build / Peak / Race), semaines de récupération et affûtage (taper J-x) calculés à partir de la CTL cible
- Génération semaine par semaine avec continuité vis-à-vis de la semaine précédente
- Régénération d'une séance isolée, ou de la fin de semaine en cas de dérive
- Prise en compte des zones (FC / puissance / allure), des disponibilités hebdomadaires et des objectifs déclarés
- Double variante **Outdoor / Indoor** par séance
- Persona de coach au choix : cyclisme, course à pied, natation ou triathlon

### Calendrier
- Vue desktop (grille mensuelle) et vue mobile dédiée, avec résumé de charge hebdomadaire
- **Glisser-déposer** pour déplacer une séance
- Statuts : à faire / faite / ratée, avec détection automatique des séances manquées
- Détail de séance structurée (blocs, répétitions, intensités par zone)
- Feedback post-séance : RPE, durée réelle, distance
- Ajout manuel d'une sortie libre
- Modales de progression pendant la génération IA

### Vue Plan
- Vue d'ensemble du plan : blocs, semaines, TSS cible vs réalisé
- Édition du plan (nom, date d'objectif, stratégie macro), décalage temporel des séances à venir, suppression
- Archivage automatique de l'ancien plan lors de la création d'un nouveau (les séances réalisées sont conservées pour le calcul de la CTL)

### Objectifs & courses
- Liste d'objectifs (course, date, sport, distance, dénivelé, priorité principale/secondaire)
- Génération d'un plan calé sur une date d'objectif

### Coach IA (chat)
- Conversation en streaming avec un coach contextualisé : profil, CTL, sports actifs, objectif et séances récentes

### Intégration Strava
- OAuth 2.0, rafraîchissement de token, synchronisation des activités
- Dédoublonnage par `stravaId`
- Mapping des activités en séances (laps, puissance, FC, allure, distribution en zones)
- *Write-back* optionnel vers Strava (activable dans le profil)

### Analyse & statistiques
- Calcul du **TSS** avec cascade par sport : puissance → cardio (Karvonen) → défaut sport (vélo), allure/NGP (course), allure/CSS (natation)
- **PMC** : CTL (charge chronique), ATL (fatigue aiguë), recalculés jour par jour pour que les jours de repos fassent décroître l'ATL
- Classification déterministe du stimulus réel d'une séance (zones, détection d'intervalles, IF, FC)
- **Analyse de dérive** planifié vs réalisé (durée, TSS, puissance, FC, fade, découplage) avec seuils d'alerte
- Graphiques de charge par sport et par semaine

### Profil athlète
- Informations de base, sports actifs, expérience
- Zones FC / puissance / allure par sport, calculateur FTP & Critical Power, tests de calibration
- Disponibilités hebdomadaires respectées par l'IA
- Thème clair / sombre persisté en base

### Compte & onboarding
- Inscription / connexion email + mot de passe (Supabase Auth)
- Réinitialisation et changement de mot de passe
- Écran de bienvenue et tutoriel interactif au premier lancement
- Installation **PWA** (manifest, mode standalone) avec filet de sécurité de session pour iOS

### Abonnements & administration
- Pages publiques `/pricing` et `/checkout` (plans Gratuit / Développeur / Pro)
- *Feature gating* et paywall côté UI selon le plan et le rôle
- Tableau de bord admin (`/admin`) : liste des utilisateurs, changement de plan/rôle, réinitialisation des compteurs IA, statistiques

---

## Stack technique

| Couche | Technologie |
|---|---|
| Framework | Next.js 16 (App Router, Server Components, Server Actions) |
| UI | React 19 · Tailwind CSS v4 · Lucide React · Recharts |
| Base de données | Supabase (PostgreSQL) |
| ORM | Drizzle ORM (`drizzle-kit`) |
| Auth | Supabase Auth (`@supabase/ssr`, cookies HTTP-only) |
| IA | Google Gemini (`gemini-2.5-flash`) |
| Intégration sport | Strava API (OAuth 2.0) |
| Dates | date-fns |
| Langage | TypeScript strict |

---

## Installation

Prérequis : **Node.js 20+**, un projet **Supabase**, une clé **Gemini** et une application **Strava**.

```bash
# 1. Cloner le dépôt
git clone https://github.com/jpthibault20/pulsepeak2.git
cd pulsepeak2

# 2. Installer les dépendances
npm install

# 3. Créer le fichier d'environnement
#    (voir la section « Variables d'environnement » ci-dessous)
touch .env.local

# 4. Pousser le schéma vers Supabase
npm run db:push

# 5. Lancer le serveur de développement
npm run dev
```

L'application est disponible sur http://localhost:3000.

> `profiles.id` doit correspondre à `auth.users.id` : un **trigger Supabase** doit créer la ligne `profiles` à l'inscription (cf. commentaire dans `src/lib/db/schema.ts`).

---

## Variables d'environnement

À placer dans `.env.local`. Les variables serveur sont validées au démarrage par `src/lib/env.ts` (*fail fast* si une variable manque).

```env
# ── Supabase ────────────────────────────────────────────────
NEXT_PUBLIC_SUPABASE_URL=https://xxx.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJ...

# ── PostgreSQL direct (Drizzle ORM) ─────────────────────────
DATABASE_URL=postgresql://postgres.xxx:password@aws-0-region.pooler.supabase.com:6543/postgres

# ── IA ──────────────────────────────────────────────────────
GEMINI_API_KEY=AIza...

# ── Strava OAuth ────────────────────────────────────────────
STRAVA_CLIENT_ID=000000
STRAVA_CLIENT_SECRET=xxx

# ── Divers ──────────────────────────────────────────────────
NEXT_PUBLIC_BASE_URL=http://localhost:3000   # redirections OAuth et emails
NEXT_PUBLIC_APP_VERSION=1.6.5                # affichée dans l'UI (optionnelle)
```

`drizzle.config.ts` charge `DATABASE_URL` depuis `.env.local` via `dotenv`.

---

## Scripts

```bash
npm run dev              # Serveur de développement
npm run build            # Build de production (sert aussi de type-check)
npm run start            # Serveur de production
npm run lint             # ESLint (config plate eslint-config-next)

# Base de données
npm run db:push          # Pousser le schéma Drizzle vers Supabase (flux de dev)
npm run db:generate      # Générer les migrations SQL depuis le schéma
npm run db:migrate       # Appliquer les migrations
npm run db:studio        # Drizzle Studio

# Utilitaires ponctuels
npm run db:migrate-json  # Migration initiale JSON → Supabase (usage unique)
npm run db:dedup-strava  # Supprimer les doublons Strava (basé sur stravaId)
```

Aucun *test runner* n'est configuré. La vérification passe par `npm run build` (types) + `npm run lint` + test manuel en `npm run dev`.

---

## Architecture

### Flux de données

```
Composant client  →  Server Action (src/app/actions/)  →  crud.ts  →  Drizzle  →  PostgreSQL
```

`src/lib/data/crud.ts` est **server-only** : jamais importé depuis un composant `'use client'`. Chaque fonction CRUD dérive le `userId` de la session Supabase — l'appelant ne le transmet jamais. La couche action porte l'authentification, la limitation de débit et la revalidation ; `crud.ts` porte le mapping DB.

### Server Actions

Le domaine « schedule » est découpé par responsabilité dans `src/app/actions/schedule/` (pas de barrel : import direct du sous-module).

| Fichier | Rôle |
|---|---|
| `plan-creation.ts` | Création de plan (libre ou calé sur un objectif), blocs, semaines, affûtage |
| `plan-management.ts` | Édition, décalage temporel et suppression du plan actif |
| `plan-overview.ts` | Vue d'ensemble du plan |
| `week-actions.ts` | Contexte de semaine, génération des séances d'une semaine |
| `workout-actions.ts` | CRUD séance : statut, mode, déplacement, ajout/suppression manuelle, RPE |
| `workout-ai.ts` | Séance IA : création, régénération, résumé, dérive |
| `strava-sync.ts` | Synchronisation Strava |
| `fitness-metrics.ts` | Recalcul CTL / ATL |
| `profile.ts` | Chargement initial, sauvegarde du profil et du thème |
| `_internals/` | Helpers privés : `rate-limit`, `ai-context`, `fitness-tss`, `workout-helpers`, `week-finder`, `workout-generator`, `plan-archive` |

Chaque module public porte son propre `'use server';` ; les fichiers de `_internals/` sont de simples helpers TypeScript, importables depuis plusieurs actions sans être enregistrés comme Server Actions.

Les autres actions vivent à la racine de `src/app/actions/` : `auth.ts`, `admin.ts`, `objectives.ts`, plus `constants.ts` (tunables d'entraînement) et `helpers.ts`.

### Couche IA (`src/lib/ai/`)

- `coach-api.ts` — point d'entrée Gemini unique, personas de coach, génération de plan et de séance
- `structure-session.ts` — parsing d'une description libre de séance en segments structurés
- Le prompt lourd par semaine (zones, disponibilités, taper, continuité) vit dans `actions/schedule/_internals/workout-generator.ts`
- `/api/chat` — route Node.js en streaming SSE pour le coach conversationnel

### Auth & protection des routes

Supabase Auth via `@supabase/ssr`, session en cookies HTTP-only. Trois clients dans `src/lib/supabase/` : `server.ts` (Server Components / Actions), `client.ts` (composants client), `proxy.ts` (proxy Next.js).

Le point d'entrée est **`src/proxy.ts`** (convention Next.js 16, et non `middleware.ts`) : il redirige les requêtes non authentifiées vers `/auth`, hors `/auth/*` et `/api/strava/*`.

### Structure du projet

```
src/
├── app/
│   ├── actions/               # Server Actions (schedule/, auth, admin, objectives)
│   ├── admin/                 # Tableau de bord admin
│   ├── api/
│   │   ├── chat/              # Coach IA en streaming
│   │   └── strava/            # Login + callback OAuth
│   ├── auth/                  # Connexion, mot de passe oublié / réinitialisé, callback
│   ├── checkout/              # Tunnel d'abonnement
│   ├── pricing/               # Offres publiques
│   ├── layout.tsx
│   └── page.tsx               # Seule page protégée — pilote toute la SPA
│
├── components/
│   ├── AppClientWrapper.tsx   # Routeur de vues (agenda / plan / stats / coach / profil)
│   ├── ui/                    # Design system : Button, Card, Badge, Modale
│   └── features/
│       ├── billing/           # FeatureGate, PaywallModal, SubscriptionTab
│       ├── calendar/          # Grille, vues mobiles, popovers, contexte
│       ├── chat/              # Coach IA
│       ├── plan/              # Vue et gestion du plan
│       ├── profile/           # Profil, zones, disponibilités, calibration
│       ├── stats/             # Dashboard de charge
│       ├── tutorial/          # Onboarding
│       └── workout/           # Détail, feedback, création manuelle
│
├── hooks/                     # useCalendarDays, useWeekStats
└── lib/
    ├── ai/                    # Prompts et appels Gemini
    ├── data/                  # crud.ts (server-only), type.ts, DatabaseTypes.ts
    ├── db/                    # Schéma Drizzle + migrations
    ├── stats/                 # computeTSS, computePMC, computeDeviation, classifySession
    ├── subscription/          # Contexte de plan et matrice de features
    ├── supabase/              # Clients + sauvegarde de session iOS
    ├── strava-service.ts      # OAuth Strava + synchronisation
    └── strava-mapper.ts       # Mapping activités Strava → Workout
```

### Deux systèmes de types

- **`src/lib/data/type.ts`** — types métier (`PlannedData`, `CompletedData`, `Zones`, `AvailabilitySlot`, `StravaConfig`, `DeviationMetrics`…), utilisés dans les colonnes `jsonb`
- **`src/lib/data/DatabaseTypes.ts`** — interfaces au format ligne (`Profile`, `Plan`, `Block`, `Week`, `Workout`, `Objective`) retournées par les mappers de `crud.ts`

---

## Modèle de données

Schéma défini dans `src/lib/db/schema.ts`. Hiérarchie d'entraînement : **`plans` → `blocks` → `weeks` → `workouts`**, `objectives` étant une liste plate référencée par `plans.objectivesIds`.

| Table | Description |
|---|---|
| `profiles` | Profil athlète (lié à `auth.users`), zones, disponibilités, plan, rôle, CTL/ATL, quotas IA |
| `plans` | Plans macro (`active` / `archived`) |
| `blocks` | Mésocycles (Base / Build / Peak / Race) avec CTL de départ et cible |
| `weeks` | Semaines (`Load` / `Recovery` / `Taper`) avec TSS cible et réalisé |
| `workouts` | Séances : `plannedData`, `completedData`, résumé IA, cache de dérive |
| `objectives` | Courses et événements cibles (priorité, statut) |

Toutes les tables portent un `userId` en `onDelete: 'cascade'` depuis `profiles.id`. Les données complexes sont stockées en colonnes `jsonb` typées via `$type<…>()`.

Les tunables d'entraînement (`CTL_PROGRESSION`, `TAPER_CTL_DROP_PERCENT`, `RECOVERY_WEEK_THRESHOLD`…) sont centralisés dans `src/app/actions/constants.ts`.

---

## Abonnements & quotas

| Plan | Prix | Accès |
|---|---|---|
| `free` | 0 € | Compte et profil ; 3 générations de plan et 10 générations de séance par jour |
| `dev` | 5 €/mois | Accès complet pendant la phase bêta |
| `pro` | 20 €/mois | Version finale (à venir) |

Le rôle `admin` et le plan `dev` donnent un accès complet. Les quotas IA sont appliqués par `checkAndIncrementAICallLimit()` (`actions/schedule/_internals/rate-limit.ts`) via un incrément atomique en base, avec réinitialisation quotidienne. La consommation de tokens est suivie séparément sur `profiles.tokenPerMonth`.

---

## Licence & contributions

**Tous droits réservés © 2026 [@jpthibault20](https://github.com/jpthibault20)** — voir [LICENSE](LICENSE).

Le code est publié en lecture seule, à des fins de démonstration et de transparence. Aucune licence d'utilisation, de modification ou de redistribution n'est accordée. Les dépendances tierces restent soumises à leurs licences respectives.

Ce dépôt est un projet personnel maintenu par un unique auteur : **les issues, pull requests et demandes de fonctionnalités ne sont pas acceptées** et seront fermées sans suite.
