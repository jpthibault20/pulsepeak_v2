/******************************************************************************
 * @file    stats/computeTSS.ts
 * @brief   Source unique de vérité pour le calcul et la lecture du TSS.
 *
 * Cascade par sport (priorité décroissante) :
 *   - cycling  : puissance (NP/FTP) → cardio (Karvonen) → défaut sport
 *   - running  : allure (NGP/seuil) → cardio (Karvonen) → défaut sport
 *   - swimming : allure (pace/CSS, IF cubé) → cardio (Karvonen) → défaut sport
 *
 * Le calcul est fait à l'écriture (import Strava ou saisie manuelle) via
 * `computeWorkoutTSS` qui renseigne `calculatedTSS` + `tssSource`.
 * À la lecture, `getWorkoutTSS` lit simplement le TSS canonique stocké.
 *
 * Fichier client-safe — peut être importé depuis composants client comme
 * depuis Server Actions / Server Components.
 ******************************************************************************/

import type { Profile, Workout } from '@/lib/data/DatabaseTypes';
import type { CompletedData, SportType, TssSource } from '@/lib/data/type';

// ─── Constantes ───────────────────────────────────────────────────────────────

/** TSS / heure pour le calcul de défaut (dernier fallback). */
const DEFAULT_TSS_PER_HOUR: Record<SportType, number> = {
    cycling: 50,
    running: 60,
    swimming: 55,
    other: 50,
};

/** Allure seuil ≈ 88% de la VMA (convention française pour le seuil anaérobie). */
const VMA_TO_THRESHOLD_RATIO = 0.88;

// ─── Helpers internes ─────────────────────────────────────────────────────────

interface TssResult {
    tss: number;
    source: TssSource;
    intensityFactor: number | null;
}

/** Convertit "5:30" (mm:ss) en secondes. */
function paceToSeconds(pace: string | null | undefined): number | null {
    if (!pace) return null;
    const m = /^(\d+):(\d{1,2})$/.exec(pace.trim());
    if (!m) return null;
    return parseInt(m[1], 10) * 60 + parseInt(m[2], 10);
}

/**
 * Formate des secondes en allure « m:ss ».
 * L'arrondi des secondes peut atteindre 60 (ex. 119.6 s) : on retient alors la
 * minute, sinon on afficherait « 1:60 ».
 */
function formatPaceSeconds(totalSeconds: number): string {
    let m = Math.floor(totalSeconds / 60);
    let s = Math.round(totalSeconds - m * 60);
    if (s === 60) {
        m += 1;
        s = 0;
    }
    return `${m}:${s.toString().padStart(2, '0')}`;
}

/** Convertit une vitesse (km/h) en allure mm:ss/km. */
export function speedKmhToPaceMinPerKm(speedKmh: number | null | undefined): string | null {
    if (!speedKmh || speedKmh <= 0) return null;
    return formatPaceSeconds(3600 / speedKmh);
}

/** Convertit une vitesse (m/s) en allure mm:ss/100m. */
export function speedMsToPace100m(speedMs: number | null | undefined): string | null {
    if (!speedMs || speedMs <= 0) return null;
    return formatPaceSeconds(100 / speedMs);
}

// ─── Dérivation des seuils depuis le profil ───────────────────────────────────

/**
 * Allure seuil de course en km/h, dérivée de la VMA du profil.
 * Si pas de VMA : null (la cascade passera à la FC ou au défaut).
 */
export function getRunThresholdSpeedKmh(profile: Profile | undefined | null): number | null {
    const vma = profile?.running?.Test?.vma;
    if (!vma || vma <= 0) return null;
    return vma * VMA_TO_THRESHOLD_RATIO;
}

/**
 * CSS (Critical Swim Speed) approximée en m/s, dérivée du dernier test de
 * natation : vitesse moyenne d'un effort 200-1500m. Pour un effort plus court
 * (<200m), trop éloigné du seuil aérobie : on retourne null.
 */
export function getSwimCSSms(profile: Profile | undefined | null): number | null {
    const test = profile?.swimming?.Test;
    const time = Number(test?.recentRaceTimeSec);
    const dist = Number(test?.recentRaceDistanceMeters);
    if (!time || !dist || time <= 0 || dist < 200) return null;
    return dist / time;
}

// ─── Calculs TSS — un par méthode ─────────────────────────────────────────────

/**
 * TSS puissance : (durée_h) × IF² × 100, avec IF = NP / FTP.
 * Référence : 1h à FTP = 100 TSS.
 */
function tssFromPower(input: { durationSec: number; np: number; ftp: number }): TssResult | null {
    const { durationSec, np, ftp } = input;
    if (durationSec <= 0 || np <= 0 || ftp <= 0) return null;
    const intensityFactor = np / ftp;
    const tss = (durationSec / 3600) * intensityFactor * intensityFactor * 100;
    return { tss: Math.round(tss), source: 'power', intensityFactor: Math.round(intensityFactor * 100) / 100 };
}

/**
 * hrTSS via réserve de fréquence cardiaque (Karvonen) :
 *   IF = (HRavg − HRrest) / (HRmax − HRrest)
 * Si HRrest absente : repli sur HRavg / HRmax.
 * IF² × heures × 100, comme TrainingPeaks (approximation hrTSS).
 */
function tssFromHR(input: {
    durationSec: number;
    avgHR: number;
    maxHR: number;
    restHR?: number | null;
}): TssResult | null {
    const { durationSec, avgHR, maxHR } = input;
    if (durationSec <= 0 || avgHR <= 0 || maxHR <= 0) return null;
    const restHR = input.restHR ?? 0;
    const ratio = restHR > 0
        ? (avgHR - restHR) / (maxHR - restHR)
        : avgHR / maxHR;
    const intensityFactor = Math.min(Math.max(ratio, 0), 1);
    const tss = (durationSec / 3600) * intensityFactor * intensityFactor * 100;
    return { tss: Math.round(tss), source: 'hr', intensityFactor: Math.round(intensityFactor * 100) / 100 };
}

/**
 * rTSS course : IF = vitesse_moyenne / vitesse_seuil ; rTSS = h × IF² × 100.
 * Note : on n'a pas le NGP (Normalized Graded Pace) brut depuis Strava sans
 * stream complet ; on approxime avec la vitesse moyenne. Tant qu'on n'a pas le
 * dénivelé instantané, c'est l'approximation standard et c'est plus fiable que
 * la FC (qui dérive avec la chaleur, le café, le manque de sommeil…).
 */
function tssFromRunPace(input: {
    durationSec: number;
    avgSpeedKmh: number;
    thresholdSpeedKmh: number;
}): TssResult | null {
    const { durationSec, avgSpeedKmh, thresholdSpeedKmh } = input;
    if (durationSec <= 0 || avgSpeedKmh <= 0 || thresholdSpeedKmh <= 0) return null;
    const intensityFactor = avgSpeedKmh / thresholdSpeedKmh;
    const tss = (durationSec / 3600) * intensityFactor * intensityFactor * 100;
    return { tss: Math.round(tss), source: 'pace', intensityFactor: Math.round(intensityFactor * 100) / 100 };
}

/**
 * sTSS natation : IF cubé (résistance de l'eau augmente plus vite avec la
 * vitesse) ; IF = vitesse / CSS ; sTSS = h × IF³ × 100.
 */
function tssFromSwimPace(input: {
    durationSec: number;
    avgSpeedMs: number;
    cssMs: number;
}): TssResult | null {
    const { durationSec, avgSpeedMs, cssMs } = input;
    if (durationSec <= 0 || avgSpeedMs <= 0 || cssMs <= 0) return null;
    const intensityFactor = avgSpeedMs / cssMs;
    const tss = (durationSec / 3600) * Math.pow(intensityFactor, 3) * 100;
    return { tss: Math.round(tss), source: 'pace', intensityFactor: Math.round(intensityFactor * 100) / 100 };
}

/** Estimation forfaitaire — dernier recours. */
function tssDefault(durationSec: number, sport: SportType): TssResult {
    const tss = (durationSec / 3600) * DEFAULT_TSS_PER_HOUR[sport];
    return { tss: Math.round(tss), source: 'default', intensityFactor: null };
}

// ─── Cascade par sport ────────────────────────────────────────────────────────

export interface TssSignals {
    durationSec: number;
    sport: SportType;

    // Puissance (vélo)
    np?: number | null;          // Normalized Power (ou avg si pas de NP)

    // Cardio (tous sports)
    avgHR?: number | null;
    // Course
    avgSpeedKmh?: number | null;
    // Natation
    avgSpeedMs?: number | null;
}

/**
 * Calcule le TSS d'une séance à partir de ses signaux bruts en suivant la
 * cascade par sport. Renvoie toujours un résultat (au pire, le défaut sport).
 */
export function computeTSSFromSignals(signals: TssSignals, profile: Profile | undefined | null): TssResult {
    const { durationSec, sport } = signals;
    if (durationSec <= 0) return { tss: 0, source: 'default', intensityFactor: null };

    const ftp = profile?.cycling?.Test?.ftp ?? 0;
    const maxHR = profile?.heartRate?.max ?? 0;
    const restHR = profile?.heartRate?.resting ?? 0;
    const runThreshold = getRunThresholdSpeedKmh(profile);
    const swimCSS = getSwimCSSms(profile);

    if (sport === 'cycling') {
        if (signals.np && ftp) {
            const r = tssFromPower({ durationSec, np: signals.np, ftp });
            if (r) return r;
        }
        if (signals.avgHR && maxHR) {
            const r = tssFromHR({ durationSec, avgHR: signals.avgHR, maxHR, restHR });
            if (r) return r;
        }
        return tssDefault(durationSec, sport);
    }

    if (sport === 'running') {
        if (signals.avgSpeedKmh && runThreshold) {
            const r = tssFromRunPace({ durationSec, avgSpeedKmh: signals.avgSpeedKmh, thresholdSpeedKmh: runThreshold });
            if (r) return r;
        }
        if (signals.avgHR && maxHR) {
            const r = tssFromHR({ durationSec, avgHR: signals.avgHR, maxHR, restHR });
            if (r) return r;
        }
        return tssDefault(durationSec, sport);
    }

    if (sport === 'swimming') {
        if (signals.avgSpeedMs && swimCSS) {
            const r = tssFromSwimPace({ durationSec, avgSpeedMs: signals.avgSpeedMs, cssMs: swimCSS });
            if (r) return r;
        }
        if (signals.avgHR && maxHR) {
            const r = tssFromHR({ durationSec, avgHR: signals.avgHR, maxHR, restHR });
            if (r) return r;
        }
        return tssDefault(durationSec, sport);
    }

    // sport === 'other' (renforcement, etc.)
    if (signals.avgHR && maxHR) {
        const r = tssFromHR({ durationSec, avgHR: signals.avgHR, maxHR, restHR });
        if (r) return r;
    }
    return tssDefault(durationSec, sport);
}

// ─── Compute & extraction par workout ─────────────────────────────────────────

/**
 * Extrait les signaux bruts depuis un CompletedData et calcule le TSS.
 * Appelé à l'écriture (import Strava, saisie manuelle).
 */
export function computeWorkoutTSS(
    sport: SportType,
    cd: CompletedData,
    profile: Profile | undefined | null
): TssResult {
    const durationSec = (cd.actualDurationMinutes ?? 0) * 60;

    // Puissance vélo : NP en priorité, sinon avg
    const np = cd.metrics?.cycling?.normalizedPowerWatts ?? cd.metrics?.cycling?.avgPowerWatts ?? null;

    const avgHR = cd.heartRate?.avgBPM ?? null;

    // Vitesse course : depuis metrics ou depuis distance/durée
    let avgSpeedKmh: number | null = null;
    if (sport === 'running') {
        avgSpeedKmh = cd.metrics?.running?.avgSpeedKmH ?? null;
        if (!avgSpeedKmh && cd.distanceKm && durationSec > 0) {
            avgSpeedKmh = (cd.distanceKm / (durationSec / 3600));
        }
    }

    // Vitesse natation (m/s) : depuis distance/durée (avgSpeed pas toujours présent)
    let avgSpeedMs: number | null = null;
    if (sport === 'swimming') {
        if (cd.distanceKm && durationSec > 0) {
            avgSpeedMs = (cd.distanceKm * 1000) / durationSec;
        }
    }

    return computeTSSFromSignals(
        { durationSec, sport, np, avgHR, avgSpeedKmh, avgSpeedMs },
        profile,
    );
}

/**
 * Lecture canonique du TSS d'une séance.
 *
 * Ordre :
 *   1. cd.calculatedTSS (TSS canonique, calculé à l'écriture)
 *   2. metrics.{sport}.tss (legacy : workouts antérieurs à la centralisation)
 *   3. Si profile fourni : recalcul à la volée via computeWorkoutTSS (legacy)
 *   4. 0
 *
 * ⚠️ Ne retombe JAMAIS sur plannedTSS — un TSS planifié n'est pas une mesure
 * de la charge réellement encaissée et fausserait CTL/ATL.
 */
export function getWorkoutTSS(workout: Workout, profile?: Profile | null): number {
    if (workout.status !== 'completed' || !workout.completedData) return 0;
    const cd = workout.completedData;

    if (cd.calculatedTSS != null && cd.calculatedTSS > 0) return cd.calculatedTSS;

    // Legacy : workouts qui n'ont que metrics.{sport}.tss (avant la centralisation)
    const legacy =
        cd.metrics?.cycling?.tss ??
        cd.metrics?.running?.tss ??
        cd.metrics?.swimming?.tss ??
        null;
    if (legacy != null && legacy > 0) return legacy;

    // Recalcul à la volée si on a le profil (cas d'un workout legacy sans calculatedTSS)
    if (profile) {
        const r = computeWorkoutTSS(workout.sportType, cd, profile);
        if (r.tss > 0) return r.tss;
    }

    return 0;
}

// ─── Réexports utilitaires ────────────────────────────────────────────────────

export { paceToSeconds };
