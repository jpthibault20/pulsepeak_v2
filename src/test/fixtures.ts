/******************************************************************************
 * @file    test/fixtures.ts
 * @brief   Constructeurs d'objets de test partagés entre les suites Vitest.
 *
 * Chaque fabrique renvoie un objet minimal VALIDE au regard du type, que l'on
 * surcharge champ par champ. Objectif : qu'un test ne montre que les champs qui
 * comptent pour lui, et que l'ajout d'un champ obligatoire au domaine ne casse
 * pas les quinze fichiers de tests.
 *
 * Fichier hors runtime applicatif — jamais importé depuis `src/app` ou
 * `src/components`.
 ******************************************************************************/

import type { Block, Objective, Profile, Week, Workout } from '@/lib/data/DatabaseTypes';
import type {
    AvailabilitySlot,
    CompletedData,
    CompletedLap,
    CyclingMetrics,
    PlannedData,
    RunningMetrics,
    Zones,
} from '@/lib/data/type';

// ─── Profil ───────────────────────────────────────────────────────────────────

export function makeProfile(overrides: Partial<Profile> = {}): Profile {
    return {
        id: 'user-test',
        createdAt: '2026-01-01',
        updatedAt: '2026-01-01',
        lastLoginAt: null,
        lastName: 'Test',
        firstName: 'Athlète',
        email: 'test@example.com',
        birthDate: null,
        experience: 'Intermédiaire',
        currentCTL: 50,
        currentATL: 50,
        activeSports: { swimming: true, cycling: true, running: true },
        weeklyAvailability: {},
        coachType: 'triathlon',
        role: 'user',
        goal: '',
        objectiveDate: null,
        weaknesses: '',
        workouts: [],
        ...overrides,
    };
}

/** Zones de puissance simples et sans trou, pour tester bucketByZones/resolveZone. */
export function makeZones(overrides: Partial<Zones> = {}): Zones {
    return {
        z1: { min: 0, max: 100 },
        z2: { min: 101, max: 150 },
        z3: { min: 151, max: 200 },
        z4: { min: 201, max: 250 },
        z5: { min: 251, max: 300 },
        ...overrides,
    };
}

// ─── Données de séance ────────────────────────────────────────────────────────

export function makeCompletedData(overrides: Partial<CompletedData> = {}): CompletedData {
    return {
        actualDurationMinutes: 60,
        distanceKm: 0,
        perceivedEffort: null,
        notes: '',
        source: { type: 'manual' },
        laps: [],
        metrics: { cycling: null, running: null, swimming: null },
        ...overrides,
    };
}

export function makePlannedData(overrides: Partial<PlannedData> = {}): PlannedData {
    return {
        durationMinutes: 60,
        targetPowerWatts: null,
        targetPaceMinPerKm: null,
        targetPaceMinPer100m: null,
        targetHeartRateBPM: null,
        distanceKm: null,
        distanceMeters: null,
        plannedTSS: null,
        description: null,
        ...overrides,
    };
}

export function makeWorkout(overrides: Partial<Workout> = {}): Workout {
    return {
        id: 'workout-1',
        userId: 'user-test',
        weekId: 'week-1',
        date: '2026-03-02',
        sportType: 'cycling',
        title: 'Séance test',
        workoutType: 'endurance',
        mode: 'Outdoor',
        status: 'pending',
        plannedData: null,
        completedData: null,
        ...overrides,
    };
}

/**
 * Séance terminée avec un TSS canonique déjà posé — la forme que `getWorkoutTSS`
 * lit en priorité, donc celle qui rend un test de PMC lisible.
 */
export function makeCompletedWorkout(date: string, tss: number, overrides: Partial<Workout> = {}): Workout {
    return makeWorkout({
        id: `workout-${date}-${tss}`,
        date,
        status: 'completed',
        completedData: makeCompletedData({ calculatedTSS: tss }),
        ...overrides,
    });
}

export function makeCyclingMetrics(overrides: Partial<CyclingMetrics> = {}): CyclingMetrics {
    return {
        tss: null,
        avgPowerWatts: null,
        maxPowerWatts: null,
        normalizedPowerWatts: null,
        intensityFactor: null,
        avgCadenceRPM: null,
        maxCadenceRPM: null,
        elevationGainMeters: null,
        avgSpeedKmH: null,
        maxSpeedKmH: null,
        ...overrides,
    };
}

export function makeRunningMetrics(overrides: Partial<RunningMetrics> = {}): RunningMetrics {
    return {
        tss: null,
        intensityFactor: null,
        avgPaceMinPerKm: null,
        bestPaceMinPerKm: null,
        elevationGainMeters: null,
        avgCadenceSPM: null,
        maxCadenceSPM: null,
        avgSpeedKmH: null,
        maxSpeedKmH: null,
        strideLength: null,
        ...overrides,
    };
}

export function makeLap(overrides: Partial<CompletedLap> = {}): CompletedLap {
    return {
        index: 1,
        name: 'Lap 1',
        durationSeconds: 300,
        distanceMeters: 1000,
        ...overrides,
    };
}

// ─── Structure de plan ────────────────────────────────────────────────────────

export function makeBlock(overrides: Partial<Block> = {}): Block {
    return {
        id: 'block-1',
        planId: 'plan-1',
        userId: 'user-test',
        orderIndex: 1,
        type: 'Base',
        theme: 'Consolidation aérobie',
        weekCount: 4,
        startDate: '2026-03-02',
        weeksId: [],
        startCTL: 50,
        targetCTL: 58,
        avgWeeklyTSS: 380,
        ...overrides,
    };
}

export function makeObjective(overrides: Partial<Objective> = {}): Objective {
    return {
        id: 'objective-1',
        userId: 'user-test',
        createdAt: '2026-01-01',
        updatedAt: '2026-01-01',
        name: 'Course test',
        date: '2026-03-08',
        sport: 'running',
        priority: 'principale',
        status: 'upcoming',
        ...overrides,
    };
}

/** Créneau de disponibilité : tout à zéro = jour de repos. */
export function makeSlot(overrides: Partial<AvailabilitySlot> = {}): AvailabilitySlot {
    return {
        swimming: 0,
        cycling: 0,
        running: 0,
        comment: '',
        aiChoice: false,
        ...overrides,
    };
}

export function makeWeek(overrides: Partial<Week> = {}): Week {
    return {
        id: 'week-1',
        userId: 'user-test',
        workoutsId: [],
        blockId: 'block-1',
        weekNumber: 1,
        type: 'Load',
        targetTSS: 350,
        actualTSS: 0,
        ...overrides,
    };
}
