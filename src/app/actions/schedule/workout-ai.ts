/******************************************************************************
 * @file    workout-ai.ts
 * @brief   Server Actions IA autour d'une séance unique :
 *          - création d'une séance planifiée via Gemini
 *          - régénération d'une séance existante
 *          - métriques de déviation planifié vs réalisé (cache DB)
 *          - régénération adaptative du reste de la semaine après déviation
 *
 *          Toutes ces actions passent par le quota d'appels IA
 *          (checkAndIncrementAICallLimit) et comptent les tokens consommés.
 ******************************************************************************/

'use server';

import { randomUUID } from 'crypto';
import { revalidatePath } from 'next/cache';
import {
    endOfISOWeek,
    startOfISOWeek,
} from 'date-fns';
import { parseLocalDate } from '@/lib/utils';
import {
    atomicIncrementTokenCount,
    getProfile,
    getSchedule,
    getWorkout,
    insertSingleWorkout,
    saveSchedule,
    updateWorkoutById,
} from '@/lib/data/crud';
import type { SportType } from '@/lib/data/type';
import { Workout } from '@/lib/data/DatabaseTypes';
import { generateSingleWorkoutFromAI } from '@/lib/ai/coach-api';
import { checkAndIncrementAICallLimit } from './_internals/rate-limit';
import { findWorkoutIndex } from './_internals/workout-helpers';
import {
    getRecentPerformanceHistory,
    getSurroundingWorkouts,
} from './_internals/ai-context';


/**
 * Création d'une séance planifiée via l'IA.
 * L'IA reçoit l'historique récent et les séances voisines pour cohérence.
 * La durée demandée par l'utilisateur est la cible que la structure générée doit
 * atteindre (±5 %) ; la durée finale de la séance en est déduite.
 */
export async function createPlannedWorkoutAI(
    dateStr: string,
    sportType: SportType,
    durationMinutes: number,
    comment: string,
) {
    await checkAndIncrementAICallLimit('workout');

    const existingSchedule = await getSchedule();
    const existingProfile = await getProfile();
    if (!existingProfile) throw new Error("Profil manquant");

    const history = getRecentPerformanceHistory(existingSchedule);
    const surroundingWorkouts = getSurroundingWorkouts(existingSchedule, dateStr);

    const instruction = [
        `Sport: ${sportType}`,
        `Durée cible: ${durationMinutes} min`,
        comment ? `Thème: ${comment}` : '',
    ].filter(Boolean).join('. ');

    try {
        const { workout: newWorkoutData, tokensUsed: tkCreate } = await generateSingleWorkoutFromAI(
            existingProfile,
            history,
            dateStr,
            sportType,
            surroundingWorkouts,
            undefined,
            "General Fitness",
            instruction,
            durationMinutes,
        );
        if (tkCreate > 0) await atomicIncrementTokenCount(tkCreate);

        const workout: Workout = {
            ...newWorkoutData,
            id: randomUUID(),
            userId: existingProfile.id,
            weekId: '',
            date: dateStr,
            sportType,
            status: 'pending',
            completedData: null,
        };

        // La durée demandée est passée EN AMONT à l'IA (cible de la structure) et
        // la durée finale est déduite des blocs générés. L'écraser ici la
        // désaccorderait du contenu réel de la séance : une structure de 16 min
        // étiquetée 60 min, c'est le bug que ce chemin produisait.

        await insertSingleWorkout(workout);
        revalidatePath('/');
    // Le cache de /seance/[id] est distinct : sans ça, un retour arrière
    // après modification réafficherait des données périmées.
    revalidatePath('/seance/[id]', 'page');
    } catch (error) {
        console.error("Échec création séance IA:", error);
        throw new Error("L'IA n'a pas pu créer la séance.");
    }
}


/**
 * Régénère une séance existante via l'IA, en conservant les clés relationnelles
 * (id, userId, weekId) et la date d'origine.
 */
export async function regenerateWorkout(workoutId: string, instruction?: string) {

    await checkAndIncrementAICallLimit('workout');

    const existingSchedule = await getSchedule();
    const existingProfile = await getProfile();

    if (!existingProfile) throw new Error("Profil manquant");

    // Trouver la séance cible
    const targetIndex = findWorkoutIndex(existingSchedule.workouts, workoutId);
    if (targetIndex === -1) throw new Error("Séance introuvable");

    const oldWorkout = existingSchedule.workouts[targetIndex];
    const dateKey = oldWorkout.date; // La date est nécessaire pour l'IA

    const history = getRecentPerformanceHistory(existingSchedule);
    const surroundingWorkouts = getSurroundingWorkouts(existingSchedule, dateKey);
    const blockFocus = "General Fitness"; // TODO: Stocker le focus actuel dans le Schedule si nécessaire

    try {
        const { workout: newWorkoutData, tokensUsed: tkRegen } = await generateSingleWorkoutFromAI(
            existingProfile,
            history,
            dateKey,
            oldWorkout.sportType,
            surroundingWorkouts,
            oldWorkout,
            blockFocus,
            instruction,
            oldWorkout.plannedData?.durationMinutes,
        );
        if (tkRegen > 0) await atomicIncrementTokenCount(tkRegen);

        // Remplacement dans le tableau en préservant les clés relationnelles
        existingSchedule.workouts[targetIndex] = {
            ...newWorkoutData,
            id: oldWorkout.id,
            userId: oldWorkout.userId,
            weekId: oldWorkout.weekId,
            date: dateKey,
            status: 'pending',
            completedData: null,
        };

        await saveSchedule(existingSchedule);
        revalidatePath('/');
    // Le cache de /seance/[id] est distinct : sans ça, un retour arrière
    // après modification réafficherait des données périmées.
    revalidatePath('/seance/[id]', 'page');

    } catch (error) {
        console.error("Échec régénération:", error);
        throw new Error("L'IA n'a pas pu créer la séance.");
    }
}


/**
 * Calcule les métriques de déviation planifié vs réalisé pour une séance.
 * Résultat mis en cache en DB.
 */
export async function getWorkoutDeviation(workout: Workout) {
    // Cache hit → retourner directement
    if (workout.aiDeviationCache) return workout.aiDeviationCache;

    const { computeDeviationMetrics } = await import('@/lib/stats/computeDeviation');
    const profile = await getProfile();
    if (!profile || !workout.completedData) return null;

    const deviation = computeDeviationMetrics(workout, profile);
    // Persister en DB
    if (deviation) {
        await updateWorkoutById(workout.id, { aiDeviationCache: deviation });
    }
    return deviation;
}


/**
 * Régénère le reste de la semaine suite à une déviation détectée.
 * adaptationLevel: 'conservative' | 'recommended' | 'ambitious'
 */
export async function regenerateWeekFromDeviation(
    workoutId: string,
    adaptationLevel: 'conservative' | 'recommended' | 'ambitious'
): Promise<{ updatedCount: number }> {
    const [profile, allWorkouts] = await Promise.all([getProfile(), getWorkout()]);
    if (!profile || !allWorkouts) throw new Error("Données manquantes");

    const { computeDeviationMetrics } = await import('@/lib/stats/computeDeviation');

    const triggerWorkout = allWorkouts.find(w => w.id === workoutId);
    if (!triggerWorkout || !triggerWorkout.completedData) {
        throw new Error("Séance non trouvée ou pas complétée");
    }

    const deviation = computeDeviationMetrics(triggerWorkout, profile);
    if (!deviation || deviation.signal === 'normal') {
        return { updatedCount: 0 };
    }

    // Trouver les séances futures de la même semaine (pending uniquement)
    const triggerDate = parseLocalDate(triggerWorkout.date);
    const weekStart = startOfISOWeek(triggerDate);
    const weekEnd = endOfISOWeek(triggerDate);

    const pendingThisWeek = allWorkouts.filter(w => {
        const d = parseLocalDate(w.date);
        return w.status === 'pending'
            && d > triggerDate
            && d >= weekStart
            && d <= weekEnd;
    }).sort((a, b) => a.date.localeCompare(b.date));

    if (pendingThisWeek.length === 0) return { updatedCount: 0 };

    // Construire le contexte semaine pour l'IA
    const weekWorkouts = allWorkouts.filter(w => {
        const d = parseLocalDate(w.date);
        return d >= weekStart && d <= weekEnd;
    }).sort((a, b) => a.date.localeCompare(b.date));

    const surroundingContext: Record<string, string> = {};
    for (const w of weekWorkouts) {
        const status = w.status === 'completed' ? '(FAIT)' : w.status === 'missed' ? '(RATÉ)' : '(prévu)';
        surroundingContext[w.date] = `${w.title} ${w.workoutType} ${w.plannedData?.durationMinutes ?? '?'}min ${status}`;
    }

    // Déterminer le modificateur selon le niveau d'adaptation
    const levelInstruction: Record<string, string> = {
        conservative: 'Ajustement léger (-10/+10%). Garde la structure globale, baisse légèrement les intensités ou le volume.',
        recommended: deviation.signal === 'fatigue'
            ? 'Adaptation modérée. Remplace les intervalles haute intensité par du sweet spot ou Z2. Réduis le volume de 15-20% si fatigue centrale. Si une séance clé a été ratée, reprogramme-la en supprimant une séance secondaire.'
            : 'Adaptation modérée. Augmente légèrement l\'intensité (+3-5%) des séances qualité sans toucher au volume. Ne jamais augmenter volume ET intensité en même temps.',
        ambitious: deviation.signal === 'fatigue'
            ? 'Adaptation forte. Réduis le volume de 25-30%, transforme les séances qualité restantes en endurance Z2, ajoute une journée de repos si possible.'
            : 'Adaptation ambitieuse. Augmente l\'intensité des séances qualité (+5-8%). Garde le volume stable. Attention au surentraînement.',
    };

    // Régénérer chaque séance pending
    const currentBlockFocus = triggerWorkout.workoutType || "General Fitness";
    let updatedCount = 0;

    for (const pendingWorkout of pendingThisWeek) {
        try {
            const adaptInstruction = `CONTEXTE ADAPTATION: ${deviation.headline}. ${deviation.adaptationReason}
NIVEAU: ${levelInstruction[adaptationLevel]}
SIGNAUX: ${deviation.details.join('; ')}
Score déviation: ${deviation.score}`;

            const { workout: newWorkout, tokensUsed: tkAdapt } = await generateSingleWorkoutFromAI(
                profile,
                null,
                pendingWorkout.date,
                pendingWorkout.sportType,
                surroundingContext,
                pendingWorkout,
                currentBlockFocus,
                adaptInstruction,
                pendingWorkout.plannedData?.durationMinutes,
            );
            if (tkAdapt > 0) await atomicIncrementTokenCount(tkAdapt);

            await updateWorkoutById(pendingWorkout.id, {
                title: newWorkout.title,
                workoutType: newWorkout.workoutType,
                mode: newWorkout.mode,
                plannedData: newWorkout.plannedData,
            });

            // Mettre à jour le contexte pour la prochaine séance
            surroundingContext[pendingWorkout.date] = `${newWorkout.title} ${newWorkout.workoutType} ${newWorkout.plannedData?.durationMinutes ?? '?'}min (ADAPTÉ)`;
            updatedCount++;
        } catch (e) {
            console.error(`Erreur régénération adaptative pour ${pendingWorkout.date}:`, e);
        }
    }

    revalidatePath('/');
    // Le cache de /seance/[id] est distinct : sans ça, un retour arrière
    // après modification réafficherait des données périmées.
    revalidatePath('/seance/[id]', 'page');
    return { updatedCount };
}
