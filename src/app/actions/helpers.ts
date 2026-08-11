/******************************************************************************
 * @file    helpers.ts
 * @brief   Fonctions utilitaires pures pour la génération des plans
 *          d'entraînement. Aucune I/O, aucun effet de bord.
 ******************************************************************************/

import { AvailabilitySlot } from "@/lib/data/type";
import {
    RECOVERY_TSS_RATIO,
    RECOVERY_WEEK_THRESHOLD,
    TAPER_WINDOW_DAYS,
    TAPER_RULES_PRINCIPAL,
    TAPER_RULES_SECONDARY,
    type TaperDayRule,
} from "./constants";
import { Objective, Profile } from "@/lib/data/DatabaseTypes";
import { addDays, differenceInCalendarDays, format } from "date-fns";
import { parseLocalDate } from "@/lib/utils";


// ---- TSS / CTL -------------------------------------------------------------

/**
 * Calcule le TSS hebdomadaire estimé depuis une valeur de CTL.
 * CTL représente la moyenne lissée du TSS journalier sur 42 jours,
 * donc TSS hebdo ≈ CTL × 7.
 *
 * @param ctl - Chronic Training Load de référence
 * @returns   TSS hebdomadaire estimé
 */
export const computeWeeklyTSS = (ctl: number): number => ctl * 7;


// ---- Découpage en blocs ----------------------------------------------------

/**
 * Découpe un plan en squelettes de blocs de méso-cycles.
 * Règles :
 * - Blocs standards de 4 semaines
 * - Si ≤ 5 semaines restantes → dernier bloc absorbe le reliquat
 * - Le dernier bloc est marqué isLast = true (sauf si plan = 1 seul bloc)
 *
 * @param totalWeeks - Nombre total de semaines du plan
 * @returns Tableau de squelettes ordonnés
 */
export const computeBlockSkeletons = (
    totalWeeks: number
): { index: number; duration: number; isLast: boolean }[] => {

    const skeletons: { index: number; duration: number; isLast: boolean }[] = [];
    let weeksRemaining = totalWeeks;
    let index = 1;

    while (weeksRemaining > 0) {
        if (weeksRemaining <= 5) {
            skeletons.push({ index, duration: weeksRemaining, isLast: index > 1 });
            break;
        }
        skeletons.push({ index, duration: 4, isLast: false });
        weeksRemaining -= 4;
        index++;
    }

    return skeletons;
};


// ---- Progression TSS -------------------------------------------------------

/**
 * Calcule le TSS cible d'une semaine de charge selon sa position
 * dans le bloc (progression linéaire entre startTSS et targetTSS).
 *
 * @param weekNumber       - Numéro de la semaine (1-based)
 * @param startWeeklyTSS   - TSS hebdo en début de bloc
 * @param progressionPerWeek - Incrément de TSS par semaine
 * @returns TSS cible arrondi
 */
export const computeLoadWeekTSS = (
    weekNumber: number,
    startWeeklyTSS: number,
    progressionPerWeek: number
): number => Math.round(startWeeklyTSS + progressionPerWeek * (weekNumber - 1));

/**
 * Calcule le TSS cible d'une semaine de récupération.
 * Applique RECOVERY_TSS_RATIO sur le TSS de départ du bloc.
 *
 * @param startWeeklyTSS - TSS hebdo en début de bloc
 * @returns TSS de récupération arrondi
 */
export const computeRecoveryWeekTSS = (
    startWeeklyTSS: number
): number => Math.round(startWeeklyTSS * RECOVERY_TSS_RATIO);

/**
 * Calcule l'incrément de TSS par semaine de charge dans un bloc.
 *
 * @param startWeeklyTSS  - TSS hebdo en début de bloc
 * @param targetWeeklyTSS - TSS hebdo visé en fin de bloc
 * @param weekCount       - Nombre total de semaines du bloc
 * @returns Progression par semaine (0 si une seule semaine de charge)
 */
export const computeProgressionPerWeek = (
    startWeeklyTSS: number,
    targetWeeklyTSS: number,
    weekCount: number
): number => {
    const loadWeeksCount = weekCount > RECOVERY_WEEK_THRESHOLD
        ? weekCount - 1
        : weekCount;

    return loadWeeksCount > 1
        ? (targetWeeklyTSS - startWeeklyTSS) / (loadWeeksCount - 1)
        : 0;
};

export const getActiveSports = (activeSports: Profile['activeSports']): string[] => {
    return Object.entries(activeSports)
        .filter(([, isActive]) => isActive)
        .map(([sport]) => sport);
};

const SPORT_LABELS_FR: Record<string, string> = {
    cycling:  'cyclisme',
    running:  'course à pied',
    swimming: 'natation',
};

/**
 * Liste FR des disciplines actives, prête à être injectée dans un prompt
 * (ex: "cyclisme, natation"). Chaîne vide si aucune discipline n'est activée —
 * aux appelants de fournir leur propre repli.
 */
export const formatActiveSportsFr = (activeSports: Profile['activeSports']): string => {
    return getActiveSports(activeSports)
        .map(sport => SPORT_LABELS_FR[sport] ?? sport)
        .join(', ');
};

// Mapping dayOffset (0=Lundi … 6=Dimanche) → clé française
const DAY_OFFSET_TO_FR = ['Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi', 'Dimanche'] as const;

/** Normalise une valeur de dispo : <= 12 = heures (ancien format), > 12 = minutes (DurationInput) */
function toMinutes(value: number): number {
    if (value <= 0) return 0;
    return value <= 12 ? Math.round(value * 60) : Math.round(value);
}

function formatDuration(value: number): string {
    const mins = toMinutes(value);
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    if (h > 0 && m > 0) return `${h}h${m < 10 ? '0' : ''}${m}`;
    if (h > 0) return `${h}h`;
    return `${m}min`;
}

export const formatAvailability = (availability: { [key: string]: AvailabilitySlot }): string => {
    return Object.entries(availability)
        .map(([day, slot]) => {
            if (slot.aiChoice) {
                const comment = slot.comment ? ` (${slot.comment})` : '';
                return `- ${day} : IA LIBRE — tu choisis le sport, la durée et l'intensité${comment}`;
            }

            const sports = [
                slot.swimming > 0 ? `natation ${formatDuration(slot.swimming)}` : null,
                slot.cycling   > 0 ? `vélo ${formatDuration(slot.cycling)}`     : null,
                slot.running   > 0 ? `course ${formatDuration(slot.running)}`   : null,
            ].filter(Boolean).join(", ");

            // Aucun sport prévu → jour de repos (même s'il y a un commentaire)
            if (!sports) return null;

            const parts = [sports, slot.comment ? `(${slot.comment})` : null].filter(Boolean).join(" ");
            return `- ${day} : ${parts}`;
        })
        .filter(Boolean)
        .join("\n");
};

/**
 * Construit un Set des (dayOffset, sportType) autorisés à partir des disponibilités.
 * Jours IA LIBRE → toutes les disciplines actives sont autorisées.
 * Jours sans sport → aucun workout autorisé (repos).
 */
// ---- Taper par J-x ---------------------------------------------------------

export type TaperDayInfo = {
    dayOffset:     number;                              // 0-6 (Lundi … Dimanche)
    date:          string;                              // YYYY-MM-DD
    daysBefore:    number;                              // J-x (0 = jour de course)
    priority:      'principale' | 'secondaire';
    objectiveName: string;
    objectiveDate: string;
    objectiveSport:string;
    rule:          TaperDayRule;
};

/**
 * Calcule, pour chaque jour d'une semaine (weekStartDate + 0..6), la règle de
 * tapering applicable si ce jour tombe dans la fenêtre d'affûtage d'un
 * objectif. Règle la plus restrictive si overlap (principale > secondaire,
 * puis plus petit daysBefore).
 *
 * @param weekStartDate  - Lundi de la semaine cible
 * @param objectives     - Liste des objectifs candidats (principaux + secondaires)
 * @returns Map<dayOffset, TaperDayInfo> — seuls les jours impactés sont inclus
 */
export const buildTaperPlan = (
    weekStartDate: Date,
    objectives: Objective[],
): Map<number, TaperDayInfo> => {
    const result = new Map<number, TaperDayInfo>();
    if (objectives.length === 0) return result;

    for (let dayOffset = 0; dayOffset <= 6; dayOffset++) {
        const currentDate    = addDays(weekStartDate, dayOffset);
        const currentDateStr = format(currentDate, 'yyyy-MM-dd');

        let best: TaperDayInfo | null = null;

        for (const obj of objectives) {
            if (obj.priority !== 'principale' && obj.priority !== 'secondaire') continue;
            const objDate    = parseLocalDate(obj.date);
            const daysBefore = differenceInCalendarDays(objDate, currentDate);
            if (daysBefore < 0) continue; // la course est passée, pas de taper
            const windowDays = TAPER_WINDOW_DAYS[obj.priority];
            if (daysBefore > windowDays) continue; // hors fenêtre

            const rules = obj.priority === 'principale' ? TAPER_RULES_PRINCIPAL : TAPER_RULES_SECONDARY;
            const rule  = rules[daysBefore];
            if (!rule) continue;

            const candidate: TaperDayInfo = {
                dayOffset,
                date:          currentDateStr,
                daysBefore,
                priority:      obj.priority,
                objectiveName: obj.name,
                objectiveDate: obj.date,
                objectiveSport:obj.sport,
                rule,
            };

            if (!best) {
                best = candidate;
            } else if (best.priority !== 'principale' && candidate.priority === 'principale') {
                // Un principal bat un secondaire
                best = candidate;
            } else if (best.priority === candidate.priority && candidate.daysBefore < best.daysBefore) {
                // Même priorité : la course la plus proche gagne
                best = candidate;
            }
        }

        if (best) result.set(dayOffset, best);
    }

    return result;
};

export const buildAllowedSlots = (
    availability: { [key: string]: AvailabilitySlot },
    activeSports: string[],
): Map<number, { sports: Set<string>; maxMinutes: Record<string, number> }> => {
    const allowed = new Map<number, { sports: Set<string>; maxMinutes: Record<string, number> }>();

    for (const [day, slot] of Object.entries(availability)) {
        const dayIdx = DAY_OFFSET_TO_FR.indexOf(day as typeof DAY_OFFSET_TO_FR[number]);
        if (dayIdx === -1) continue;

        const sports = new Set<string>();
        const maxMinutes: Record<string, number> = {};

        if (slot.aiChoice) {
            // IA libre : tous les sports actifs autorisés, pas de plafond dur
            activeSports.forEach(s => sports.add(s));
        } else {
            if (slot.swimming > 0) { sports.add('swimming'); maxMinutes['swimming'] = toMinutes(slot.swimming); }
            if (slot.cycling > 0)  { sports.add('cycling');  maxMinutes['cycling']  = toMinutes(slot.cycling); }
            if (slot.running > 0)  { sports.add('running');  maxMinutes['running']  = toMinutes(slot.running); }
        }

        if (sports.size > 0) {
            allowed.set(dayIdx, { sports, maxMinutes });
        }
    }

    return allowed;
};