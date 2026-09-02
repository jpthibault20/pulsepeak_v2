// ATTENTION: CE FICHIER EST SERVER-ONLY.
// SES EXPORTS NE DOIVENT JAMAIS ÊTRE IMPORTÉS DANS UN COMPOSANT CLIENT ('use client').
// Utilisez une Server Action intermédiaire pour l'accès aux données.

import { db } from '@/lib/db';
import {
    profiles,
    plans as plansTable,
    blocks as blocksTable,
    weeks as weeksTable,
    workouts as workoutsTable,
    objectives as objectivesTable,
} from '@/lib/db/schema';
import { eq, and, ne, notInArray, inArray, gte, lte, sql } from 'drizzle-orm';
import { createClient } from '@/lib/supabase/server';
import { Block, Objective, Plan, Profile, Schedule, Week, Workout } from './DatabaseTypes';
import type { PlannedData, CompletedData, DeviationMetrics } from './type';

// ─── Auth helper ──────────────────────────────────────────────────────────────

async function getCurrentUserId(): Promise<string> {
    const supabase = await createClient();
    const { data: { user }, error } = await supabase.auth.getUser();
    if (error || !user) throw new Error('Utilisateur non authentifié');
    return user.id;
}

// ─── Mappers DB → TypeScript ──────────────────────────────────────────────────

function toWorkout(row: typeof workoutsTable.$inferSelect): Workout {
    return {
        id:            row.id,
        userId:        row.userId,
        weekId:        row.weekId ?? '',
        date:          row.date,
        sportType:     row.sportType,
        title:         row.title,
        workoutType:   row.workoutType ?? '',
        mode:          row.mode,
        status:        row.status,
        plannedData:   row.plannedData   as PlannedData,
        completedData: row.completedData as CompletedData | null,
        aiDeviationCache: row.aiDeviationCache as DeviationMetrics | null ?? null,
    };
}

function toProfile(row: typeof profiles.$inferSelect): Profile {
    return {
        id:                 row.id,
        createdAt:          row.createdAt instanceof Date ? row.createdAt.toISOString() : row.createdAt,
        updatedAt:          row.updatedAt instanceof Date ? row.updatedAt.toISOString() : row.updatedAt,
        lastLoginAt:        row.lastLoginAt instanceof Date ? row.lastLoginAt.toISOString() : (row.lastLoginAt ?? null),
        firstName:          row.firstName,
        lastName:           row.lastName,
        email:              row.email,
        birthDate:          row.birthDate  ?? null,
        weight:             row.weight     ?? undefined,
        height:             row.height     ?? undefined,
        experience:         row.experience ?? null,
        currentCTL:         row.currentCTL ?? 0,
        currentATL:         row.currentATL ?? 0,
        activeSports:       row.activeSports       ?? { swimming: false, cycling: false, running: false },
        weeklyAvailability: row.weeklyAvailability  ?? {},
        heartRate:          row.heartRate    ?? undefined,
        cycling:            row.cycling      ?? undefined,
        running:            row.running      ?? undefined,
        swimming:           row.swimming     ?? undefined,
        coachType:          row.coachType,
        plan:               (row.plan ?? 'free') as 'free' | 'dev' | 'pro',
        role:               (row.role ?? 'user') as 'user' | 'admin',
        strava:             row.strava       ?? undefined,
        stravaWriteBack:    row.stravaWriteBack ?? true,
        goal:               row.goal,
        objectiveDate:      row.objectiveDate ?? null,
        weaknesses:         row.weaknesses,
        aiPlanCallsCount:       row.aiPlanCallsCount  ?? 0,
        aiPlanCallsResetDate:   row.aiPlanCallsResetDate ?? undefined,
        aiWorkoutCallsCount:    row.aiWorkoutCallsCount  ?? 0,
        aiWorkoutCallsResetDate:row.aiWorkoutCallsResetDate ?? undefined,
        tokenPerMonth:          row.tokenPerMonth ?? 0,
        tokenPerMonthResetDate: row.tokenPerMonthResetDate ?? undefined,
        stripeCustomerId:       row.stripeCustomerId ?? undefined,
        stripeSubscriptionId:   row.stripeSubscriptionId ?? undefined,
        stripePriceId:          row.stripePriceId ?? undefined,
        billingStatus:          row.billingStatus ?? undefined,
        currentPeriodEnd:       row.currentPeriodEnd instanceof Date ? row.currentPeriodEnd.toISOString() : (row.currentPeriodEnd ?? null),
        cancelAtPeriodEnd:      row.cancelAtPeriodEnd ?? false,
        billingInterval:        (row.billingInterval as 'month' | 'year' | null) ?? undefined,
        trialUsedAt:            row.trialUsedAt instanceof Date ? row.trialUsedAt.toISOString() : (row.trialUsedAt ?? null),
        trialEndsAt:            row.trialEndsAt instanceof Date ? row.trialEndsAt.toISOString() : (row.trialEndsAt ?? null),
        theme:              (row.theme as 'dark' | 'light') ?? 'dark',
        workouts:           [],
    };
}

function toPlan(row: typeof plansTable.$inferSelect, blockIds: string[]): Plan {
    return {
        id:                       row.id,
        userId:                   row.userId,
        blocksId:                 blockIds,
        objectivesId:             (row.objectivesIds as string[]) ?? [],
        name:                     row.name,
        goalDate:                 row.goalDate ?? '',
        startDate:                row.startDate,
        macroStrategyDescription: row.macroStrategyDescription ?? '',
        status:                   row.status,
    };
}

function toBlock(row: typeof blocksTable.$inferSelect, weekIds: string[]): Block {
    return {
        id:           row.id,
        planId:       row.planId,
        userId:       row.userId,
        orderIndex:   row.orderIndex,
        type:         row.type,
        theme:        row.theme ?? '',
        weekCount:    row.weekCount,
        startDate:    row.startDate,
        weeksId:      weekIds,
        startCTL:     row.startCTL    ?? 0,
        targetCTL:    row.targetCTL   ?? 0,
        avgWeeklyTSS: row.avgWeeklyTSS ?? 0,
    };
}

function toWeek(row: typeof weeksTable.$inferSelect, workoutIds: string[]): Week {
    return {
        id:           row.id,
        userId:       row.userId,
        blockId:      row.blockId,
        workoutsId:   workoutIds,
        weekNumber:   row.weekNumber,
        type:         row.type,
        targetTSS:    row.targetTSS ?? 0,
        actualTSS:    row.actualTSS,
        userFeedback: row.userFeedback ?? undefined,
    };
}

// ─── GET ──────────────────────────────────────────────────────────────────────

export async function getProfile(): Promise<Profile> {
    const supabase = await createClient();
    const { data: { user }, error } = await supabase.auth.getUser();
    if (error || !user) throw new Error('Utilisateur non authentifié');

    const userId = user.id;
    const authEmail = user.email ?? '';

    const row = await db.query.profiles.findFirst({
        where: eq(profiles.id, userId),
    });

    if (!row) {
        // Nouveau compte : profil vide
        return {
            id:                 userId,
            createdAt:          new Date().toISOString(),
            updatedAt:          new Date().toISOString(),
            lastLoginAt:        null,
            firstName:          '',
            lastName:           '',
            email:              authEmail,
            birthDate:          null,
            experience:         null,
            currentCTL:         0,
            currentATL:         0,
            activeSports:       { swimming: false, cycling: false, running: false },
            weeklyAvailability: {},
            coachType:          'triathlon',
            role:               'user',
            goal:               '',
            objectiveDate:      null,
            weaknesses:         '',
            theme:              'dark',
            workouts:           [],
        };
    }

    const profile = toProfile(row);
    // L'email de Supabase Auth est la source de vérité
    profile.email = authEmail || profile.email;
    return profile;
}

export async function getSchedule(): Promise<Schedule> {
    const workoutList = await getWorkout();
    return {
        dbVersion:     '2.0',
        workouts:      workoutList ?? [],
        summary:       null,
        lastGenerated: null,
    };
}

export async function getPlan(): Promise<Plan[] | null> {
    const userId = await getCurrentUserId();

    const rows = await db.query.plans.findMany({
        where: eq(plansTable.userId, userId),
        with: {
            blocks: { columns: { id: true } },
        },
    });

    if (!rows.length) return null;

    return rows.map((r) => toPlan(r, r.blocks.map((b) => b.id)));
}

export async function getBlock(): Promise<Block[] | null> {
    const userId = await getCurrentUserId();

    const rows = await db.query.blocks.findMany({
        where: eq(blocksTable.userId, userId),
        with: {
            weeks: { columns: { id: true } },
        },
    });

    if (!rows.length) return null;

    return rows.map((r) => toBlock(r, r.weeks.map((w) => w.id)));
}

export async function getWeek(): Promise<Week[] | null> {
    const userId = await getCurrentUserId();

    const rows = await db.query.weeks.findMany({
        where: eq(weeksTable.userId, userId),
        with: {
            workouts: { columns: { id: true } },
        },
    });

    if (!rows.length) return null;

    return rows.map((r) => toWeek(r, r.workouts.map((w) => w.id)));
}

export async function getWorkout(): Promise<Workout[] | null> {
    const userId = await getCurrentUserId();

    const rows = await db.query.workouts.findMany({
        where:   eq(workoutsTable.userId, userId),
        orderBy: (w, { asc }) => [asc(w.date)],
    });

    if (!rows.length) return null;

    return rows.map(toWorkout);
}

// ─── Lectures ciblées pour la page /seance/[id] ───────────────────────────────
// Ces fonctions évitent de charger tout le schedule pour afficher une séance.
// Comme partout ici, userId vient de la session : une séance appartenant à un
// autre utilisateur est simplement introuvable (jamais un 403, on ne révèle pas
// l'existence de l'id).

export async function getWorkoutById(workoutId: string): Promise<Workout | null> {
    const userId = await getCurrentUserId();

    const row = await db.query.workouts.findFirst({
        where: and(eq(workoutsTable.id, workoutId), eq(workoutsTable.userId, userId)),
    });

    return row ? toWorkout(row) : null;
}

/** Séance voisine dans l'ordre chronologique (date, id) — le même que la vue calendrier. */
export interface WorkoutNeighbour {
    id: string;
    title: string;
    date: string;
    sportType: Workout['sportType'];
}

/**
 * Résout les séances précédente et suivante par comparaison de tuple Postgres
 * `(date, id)`, ce qui donne un ordre total stable même quand plusieurs séances
 * partagent la même date. Deux requêtes LIMIT 1 au lieu du tri de tout le plan.
 */
export async function getWorkoutNeighbours(
    workoutId: string,
): Promise<{ prev: WorkoutNeighbour | null; next: WorkoutNeighbour | null }> {
    const userId = await getCurrentUserId();

    const current = await db.query.workouts.findFirst({
        where:   and(eq(workoutsTable.id, workoutId), eq(workoutsTable.userId, userId)),
        columns: { id: true, date: true },
    });
    if (!current) return { prev: null, next: null };

    const cols = { id: true, title: true, date: true, sportType: true } as const;

    const [prevRow, nextRow] = await Promise.all([
        db.query.workouts.findFirst({
            where: and(
                eq(workoutsTable.userId, userId),
                sql`(${workoutsTable.date}, ${workoutsTable.id}) < (${current.date}::date, ${current.id}::uuid)`,
            ),
            orderBy: (w, { desc }) => [desc(w.date), desc(w.id)],
            columns: cols,
        }),
        db.query.workouts.findFirst({
            where: and(
                eq(workoutsTable.userId, userId),
                sql`(${workoutsTable.date}, ${workoutsTable.id}) > (${current.date}::date, ${current.id}::uuid)`,
            ),
            orderBy: (w, { asc }) => [asc(w.date), asc(w.id)],
            columns: cols,
        }),
    ]);

    return { prev: prevRow ?? null, next: nextRow ?? null };
}

/** Toutes les séances d'une date, triées comme la navigation (pour « Ce jour-là »). */
export async function getWorkoutsOnDate(date: string): Promise<Workout[]> {
    const userId = await getCurrentUserId();

    const rows = await db.query.workouts.findMany({
        where:   and(eq(workoutsTable.userId, userId), eq(workoutsTable.date, date)),
        orderBy: (w, { asc }) => [asc(w.date), asc(w.id)],
    });

    return rows.map(toWorkout);
}

/**
 * Candidats à la réattribution d'une activité Strava déliée.
 * Filtre repris à l'identique de l'ancienne vue détail : même date, id
 * différent, statut `pending`, ET même sport — la condition sur le sport est
 * facile à perdre en déplaçant le code, elle est ici volontaire.
 */
export async function getSameDayWorkouts(
    date: string,
    excludeId: string,
    sportType: Workout['sportType'],
): Promise<Workout[]> {
    const userId = await getCurrentUserId();

    const rows = await db.query.workouts.findMany({
        where: and(
            eq(workoutsTable.userId, userId),
            eq(workoutsTable.date, date),
            ne(workoutsTable.id, excludeId),
            eq(workoutsTable.status, 'pending'),
            eq(workoutsTable.sportType, sportType),
        ),
        orderBy: (w, { asc }) => [asc(w.id)],
    });

    return rows.map(toWorkout);
}

/** Position de la séance dans son plan — alimente le fil d'Ariane et le rail contexte. */
export interface WorkoutPlanContext {
    planName: string | null;
    planGoalDate: string | null;
    blockType: string | null;
    blockTheme: string | null;
    blockOrderIndex: number | null;
    blockWeekCount: number | null;
    weekNumber: number | null;
    weekType: string | null;
    weekTargetTSS: number | null;
    weekActualTSS: number | null;
}

export async function getWorkoutPlanContext(workoutId: string): Promise<WorkoutPlanContext | null> {
    const userId = await getCurrentUserId();

    const rows = await db
        .select({
            planName:        plansTable.name,
            planGoalDate:    plansTable.goalDate,
            blockType:       blocksTable.type,
            blockTheme:      blocksTable.theme,
            blockOrderIndex: blocksTable.orderIndex,
            blockWeekCount:  blocksTable.weekCount,
            weekNumber:      weeksTable.weekNumber,
            weekType:        weeksTable.type,
            weekTargetTSS:   weeksTable.targetTSS,
            weekActualTSS:   weeksTable.actualTSS,
        })
        .from(workoutsTable)
        .innerJoin(weeksTable, eq(workoutsTable.weekId, weeksTable.id))
        .innerJoin(blocksTable, eq(weeksTable.blockId, blocksTable.id))
        .innerJoin(plansTable, eq(blocksTable.planId, plansTable.id))
        .where(and(eq(workoutsTable.id, workoutId), eq(workoutsTable.userId, userId)))
        .limit(1);

    return rows[0] ?? null;
}

// ─── SAVE ─────────────────────────────────────────────────────────────────────

export async function saveProfile(profile: Profile): Promise<void> {
    const userId = await getCurrentUserId();

    await db
        .insert(profiles)
        .values({
            id:                 userId,
            createdAt:          new Date(),
            updatedAt:          new Date(),
            firstName:          profile.firstName          ?? '',
            lastName:           profile.lastName           ?? '',
            email:              profile.email              ?? '',
            birthDate:          profile.birthDate || null,
            weight:             profile.weight             ?? null,
            height:             profile.height             ?? null,
            experience:         (profile.experience as 'Débutant' | 'Intermédiaire' | 'Avancé') ?? null,
            currentCTL:         profile.currentCTL         ?? 0,
            currentATL:         profile.currentATL         ?? 0,
            activeSports:       profile.activeSports       ?? null,
            weeklyAvailability: profile.weeklyAvailability ?? null,
            heartRate:          profile.heartRate ? { max: profile.heartRate.max ?? null, resting: profile.heartRate.resting ?? null, zones: profile.heartRate.zones } : null,
            cycling:            profile.cycling            ?? null,
            running:            profile.running            ?? null,
            swimming:           profile.swimming           ?? null,
            coachType:          profile.coachType          ?? 'triathlon',
            plan:               profile.plan               ?? 'free',
            strava:             profile.strava             ?? null,
            stravaWriteBack:    profile.stravaWriteBack    ?? true,
            goal:               profile.goal               ?? '',
            objectiveDate:      profile.objectiveDate || null,
            weaknesses:         profile.weaknesses         ?? '',
            aiPlanCallsCount:       profile.aiPlanCallsCount       ?? 0,
            aiPlanCallsResetDate:   profile.aiPlanCallsResetDate   ?? null,
            aiWorkoutCallsCount:    profile.aiWorkoutCallsCount    ?? 0,
            aiWorkoutCallsResetDate:profile.aiWorkoutCallsResetDate ?? null,
            theme:                  profile.theme ?? 'light',
        })
        .onConflictDoUpdate({
            target: profiles.id,
            set: {
                updatedAt:          new Date(),
                firstName:          profile.firstName          ?? '',
                lastName:           profile.lastName           ?? '',
                email:              profile.email              ?? '',
                birthDate:          profile.birthDate || null,
                weight:             profile.weight             ?? null,
                height:             profile.height             ?? null,
                experience:         (profile.experience as 'Débutant' | 'Intermédiaire' | 'Avancé') ?? null,
                currentCTL:         profile.currentCTL         ?? 0,
                currentATL:         profile.currentATL         ?? 0,
                activeSports:       profile.activeSports       ?? null,
                weeklyAvailability: profile.weeklyAvailability ?? null,
                heartRate:          profile.heartRate ? { max: profile.heartRate.max ?? null, resting: profile.heartRate.resting ?? null, zones: profile.heartRate.zones } : null,
                cycling:            profile.cycling            ?? null,
                running:            profile.running            ?? null,
                swimming:           profile.swimming           ?? null,
                coachType:          profile.coachType          ?? 'triathlon',
                strava:             profile.strava             ?? null,
                stravaWriteBack:    profile.stravaWriteBack    ?? true,
                goal:               profile.goal               ?? '',
                objectiveDate:      profile.objectiveDate || null,
                weaknesses:         profile.weaknesses         ?? '',
                aiPlanCallsCount:       profile.aiPlanCallsCount       ?? 0,
                aiPlanCallsResetDate:   profile.aiPlanCallsResetDate   ?? null,
                aiWorkoutCallsCount:    profile.aiWorkoutCallsCount    ?? 0,
                aiWorkoutCallsResetDate:profile.aiWorkoutCallsResetDate ?? null,
            },
        });
}

export async function saveSchedule(schedule: Schedule): Promise<void> {
    await saveWorkout(schedule.workouts);
}

export async function savePlan(plans: Plan[]): Promise<void> {
    const userId = await getCurrentUserId();

    await db.transaction(async (tx) => {
        for (const p of plans) {
            await tx
                .insert(plansTable)
                .values({
                    id:                       p.id,
                    userId,
                    name:                     p.name,
                    startDate:                p.startDate,
                    goalDate:                 p.goalDate || null,
                    macroStrategyDescription: p.macroStrategyDescription ?? null,
                    status:                   (p.status as 'active' | 'archived') ?? 'active',
                    objectivesIds:            p.objectivesId ?? [],
                })
                .onConflictDoUpdate({
                    target: plansTable.id,
                    set: {
                        name:                     p.name,
                        startDate:                p.startDate,
                        goalDate:                 p.goalDate || null,
                        macroStrategyDescription: p.macroStrategyDescription ?? null,
                        status:                   (p.status as 'active' | 'archived') ?? 'active',
                        objectivesIds:            p.objectivesId ?? [],
                    },
                });
        }

        const ids = plans.map((p) => p.id);
        if (ids.length > 0) {
            await tx.delete(plansTable).where(and(eq(plansTable.userId, userId), notInArray(plansTable.id, ids)));
        }
    });
}

export async function saveBlocks(blocks: Block[]): Promise<void> {
    const userId = await getCurrentUserId();

    await db.transaction(async (tx) => {
        for (const b of blocks) {
            await tx
                .insert(blocksTable)
                .values({
                    id:           b.id,
                    planId:       b.planId,
                    userId,
                    orderIndex:   b.orderIndex,
                    type:         b.type,
                    theme:        b.theme ?? null,
                    weekCount:    b.weekCount,
                    startDate:    b.startDate,
                    startCTL:     b.startCTL  ?? null,
                    targetCTL:    b.targetCTL ?? null,
                    avgWeeklyTSS: b.avgWeeklyTSS ?? null,
                })
                .onConflictDoUpdate({
                    target: blocksTable.id,
                    set: {
                        orderIndex:   b.orderIndex,
                        type:         b.type,
                        theme:        b.theme ?? null,
                        weekCount:    b.weekCount,
                        startDate:    b.startDate,
                        startCTL:     b.startCTL  ?? null,
                        targetCTL:    b.targetCTL ?? null,
                        avgWeeklyTSS: b.avgWeeklyTSS ?? null,
                    },
                });
        }

        const ids = blocks.map((b) => b.id);
        if (ids.length > 0) {
            await tx.delete(blocksTable).where(and(eq(blocksTable.userId, userId), notInArray(blocksTable.id, ids)));
        }
    });
}

export async function saveWeek(weeks: Week[]): Promise<void> {
    const userId = await getCurrentUserId();

    await db.transaction(async (tx) => {
        for (const w of weeks) {
            await tx
                .insert(weeksTable)
                .values({
                    id:           w.id,
                    blockId:      w.blockId,
                    userId,
                    weekNumber:   w.weekNumber,
                    type:         w.type,
                    targetTSS:    w.targetTSS ?? null,
                    actualTSS:    w.actualTSS ?? 0,
                    userFeedback: w.userFeedback ?? null,
                })
                .onConflictDoUpdate({
                    target: weeksTable.id,
                    set: {
                        weekNumber:   w.weekNumber,
                        type:         w.type,
                        targetTSS:    w.targetTSS ?? null,
                        actualTSS:    w.actualTSS ?? 0,
                        userFeedback: w.userFeedback ?? null,
                    },
                });
        }

        const ids = weeks.map((w) => w.id);
        if (ids.length > 0) {
            await tx.delete(weeksTable).where(and(eq(weeksTable.userId, userId), notInArray(weeksTable.id, ids)));
        }
    });
}

export async function saveWorkout(workoutList: Workout[], planStartDate?: string): Promise<void> {
    const userId = await getCurrentUserId();

    await db.transaction(async (tx) => {
        for (const w of workoutList) {
            await tx
                .insert(workoutsTable)
                .values({
                    id:            w.id,
                    userId,
                    weekId:        w.weekId || null,
                    date:          w.date,
                    sportType:     w.sportType,
                    title:         w.title         ?? '',
                    workoutType:   w.workoutType   ?? null,
                    mode:          (w.mode as 'Outdoor' | 'Indoor') ?? 'Outdoor',
                    status:        (w.status as 'pending' | 'completed' | 'missed') ?? 'pending',
                    plannedData:   w.plannedData   ?? null,
                    completedData: w.completedData ?? null,
                })
                .onConflictDoUpdate({
                    target: workoutsTable.id,
                    set: {
                        updatedAt:     new Date(),
                        weekId:        w.weekId || null,
                        date:          w.date,
                        sportType:     w.sportType,
                        title:         w.title         ?? '',
                        workoutType:   w.workoutType   ?? null,
                        mode:          (w.mode as 'Outdoor' | 'Indoor') ?? 'Outdoor',
                        status:        (w.status as 'pending' | 'completed' | 'missed') ?? 'pending',
                        plannedData:   w.plannedData   ?? null,
                        completedData: w.completedData ?? null,
                    },
                });
        }

        const ids = workoutList.map((w) => w.id);
        const now = new Date();
        const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
        // Utiliser la date de début du plan si fournie, sinon aujourd'hui
        const deleteFromDate = planStartDate ?? todayStr;
        if (ids.length > 0) {
            await tx.delete(workoutsTable).where(
                and(
                    eq(workoutsTable.userId, userId),
                    notInArray(workoutsTable.id, ids),
                    gte(workoutsTable.date, deleteFromDate),
                    ne(workoutsTable.status, 'completed'),
                )
            );
        }
    });
}

/**
 * Upsert groupé d'un sous-ensemble de workouts, en UN seul INSERT multi-lignes.
 *
 * Contrairement à `saveWorkout`, ne réécrit PAS tout l'historique et ne supprime
 * aucun orphelin : on ne touche qu'aux lignes fournies. À utiliser quand seules
 * quelques séances changent (ex. sync Strava) pour éviter le coût O(N) de la
 * réécriture complète.
 */
export async function saveWorkoutsBatch(workoutList: Workout[]): Promise<void> {
    if (workoutList.length === 0) return;
    const userId = await getCurrentUserId();

    await db
        .insert(workoutsTable)
        .values(workoutList.map((w) => ({
            id:            w.id,
            userId,
            weekId:        w.weekId || null,
            date:          w.date,
            sportType:     w.sportType,
            title:         w.title         ?? '',
            workoutType:   w.workoutType   ?? null,
            mode:          (w.mode as 'Outdoor' | 'Indoor') ?? 'Outdoor',
            status:        (w.status as 'pending' | 'completed' | 'missed') ?? 'pending',
            plannedData:   w.plannedData   ?? null,
            completedData: w.completedData ?? null,
        })))
        .onConflictDoUpdate({
            target: workoutsTable.id,
            set: {
                updatedAt:     new Date(),
                weekId:        sql`excluded.week_id`,
                date:          sql`excluded.date`,
                sportType:     sql`excluded.sport_type`,
                title:         sql`excluded.title`,
                workoutType:   sql`excluded.workout_type`,
                mode:          sql`excluded.mode`,
                status:        sql`excluded.status`,
                plannedData:   sql`excluded.planned_data`,
                completedData: sql`excluded.completed_data`,
            },
        });
}

export async function deleteWorkoutById(workoutId: string): Promise<void> {
    const userId = await getCurrentUserId();
    await db.delete(workoutsTable).where(
        and(
            eq(workoutsTable.userId, userId),
            eq(workoutsTable.id, workoutId)
        )
    );
}

/**
 * Supprime un plan par ID (scopé à l'utilisateur authentifié).
 * Les blocs → semaines → séances liés sont supprimés en cascade au niveau DB
 * (FK `onDelete: 'cascade'`).
 */
export async function deletePlanById(planId: string): Promise<void> {
    const userId = await getCurrentUserId();
    await db.delete(plansTable).where(
        and(
            eq(plansTable.userId, userId),
            eq(plansTable.id, planId)
        )
    );
}

/**
 * Supprime plusieurs séances en un seul DELETE. À utiliser quand on remplace
 * un lot de séances (ex. régénération d'une semaine) pour éviter le coût O(N)
 * de la réécriture complète via `saveWorkout`.
 */
export async function deleteWorkoutsByIds(workoutIds: string[]): Promise<void> {
    if (workoutIds.length === 0) return;
    const userId = await getCurrentUserId();
    await db.delete(workoutsTable).where(
        and(
            eq(workoutsTable.userId, userId),
            inArray(workoutsTable.id, workoutIds),
        )
    );
}

// ─── Atomic operations ───────────────────────────────────────────────────────

export async function atomicIncrementAICallCount(
    type: 'plan' | 'workout',
    periodValue: string,
    limit: number,
    period: 'day' | 'month' = 'day',
): Promise<void> {
    const userId = await getCurrentUserId();

    const countCol  = type === 'plan' ? profiles.aiPlanCallsCount       : profiles.aiWorkoutCallsCount;
    const dateCol   = type === 'plan' ? profiles.aiPlanCallsResetDate   : profiles.aiWorkoutCallsResetDate;
    const countKey  = type === 'plan' ? 'aiPlanCallsCount'              : 'aiWorkoutCallsCount';
    const dateKey   = type === 'plan' ? 'aiPlanCallsResetDate'          : 'aiWorkoutCallsResetDate';

    // Reset if new period (jour ou 1er du mois selon `period`), puis vérifie la limite, puis incrémente — tout en une seule UPDATE atomique
    const result = await db
        .update(profiles)
        .set({
            [countKey]: sql`CASE WHEN ${dateCol} = ${periodValue} THEN ${countCol} + 1 ELSE 1 END`,
            [dateKey]:  periodValue,
        })
        .where(and(
            eq(profiles.id, userId),
            // Only update if count is under the limit (or it's a new period)
            sql`(${dateCol} != ${periodValue} OR ${countCol} < ${limit})`,
        ))
        .returning({ id: profiles.id });

    if (result.length === 0) {
        const periodLabel = period === 'month' ? 'mensuelle' : 'journalière';
        const retryLabel  = period === 'month' ? 'le mois prochain' : 'demain';
        throw new Error(
            `Limite ${periodLabel} atteinte (${limit} ${type === 'plan' ? 'plans' : 'régénérations'}/${period === 'month' ? 'mois' : 'jour'}). Réessaie ${retryLabel}.`
        );
    }
}

export async function atomicIncrementTokenCount(tokens: number): Promise<void> {
    if (tokens <= 0) return;
    const userId = await getCurrentUserId();
    const now = new Date();
    const monthStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;

    await db
        .update(profiles)
        .set({
            tokenPerMonth: sql`CASE WHEN ${profiles.tokenPerMonthResetDate} = ${monthStr} THEN ${profiles.tokenPerMonth} + ${tokens} ELSE ${tokens} END`,
            tokenPerMonthResetDate: monthStr,
        })
        .where(eq(profiles.id, userId));
}

export async function updateWorkoutById(
    workoutId: string,
    data: Partial<Pick<Workout, 'date' | 'status' | 'completedData' | 'title' | 'sportType' | 'weekId' | 'plannedData' | 'workoutType' | 'mode' | 'aiDeviationCache'>>,
): Promise<void> {
    const userId = await getCurrentUserId();
    await db
        .update(workoutsTable)
        .set({
            ...data,
            updatedAt: new Date(),
        })
        .where(and(
            eq(workoutsTable.id, workoutId),
            eq(workoutsTable.userId, userId),
        ));
}

export async function insertSingleWorkout(w: Workout): Promise<void> {
    const userId = await getCurrentUserId();
    await db.insert(workoutsTable).values({
        id:            w.id,
        userId,
        weekId:        w.weekId || null,
        date:          w.date,
        sportType:     w.sportType,
        title:         w.title         ?? '',
        workoutType:   w.workoutType   ?? null,
        mode:          (w.mode as 'Outdoor' | 'Indoor') ?? 'Outdoor',
        status:        (w.status as 'pending' | 'completed' | 'missed') ?? 'pending',
        plannedData:   w.plannedData   ?? null,
        completedData: w.completedData ?? null,
    });
}

// ─── Objectives ───────────────────────────────────────────────────────────────

function toObjective(row: typeof objectivesTable.$inferSelect): Objective {
    return {
        id:             row.id,
        userId:         row.userId,
        createdAt:      row.createdAt instanceof Date ? row.createdAt.toISOString() : row.createdAt,
        updatedAt:      row.updatedAt instanceof Date ? row.updatedAt.toISOString() : row.updatedAt,
        name:           row.name,
        date:           row.date,
        sport:          row.sport as Objective['sport'],
        distanceKm:     row.distanceKm     ?? undefined,
        elevationGainM: row.elevationGainM ?? undefined,
        priority:       row.priority,
        status:         row.status,
        comment:        row.comment        ?? undefined,
    };
}

export async function getObjectives(): Promise<Objective[]> {
    const userId = await getCurrentUserId();

    // Best-effort : marquer automatiquement les objectifs passés comme 'passed'.
    // Si la migration 0004 n'a pas été appliquée (enum sans 'passed'), on avale
    // l'erreur pour ne pas casser la lecture des objectifs.
    try {
        const now = new Date();
        const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
        await db.update(objectivesTable)
            .set({ status: 'passed', updatedAt: now })
            .where(
                and(
                    eq(objectivesTable.userId, userId),
                    eq(objectivesTable.status, 'upcoming'),
                    lte(objectivesTable.date, todayStr),
                )
            );
    } catch (err) {
        console.error('[getObjectives] auto-mark passed failed (migration 0004 appliquée ?):', err);
    }

    const rows = await db.query.objectives.findMany({
        where: eq(objectivesTable.userId, userId),
        orderBy: (o, { asc }) => [asc(o.date)],
    });
    return rows.map(toObjective);
}

export async function saveObjective(obj: Objective): Promise<void> {
    const userId = await getCurrentUserId();
    await db
        .insert(objectivesTable)
        .values({
            id:             obj.id,
            userId,
            name:           obj.name,
            date:           obj.date,
            sport:          obj.sport,
            distanceKm:     obj.distanceKm     ?? null,
            elevationGainM: obj.elevationGainM ?? null,
            priority:       obj.priority,
            status:         obj.status,
            comment:        obj.comment        ?? null,
        })
        .onConflictDoUpdate({
            target: objectivesTable.id,
            set: {
                updatedAt:      new Date(),
                name:           obj.name,
                date:           obj.date,
                sport:          obj.sport,
                distanceKm:     obj.distanceKm     ?? null,
                elevationGainM: obj.elevationGainM ?? null,
                priority:       obj.priority,
                status:         obj.status,
                comment:        obj.comment        ?? null,
            },
        });
}

export async function deleteObjective(id: string): Promise<void> {
    const userId = await getCurrentUserId();
    await db.delete(objectivesTable).where(
        and(eq(objectivesTable.id, id), eq(objectivesTable.userId, userId))
    );
}

// ─── Theme ───────────────────────────────────────────────────────────────────

export async function saveTheme(theme: 'dark' | 'light'): Promise<void> {
    const userId = await getCurrentUserId();
    await db
        .update(profiles)
        .set({ theme, updatedAt: new Date() })
        .where(eq(profiles.id, userId));
}