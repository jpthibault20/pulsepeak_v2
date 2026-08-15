/**
 * Assemblage d'un `PlannedData` à partir de la structure renvoyée par l'IA.
 *
 * C'est le point d'entrée unique des deux sites de génération (semaine complète
 * et séance isolée). Tout ce qui suit l'appel Gemini est ici, et tout est du
 * calcul pur : expansion, réparation, ajustement au créneau, dérivation de la
 * durée et des cibles, rendu du texte. Aucun second appel au modèle.
 */

import type { PlannedData, SportType, StructureBlock } from '@/lib/data/type';
import { expandCompactStructure } from './schema';
import {
    deriveDurationMinutes,
    deriveTopLevelTargets,
    fitStructureToSlot,
    repairStructure,
    validateStructure,
    type StructureIssue,
} from './normalize';
import { renderStructureToText } from './render';

export interface BuildPlannedDataParams {
    /** Tableau de blocs compacts tel que renvoyé par Gemini. */
    rawStructure: unknown;
    sportType: SportType;
    /** Durée du créneau de l'athlète, en minutes. La structure y est ramenée si besoin. */
    slotMinutes?: number | null;
    /** Durée retenue si la structure est inexploitable. */
    fallbackDurationMinutes: number;
    plannedTSS: number | null;
    why?: string | null;
}

export interface BuildPlannedDataResult {
    plannedData: PlannedData;
    issues: StructureIssue[];
    /** Vrai si la structure a dû être raccourcie pour tenir dans le créneau. */
    adjustedToSlot: boolean;
}

/**
 * Séance de repli quand l'IA n'a renvoyé aucun bloc exploitable.
 *
 * On n'invente ni intervalle, ni intensité, ni découpage : la seule chose qu'on
 * sache encore est la durée annoncée, et c'est la seule chose qu'on écrive. Une
 * carte vide serait pire pour l'athlète, une structure reconstituée serait pire
 * pour tout le monde.
 */
function fallbackPlannedData(params: BuildPlannedDataParams): PlannedData {
    const duration = Math.max(1, Math.round(params.fallbackDurationMinutes));
    return {
        durationMinutes: duration,
        targetPowerWatts: null,
        targetPaceMinPerKm: null,
        targetPaceMinPer100m: null,
        targetHeartRateBPM: null,
        distanceKm: null,
        distanceMeters: null,
        plannedTSS: params.plannedTSS,
        description: `Séance de ${duration} min.`,
        why: params.why ?? null,
        structure: [],
    };
}

export function buildPlannedDataFromStructure(params: BuildPlannedDataParams): BuildPlannedDataResult {
    const expanded: StructureBlock[] = expandCompactStructure(params.rawStructure);

    if (expanded.length === 0) {
        return {
            plannedData: fallbackPlannedData(params),
            issues: [{ code: 'EMPTY', blockIndex: null, detail: 'Aucun bloc exploitable renvoyé par l\'IA.' }],
            adjustedToSlot: false,
        };
    }

    const repaired = repairStructure(expanded);
    const slotSeconds = params.slotMinutes != null && params.slotMinutes > 0
        ? params.slotMinutes * 60
        : undefined;

    const fitted = slotSeconds != null
        ? fitStructureToSlot(repaired.structure, slotSeconds)
        : { structure: repaired.structure, adjusted: false };

    const structure = fitted.structure;

    const issues = [
        ...repaired.issues,
        ...validateStructure(structure, {
            countsInDistance: params.sportType === 'swimming',
            slotSeconds,
        }),
    ];

    const plannedData: PlannedData = {
        durationMinutes: deriveDurationMinutes(structure, params.fallbackDurationMinutes),
        ...deriveTopLevelTargets(structure),
        plannedTSS: params.plannedTSS,
        description: renderStructureToText(structure),
        why: params.why ?? null,
        structure,
    };

    return { plannedData, issues, adjustedToSlot: fitted.adjusted };
}
