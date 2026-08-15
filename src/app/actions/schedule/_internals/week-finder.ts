/******************************************************************************
 * @file    _internals/week-finder.ts
 * @brief   Résolution d'une date vers la paire (bloc, semaine) du plan actif.
 *          Utilisé à la fois par l'affichage (plan-overview, week-actions)
 *          et par la synchronisation Strava (rattacher une activité libre
 *          à la semaine courante).
 * @access  Module privé — ne pas importer depuis un composant client.
 ******************************************************************************/

import { addDays } from 'date-fns';
import { parseLocalDate } from '@/lib/utils';
import { Block, Week } from '@/lib/data/DatabaseTypes';


/**
 * Trouve le bloc et la semaine qui contiennent `targetDate`.
 *
 * ⚠️ `blocks` contient TOUS les blocs de l'utilisateur, y compris ceux des
 * plans archivés (prepareArchive conserve les N derniers plans en base). Ces
 * blocs chevauchent les dates du plan actif : sans le filtre `activePlanId`,
 * `find` peut retourner un bloc archivé (l'ordre des lignes n'est pas garanti)
 * et la génération se ferait alors sur l'ancien bloc / l'ancienne semaine.
 *
 * @param activePlanId Identifiant du plan actif — seuls ses blocs sont candidats.
 * @returns { block, week } ou null si la date est hors de tout bloc du plan actif
 */
export function findBlockAndWeekForDate(
    blocks: Block[],
    weeks: Week[],
    targetDate: Date,
    activePlanId: string,
): { block: Block; week: Week } | null {
    const block = blocks.filter(b => b.planId === activePlanId).find(b => {
        const start = parseLocalDate(b.startDate);
        const end = addDays(start, b.weekCount * 7);
        return targetDate >= start && targetDate < end;
    });
    if (!block) return null;

    const blockStart = parseLocalDate(block.startDate);
    const blockWeeks = weeks.filter(w => block.weeksId?.includes(w.id));
    const week = blockWeeks.find(w => {
        const wStart = addDays(blockStart, (w.weekNumber - 1) * 7);
        const wEnd = addDays(wStart, 6);
        return targetDate >= wStart && targetDate <= wEnd;
    });

    if (!week) return null;
    return { block, week };
}
