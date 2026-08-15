/**
 * Totaux, validation et réparations DÉTERMINISTES d'une structure de séance.
 *
 * Règle cardinale de ce module : **on ne fabrique jamais une durée absente.**
 * L'ancien pipeline comblait les durées manquantes en divisant la durée totale
 * par le nombre de blocs — c'est ce qui produisait des intervalles de 31:15 sur
 * une séance dont le texte ne contenait que des minutes rondes. Une durée
 * inconnue reste inconnue et remonte comme anomalie ; seule une durée EXISTANTE
 * peut être raccourcie, et uniquement pour tenir dans le créneau de l'athlète.
 */

import type { PlannedData, StructureBlock, StructureRepeatBlock } from '@/lib/data/type';

// ─── Totaux ───────────────────────────────────────────────────────────────────

/** Temps total occupé par un bloc, répétitions et récupérations comprises. */
export function blockTotalSeconds(b: StructureBlock): number {
    const actif = b.durationActifSecondes ?? 0;
    if (b.type === 'Repeat') {
        const recup = b.durationRecupSecondes ?? 0;
        return Math.max(1, b.repeat) * (actif + recup);
    }
    return actif;
}

export function structureTotalSeconds(structure: StructureBlock[]): number {
    return structure.reduce((sum, b) => sum + blockTotalSeconds(b), 0);
}

export function structureTotalMeters(structure: StructureBlock[]): number {
    return structure.reduce((sum, b) => {
        const m = b.distanceMeters ?? 0;
        return sum + (b.type === 'Repeat' ? Math.max(1, b.repeat) * m : m);
    }, 0);
}

// ─── Validation ───────────────────────────────────────────────────────────────

export type StructureIssueCode =
    | 'EMPTY'              // aucune structure exploitable
    | 'MISSING_DURATION'   // bloc sans durée sur un sport qui se compte en temps
    | 'NO_TARGET'          // bloc d'effort sans aucune cible chiffrée
    | 'MISSING_RECOVERY'   // série chronométrée sans récupération intercalée
    | 'INVERTED_REPEAT'    // récupération plus intense que la phase active
    | 'OVER_SLOT'          // structure plus longue que le créneau disponible
    | 'UNDER_SLOT';        // structure très en deçà du temps disponible

export interface StructureIssue {
    code: StructureIssueCode;
    /** Index du bloc concerné, ou null si l'anomalie porte sur la séance entière. */
    blockIndex: number | null;
    detail: string;
}

function paceToSeconds(pace: string | null): number | null {
    if (!pace) return null;
    const m = pace.match(/^(\d+):([0-5]\d)$/);
    return m ? parseInt(m[1], 10) * 60 + parseInt(m[2], 10) : null;
}

function hasTarget(b: StructureBlock): boolean {
    return b.targetPowerWatts != null
        || b.targetPaceMinPerKm != null
        || b.targetPaceMinPer100m != null
        || b.targetHeartRateBPM != null
        || b.targetRPE != null
        || (b.type !== 'Repeat' && b.loadKg != null);
}

/**
 * Détecte un Repeat dont les phases active et récup sont inversées.
 *
 * Heuristique : la phase active est toujours la plus intense, quelles que soient
 * les durées. La natation est exclue — la « récup » y est une pause au bord, pas
 * une intensité comparable.
 */
export function isRepeatInverted(b: StructureRepeatBlock): boolean {
    if (b.targetPowerWatts != null && b.targetRecupPowerWatts != null) {
        return b.targetRecupPowerWatts > b.targetPowerWatts;
    }
    const active = paceToSeconds(b.targetPaceMinPerKm);
    const recup = paceToSeconds(b.targetRecupPaceMinPerKm);
    if (active != null && recup != null) return recup < active; // allure plus basse = plus rapide
    if (b.targetHeartRateBPM != null && b.targetRecupHeartRateBPM != null) {
        return b.targetRecupHeartRateBPM > b.targetHeartRateBPM;
    }
    return false;
}

function swapRepeatPhases(b: StructureRepeatBlock): StructureRepeatBlock {
    return {
        ...b,
        durationActifSecondes: b.durationRecupSecondes,
        targetPowerWatts: b.targetRecupPowerWatts,
        targetPaceMinPerKm: b.targetRecupPaceMinPerKm,
        targetPaceMinPer100m: b.targetRecupPaceMinPer100m,
        targetHeartRateBPM: b.targetRecupHeartRateBPM,
        targetRPE: b.targetRecupRPE,

        durationRecupSecondes: b.durationActifSecondes,
        targetRecupPowerWatts: b.targetPowerWatts,
        targetRecupPaceMinPerKm: b.targetPaceMinPerKm,
        targetRecupPaceMinPer100m: b.targetPaceMinPer100m,
        targetRecupHeartRateBPM: b.targetHeartRateBPM,
        targetRecupRPE: b.targetRPE,
    };
}

/**
 * Remet d'aplomb ce qui peut l'être sans inventer d'information : aujourd'hui,
 * uniquement l'inversion actif/récup d'un Repeat. Les anomalies non réparables
 * sont remontées telles quelles.
 */
export function repairStructure(structure: StructureBlock[]): {
    structure: StructureBlock[];
    issues: StructureIssue[];
} {
    const issues: StructureIssue[] = [];
    const out = structure.map((b, i) => {
        if (b.type === 'Repeat' && isRepeatInverted(b)) {
            issues.push({
                code: 'INVERTED_REPEAT',
                blockIndex: i,
                detail: 'Phase de récupération plus intense que la phase active — phases échangées.',
            });
            return swapRepeatPhases(b);
        }
        return b;
    });
    return { structure: out, issues };
}

/**
 * Contrôle qu'une structure est affichable et cohérente.
 * `slotSeconds` optionnel : durée maximale disponible pour l'athlète.
 */
export function validateStructure(
    structure: StructureBlock[],
    opts: { countsInDistance?: boolean; slotSeconds?: number } = {},
): StructureIssue[] {
    const issues: StructureIssue[] = [];

    if (structure.length === 0) {
        return [{ code: 'EMPTY', blockIndex: null, detail: 'Aucun bloc exploitable.' }];
    }

    structure.forEach((b, i) => {
        const measuredByDistance = opts.countsInDistance && b.distanceMeters != null;
        const isStrength = b.type !== 'Repeat' && b.reps != null && b.sets != null;

        if (b.durationActifSecondes == null && !measuredByDistance && !isStrength) {
            issues.push({
                code: 'MISSING_DURATION',
                blockIndex: i,
                detail: `Bloc ${b.type} sans durée.`,
            });
        }
        if ((b.type === 'Active' || b.type === 'Repeat') && !hasTarget(b)) {
            issues.push({
                code: 'NO_TARGET',
                blockIndex: i,
                detail: `Bloc ${b.type} sans cible chiffrée.`,
            });
        }
        if (b.type === 'Repeat' && isRepeatInverted(b)) {
            issues.push({
                code: 'INVERTED_REPEAT',
                blockIndex: i,
                detail: 'Récupération plus intense que la phase active.',
            });
        }
        // Une série chronométrée sans récupération intercalée n'est pas une
        // série : c'est un bloc continu, ou une prescription infaisable. On la
        // signale sans rien inventer — aucune durée de récup ne se devine.
        if (b.type === 'Repeat'
            && b.repeat > 1
            && b.durationActifSecondes != null
            && b.durationRecupSecondes == null) {
            issues.push({
                code: 'MISSING_RECOVERY',
                blockIndex: i,
                detail: `Série de ${b.repeat} répétitions sans récupération intercalée.`,
            });
        }
    });

    if (opts.slotSeconds != null && opts.slotSeconds > 0 && isFullyTimed(structure)) {
        const total = structureTotalSeconds(structure);
        if (total > slotBudget(opts.slotSeconds)) {
            issues.push({
                code: 'OVER_SLOT',
                blockIndex: null,
                detail: `Structure de ${Math.round(total / 60)} min pour un créneau de ${Math.round(opts.slotSeconds / 60)} min.`,
            });
        } else if (total < opts.slotSeconds * UNDER_SLOT_RATIO) {
            // Une séance très courte face au temps disponible est le symptôme
            // d'une prescription tronquée — le modèle s'est arrêté en route.
            issues.push({
                code: 'UNDER_SLOT',
                blockIndex: null,
                detail: `Structure de ${Math.round(total / 60)} min seulement pour un créneau de ${Math.round(opts.slotSeconds / 60)} min.`,
            });
        }
    }

    return issues;
}

// ─── Ajustement au créneau ────────────────────────────────────────────────────

/** Durées planchers d'un raccourcissement : en deçà, le bloc perd son sens. */
const MIN_REPEAT_COUNT = 2;
const MIN_EDGE_SECONDS = 300;   // échauffement / retour au calme
const MAX_FIT_ITERATIONS = 60;

/**
 * Marge accordée au créneau : la tolérance de ±5 % qu'on demande au modèle, avec
 * un plancher d'une minute pour les séances courtes. Amputer une série entière
 * parce que la séance dépasse de deux minutes ferait plus de dégâts que le
 * dépassement lui-même.
 */
function slotBudget(slotSeconds: number): number {
    return slotSeconds + Math.max(60, slotSeconds * 0.05);
}

/** En deçà de cette part du créneau, la séance est considérée comme tronquée. */
const UNDER_SLOT_RATIO = 0.7;

/**
 * Raccourcit une structure trop longue pour le créneau de l'athlète, dans l'ordre
 * qu'appliquerait un entraîneur :
 *   1. retirer des répétitions à la série la plus coûteuse (jamais en dessous de 2) ;
 *   2. rogner échauffement / récupération isolée / retour au calme, plancher 5 min.
 * Si ça ne suffit toujours pas, on rend la structure en l'état : mieux vaut une
 * séance trop longue et honnête qu'un corps de séance dénaturé.
 *
 * Aucune durée n'est créée ici — seules des durées existantes sont réduites, et
 * le texte de la séance étant rendu À PARTIR de la structure, l'affichage suit
 * automatiquement.
 */
export function fitStructureToSlot(
    structure: StructureBlock[],
    slotSeconds: number,
): { structure: StructureBlock[]; adjusted: boolean } {
    if (!Number.isFinite(slotSeconds) || slotSeconds <= 0 || structure.length === 0) {
        return { structure, adjusted: false };
    }

    const budget = slotBudget(slotSeconds);
    if (structureTotalSeconds(structure) <= budget) {
        return { structure, adjusted: false };
    }

    const out: StructureBlock[] = structure.map(b => ({ ...b }));
    let adjusted = false;

    // 1. Répétitions en trop.
    for (let guard = 0; guard < MAX_FIT_ITERATIONS; guard++) {
        if (structureTotalSeconds(out) <= budget) break;

        let bestIdx = -1;
        let bestCost = 0;
        for (let i = 0; i < out.length; i++) {
            const b = out[i];
            if (b.type !== 'Repeat' || b.repeat <= MIN_REPEAT_COUNT) continue;
            const cost = (b.durationActifSecondes ?? 0) + (b.durationRecupSecondes ?? 0);
            if (cost > bestCost) {
                bestCost = cost;
                bestIdx = i;
            }
        }
        if (bestIdx < 0 || bestCost <= 0) break;

        const target = out[bestIdx] as StructureRepeatBlock;
        out[bestIdx] = { ...target, repeat: target.repeat - 1 };
        adjusted = true;
    }

    // 2. Bords de séance.
    let excess = structureTotalSeconds(out) - budget;
    if (excess > 0) {
        const edges = out
            .map((b, i) => ({ b, i }))
            .filter(({ b }) =>
                (b.type === 'Warmup' || b.type === 'Cooldown' || b.type === 'Rest')
                && (b.durationActifSecondes ?? 0) > MIN_EDGE_SECONDS,
            );

        const trimmable = edges.reduce(
            (sum, { b }) => sum + ((b.durationActifSecondes ?? 0) - MIN_EDGE_SECONDS),
            0,
        );

        if (trimmable > 0) {
            const ratio = Math.min(1, excess / trimmable);
            for (const { b, i } of edges) {
                const current = b.durationActifSecondes ?? 0;
                const cut = Math.round((current - MIN_EDGE_SECONDS) * ratio);
                if (cut <= 0) continue;
                out[i] = { ...out[i], durationActifSecondes: current - cut };
                adjusted = true;
                excess -= cut;
                if (excess <= 0) break;
            }
        }
    }

    return { structure: out, adjusted };
}

// ─── Dérivations ──────────────────────────────────────────────────────────────

/**
 * Une structure n'est chronométrable que si CHACUN de ses blocs porte une durée
 * active.
 *
 * Le cas qui impose ce garde-fou est la natation : ses blocs se comptent en
 * mètres et ne portent souvent que la récupération (« 15'' R » au bord). La
 * somme des temps y vaut alors la somme des repos — deux minutes pour une séance
 * de trois quarts d'heure. Idem pour le renforcement, prescrit en séries.
 */
export function isFullyTimed(structure: StructureBlock[]): boolean {
    return structure.length > 0 && structure.every(b => b.durationActifSecondes != null);
}

/**
 * Durée de la séance DÉDUITE de sa structure.
 *
 * C'est l'inversion clé : la durée n'est plus une consigne imposée à côté du
 * contenu, que l'IA devait ensuite réconcilier avec ses propres blocs. Elle est
 * la somme des blocs, donc structurellement exacte. Quand la séance ne se compte
 * pas en temps, on garde la durée annoncée en amont plutôt que d'additionner des
 * grandeurs qui ne sont pas la durée de la séance.
 */
export function deriveDurationMinutes(structure: StructureBlock[], fallbackMinutes: number): number {
    if (!isFullyTimed(structure)) return Math.max(1, Math.round(fallbackMinutes));
    const total = structureTotalSeconds(structure);
    if (total <= 0) return Math.max(1, Math.round(fallbackMinutes));
    return Math.max(1, Math.round(total / 60));
}

type TopLevelTargets = Pick<
    PlannedData,
    'targetPowerWatts' | 'targetPaceMinPerKm' | 'targetPaceMinPer100m'
    | 'targetHeartRateBPM' | 'distanceKm' | 'distanceMeters'
>;

/**
 * Cibles dominantes de la séance, lues dans la structure : la plus intense de
 * chaque métrique parmi les blocs de travail (l'échauffement ne définit pas la
 * cible d'une séance d'intervalles). Ces valeurs étaient jusqu'ici demandées à
 * l'IA lors d'un second appel — elles se calculent.
 */
export function deriveTopLevelTargets(structure: StructureBlock[]): TopLevelTargets {
    const work = structure.filter(b => b.type === 'Active' || b.type === 'Repeat');
    const pool = work.length > 0 ? work : structure;

    let watts: number | null = null;
    let hr: number | null = null;
    let pace: string | null = null;
    let paceSec = Infinity;
    let pace100: string | null = null;
    let pace100Sec = Infinity;

    for (const b of pool) {
        if (b.targetPowerWatts != null && (watts == null || b.targetPowerWatts > watts)) {
            watts = b.targetPowerWatts;
        }
        if (b.targetHeartRateBPM != null && (hr == null || b.targetHeartRateBPM > hr)) {
            hr = b.targetHeartRateBPM;
        }
        const p = paceToSeconds(b.targetPaceMinPerKm);
        if (p != null && p < paceSec) {
            paceSec = p;
            pace = b.targetPaceMinPerKm;
        }
        const p100 = paceToSeconds(b.targetPaceMinPer100m);
        if (p100 != null && p100 < pace100Sec) {
            pace100Sec = p100;
            pace100 = b.targetPaceMinPer100m;
        }
    }

    const meters = structureTotalMeters(structure);

    return {
        targetPowerWatts: watts,
        targetPaceMinPerKm: pace,
        targetPaceMinPer100m: pace100,
        targetHeartRateBPM: hr,
        distanceKm: null,
        distanceMeters: meters > 0 ? meters : null,
    };
}

/**
 * Seuil au-delà duquel un entraîneur prescrit en minutes rondes. En dessous, les
 * durées « bâtardes » sont normales : un 40"/20" ou un 90 s de récup.
 */
const ROUND_DURATION_THRESHOLD = 5 * 60;

/** Une durée longue qui ne tombe pas sur la minute n'a pas été prescrite, elle a été calculée. */
function isFabricatedDuration(seconds: number | null): boolean {
    if (seconds == null || seconds <= ROUND_DURATION_THRESHOLD) return false;
    return seconds % 60 !== 0;
}

/**
 * Garde-fou de LECTURE, pour les séances déjà en base générées par l'ancien
 * pipeline.
 *
 * Le test de cohérence évident — « la somme des blocs vaut-elle la durée
 * annoncée ? » — ne détecte RIEN ici : l'ancien fallback obtenait ses durées en
 * divisant précisément la durée totale par le nombre de blocs, donc la somme
 * tombait toujours juste. Sa vraie signature est la non-rondeur : 7500 s / 4
 * blocs = 1875 s, soit des intervalles de 31:15 sur une séance dont le texte ne
 * contenait que des minutes rondes.
 *
 * On masque donc la structure (le texte, lui, reste affiché) quand un bloc long
 * ne tombe pas sur la minute, ou quand le total s'écarte franchement de la durée
 * annoncée.
 */
export function isStructureTrustworthy(
    structure: StructureBlock[] | null | undefined,
    durationMinutes: number | null | undefined,
): boolean {
    if (!Array.isArray(structure) || structure.length === 0) return false;

    for (const b of structure) {
        if (isFabricatedDuration(b.durationActifSecondes)) return false;
        if (b.type === 'Repeat' && isFabricatedDuration(b.durationRecupSecondes)) return false;
    }

    // Séance comptée en mètres ou en séries : la somme des temps ne représente
    // pas sa durée, il n'y a donc rien à confronter à la durée annoncée.
    if (!isFullyTimed(structure)) return true;

    if (durationMinutes == null || durationMinutes <= 0) return true;
    const expected = durationMinutes * 60;
    return Math.abs(structureTotalSeconds(structure) - expected) / expected <= 0.25;
}
