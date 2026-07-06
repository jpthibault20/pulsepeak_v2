/******************************************************************************
 * @file    week-actions.ts
 * @brief   Server Actions centrées sur une semaine du plan :
 *          - lecture du contexte (bloc parent + type semaine + TSS cible)
 *          - comptage des pending (pour confirmation avant régénération)
 *          - (re)génération IA des séances d'une semaine précise
 *
 *          Se base sur le helper `findBlockAndWeekForDate` pour retrouver
 *          la paire (bloc, semaine) à partir d'une date quelconque.
 ******************************************************************************/

'use server';

import { addDays, format } from 'date-fns';
import { revalidatePath } from 'next/cache';
import { parseLocalDate } from '@/lib/utils';
import {
    deleteWorkoutsByIds,
    getBlock,
    getObjectives,
    getPlan,
    getProfile,
    getWeek,
    getWorkout,
    saveWorkoutsBatch,
} from '@/lib/data/crud';
import type { AvailabilitySlot } from '@/lib/data/type';
import { findBlockAndWeekForDate } from './_internals/week-finder';
import { computeAvgCompletion } from './_internals/ai-context';
import { CreateWorkoutForWeek } from './_internals/workout-generator';


// ─── Types ───────────────────────────────────────────────────────────────────

export type WeekContext = {
    blockTheme: string;
    blockType: string;
    weekType: 'Load' | 'Recovery' | 'Taper';
    targetTSS: number;
    weekNumber: number;
    blockWeekCount: number;
} | null;


// ─── Server Actions ──────────────────────────────────────────────────────────

/**
 * Retourne le contexte (bloc + semaine) pour une date de début de semaine.
 * Utilisé par le calendrier pour afficher le thème courant au-dessus de la grille.
 */
export async function getWeekContextForDate(weekStartDate: string): Promise<WeekContext> {
    const [blocks, weeks] = await Promise.all([getBlock(), getWeek()]);
    if (!blocks || !weeks) return null;

    const result = findBlockAndWeekForDate(blocks, weeks, parseLocalDate(weekStartDate));
    if (!result) return null;

    return {
        blockTheme: result.block.theme,
        blockType: result.block.type,
        weekType: result.week.type,
        targetTSS: result.week.targetTSS,
        weekNumber: result.week.weekNumber,
        blockWeekCount: result.block.weekCount,
    };
}


/**
 * Retourne le nombre de séances en statut 'pending' pour la semaine donnée.
 * Utilisé côté client pour demander confirmation avant d'écraser.
 */
export async function getWeekPendingCount(weekStartDate: string): Promise<number> {
    const [blocks, weeks, workouts] = await Promise.all([getBlock(), getWeek(), getWorkout()]);
    if (!blocks || !weeks || !workouts) return 0;

    const result = findBlockAndWeekForDate(blocks, weeks, parseLocalDate(weekStartDate));
    if (!result) return 0;

    return workouts.filter(w => w.weekId === result.week.id && w.status === 'pending').length;
}


/**
 * Génère les séances IA pour la semaine contenant weekStartDate,
 * en remplaçant les séances pending existantes de cette semaine.
 *
 * Les séances complétées de la semaine sont préservées (on ne touche pas
 * à ce que l'athlète a réellement fait).
 */
export async function generateWeekWorkoutsFromDate(
    weekStartDate: string,
    comment: string | null,
    weeklyAvailability: { [key: string]: AvailabilitySlot }
): Promise<void> {
    // [TIMING] Instrumentation temporaire pour calibrer les étapes de la progress bar
    const tStart = performance.now();
    const ms = (from: number) => Math.round(performance.now() - from);

    const tFetch0 = performance.now();
    const [profile, blocks, weeks, existingWorkouts, plans] = await Promise.all([
        getProfile(),
        getBlock(),
        getWeek(),
        getWorkout(),
        getPlan(),
    ]);
    console.log(`[week-gen] 1/4 fetch initial (profile+blocks+weeks+workouts+plans): ${ms(tFetch0)}ms`);

    if (!blocks || !weeks) throw new Error("Aucun plan trouvé.");

    const tCtx0 = performance.now();
    const result = findBlockAndWeekForDate(blocks, weeks, parseLocalDate(weekStartDate));
    if (!result) throw new Error("Aucun bloc actif pour cette semaine.");

    const { block, week } = result;
    const plan = plans?.find(p => p.id === block.planId);
    if (!plan) throw new Error("Plan introuvable.");

    // Trouver les objectifs pertinents (cette semaine + semaine suivante)
    const objectives = await getObjectives();
    const weekStart = parseLocalDate(weekStartDate);
    const weekEndPlusOne = addDays(weekStart, 13);
    const todayStr = format(new Date(), 'yyyy-MM-dd');
    const weekObjectives = objectives.filter(o =>
        o.status === 'upcoming' && o.date >= todayStr
        && parseLocalDate(o.date) >= weekStart && parseLocalDate(o.date) <= weekEndPlusOne
    );

    const realCompletion3 = computeAvgCompletion(existingWorkouts ?? [], weeks, week.id);
    console.log(`[week-gen] 2/4 contexte (findBlock+objectives+completion): ${ms(tCtx0)}ms`);

    const tAI0 = performance.now();
    const newWorkouts = await CreateWorkoutForWeek(
        profile,
        plan,
        block,
        week,
        comment,
        realCompletion3,
        weeklyAvailability,
        weekObjectives,
    );
    console.log(`[week-gen] 3/4 CreateWorkoutForWeek (IA totale): ${ms(tAI0)}ms — ${newWorkouts?.length ?? 0} séances`);

    if (!newWorkouts || newWorkouts.length === 0) {
        throw new Error("L'IA n'a retourné aucune séance. Les séances existantes sont conservées.");
    }

    const tSave0 = performance.now();
    // On supprime UNIQUEMENT les pending/missed de la semaine (celles qu'on remplace)
    // et on insère les nouvelles en un seul INSERT multi-lignes. Les séances complétées
    // sont préservées. `workoutsId` de la semaine est dérivé au read (non stocké),
    // donc pas besoin de mettre à jour la table `weeks`.
    const removedIds = (existingWorkouts ?? [])
        .filter(w => w.weekId === week.id && w.status !== 'completed')
        .map(w => w.id);

    await Promise.all([
        deleteWorkoutsByIds(removedIds),
        saveWorkoutsBatch(newWorkouts),
    ]);

    revalidatePath('/');
    console.log(`[week-gen] 4/4 save (delete+batchInsert+revalidate): ${ms(tSave0)}ms`);
    console.log(`[week-gen] ✓ TOTAL: ${ms(tStart)}ms`);
}
