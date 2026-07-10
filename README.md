# PulsePeak

Application web de planification et suivi d'entraînement **triathlon** (natation · cyclisme · course à pied), pilotée par l'IA.
"test jira"
---

## Stack technique

| Couche | Technologie |
|---|---|
| Framework | Next.js 16 (App Router, Server Components, Server Actions) |
| UI | React 19 + Tailwind CSS v4 + Lucide React |
| Base de données | Supabase (PostgreSQL) |
| ORM | Drizzle ORM |
| Auth | Supabase Auth (`@supabase/ssr`) |
| IA | Google Gemini API (`gemini-2.5-flash`) |
| Intégration sport | Strava API (OAuth 2.0) |
| Langage | TypeScript strict |

---

## Fonctionnalités

**Planification IA**
- Génération de plans d'entraînement complets (blocs → semaines → séances) via Gemini
- Adaptation du prochain bloc selon la conformité et le RPE déclarés
- Double variante Outdoor / Indoor par séance

**Calendrier interactif**
- Vue semaine/mois avec résumé de charge hebdomadaire
- Marquage séance : À faire / Faite / Ratée
- Saisie du feedback post-séance (RPE, durée réelle, distance)
- Ajout manuel d'une sortie libre

**Intégration Strava**
- Connexion OAuth 2.0 et synchronisation des activités
- Dédoublonnage automatique par `stravaId`

**Profil athlète**
- Zones FC et de puissance par sport
- Disponibilités hebdomadaires (contraintes respectées par l'IA)
- Calculateur FTP / Critical Power

**Statistiques**
- TSS, CTL, ATL, charge hebdomadaire par sport
- Comparatif Planifié vs Réalisé

**Authentification**
- Inscription / connexion email + mot de passe
- Réinitialisation du mot de passe par email
- Changement de mot de passe en profil
- Déconnexion

---

## Installation

```bash
# 1. Cloner le projet
git clone https://github.com/ton-compte/pulsepeak2025.git
cd pulsepeak2025

# 2. Installer les dépendances
npm install

# 3. Configurer les variables d'environnement
cp .env.example .env.local
# Remplir les valeurs dans .env.local

# 4. Pousser le schéma de base de données
npm run db:push

# 5. Lancer en développement
npm run dev
```

---

## Variables d'environnement

```env
# Supabase
NEXT_PUBLIC_SUPABASE_URL=https://xxx.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJ...

# PostgreSQL direct (Drizzle ORM)
DATABASE_URL=postgresql://postgres.xxx:password@aws-0-region.pooler.supabase.com:6543/postgres

# IA
GEMINI_API_KEY=AIza...

# Strava OAuth
STRAVA_CLIENT_ID=000000
STRAVA_CLIENT_SECRET=xxx

# URL de base (redirections OAuth et email)
NEXT_PUBLIC_BASE_URL=http://localhost:3000
```

---

## Scripts

```bash
npm run dev              # Serveur de développement
npm run build            # Build de production
npm run lint             # ESLint

# Base de données
npm run db:push          # Pousser le schéma Drizzle vers Supabase
npm run db:generate      # Générer les fichiers de migration
npm run db:migrate       # Appliquer les migrations
npm run db:studio        # Interface visuelle Drizzle Studio

# Utilitaires
npm run db:migrate-json  # Migration initiale JSON → Supabase (usage unique)
npm run db:dedup-strava  # Supprimer les doublons Strava (basé sur stravaId)
```

---

## Structure du projet

```
src/
├── app/
│   ├── auth/                  # Pages : login/register, forgot-password, reset-password
│   ├── auth/callback/         # Échange de code Supabase (OAuth, reset password)
│   ├── api/strava/            # Route API OAuth Strava
│   ├── actions/               # Server Actions : schedule, auth, profile
│   ├── layout.tsx
│   └── page.tsx               # Page principale (calendrier)
│
├── components/
│   ├── ui/                    # Design system : Button, Card, Modal…
│   └── features/
│       ├── calendar/          # CalendarView, CalendarGrid, WeekSummaryCell
│       ├── profile/           # ProfileForm, Availability, AccountSettings
│       ├── stats/             # Dashboard de charge
│       └── workout/           # ManualWorkoutModal, WorkoutCard
│
└── lib/
    ├── ai/                    # Prompts et appels Gemini
    ├── data/                  # Types TypeScript (DatabaseTypes, type.ts), crud.ts
    ├── db/                    # Schéma Drizzle (schema.ts) + migrations
    ├── supabase/              # Clients Supabase (client.ts, server.ts)
    ├── strava-service.ts      # OAuth Strava + synchronisation
    └── strava-mapper.ts       # Mapping activités Strava → Workout
```

---

## Base de données

Schéma défini dans `src/lib/db/schema.ts` — 5 tables PostgreSQL :

| Table | Description |
|---|---|
| `profiles` | Profil athlète, lié à `auth.users` de Supabase |
| `plans` | Plans d'entraînement macro |
| `blocks` | Blocs de périodisation (charge, récupération, compétition…) |
| `weeks` | Semaines d'entraînement avec TSS cible/réalisé |
| `workouts` | Séances individuelles (données planifiées + réalisées en `jsonb`) |

Les données complexes (`plannedData`, `completedData`, zones FC, metrics sport) sont stockées en colonnes `jsonb`.

---

## Auth

Supabase Auth avec `@supabase/ssr` — session gérée côté serveur via cookies HTTP-only.
Protection des routes via `src/proxy.ts` (convention Next.js 16).
