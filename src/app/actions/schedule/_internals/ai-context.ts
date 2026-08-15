/******************************************************************************
 * @file    _internals/ai-context.ts
 * @brief   Fonctions pures qui construisent les blocs de contexte injectés
 *          dans les prompts IA (historique d'entraînement, état de forme,
 *          semaine précédente, séances voisines, etc.).
 *
 *          Toutes ces fonctions sont DÉTERMINISTES : elles ne font aucune I/O
 *          et se contentent de formatter des données déjà chargées. Elles
 *          peuvent donc être utilisées dans n'importe quel contexte serveur.
 * @access  Module privé — ne pas importer depuis un composant client.
 ******************************************************************************/

import { addWeeks, format } from 'date-fns';
import { parseLocalDate } from '@/lib/utils';
import { getBlock, getPlan } from '@/lib/data/crud';
import { Block, Objective, Profile, Schedule, Week, Workout } from '@/lib/data/DatabaseTypes';
import { RESIDUAL_EFFECTS_DAYS } from '../../constants';
import { getWorkoutTSS } from '@/lib/stats/computeTSS';


/**
 * Résumé compact de l'historique récent pour informer la génération des blocs.
 * Retourne les 12 dernières semaines : volume, sports, types d'entraînement.
 * Permet à l'IA de comprendre la trajectoire d'entraînement complète de l'athlète.
 */
export function getTrainingHistorySummary(workouts: Workout[]): string {
    const completed = workouts
        .filter(w => w.status === 'completed' && w.completedData)
        .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

    if (completed.length === 0) return "Aucun historique d'entraînement disponible — l'athlète débute ou n'a pas de données.";

    // Regrouper par semaine (12 dernières)
    const weekMap = new Map<string, Workout[]>();
    for (const w of completed) {
        const d = new Date(w.date);
        const weekStart = new Date(d);
        weekStart.setDate(d.getDate() - ((d.getDay() + 6) % 7));
        const key = format(weekStart, 'yyyy-MM-dd');
        if (!weekMap.has(key)) weekMap.set(key, []);
        weekMap.get(key)!.push(w);
    }

    const recentWeeks = [...weekMap.entries()].slice(0, 12);
    if (recentWeeks.length === 0) return "Aucun historique récent.";

    const lines = recentWeeks.map(([weekOf, wks]) => {
        const sportCount: Record<string, number> = {};
        const typeCount: Record<string, number> = {};
        let totalDuration = 0;
        let totalTSS = 0;

        for (const w of wks) {
            sportCount[w.sportType] = (sportCount[w.sportType] || 0) + 1;
            typeCount[w.workoutType || 'Autre'] = (typeCount[w.workoutType || 'Autre'] || 0) + 1;
            totalDuration += w.completedData?.actualDurationMinutes || 0;
            totalTSS += getWorkoutTSS(w);
        }

        const sports = Object.entries(sportCount).map(([s, n]) => `${s}(${n})`).join(', ');
        const types = Object.entries(typeCount).map(([t, n]) => `${t}(${n})`).join(', ');
        const hours = (totalDuration / 60).toFixed(1);

        return `- Semaine du ${weekOf} : ${wks.length} séances | ${hours}h | TSS ${totalTSS} | Sports: ${sports} | Types: ${types}`;
    });

    // Résumé global de la tendance
    const totalWeeksWithData = recentWeeks.length;
    const allTSS = recentWeeks.map(([, wks]) => wks.reduce((sum, w) => sum + getWorkoutTSS(w), 0));
    const avgTSS = Math.round(allTSS.reduce((a, b) => a + b, 0) / totalWeeksWithData);
    const tssFirst4 = allTSS.slice(0, Math.min(4, allTSS.length));
    const tssLast4 = allTSS.slice(Math.max(0, allTSS.length - 4));
    const avgRecent = Math.round(tssFirst4.reduce((a, b) => a + b, 0) / tssFirst4.length);
    const avgOlder = Math.round(tssLast4.reduce((a, b) => a + b, 0) / tssLast4.length);
    const trend = avgRecent > avgOlder * 1.1 ? '📈 en progression' : avgRecent < avgOlder * 0.9 ? '📉 en baisse' : '➡️ stable';

    return `TENDANCE SUR ${totalWeeksWithData} SEMAINES : TSS moyen ${avgTSS}/sem | Charge récente vs ancienne : ${trend}\n\n` + lines.join('\n');
}


/**
 * Analyse les blocs d'entraînement déjà complétés pour informer l'IA
 * des phases de périodisation déjà effectuées par l'athlète.
 * Évite de reproposer une phase Base quand l'athlète est en pleine saison.
 */
export async function getCompletedBlocksHistory(): Promise<string> {
    const [plans, blocks] = await Promise.all([getPlan(), getBlock()]);
    if (!plans || plans.length === 0 || !blocks || blocks.length === 0) {
        return "Aucun plan précédent — l'athlète n'a pas d'historique de périodisation.";
    }

    // Trier les blocs par date de début (plus récent en premier)
    const sortedBlocks = [...blocks].sort((a, b) =>
        new Date(b.startDate).getTime() - new Date(a.startDate).getTime()
    );

    const today = new Date();
    const lines = sortedBlocks.map(block => {
        const blockEnd = addWeeks(parseLocalDate(block.startDate), block.weekCount);
        const isPast = today > blockEnd;
        const plan = plans.find(p => p.id === block.planId);

        // Un bloc d'un plan archivé ne peut être ni "en cours" ni "à venir" : le
        // plan a été remplacé. Sans ça, l'ancien bloc (ex. PMA) était présenté à
        // l'IA comme le bloc courant et son thème repartait dans le nouveau plan.
        const isActivePlan = plan?.status === 'active';
        const isCurrent = isActivePlan && today >= parseLocalDate(block.startDate) && today <= blockEnd;
        const status = isCurrent
            ? '🔵 EN COURS'
            : isPast ? '✅ TERMINÉ'
            : isActivePlan ? '⏳ À VENIR' : '⛔ ABANDONNÉ (plan remplacé)';

        return `- [${status}] ${block.type} — "${block.theme}" (${block.weekCount} sem, du ${block.startDate}) | CTL: ${block.startCTL}→${block.targetCTL} | Plan: ${plan?.name ?? 'N/A'}`;
    });

    // Résumé des phases complétées
    const completedTypes = sortedBlocks
        .filter(b => today > addWeeks(parseLocalDate(b.startDate), b.weekCount))
        .map(b => b.type);
    const typeCounts = completedTypes.reduce((acc, t) => { acc[t] = (acc[t] || 0) + 1; return acc; }, {} as Record<string, number>);
    const summary = Object.entries(typeCounts).map(([t, n]) => `${t}(${n}x)`).join(', ');

    return `PHASES DÉJÀ RÉALISÉES : ${summary || 'aucune'}\n\n${lines.join('\n')}`;
}


/**
 * Analyse complète du contexte de l'athlète pour guider la génération de plan.
 * Basé sur les méthodologies de Friel, Coggan/Allen, Issurin (block periodization).
 *
 * Détermine :
 * - Si l'athlète est en pré-saison, pleine saison, ou fin de saison
 * - Quelles qualités physiques ont encore un effet résiduel actif
 * - Quel type de bloc est recommandé en priorité
 * - Ce qu'il faut ÉVITER de reproposer
 */
export async function analyzeAthleteContext(
    profile: Profile,
    workouts: Workout[],
    blocks: Block[],
    objectives: Objective[]
): Promise<string> {
    const today = new Date();
    const lines: string[] = [];

    // --- 1. Niveau de forme actuel ---
    const ctl = profile.currentCTL;
    const atl = profile.currentATL;
    const tsb = ctl - atl;
    let fitnessState = '';
    if (ctl >= 80) fitnessState = 'Excellent — athlète très entraîné, pleine saison';
    else if (ctl >= 60) fitnessState = 'Bon — base solide construite, prêt pour intensité';
    else if (ctl >= 40) fitnessState = 'Modéré — condition correcte, peut encore construire';
    else fitnessState = 'Faible — besoin de reconstruire une base aérobie';

    let fatigueState = '';
    if (tsb < -30) fatigueState = '⚠️ SURCHARGE — TSB très négatif, récupération prioritaire';
    else if (tsb < -15) fatigueState = 'Fatigue accumulée — attention à la charge';
    else if (tsb > 15) fatigueState = 'Très reposé — peut absorber de la charge';
    else fatigueState = 'Équilibre correct';

    lines.push(`## ÉTAT DE FORME ACTUEL`);
    lines.push(`- CTL: ${ctl} | ATL: ${atl} | TSB (forme): ${tsb}`);
    lines.push(`- Condition : ${fitnessState}`);
    lines.push(`- Fatigue : ${fatigueState}`);

    // --- 2. Analyse des effets résiduels ---
    const completed = workouts
        .filter(w => w.status === 'completed' && w.completedData)
        .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

    const recentTypeMap: Record<string, Date> = {};
    for (const w of completed) {
        const type = w.workoutType || 'Autre';
        if (!recentTypeMap[type]) {
            recentTypeMap[type] = new Date(w.date);
        }
    }

    lines.push(`\n## EFFETS RÉSIDUELS (dernière séance par type)`);
    for (const [type, lastDate] of Object.entries(recentTypeMap)) {
        const daysAgo = Math.round((today.getTime() - lastDate.getTime()) / (1000 * 60 * 60 * 24));
        const residual = RESIDUAL_EFFECTS_DAYS[type] ?? 20;
        const stillActive = daysAgo <= residual;
        const status = stillActive
            ? `✅ Actif (fait il y a ${daysAgo}j, effet résiduel ${residual}j)`
            : `❌ Expiré (fait il y a ${daysAgo}j, effet résiduel ${residual}j) → à retravailler`;
        lines.push(`- ${type} : ${status}`);
    }

    // --- 3. Répartition récente intensité/volume (4 dernières semaines) ---
    const fourWeeksAgo = new Date(today);
    fourWeeksAgo.setDate(fourWeeksAgo.getDate() - 28);
    const recentWorkouts = completed.filter(w => new Date(w.date) >= fourWeeksAgo);

    if (recentWorkouts.length > 0) {
        const intensityCount = recentWorkouts.filter(w =>
            ['Interval', 'Tempo', 'Sprint'].includes(w.workoutType || '')
        ).length;
        const enduranceCount = recentWorkouts.filter(w =>
            ['Endurance', 'Long', 'Recovery'].includes(w.workoutType || '')
        ).length;
        const total = recentWorkouts.length;
        const intensityPct = Math.round((intensityCount / total) * 100);
        const endurancePct = Math.round((enduranceCount / total) * 100);

        lines.push(`\n## RÉPARTITION RÉCENTE (4 dernières semaines)`);
        lines.push(`- ${total} séances : ${intensityPct}% intensité (${intensityCount}) | ${endurancePct}% endurance/récup (${enduranceCount})`);

        if (intensityPct > 30) {
            lines.push(`→ Beaucoup d'intensité récemment — envisager un bloc plus aérobie ou de récupération`);
        } else if (intensityPct < 15) {
            lines.push(`→ Peu d'intensité récemment — l'athlète peut bénéficier d'un bloc PMA/seuil/intervalles`);
        } else {
            lines.push(`→ Distribution équilibrée — adapter selon l'objectif`);
        }
    }

    // --- 4. Analyse des blocs passés récents ---
    const recentBlocks = blocks
        .filter(b => today > addWeeks(parseLocalDate(b.startDate), b.weekCount))
        .sort((a, b) => new Date(b.startDate).getTime() - new Date(a.startDate).getTime())
        .slice(0, 3);

    if (recentBlocks.length > 0) {
        const lastBlock = recentBlocks[0];
        const daysSinceLastBlock = Math.round(
            (today.getTime() - addWeeks(parseLocalDate(lastBlock.startDate), lastBlock.weekCount).getTime()) / (1000 * 60 * 60 * 24)
        );

        lines.push(`\n## DERNIER BLOC TERMINÉ`);
        lines.push(`- Type: ${lastBlock.type} — "${lastBlock.theme}"`);
        lines.push(`- Terminé il y a ${daysSinceLastBlock} jours`);
        lines.push(`- CTL: ${lastBlock.startCTL} → ${lastBlock.targetCTL}`);

        // Règle d'alternance (Issurin) : ne pas répéter le même type
        lines.push(`→ RÈGLE D'ALTERNANCE : ne PAS enchaîner avec un bloc "${lastBlock.type}" identique. Alterner les stimuli.`);
    }

    // --- 5. Recommandation de phase ---
    lines.push(`\n## RECOMMANDATION CONTEXTUELLE`);

    const nextObjective = objectives
        .filter(o => new Date(o.date) > today)
        .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())[0];

    if (nextObjective) {
        const daysToRace = Math.round((new Date(nextObjective.date).getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
        if (daysToRace <= 14) {
            lines.push(`→ Course dans ${daysToRace} jours : TAPER / AFFÛTAGE obligatoire`);
        } else if (daysToRace <= 28) {
            lines.push(`→ Course dans ${daysToRace} jours : PEAK (intensité ciblée, volume réduit)`);
        } else {
            lines.push(`→ Course dans ${daysToRace} jours : temps suffisant pour un bloc de développement`);
        }
    }

    if (tsb < -30) {
        lines.push(`→ PRIORITÉ : bloc de RÉCUPÉRATION (TSB = ${tsb}, seuil critique dépassé)`);
    } else if (ctl >= 60) {
        lines.push(`→ Base aérobie DÉJÀ CONSTRUITE (CTL ${ctl}). NE PAS reproposer de bloc Base/Endurance.`);
        lines.push(`→ Privilégier : Build intensité (PMA, seuil, VO2max), Peak, ou Spécificité course.`);
    } else if (ctl >= 40) {
        lines.push(`→ Condition correcte. Selon l'historique, un bloc Build ou Base court est approprié.`);
    } else {
        lines.push(`→ CTL faible (${ctl}). Un bloc Base/Accumulation est nécessaire pour reconstruire.`);
    }

    return lines.join('\n');
}


/**
 * Calcule le taux de complétion moyen des 4 dernières semaines.
 * Remplace le hardcoded 100 pour donner un feedback réel à l'IA.
 *
 * `weekNumber` est relatif au bloc (1..weekCount) : il faut donc ordonner par
 * (ordre du bloc, n° de semaine) et rester dans le plan de la semaine courante,
 * sinon on mélange les blocs et les plans archivés encore présents en base.
 */
export function computeAvgCompletion(
    workouts: Workout[],
    weeks: Week[],
    blocks: Block[],
    currentWeekId: string,
): number {
    // Trouver les 4 semaines précédant la semaine courante
    const currentWeek = weeks.find(w => w.id === currentWeekId);
    if (!currentWeek) return 100;

    const blockById = new Map(blocks.map(b => [b.id, b]));
    const currentBlock = blockById.get(currentWeek.blockId);
    if (!currentBlock) return 100;

    const previousWeeks = weeks
        .filter(w => w.id !== currentWeekId)
        .map(w => ({ week: w, block: blockById.get(w.blockId) }))
        .filter(e =>
            e.block?.planId === currentBlock.planId
            && (e.block.orderIndex < currentBlock.orderIndex
                || (e.block.orderIndex === currentBlock.orderIndex && e.week.weekNumber < currentWeek.weekNumber))
        )
        .sort((a, b) =>
            (b.block!.orderIndex - a.block!.orderIndex) || (b.week.weekNumber - a.week.weekNumber)
        )
        .slice(0, 4)
        .map(e => e.week);

    if (previousWeeks.length === 0) return 100;

    const completionRates = previousWeeks.map(week => {
        const weekWorkouts = workouts.filter(w => w.weekId === week.id);
        if (weekWorkouts.length === 0) return 100;
        const completed = weekWorkouts.filter(w => w.status === 'completed').length;
        return Math.round((completed / weekWorkouts.length) * 100);
    });

    return Math.round(completionRates.reduce((a, b) => a + b, 0) / completionRates.length);
}


/**
 * Résumé de la semaine précédente pour guider la continuité.
 * Donne à l'IA le contexte de ce que l'athlète a réellement fait :
 * TSS réel vs planifié, RPE, types de séances, durée sortie longue.
 */
export function getPreviousWeekSummary(
    workouts: Workout[],
    weeks: Week[],
    blocks: Block[],
    currentWeekId: string
): string {
    const currentWeek = weeks.find(w => w.id === currentWeekId);
    if (!currentWeek) return "Aucune semaine précédente disponible.";

    const blockById = new Map(blocks.map(b => [b.id, b]));
    const currentBlock = blockById.get(currentWeek.blockId);
    if (!currentBlock) return "Aucune semaine précédente disponible.";

    // Chercher la semaine juste AVANT la semaine courante, dans le même plan.
    // Deux garde-fous indispensables :
    //  - `weeks`/`blocks` contiennent aussi les plans archivés (conservés par
    //    prepareArchive) : sans le filtre sur planId, la "semaine précédente"
    //    pouvait être celle d'un ancien plan et injecter son thème dans le prompt.
    //  - l'ordre (bloc, semaine) doit être comparé À la position courante, sinon
    //    on remonte simplement la dernière semaine du plan.
    const orderOf = (w: Week): [number, number] | null => {
        const b = blockById.get(w.blockId);
        if (!b || b.planId !== currentBlock.planId) return null;
        return [b.orderIndex, w.weekNumber];
    };
    const isBefore = ([blockIdx, weekNum]: [number, number]) =>
        blockIdx < currentBlock.orderIndex
        || (blockIdx === currentBlock.orderIndex && weekNum < currentWeek.weekNumber);

    const prevWeek = weeks
        .filter(w => w.id !== currentWeekId)
        .map(w => ({ week: w, order: orderOf(w) }))
        .filter((e): e is { week: Week; order: [number, number] } => e.order !== null && isBefore(e.order))
        .sort((a, b) => (b.order[0] - a.order[0]) || (b.order[1] - a.order[1]))[0]
        ?.week;

    if (!prevWeek) return "Première semaine du plan — pas de semaine précédente.";

    const prevWorkouts = workouts.filter(w => w.weekId === prevWeek.id);
    const completedWorkouts = prevWorkouts.filter(w => w.status === 'completed' && w.completedData);
    const missedWorkouts = prevWorkouts.filter(w => w.status === 'missed' || (w.status === 'pending' && new Date(w.date) < new Date()));

    if (completedWorkouts.length === 0 && missedWorkouts.length === 0) {
        return "Semaine précédente sans données de complétion.";
    }

    const lines: string[] = [];
    const prevBlock = blocks.find(b => b.id === prevWeek.blockId);

    lines.push(`## SEMAINE PRÉCÉDENTE (S${prevWeek.weekNumber}${prevBlock ? ` — ${prevBlock.type} "${prevBlock.theme}"` : ''})`);

    // TSS réel vs planifié
    const actualTSS = completedWorkouts.reduce((sum, w) => sum + getWorkoutTSS(w), 0);
    const plannedTSS = prevWorkouts.reduce((sum, w) => sum + (w.plannedData?.plannedTSS ?? 0), 0);
    const tssRatio = plannedTSS > 0 ? Math.round((actualTSS / plannedTSS) * 100) : 0;

    lines.push(`- TSS : ${actualTSS} réalisé / ${plannedTSS} planifié (${tssRatio}%)`);
    lines.push(`- Complétion : ${completedWorkouts.length}/${prevWorkouts.length} séances (${missedWorkouts.length} manquées)`);

    // RPE moyen
    const rpeValues = completedWorkouts
        .map(w => w.completedData?.perceivedEffort)
        .filter((rpe): rpe is number => rpe != null && rpe > 0);
    if (rpeValues.length > 0) {
        const avgRPE = (rpeValues.reduce((a, b) => a + b, 0) / rpeValues.length).toFixed(1);
        lines.push(`- RPE moyen : ${avgRPE}/10${Number(avgRPE) >= 8 ? ' ⚠️ FATIGUE ÉLEVÉE' : ''}`);
    }

    // Détail des séances complétées (pour continuité)
    if (completedWorkouts.length > 0) {
        lines.push(`- Séances réalisées :`);
        for (const w of completedWorkouts) {
            const cd = w.completedData!;
            const duration = cd.actualDurationMinutes;
            const tss = getWorkoutTSS(w);
            const rpe = cd.perceivedEffort ? ` | RPE ${cd.perceivedEffort}/10` : '';
            lines.push(`  · ${w.sportType} ${w.workoutType} — ${duration}min | TSS ${tss}${rpe} | "${w.title}"`);
        }

        // Identifier la sortie longue pour la progression
        const longWorkout = completedWorkouts
            .filter(w => w.workoutType === 'Long' || w.workoutType === 'Endurance')
            .sort((a, b) => (b.completedData?.actualDurationMinutes ?? 0) - (a.completedData?.actualDurationMinutes ?? 0))[0];

        if (longWorkout) {
            lines.push(`- Sortie longue de la semaine : ${longWorkout.completedData?.actualDurationMinutes}min (${longWorkout.sportType})`);
            lines.push(`  → CETTE SEMAINE : augmenter de 15-30min si semaine de charge, réduire de 50% si semaine de récup`);
        }

        // Identifier les séances d'intervalles pour la progression
        const intervalWorkouts = completedWorkouts.filter(w =>
            w.workoutType === 'Interval' || w.workoutType === 'Tempo'
        );
        if (intervalWorkouts.length > 0) {
            lines.push(`- Séances intensité réalisées : ${intervalWorkouts.length}`);
            for (const iw of intervalWorkouts) {
                lines.push(`  · "${iw.title}" — ${iw.completedData?.actualDurationMinutes}min`);
            }
            lines.push(`  → CETTE SEMAINE : progresser en ajoutant 1 rep OU en allongeant les intervalles OU en réduisant le repos`);
        }
    }

    // Analyse de l'écart TSS
    if (tssRatio > 110) {
        lines.push(`\n⚠️ L'athlète a DÉPASSÉ le TSS planifié de ${tssRatio - 100}%. Vérifier que la charge cette semaine ne s'accumule pas excessivement (ACWR < 1.3).`);
    } else if (tssRatio < 70) {
        lines.push(`\n⚠️ L'athlète n'a réalisé que ${tssRatio}% du TSS planifié. Adapter cette semaine : ne pas surcharger, progresser depuis le TSS RÉEL (${actualTSS}), pas le planifié.`);
    }

    return lines.join('\n');
}


/**
 * Récupère les 10 dernières séances complétées sous forme de résumé
 * textuel structuré pour injecter dans un prompt IA (performance passée).
 */
export const getRecentPerformanceHistory = (schedule: Schedule): string => {
    // Sécurité: vérifier que schedule.workouts est un tableau
    const allWorkouts = Array.isArray(schedule.workouts) ? schedule.workouts : [];

    // On récupère les 10 dernières séances complétées, du plus récent au plus ancien
    const workouts = allWorkouts
        .filter(w => w.status === 'completed' && w.completedData)
        .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
        .slice(0, 10);

    if (workouts.length === 0) return "Aucune donnée historique récente disponible.";

    return workouts.map(w => {
        const data = w.completedData!;
        const metrics = data.metrics;
        const plannedDuration = w.plannedData?.durationMinutes || '?';

        // Construction des détails spécifiques au sport
        const performanceDetails = [];

        // 1. Métriques Spécifiques par Sport
        if (w.sportType === 'cycling' && metrics.cycling) {
            if (metrics.cycling.avgPowerWatts) performanceDetails.push(`${metrics.cycling.avgPowerWatts}W Avg`);
            if (metrics.cycling.normalizedPowerWatts) performanceDetails.push(`${metrics.cycling.normalizedPowerWatts}W NP`);
        }
        else if (w.sportType === 'running' && metrics.running) {
            if (metrics.running.avgPaceMinPerKm) performanceDetails.push(`${metrics.running.avgPaceMinPerKm}/km`);
            if (metrics.running.elevationGainMeters) performanceDetails.push(`D+ ${metrics.running.elevationGainMeters}m`);
            if (metrics.cycling?.tss) performanceDetails.push(`TSS: ${metrics.cycling?.tss}`);
        }
        else if (w.sportType === 'swimming' && metrics.swimming) {
            if (metrics.swimming.avgPace100m) performanceDetails.push(`${metrics.swimming.avgPace100m}/100m`);
            if (metrics.swimming.strokeType) performanceDetails.push(`Nage: ${metrics.swimming.strokeType}`);
        }

        // 2. Données Physiologiques & Charge (Communs)
        const physioDetails = [];
        if (data.heartRate?.avgBPM) physioDetails.push(`FC Moy: ${data.heartRate.avgBPM}bpm`);

        // Assemblage des chaines pour l'affichage
        const perfString = performanceDetails.length > 0 ? `| Perf: [${performanceDetails.join(', ')}]` : '';
        const physioString = physioDetails.length > 0 ? `| Physio: [${physioDetails.join(', ')}]` : '';

        // Formatage pour l'IA : Conis et structuré
        return `
      - [${w.date}] ${w.sportType.toUpperCase()} - ${w.workoutType}
        * Durée: Prévue ${plannedDuration}m vs Réelle ${data.actualDurationMinutes}m
        * Volume: ${data.distanceKm.toFixed(2)} km ${perfString}
        * Intensité/Ressenti: RPE ${data.perceivedEffort}/10 ${physioString}
        * Notes: "${data.notes || 'R.A.S'}"
    `.trim();
    }).join('\n\n');
};


/**
 * Retourne les séances situées dans une fenêtre de ±2 jours autour d'une date.
 * Utilisé pour donner à l'IA le contexte voisin (veille / lendemain) quand
 * on régénère ou crée une séance unique.
 */
export function getSurroundingWorkouts(schedule: Schedule, targetDate: string): Record<string, string> {
    const target = new Date(targetDate);
    const context: Record<string, string> = {};

    const surroundingDates = new Set<string>();
    for (let i = -2; i <= 2; i++) {
        if (i === 0) continue;
        const d = new Date(target);
        d.setDate(d.getDate() + i);
        surroundingDates.add(format(d, 'yyyy-MM-dd'));
    }

    schedule.workouts.forEach(w => {
        if (surroundingDates.has(w.date)) {
            context[w.date] = `${w.workoutType} - ${w.title}`;
        }
    });

    return context;
}
