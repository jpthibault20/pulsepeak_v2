/******************************************************************************
 * @file    _internals/workout-helpers.ts
 * @brief   Helpers partagés autour de la manipulation des workouts :
 *          résolution ID/Date et conversion formulaire → CompletedData.
 * @access  Module privé — ne pas importer depuis un composant client.
 ******************************************************************************/

import { CompletedData, CompletedDataFeedback } from '@/lib/data/type';
import { Workout, Profile } from '@/lib/data/DatabaseTypes';
import { computeWorkoutTSS } from '@/lib/stats/computeTSS';


/**
 * Trouve l'index d'un workout dans un tableau par ID.
 *
 * Le matching par date a été retiré : avec plusieurs séances le même jour,
 * il renvoyait la première trouvée — pas forcément celle visée — ce qui a
 * causé des erreurs (mauvaise séance marquée "non faite", régénérée, etc.).
 *
 * @returns l'index dans le tableau, ou -1 si introuvable
 */
export function findWorkoutIndex(workouts: Workout[], workoutId: string): number {
    return workouts.findIndex(w => w.id === workoutId);
}


/**
 * Le plan free a le calendrier en lecture seule (feature 'calendar-write',
 * voir src/lib/subscription/context.tsx) — seuls pro/dev/admin peuvent
 * modifier une séance (déplacer, changer de statut, supprimer, etc.).
 */
export function hasCalendarWriteAccess(profile: Pick<Profile, 'plan' | 'role'>): boolean {
    return profile.role === 'admin' || profile.plan === 'pro' || profile.plan === 'dev';
}

/** @throws Error si l'utilisateur n'a pas les droits d'écriture sur le calendrier. */
export function assertCalendarWriteAccess(profile: Pick<Profile, 'plan' | 'role'>): void {
    if (!hasCalendarWriteAccess(profile)) {
        throw new Error('Modification du calendrier réservée au plan Pro.');
    }
}


/**
 * Transforme les données saisies par l'utilisateur dans le formulaire de
 * feedback (CompletedDataFeedback — majoritairement des strings) en objet
 * CompletedData canonique stocké en base (typé, normalisé en nombres).
 *
 * Si `profile` est fourni, le TSS est calculé via la cascade unifiée
 * (computeWorkoutTSS). Si l'utilisateur a saisi un TSS vélo manuel
 * (feedback.tss), il est respecté tel quel et marqué `source = 'power'`
 * (hypothèse : sortie de compteur de puissance).
 */
export function transformFeedbackToCompletedData(
    feedback: CompletedDataFeedback,
    profile?: Profile | null
): CompletedData {
    const sportType = feedback.sportType;

    const completed: CompletedData = {
        actualDurationMinutes: Number(feedback.actualDuration),
        distanceKm: feedback.distance ? Number(feedback.distance) : 0,
        perceivedEffort: Number(feedback.rpe),
        notes: feedback.notes || "",

        source: {
            type: 'manual',
            stravaId: null,
        },

        laps: [],

        heartRate: {
            avgBPM: feedback.avgHeartRate ? Number(feedback.avgHeartRate) : null,
            maxBPM: null,
        },

        caloriesBurned: feedback.calories ? Number(feedback.calories) : null,

        metrics: {
            cycling: sportType === 'cycling' ? {
                tss: null,             // Renseigné plus bas si source=power (saisie utilisateur ou calcul)
                avgPowerWatts: feedback.avgPower ? Number(feedback.avgPower) : null,
                maxPowerWatts: feedback.maxPower ? Number(feedback.maxPower) : null,
                normalizedPowerWatts: feedback.normalizedPower ? Number(feedback.normalizedPower) : null,
                intensityFactor: null,
                avgCadenceRPM: feedback.avgCadence ? Number(feedback.avgCadence) : null,
                maxCadenceRPM: feedback.maxCadence ? Number(feedback.maxCadence) : null,
                elevationGainMeters: feedback.elevation ? Number(feedback.elevation) : null,
                avgSpeedKmH: feedback.avgSpeed ? Number(feedback.avgSpeed) : null,
                maxSpeedKmH: feedback.maxSpeed ? Number(feedback.maxSpeed) : null,
            } : null,

            running: sportType === 'running' ? {
                tss: null,             // Renseigné plus bas si source=pace
                intensityFactor: null,
                avgPaceMinPerKm: feedback.avgPace ? feedback.avgPace : null,
                bestPaceMinPerKm: null,
                elevationGainMeters: feedback.elevation ? Number(feedback.elevation) : null,
                avgCadenceSPM: feedback.avgCadence ? Number(feedback.avgCadence) : null,
                maxCadenceSPM: feedback.maxCadence ? Number(feedback.maxCadence) : null,
                avgSpeedKmH: feedback.avgSpeed ? Number(feedback.avgSpeed) : null,
                maxSpeedKmH: feedback.maxSpeed ? Number(feedback.maxSpeed) : null
            } : null,

            swimming: sportType === 'swimming' ? {
                tss: null,             // Renseigné plus bas si source=pace
                intensityFactor: null,
                avgPace100m: null,
                bestPace100m: null,
                strokeType: feedback.strokeType ?? null,
                avgStrokeRate: feedback.avgStrokeRate ? Number(feedback.avgStrokeRate) : null,
                avgSwolf: feedback.avgSwolf ? Number(feedback.avgSwolf) : null,
                poolLengthMeters: feedback.poolLengthMeters ? Number(feedback.poolLengthMeters) : null,
                totalStrokes: feedback.totalStrokes ? Number(feedback.totalStrokes) : null
            } : null
        }
    };

    // ── TSS : saisie manuelle utilisateur (vélo) prend la priorité absolue ──
    const userTss = feedback.tss ? Number(feedback.tss) : null;
    if (userTss && userTss > 0 && sportType === 'cycling' && completed.metrics.cycling) {
        completed.calculatedTSS = userTss;
        completed.tssSource = 'power';
        completed.metrics.cycling.tss = userTss;
        if (feedback.intensityFactor) {
            completed.intensityFactor = Number(feedback.intensityFactor);
            completed.metrics.cycling.intensityFactor = Number(feedback.intensityFactor);
        }
        return completed;
    }

    // ── Sinon : cascade unifiée ──
    const tssResult = computeWorkoutTSS(sportType, completed, profile);
    completed.calculatedTSS = tssResult.tss;
    completed.tssSource = tssResult.source;
    if (tssResult.intensityFactor != null) completed.intensityFactor = tssResult.intensityFactor;

    if (tssResult.source === 'power' && completed.metrics.cycling) {
        completed.metrics.cycling.tss = tssResult.tss;
        completed.metrics.cycling.intensityFactor = tssResult.intensityFactor;
    } else if (tssResult.source === 'pace' && sportType === 'running' && completed.metrics.running) {
        completed.metrics.running.tss = tssResult.tss;
        completed.metrics.running.intensityFactor = tssResult.intensityFactor;
    } else if (tssResult.source === 'pace' && sportType === 'swimming' && completed.metrics.swimming) {
        completed.metrics.swimming.tss = tssResult.tss;
        completed.metrics.swimming.intensityFactor = tssResult.intensityFactor;
    }

    return completed;
}
