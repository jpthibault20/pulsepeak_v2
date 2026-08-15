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

npm run test             # Vitest, one-shot
npm run test:watch       # Vitest, watch mode
```

`drizzle.config.ts` loads `DATABASE_URL` from `.env.local` via `dotenv`. All other env vars (`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `GEMINI_API_KEY`, `STRAVA_CLIENT_ID`/`SECRET`, `NEXT_PUBLIC_BASE_URL`) are required at runtime — see README for the full list.

## Testing

### Tests ship with the change — always, without being asked

Any code modification (bug fix, refactor, new feature) includes its test update **in the same pass**. This is not an optional follow-up step:

1. **The touched module already has a `.test.ts`** → update it in the same edit. New behaviour gets new cases; changed behaviour gets adjusted assertions. State in the summary which existing expectations changed and why — an assertion quietly rewritten to match new output is how a regression ships unnoticed.
2. **The touched module is a pure function with no test file** → create `<module>.test.ts` next to it, covering at minimum the new/changed path plus its edge cases (empty, zero, null, out-of-range).
3. **Behaviour removed** → delete its tests too.
4. **Before reporting done** → run `npm run test`, `npm run lint` and `npm run build`, and report the real counts. Never announce green without having run it.

**Assert what the code *should* do, not what it currently does.** If a new test exposes a pre-existing bug, do not weaken the assertion to make it pass: report the bug with a proposed fix and let the user decide. (This is how the `1:60` pace-formatting bug in `computeTSS.ts` was found.)

### Scope

In scope: **pure functions** — calculations, conversions, mappers, formatters, guard clauses, date arithmetic. Out of scope: React rendering, Server Actions, `crud.ts`, and anything that calls Gemini / Supabase / Strava over the network. If a feature lands mostly in those layers, pull the decision logic into a pure helper (`_internals/`, `src/lib/stats/`) and test that helper — never mock half the app to reach a branch.

### Conventions

- **Vitest**, configured in `vitest.config.mts`: `node` environment, `@` → `src/` alias, `TZ` pinned to `Europe/Paris` (several calculations build local `Date`s, so an unpinned timezone makes the suite machine-dependent).
- Test files follow `src/**/*.test.ts`, colocated with the module under test.
- Shared object builders live in **`src/test/fixtures.ts`** (`makeProfile`, `makeWorkout`, `makeCompletedData`, `makePlannedData`, `makeZones`, `makeObjective`, `makeBlock`/`makeWeek`, `makeCyclingMetrics`/`makeRunningMetrics`, `makeLap`, `makeSlot`). Each returns a minimal valid object overridable field by field — **add new fixtures there rather than redeclaring them in a test file**, so a new mandatory domain field only has to be fixed in one place.
- Functions reading `new Date()` (`computePMC`, `computeWeeklyTSS`) are tested with `vi.useFakeTimers()` + `vi.setSystemTime()`.
- A module importing `crud.ts` is tested by mocking it: `vi.mock('@/lib/data/crud', …)` — see `strava-mapper.test.ts`.
- Test names are in French, like the rest of the codebase, and describe the rule being enforced ("retient la minute quand l'arrondi atteint 60 s"), not the function's name.

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

`coach-api.ts` owns the single Gemini endpoint (`gemini-2.5-flash`) via `callGeminiAPI` — every AI call in the app goes through it. Three prompt sites, each owning its own prompt:
- **Block / periodization structure** — `CreateBlocks` and `CreateBlocksToObjective` in `actions/schedule/plan-creation.ts`; the returned skeletons are turned into weeks with `actions/helpers.ts` (`computeBlockSkeletons`, `computeWeeklyTSS`, `buildTaperPlan`, etc.).
- **Week of workouts** — the heavy prompt (zones, availabilities, taper J-x, continuity with previous week) lives in `actions/schedule/_internals/workout-generator.ts` (`CreateWorkoutForWeek`).
- **Single workout** — `generateSingleWorkoutFromAI` in `coach-api.ts`, called from `actions/schedule/workout-ai.ts`.

`structure-session.ts` is a separate Gemini call that parses free-text workout descriptions into structured segments.

**Coach persona:** `coach-persona.ts` holds `buildCoachRoleIntro(coachType)` — the role line prepended to every prompt, driven by `profiles.coachType` (falls back to `triathlon`). It is a pure, dependency-free module so the chat prompt can use it too; the four prompt builders above plus `chat-prompt.ts` all open on it. Adding a new AI prompt means opening it with `buildCoachRoleIntro`, never with a hand-written role.

`chat-prompt.ts` builds the system prompt of the conversational coach (`/api/chat`); the route only streams. The client sends `coachType` in the `ChatContext` (`ChatView.tsx`, `ChatWidget.tsx`).

**Rate limiting:** `checkAndIncrementAICallLimit()` in `actions/schedule/_internals/rate-limit.ts` uses `atomicIncrementAICallCount` (DB-atomic) and per-day resets (`aiPlanCallsResetDate`, `aiWorkoutCallsResetDate` on `profiles`). Free plan = 3 plan/10 workout calls/day; pro/dev/admin = effectively unlimited. Token usage is tracked separately via `atomicIncrementTokenCount` against `tokenPerMonth`.

### Strava integration

`src/lib/strava-service.ts` owns OAuth token exchange, refresh, and activity fetching; `strava-mapper.ts` converts Strava activities to `Workout` rows. Sync dedupes on `stravaId` stored inside `workouts.completedData`. OAuth callback lives at `src/app/api/strava/callback/route.ts`.

### Constants live in `src/app/actions/constants.ts`

Training-science tunables — `CTL_PROGRESSION`, `CTL_LEVEL_MULTIPLIER`, `TAPER_CTL_DROP_PERCENT`, `RECOVERY_WEEK_THRESHOLD`, `RECOVERY_TSS_RATIO`, `RESIDUAL_EFFECTS_DAYS`. Prefer editing these over hardcoding numbers in plan-generation logic.

### UI composition

`src/app/page.tsx` is the only protected page — it fetches `profile/schedule/objectives` in parallel and hands them to `AppClientWrapper.tsx`, which drives the whole SPA (calendar / plan / chat / profile / stats tabs). Features live in `src/components/features/<domain>/`; shared primitives in `src/components/ui/` (`Button`, `Card`, `Badge`, `Modale`).

The calendar uses a React Context (`src/components/features/calendar/CalendarContext.tsx`) for cross-component state (selected date, popovers). Mobile and desktop views are separate components (`MobileCalendarList` vs. `CalendarGrid`).

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
