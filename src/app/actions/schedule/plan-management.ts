/******************************************************************************
 * @file    plan-management.ts
 * @brief   Server Actions de gestion du plan actif depuis la vue "Plan" :
 *          suppression, édition des infos (nom / date objectif / stratégie),
 *          et décalage temporel du plan (séances à venir uniquement).
 *
 *          La création / régénération de plan vit dans plan-creation.ts et
 *          week-actions.ts ; la manipulation d'une séance isolée dans
 *          workout-actions.ts.
 ******************************************************************************/

'use server';

import { revalidatePath } from 'next/cache';
import { addDays, format } from 'date-fns';
import {
    deletePlanById,
    getBlock,
    getPlan,
    getWeek,
    getWorkout,
    saveBlocks,
    savePlan,
    updateWorkoutById,
} from '@/lib/data/crud';
import { formatDateKey, parseLocalDate } from '@/lib/utils';


/**
 * Supprime définitivement un plan et tout ce qu'il contient (blocs, semaines,
 * séances planifiées) via la cascade DB.
 */
export async function deletePlan(planId: string): Promise<void> {
    const plans = await getPlan();
    const plan = plans?.find(p => p.id === planId);
    if (!plan) throw new Error('Plan non trouvé.');

    await deletePlanById(planId);
    revalidatePath('/');
}


/**
 * Met à jour les métadonnées éditables d'un plan : nom, date objectif et
 * description de stratégie macro.
 */
export async function updatePlanDetails(
    planId: string,
    patch: { name: string; goalDate: string | null; macroStrategyDescription: string },
): Promise<void> {
    const plans = await getPlan();
    const plan = plans?.find(p => p.id === planId);
    if (!plan || !plans) throw new Error('Plan non trouvé.');

    const name = patch.name.trim();
    if (!name) throw new Error('Le nom du plan est requis.');

    plan.name = name;
    plan.goalDate = patch.goalDate ?? '';
    plan.macroStrategyDescription = patch.macroStrategyDescription;

    await savePlan(plans);
    revalidatePath('/');
}


/**
 * Décale le plan de `offsetDays` jours.
 *
 * Politique "séances à venir uniquement" : seules les séances planifiées dont
 * la date est ≥ aujourd'hui et qui ne sont pas déjà complétées sont déplacées.
 * L'historique réalisé et les séances passées restent à leur date d'origine.
 *
 * On décale aussi la date de début des blocs pas encore commencés et la date
 * objectif du plan, pour garder l'affichage de la timeline cohérent. Les
 * séances libres/manuelles (sans `weekId` rattaché au plan) ne sont pas touchées.
 */
export async function shiftPlan(planId: string, offsetDays: number): Promise<void> {
    if (!Number.isInteger(offsetDays) || offsetDays === 0) return;

    const [plans, blocks, weeks, workouts] = await Promise.all([
        getPlan(), getBlock(), getWeek(), getWorkout(),
    ]);

    const plan = plans?.find(p => p.id === planId);
    if (!plan || !plans) throw new Error('Plan non trouvé.');

    const todayStr = format(new Date(), 'yyyy-MM-dd');
    const shift = (iso: string) => formatDateKey(addDays(parseLocalDate(iso), offsetDays));

    // Séances rattachées à ce plan : workout → week → block → plan
    const planBlockIds = new Set((blocks ?? []).filter(b => b.planId === planId).map(b => b.id));
    const planWeekIds = new Set((weeks ?? []).filter(w => planBlockIds.has(w.blockId)).map(w => w.id));

    // 1. Décaler les séances à venir (non complétées), en réinitialisant les
    //    séances "missed" repoussées vers le futur en "pending".
    const toShift = (workouts ?? []).filter(w =>
        w.weekId != null &&
        planWeekIds.has(w.weekId) &&
        w.date >= todayStr &&
        w.status !== 'completed'
    );

    await Promise.all(toShift.map(w => updateWorkoutById(w.id, {
        date: shift(w.date),
        ...(w.status === 'missed' ? { status: 'pending' as const } : {}),
    })));

    // 2. Décaler la date de début des blocs pas encore commencés.
    const shiftedBlocks = (blocks ?? []).map(b =>
        b.planId === planId && b.startDate >= todayStr
            ? { ...b, startDate: shift(b.startDate) }
            : b
    );
    if (shiftedBlocks.length > 0) await saveBlocks(shiftedBlocks);

    // 3. Décaler la date objectif du plan si elle est dans le futur.
    if (plan.goalDate && plan.goalDate >= todayStr) {
        plan.goalDate = shift(plan.goalDate);
        await savePlan(plans);
    }

    revalidatePath('/');
}
