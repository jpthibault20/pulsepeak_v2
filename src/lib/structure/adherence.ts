/**
 * Respect de la séance : ce qui était prescrit face à ce qui a été fait.
 *
 * Devenu possible seulement maintenant : tant que la prescription n'existait
 * qu'en prose, il n'y avait rien à confronter aux données Strava. La structure
 * étant désormais la source de vérité, la comparaison est du calcul pur — aucun
 * appel IA, donc aucun token.
 *
 * Choix de méthode : on ne tente PAS d'aligner chaque bloc sur chaque tour. Un
 * athlète appuie rarement sur « lap » à chaque intervalle, et Strava découpe le
 * plus souvent tout seul au kilomètre : un alignement séquentiel inventerait une
 * correspondance et rendrait des verdicts faux avec l'aplomb d'un calcul exact.
 * On compare donc trois agrégats robustes — durée totale, volume de travail,
 * intensité de travail — qui répondent à la vraie question : « ai-je fait la
 * séance, et à la bonne intensité ? »
 */

import type { CompletedLap, SportType, StructureBlock } from '@/lib/data/type';
import { structureTotalSeconds } from './normalize';

/** Écart toléré avant de parler d'un écart réel. */
const TOLERANCE = 0.10;
/** En deçà, le volume de travail n'a manifestement pas été fait. */
const WORK_VOLUME_TOLERANCE = 0.20;
/** Part de la cible à partir de laquelle un tour compte comme du travail. */
const WORK_INTENSITY_RATIO = 0.92;

export type AdherenceVerdict = 'respecte' | 'allege' | 'durci' | 'partiel' | 'inconnu';

export interface AdherenceAxis {
    /** Écart relatif (réalisé - prévu) / prévu, ou null si non calculable. */
    deltaPct: number | null;
    plannedValue: number | null;
    actualValue: number | null;
}

export interface AdherenceReport {
    verdict: AdherenceVerdict;
    /** 0-100. 100 = séance exécutée telle que prescrite. */
    score: number;
    duration: AdherenceAxis;
    /** Temps passé à l'intensité de travail prescrite. */
    workVolume: AdherenceAxis;
    /** Intensité moyenne sur la portion de travail (watts, ou m/s). */
    intensity: AdherenceAxis;
    headline: string;
    details: string[];
}

// ─── Intensités ───────────────────────────────────────────────────────────────

function paceToSeconds(pace: string | null): number | null {
    if (!pace) return null;
    const m = pace.match(/^(\d+):([0-5]\d)$/);
    return m ? parseInt(m[1], 10) * 60 + parseInt(m[2], 10) : null;
}

/**
 * Grandeur de comparaison, croissante avec l'effort : les watts en vélo, la
 * vitesse en m/s partout ailleurs. Une allure ne peut pas servir telle quelle —
 * elle décroît quand l'effort augmente.
 */
export function plannedIntensityOf(b: StructureBlock, sport: SportType): number | null {
    if (sport === 'cycling' && b.targetPowerWatts != null) return b.targetPowerWatts;

    const perKm = paceToSeconds(b.targetPaceMinPerKm);
    if (perKm != null && perKm > 0) return 1000 / perKm;

    const per100m = paceToSeconds(b.targetPaceMinPer100m);
    if (per100m != null && per100m > 0) return 100 / per100m;

    return null;
}

function lapIntensity(lap: CompletedLap, sport: SportType): number | null {
    if (sport === 'cycling' && lap.avgPower != null) return lap.avgPower;
    if (lap.durationSeconds > 0 && lap.distanceMeters > 0) return lap.distanceMeters / lap.durationSeconds;
    return null;
}

// ─── Agrégats de la prescription ──────────────────────────────────────────────

/** Temps prescrit à l'effort : phases actives des blocs Active et Repeat. */
export function plannedWorkSeconds(structure: StructureBlock[]): number {
    return structure.reduce((sum, b) => {
        if (b.type === 'Repeat') return sum + Math.max(1, b.repeat) * (b.durationActifSecondes ?? 0);
        if (b.type === 'Active') return sum + (b.durationActifSecondes ?? 0);
        return sum;
    }, 0);
}

/** Intensité de travail prescrite : la plus élevée des blocs d'effort. */
export function plannedWorkIntensity(structure: StructureBlock[], sport: SportType): number | null {
    let peak: number | null = null;
    for (const b of structure) {
        if (b.type !== 'Active' && b.type !== 'Repeat') continue;
        const v = plannedIntensityOf(b, sport);
        if (v != null && (peak == null || v > peak)) peak = v;
    }
    return peak;
}

// ─── Rapport ──────────────────────────────────────────────────────────────────

function ratio(actual: number | null, planned: number | null): number | null {
    if (actual == null || planned == null || planned <= 0) return null;
    return (actual - planned) / planned;
}

function pct(delta: number): string {
    const rounded = Math.round(delta * 100);
    return `${rounded > 0 ? '+' : ''}${rounded} %`;
}

export interface ComputeAdherenceParams {
    structure: StructureBlock[] | null | undefined;
    sport: SportType;
    laps: CompletedLap[];
    actualDurationSeconds: number | null;
}

export function computeAdherence(params: ComputeAdherenceParams): AdherenceReport {
    const { structure, sport, laps, actualDurationSeconds } = params;

    const empty: AdherenceAxis = { deltaPct: null, plannedValue: null, actualValue: null };

    if (!Array.isArray(structure) || structure.length === 0) {
        return {
            verdict: 'inconnu',
            score: 0,
            duration: empty,
            workVolume: empty,
            intensity: empty,
            headline: 'Séance sans structure de référence',
            details: ['Aucune prescription détaillée à confronter au réalisé.'],
        };
    }

    // ── Axe 1 : durée totale ──
    const plannedSeconds = structureTotalSeconds(structure);
    const duration: AdherenceAxis = {
        plannedValue: plannedSeconds > 0 ? plannedSeconds : null,
        actualValue: actualDurationSeconds,
        deltaPct: ratio(actualDurationSeconds, plannedSeconds > 0 ? plannedSeconds : null),
    };

    // ── Axes 2 et 3 : volume et intensité de travail ──
    const target = plannedWorkIntensity(structure, sport);
    const plannedWork = plannedWorkSeconds(structure);

    let workVolume: AdherenceAxis = empty;
    let intensity: AdherenceAxis = empty;

    if (target != null && laps.length > 0) {
        const threshold = target * WORK_INTENSITY_RATIO;
        let workSeconds = 0;
        let weighted = 0;

        for (const lap of laps) {
            const value = lapIntensity(lap, sport);
            if (value == null || lap.durationSeconds <= 0) continue;
            if (value >= threshold) {
                workSeconds += lap.durationSeconds;
                weighted += value * lap.durationSeconds;
            }
        }

        const actualIntensity = workSeconds > 0 ? weighted / workSeconds : null;

        workVolume = {
            plannedValue: plannedWork > 0 ? plannedWork : null,
            actualValue: workSeconds,
            deltaPct: ratio(workSeconds, plannedWork > 0 ? plannedWork : null),
        };
        intensity = {
            plannedValue: target,
            actualValue: actualIntensity,
            deltaPct: ratio(actualIntensity, target),
        };
    }

    // ── Verdict ──
    const details: string[] = [];
    let penalty = 0;
    let tooHard = false;
    let tooEasy = false;

    if (duration.deltaPct != null) {
        if (Math.abs(duration.deltaPct) > TOLERANCE) {
            penalty += Math.min(30, Math.abs(duration.deltaPct) * 100);
            details.push(`Durée ${pct(duration.deltaPct)} par rapport au prévu.`);
            if (duration.deltaPct < 0) tooEasy = true;
        } else {
            details.push('Durée conforme.');
        }
    }

    if (workVolume.deltaPct != null) {
        if (workVolume.deltaPct < -WORK_VOLUME_TOLERANCE) {
            penalty += Math.min(40, Math.abs(workVolume.deltaPct) * 100);
            details.push(`Volume de travail ${pct(workVolume.deltaPct)} : la série n'a pas été menée à son terme.`);
            tooEasy = true;
        } else if (workVolume.deltaPct > WORK_VOLUME_TOLERANCE) {
            penalty += Math.min(20, workVolume.deltaPct * 50);
            details.push(`Volume de travail ${pct(workVolume.deltaPct)} au-delà du prévu.`);
            tooHard = true;
        } else {
            details.push('Volume de travail conforme.');
        }
    }

    if (intensity.deltaPct != null) {
        if (intensity.deltaPct < -TOLERANCE) {
            penalty += Math.min(30, Math.abs(intensity.deltaPct) * 100);
            details.push(`Intensité de travail ${pct(intensity.deltaPct)} sous la cible.`);
            tooEasy = true;
        } else if (intensity.deltaPct > TOLERANCE) {
            penalty += Math.min(30, intensity.deltaPct * 100);
            details.push(`Intensité de travail ${pct(intensity.deltaPct)} au-dessus de la cible.`);
            tooHard = true;
        } else {
            details.push('Intensité de travail dans la cible.');
        }
    }

    const measured = [duration.deltaPct, workVolume.deltaPct, intensity.deltaPct].filter(d => d != null).length;
    if (measured === 0) {
        return {
            verdict: 'inconnu',
            score: 0,
            duration, workVolume, intensity,
            headline: 'Respect non mesurable',
            details: ['Données réalisées insuffisantes : ni durée ni intensité exploitables.'],
        };
    }

    const score = Math.max(0, Math.min(100, Math.round(100 - penalty)));

    let verdict: AdherenceVerdict;
    let headline: string;
    if (penalty === 0) {
        verdict = 'respecte';
        headline = 'Séance respectée';
    } else if (tooHard && !tooEasy) {
        verdict = 'durci';
        headline = 'Séance durcie par rapport au prévu';
    } else if (tooEasy && !tooHard) {
        verdict = 'allege';
        headline = 'Séance allégée par rapport au prévu';
    } else {
        verdict = 'partiel';
        headline = 'Séance partiellement respectée';
    }

    // Une intensité mesurée mais pas le volume (ou l'inverse) reste un verdict
    // partiel : on ne décerne pas un « respectée » sur un seul axe.
    if (verdict === 'respecte' && measured < 2) {
        verdict = 'partiel';
        headline = 'Séance conforme sur les données disponibles';
    }

    return { verdict, score, duration, workVolume, intensity, headline, details };
}
