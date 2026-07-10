/******************************************************************************
 * @file    workout-actions.ts
 * @brief   Server Actions de manipulation directe des séances (hors IA) :
 *          changements de statut, toggle indoor/outdoor, déplacement,
 *          suppression, ajout manuel, édition RPE et délien d'une activité
 *          Strava d'une séance planifiée.
 *
 *          Les actions IA (régénération, analyse déviation) sont dans
 *          workout-ai.ts. La synchronisation Strava vit dans strava-sync.ts.
 ******************************************************************************/

'use server';

import { randomUUID } from 'crypto';
import { revalidatePath } from 'next/cache';
import {
    deleteWorkoutById,
    getProfile,
    getSchedule,
    insertSingleWorkout,
    saveSchedule,
    updateWorkoutById,
} from '@/lib/data/crud';
import { parseLocalDate } from '@/lib/utils';
import type { CompletedData, CompletedDataFeedback } from '@/lib/data/type';
import { Workout } from '@/lib/data/DatabaseTypes';
import {
    findWorkoutIndex,
    transformFeedbackToCompletedData,
} from './_internals/workout-helpers';
import { recalculateFitnessMetrics } from './fitness-metrics';
import { computeWorkoutTSS } from '@/lib/stats/computeTSS';


/**
 * Met à jour le statut d'un workout avec feedback optionnel.
 * Déclenche systématiquement un recalcul CTL/ATL (le statut influe sur la charge).
 */
export async function updateWorkoutStatus(
    workoutId: string,
    status: 'pending' | 'completed' | 'missed',
    feedback?: CompletedDataFeedback
): Promise<void> {
    const schedule = await getSchedule();
    const index = findWorkoutIndex(schedule.workouts, workoutId);

    if (index === -1) {
        throw new Error(`Workout non trouvé: ${workoutId}`);
    }

    const workout = schedule.workouts[index];
    const profile = (status === 'completed' && feedback) ? await getProfile() : null;
    const completedData = (status === 'completed' && feedback)
        ? transformFeedbackToCompletedData(feedback, profile)
        : null;

    // Atomic per-row update — pas de read-modify-write sur tout le schedule
    // Invalider les caches IA quand les données changent
    await updateWorkoutById(workout.id, { status, completedData, aiSummary: null, aiDeviationCache: null });

    // Recalcul CTL/ATL après tout changement de statut
    await recalculateFitnessMetrics();

    revalidatePath('/');
}


/** Alias pour clarté sémantique — marque une séance comme réalisée. */
export async function completeWorkout(
    workoutId: string,
    feedback: CompletedDataFeedback
): Promise<void> {
    return updateWorkoutStatus(workoutId, 'completed', feedback);
}


/** Alias pour clarté sémantique — marque une séance comme manquée. */
export async function markWorkoutAsMissed(workoutId: string): Promise<void> {
    return updateWorkoutStatus(workoutId, 'missed');
}


/** Alias pour clarté sémantique — repasse une séance en planifiée. */
export async function resetWorkoutToPending(workoutId: string): Promise<void> {
    return updateWorkoutStatus(workoutId, 'pending');
}


/**
 * Bascule le mode d'une séance entre Indoor et Outdoor.
 */
export async function toggleWorkoutMode(workoutId: string) {
    const schedule = await getSchedule();
    const index = findWorkoutIndex(schedule.workouts, workoutId);

    if (index !== -1) {
        const currentMode = schedule.workouts[index].mode;
        schedule.workouts[index].mode = currentMode === 'Outdoor' ? 'Indoor' : 'Outdoor';
        await saveSchedule(schedule);
        revalidatePath('/');
    }
}


/**
 * Déplace une séance à une nouvelle date.
 *
 * Cas "completed" : on ne déplace pas la séance réalisée — on crée une nouvelle
 * séance pending héritée de son plannedData à la nouvelle date, et on retire
 * le plannedData de la séance complétée (qui reste à sa date d'origine comme
 * trace historique).
 *
 * Cas "pending"/"missed" : simple mise à jour de la date.
 */
export async function moveWorkout(workoutId: string, newDateStr: string) {
    const schedule = await getSchedule();

    // 1. Trouver la source par ID
    const sourceWorkout = schedule.workouts.find(w => w.id === workoutId);
    if (!sourceWorkout) throw new Error("Séance source non trouvée.");

    if (sourceWorkout.status === 'completed') {
        // --- CAS COMPLETED : extraire le plannedData vers une nouvelle séance ---
        const newWorkout: Workout = {
            id: randomUUID(),
            userId: sourceWorkout.userId,
            weekId: sourceWorkout.weekId,
            date: newDateStr,
            sportType: sourceWorkout.sportType,
            title: sourceWorkout.title,
            workoutType: sourceWorkout.workoutType,
            mode: sourceWorkout.mode,
            status: 'pending',
            plannedData: sourceWorkout.plannedData,
            completedData: null,
        };
        // Retirer le plannedData de la séance complétée + insérer la nouvelle séance
        await Promise.all([
            updateWorkoutById(sourceWorkout.id, { plannedData: null }),
            insertSingleWorkout(newWorkout),
        ]);
    } else {
        // --- CAS PENDING / MISSED : déplacement simple ---
        // Si une séance "missed" est déplacée vers le futur (aujourd'hui ou plus
        // tard, fuseau Europe/Paris), on la réinitialise en "pending" : elle
        // redevient une séance à venir et son contenu planifié est de nouveau
        // accessible.
        const todayParis = new Date(new Date().toLocaleString('en-US', { timeZone: 'Europe/Paris' }));
        const todayStr = `${todayParis.getFullYear()}-${String(todayParis.getMonth() + 1).padStart(2, '0')}-${String(todayParis.getDate()).padStart(2, '0')}`;
        const resetMissed = sourceWorkout.status === 'missed' && newDateStr >= todayStr;
        await updateWorkoutById(sourceWorkout.id, {
            date: newDateStr,
            ...(resetMissed ? { status: 'pending' } : {}),
        });
    }

    revalidatePath('/');
}


/**
 * Délie une activité Strava (completedData) d'une séance complétée.
 *
 * Deux modes :
 * - targetWorkoutId fourni : transférer le completedData vers cette séance
 *   planifiée (matching manuel après un matching automatique incorrect).
 * - targetWorkoutId null : créer une "Sortie Libre" complétée indépendante
 *   à la même date, et remettre la séance source en pending.
 */
export async function unlinkStravaWorkout(workoutId: string, targetWorkoutId: string | null) {
    const schedule = await getSchedule();

    const sourceWorkout = schedule.workouts.find(w => w.id === workoutId);
    if (!sourceWorkout) throw new Error("Séance source non trouvée.");
    if (sourceWorkout.status !== 'completed' || !sourceWorkout.completedData) {
        throw new Error("Cette séance n'a pas de données complétées à délier.");
    }

    const completedData = sourceWorkout.completedData;

    if (targetWorkoutId) {
        // --- Transférer le completedData vers une séance planifiée ---
        const targetWorkout = schedule.workouts.find(w => w.id === targetWorkoutId);
        if (!targetWorkout) throw new Error("Séance cible non trouvée.");

        const sourceBecomesEmpty = !sourceWorkout.plannedData;
        await Promise.all([
            // Source : supprimer si vide, sinon repasser en pending
            sourceBecomesEmpty
                ? deleteWorkoutById(sourceWorkout.id)
                : updateWorkoutById(sourceWorkout.id, { status: 'pending', completedData: null }),
            // Cible : recevoir le completedData, passer en completed
            updateWorkoutById(targetWorkout.id, { status: 'completed', completedData }),
        ]);
    } else {
        // --- Créer une séance libre avec le completedData ---
        const freeWorkout: Workout = {
            id: randomUUID(),
            userId: sourceWorkout.userId,
            weekId: sourceWorkout.weekId,
            date: sourceWorkout.date,
            sportType: sourceWorkout.sportType,
            title: 'Sortie Libre',
            workoutType: 'Sortie Libre',
            mode: sourceWorkout.mode,
            status: 'completed',
            plannedData: null,
            completedData,
        };

        await Promise.all([
            // Source : retirer completedData, repasser en pending
            updateWorkoutById(sourceWorkout.id, { status: 'pending', completedData: null }),
            // Insérer la séance libre
            insertSingleWorkout(freeWorkout),
        ]);
    }

    revalidatePath('/');
}


/**
 * Ajoute une séance manuelle au schedule. Force le userId au user authentifié
 * et refuse les collisions d'ID / les dates invalides.
 */
export async function addManualWorkout(workout: Workout) {
    const profile = await getProfile();
    const schedule = await getSchedule();

    // ✅ Sécurité : forcer le userID au user authentifié
    workout.userId = profile.id;

    // ✅ Validation : vérifier que l'ID est unique
    const existingWorkout = schedule.workouts.find(w => w.id === workout.id);

    if (existingWorkout) {
        throw new Error(`Un workout avec l'ID ${workout.id} existe déjà`);
    }

    // ✅ Validation : vérifier le format de date
    const parsed = parseLocalDate(workout.date);
    if (isNaN(parsed.getTime())) {
        throw new Error(`Format de date invalide: ${workout.date}. Attendu: YYYY-MM-DD`);
    }

    // ✅ Calcul du TSS canonique si la séance est marquée complétée à la création.
    // Si l'utilisateur a saisi un TSS vélo manuel (cycling.tss), on le respecte
    // comme source 'power' ; sinon on applique la cascade unifiée.
    if (workout.status === 'completed' && workout.completedData) {
        const cd = workout.completedData;
        const userCyclingTss = cd.metrics?.cycling?.tss;
        if (workout.sportType === 'cycling' && userCyclingTss && userCyclingTss > 0) {
            cd.calculatedTSS = userCyclingTss;
            cd.tssSource = 'power';
        } else {
            const r = computeWorkoutTSS(workout.sportType, cd, profile);
            cd.calculatedTSS = r.tss;
            cd.tssSource = r.source;
            if (r.intensityFactor != null) cd.intensityFactor = r.intensityFactor;
            if (r.source === 'power' && cd.metrics.cycling) {
                cd.metrics.cycling.tss = r.tss;
                cd.metrics.cycling.intensityFactor = r.intensityFactor;
            } else if (r.source === 'pace' && workout.sportType === 'running' && cd.metrics.running) {
                cd.metrics.running.tss = r.tss;
                cd.metrics.running.intensityFactor = r.intensityFactor;
            } else if (r.source === 'pace' && workout.sportType === 'swimming' && cd.metrics.swimming) {
                cd.metrics.swimming.tss = r.tss;
                cd.metrics.swimming.intensityFactor = r.intensityFactor;
            }
        }
    }

    // ✅ Ajout du workout
    schedule.workouts.push(workout);

    await saveSchedule(schedule);
    revalidatePath('/');
}


/** Supprime une séance du schedule par ID ou par date. */
export async function deleteWorkout(workoutId: string) {
    await deleteWorkoutById(workoutId);
    revalidatePath('/');
}


/**
 * Met à jour le RPE d'une séance complétée (ex: après sync Strava sans RPE).
 * Invalide les caches IA pour recalculer avec le nouveau RPE.
 */
export async function updateWorkoutRPE(workoutId: string, rpe: number): Promise<void> {
    const schedule = await getSchedule();
    const workout = schedule.workouts.find(w => w.id === workoutId);
    if (!workout || !workout.completedData) throw new Error("Séance non trouvée ou pas complétée");

    const updatedCompletedData: CompletedData = {
        ...workout.completedData,
        perceivedEffort: rpe,
    };

    await updateWorkoutById(workoutId, {
        completedData: updatedCompletedData,
        aiSummary: null,
        aiDeviationCache: null,
    });

    revalidatePath('/');
}
