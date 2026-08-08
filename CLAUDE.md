# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

**PulsePeak** — AI-driven triathlon (swim/bike/run) training planner and tracker. Next.js 16 App Router + React 19 + Supabase (Postgres) + Drizzle ORM + Google Gemini + Strava OAuth. TypeScript strict. UI/comments/commits are in French — follow the existing language when editing.

## Commands

```bash
npm run dev              # dev server (localhost:3000)
npm run build            # production build
npm run lint             # ESLint (eslint-config-next flat config)

npm run db:push          # push Drizzle schema to Supabase (dev flow)
npm run db:generate      # generate SQL migrations from schema
npm run db:migrate       # apply migrations
npm run db:studio        # Drizzle Studio UI
```

No test runner is configured — there is no `test` script and no test files in the repo. Verify changes via `npm run build` (type-check) + `npm run lint` + manual testing in `npm run dev`.

`drizzle.config.ts` loads `DATABASE_URL` from `.env.local` via `dotenv`. All other env vars (`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `GEMINI_API_KEY`, `STRAVA_CLIENT_ID`/`SECRET`, `NEXT_PUBLIC_BASE_URL`) are required at runtime — see README for the full list.

## Architecture

### Data flow: client → Server Action → crud.ts → Drizzle → Postgres

**`src/lib/data/crud.ts` is server-only.** Its opening comment is explicit: never import it from a `'use client'` component. Client components must go through a Server Action in `src/app/actions/` (`schedule/`, `auth.ts`, `admin.ts`, `objectives.ts`). Every CRUD function derives `userId` from the Supabase session (`getCurrentUserId()`) — callers never pass it. The action layer enforces auth, rate limits, and revalidation; `crud.ts` owns DB mapping.

### `actions/schedule/` is split by concern

The schedule domain lives in `src/app/actions/schedule/` (no barrel — **import directly from the submodule**):

- `plan-creation.ts` — `CreateAdvancedPlan`, `CreatePlanToObjective` (+ private `CreateBlocks`, `CreateWeeks`, `applyTaperToWeeks`)
- `week-actions.ts` — `getWeekContextForDate`, `getWeekPendingCount`, `generateWeekWorkoutsFromDate` + type `WeekContext`
- `workout-actions.ts` — CRUD direct: status, toggle mode, move, unlink Strava, add/delete manual, RPE update
- `workout-ai.ts` — AI-driven: `createPlannedWorkoutAI`, `regenerateWorkout`, `getWorkoutDeviation`, `regenerateWeekFromDeviation`
- `strava-sync.ts` — `syncStravaActivities`
- `plan-overview.ts` — `getPlanOverview` + types `PlanOverviewBlock/Week/Data`
- `fitness-metrics.ts` — `recalculateFitnessMetrics` (CTL/ATL)
- `profile.ts` — `loadInitialData`, `saveAthleteProfile`, `saveThemePreference`
- `_internals/` — shared private helpers (no `'use server';`): `rate-limit`, `ai-context`, `fitness-tss`, `workout-helpers`, `week-finder`, `workout-generator` (the big `CreateWorkoutForWeek` — called from plan-creation and week-actions)

Each public submodule has its own `'use server';`. `_internals/` files are plain TS helpers (pure functions or module-local utilities) so they can be imported from multiple action files without being registered as Server Actions. **Do not add a barrel `schedule.ts`**: Turbopack (Next.js 16) rejects named re-exports like `export { X } from …` from a `'use server'` file, and adding a non-`'use server'` barrel would obscure the direct-import convention.

Two parallel type systems live in `src/lib/data/`:
- **`type.ts`** — domain types (`PlannedData`, `CompletedData`, `Zones`, `AvailabilitySlot`, `StravaConfig`, `DeviationMetrics`, `ReturnCode`, etc.), used in `jsonb` columns and across the app.
- **`DatabaseTypes.ts`** — row-shaped interfaces (`Profile`, `Plan`, `Block`, `Week`, `Workout`, `Objective`, `Schedule`) returned by `crud.ts` mappers. Drizzle `$inferSelect` rows are converted via `toWorkout`, `toProfile`, etc. before leaving the server boundary.

### Domain model (`src/lib/db/schema.ts`)

Training hierarchy: **`plans` → `blocks` (mesocycles) → `weeks` → `workouts`**. Every table carries `userId` with `onDelete: 'cascade'` from `profiles.id`. `objectives` (races/events) is a flat sibling list, referenced from `plans.objectivesIds` (jsonb string array).

`profiles.id` equals `auth.users.id` from Supabase — a DB trigger is expected to create the row on signup (see schema comment). Complex data lives in `jsonb` columns (`plannedData`, `completedData`, `heartRate`, `cycling`, `running`, `swimming`, `weeklyAvailability`, `strava`, `aiDeviationCache`) — always assert the `$type<…>()` shape when adding fields.

Fitness tracking state on `profiles`: `currentCTL` (chronic training load), `currentATL` (acute/7-day fatigue). These are recomputed on every page load of `src/app/page.tsx` via `recalculateFitnessMetrics()` — day-by-day iteration so rest days (TSS=0) naturally decay ATL.

### Auth & route protection

Supabase Auth via `@supabase/ssr` with HTTP-only cookies. Three clients live in `src/lib/supabase/`:
- `server.ts` — for Server Components / Server Actions
- `client.ts` — for `'use client'` components
- `proxy.ts` — Next.js **proxy** (new Next.js 16 naming, not "middleware")

The proxy entry point is **`src/proxy.ts`** (not `middleware.ts`) — Next.js 16 App Router convention. It redirects unauthenticated requests to `/auth` except for `/auth/*` and `/api/strava/*`. When adding a public path, update the matcher there.

### AI layer (`src/lib/ai/`)

Single Gemini endpoint (`gemini-2.5-flash`) called from `coach-api.ts`. Two generation modes:
- Full plan / block generation (called from `CreateAdvancedPlan` in `actions/schedule/plan-creation.ts`) — returns a flat list of `RawAIWorkout` that the server then groups into blocks/weeks using helpers in `actions/helpers.ts` (`computeBlockSkeletons`, `computeWeeklyTSS`, `buildTaperPlan`, etc.).
- Single workout regeneration — `generateSingleWorkoutFromAI`.

The heavy per-week prompt (zones, availabilities, taper J-x, continuity with previous week) lives in `actions/schedule/_internals/workout-generator.ts` (`CreateWorkoutForWeek`). `structure-session.ts` is a separate Gemini call that parses free-text workout descriptions into structured segments.

**Rate limiting:** `checkAndIncrementAICallLimit()` in `actions/schedule/_internals/rate-limit.ts` uses `atomicIncrementAICallCount` (DB-atomic) and per-day resets (`aiPlanCallsResetDate`, `aiWorkoutCallsResetDate` on `profiles`). Free plan = 3 plan/10 workout calls/day; pro/dev/admin = effectively unlimited. Token usage is tracked separately via `atomicIncrementTokenCount` against `tokenPerMonth`.

### Strava integration

`src/lib/strava-service.ts` owns OAuth token exchange, refresh, and activity fetching; `strava-mapper.ts` converts Strava activities to `Workout` rows. Sync dedupes on `stravaId` stored inside `workouts.completedData`. OAuth callback lives at `src/app/api/strava/callback/route.ts`.

### Constants live in `src/app/actions/constants.ts`

Training-science tunables — `CTL_PROGRESSION`, `CTL_LEVEL_MULTIPLIER`, `TAPER_CTL_DROP_PERCENT`, `RECOVERY_WEEK_THRESHOLD`, `RECOVERY_TSS_RATIO`, `RESIDUAL_EFFECTS_DAYS`. Prefer editing these over hardcoding numbers in plan-generation logic.

### UI composition

`src/app/page.tsx` is the only protected page — it fetches `profile/schedule/objectives` in parallel and hands them to `AppClientWrapper.tsx`, which drives the whole SPA (calendar / plan / chat / profile / stats tabs). Features live in `src/components/features/<domain>/`; shared primitives in `src/components/ui/` (`Button`, `Card`, `Badge`, `Modale`).

The calendar uses a React Context (`src/components/features/calendar/CalendarContext.tsx`) for cross-component state (selected date, popovers). Mobile and desktop views are separate components (`MobileCalendarList` vs. `CalendarGrid`).
