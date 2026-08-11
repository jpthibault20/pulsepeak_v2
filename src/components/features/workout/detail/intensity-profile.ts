/******************************************************************************
 * @file    intensity-profile.ts
 * @brief   Lecture de l'intensité d'une séance réalisée : IF global (à quelle
 *          intensité relative elle a été roulée/courue) + répartition du temps
 *          passé par zone.
 *
 *          L'IF suit la MÊME cascade que le TSS (computeTSS.ts) pour que le
 *          chiffre affiché explique toujours le TSS affiché :
 *            - vélo   : puissance (NP/FTP) → cardio (Karvonen)
 *            - course : allure (vitesse moy / seuil VMA) → cardio
 *          Il est déjà persisté à l'import (`completedData.intensityFactor` +
 *          `tssSource`) ; on ne recalcule que pour les séances antérieures.
 *
 *          La répartition en zones vient des streams Strava
 *          (`completedData.zoneDistribution`, seconde par seconde). Sans stream
 *          (saisie manuelle, import ancien) on la reconstruit depuis les tours,
 *          pondérée par leur durée : plus grossier, mais lisible. La cascade y
 *          est celle des données réellement disponibles sur un tour —
 *          vélo : puissance → cardio ; course : cardio → allure — identique à
 *          ce que produit le chemin « streams ».
 ******************************************************************************/

import type { CompletedLap, SportType, Zones } from '@/lib/data/type';
import type { Profile, Workout } from '@/lib/data/DatabaseTypes';
import {
    computeWorkoutTSS,
    getRunThresholdSpeedKmh,
    speedKmhToPaceMinPerKm,
} from '@/lib/stats/computeTSS';
import {
    intensityScaleBounds, intensityScaleKey, readIntensityLevel, type IntensityLevel,
} from '@/lib/stats/intensityScale';
import { resolveZone } from './lap-analysis';

/** Métrique de référence utilisée pour lire l'intensité. */
export type IntensitySource = 'power' | 'hr' | 'pace';

export const SOURCE_LABEL: Record<IntensitySource, string> = {
    power: 'puissance',
    hr: 'cardio',
    pace: 'allure',
};

// ─── Intensity Factor ─────────────────────────────────────────────────────────

export interface IntensityFactorInfo {
    /** Ratio effort / seuil (1.00 = une heure à fond au seuil). */
    value: number;
    source: IntensitySource;
    /** Lecture qualitative : « Endurance », « Seuil »… */
    label: IntensityLevel;
    /** Classe Tailwind de la couleur associée au niveau. */
    accent: string;
    /** D'où sort le ratio : « NP 254 W · FTP 292 W ». Null si non reconstituable. */
    detail: string | null;
    /** Échelle de la source, pour situer la valeur sur une jauge. */
    scale: IntensityScale;
}

export interface IntensityBand {
    level: IntensityLevel;
    from: number;
    to: number;
}

export interface IntensityScale {
    min: number;
    max: number;
    bands: IntensityBand[];
    /** Entrée dans la bande « Seuil » — le repère qui donne l'échelle. */
    thresholdAt: number;
}

/**
 * Bandes affichables de l'échelle. Les extrémités sont ouvertes (un IF n'a pas
 * de plancher ni de plafond) : on les borne à ±  ~30 % / 12 % des seuils utiles,
 * assez large pour que le curseur reste visible sans écraser les bandes utiles.
 */
function buildScale(bounds: readonly number[]): IntensityScale {
    const min = Math.round(bounds[0] * 0.7 * 100) / 100;
    const max = Math.round(bounds[bounds.length - 1] * 1.12 * 100) / 100;
    const edges = [min, ...bounds, max];
    const levels: IntensityLevel[] = ['Récupération', 'Endurance', 'Tempo', 'Seuil', 'VO2max'];

    return {
        min,
        max,
        thresholdAt: bounds[2],
        bands: levels.map((level, i) => ({ level, from: edges[i], to: edges[i + 1] })),
    };
}

/** Couleur d'un niveau — même code couleur que les zones (`zoneAccent`). */
const LEVEL_ACCENT: Record<IntensityLevel, string> = {
    'Récupération': 'text-sky-600 dark:text-sky-400',
    'Endurance': 'text-sky-600 dark:text-sky-400',
    'Tempo': 'text-emerald-600 dark:text-emerald-400',
    'Seuil': 'text-amber-600 dark:text-amber-400',
    'VO2max': 'text-red-600 dark:text-red-400',
};

/** Détail chiffré du ratio, selon la métrique qui a servi à le calculer. */
function intensityDetail(
    source: IntensitySource,
    workout: Workout,
    profile: Profile,
): string | null {
    const cd = workout.completedData;
    if (!cd) return null;

    if (source === 'power') {
        const np = cd.metrics?.cycling?.normalizedPowerWatts ?? cd.metrics?.cycling?.avgPowerWatts ?? null;
        const ftp = profile.cycling?.Test?.ftp ?? null;
        if (!np || !ftp) return null;
        const isNP = cd.metrics?.cycling?.normalizedPowerWatts != null;
        return `${isNP ? 'NP' : 'Puissance moy'} ${Math.round(np)} W · FTP ${Math.round(ftp)} W`;
    }

    if (source === 'hr') {
        const avg = cd.heartRate?.avgBPM ?? null;
        const max = profile.heartRate?.max ?? null;
        if (!avg || !max) return null;
        const rest = profile.heartRate?.resting ?? null;
        return rest
            ? `FC moy ${Math.round(avg)} · réserve ${Math.round(rest)}–${Math.round(max)} bpm`
            : `FC moy ${Math.round(avg)} · FC max ${Math.round(max)} bpm`;
    }

    // source === 'pace' — course uniquement (la card ne couvre pas la natation).
    const threshold = speedKmhToPaceMinPerKm(getRunThresholdSpeedKmh(profile));
    let pace = cd.metrics?.running?.avgPaceMinPerKm ?? null;
    if (!pace && cd.distanceKm && cd.actualDurationMinutes) {
        pace = speedKmhToPaceMinPerKm(cd.distanceKm / (cd.actualDurationMinutes / 60));
    }
    if (!pace || !threshold) return null;
    return `Allure ${pace} /km · seuil ${threshold} /km`;
}

/**
 * IF de la séance. Null quand aucune métrique exploitable ne permet de le
 * calculer (TSS estimé au forfait) — mieux vaut ne rien afficher qu'un ratio
 * qui ne mesure rien.
 */
export function getIntensityFactor(workout: Workout, profile: Profile): IntensityFactorInfo | null {
    const cd = workout.completedData;
    if (!cd) return null;

    let value = cd.intensityFactor ?? null;
    let source = cd.tssSource ?? null;

    // Séances antérieures à la persistance de l'IF : on rejoue la cascade.
    if (value == null || value <= 0 || source == null || source === 'default') {
        const r = computeWorkoutTSS(workout.sportType, cd, profile);
        value = r.intensityFactor;
        source = r.source;
    }

    if (value == null || value <= 0 || source == null || source === 'default') return null;

    // L'échelle dépend de la métrique ET de la convention de calcul (%FCmax vs
    // %FC de réserve) — voir intensityScale.ts.
    const label = readIntensityLevel(value, source, profile);
    const key = intensityScaleKey(source, profile);
    if (!label || !key) return null;

    return {
        value,
        source,
        label,
        accent: LEVEL_ACCENT[label],
        detail: intensityDetail(source, workout, profile),
        scale: buildScale(intensityScaleBounds(key)),
    };
}

// ─── Répartition par zone ─────────────────────────────────────────────────────

export interface ZoneBar {
    /** 1..7 */
    zone: number;
    pct: number;
    minutes: number;
}

export interface ZoneDistributionInfo {
    source: IntensitySource;
    bars: ZoneBar[];
    /** Reconstruit depuis les tours faute de stream : précision moindre. */
    fromLaps: boolean;
}

/** Zones et métrique lisibles sur un TOUR, selon le sport et le profil. */
function lapZoneConfig(sport: SportType, profile: Profile): {
    zones: Zones;
    descending: boolean;
    source: IntensitySource;
    valueOf: (lap: CompletedLap) => number | null;
} | null {
    const hrZones = profile.heartRate?.zones;
    const hrOf = (lap: CompletedLap) => lap.avgHeartRate ?? null;

    if (sport === 'cycling') {
        const powerZones = profile.cycling?.Test?.zones;
        if (powerZones) {
            return {
                zones: powerZones, descending: false, source: 'power',
                valueOf: (lap) => lap.normalizedPower ?? lap.avgPower ?? null,
            };
        }
        if (hrZones) return { zones: hrZones, descending: false, source: 'hr', valueOf: hrOf };
        return null;
    }

    if (sport === 'running') {
        if (hrZones) return { zones: hrZones, descending: false, source: 'hr', valueOf: hrOf };
        const paceZones = profile.running?.Test?.zones;
        if (paceZones) {
            return {
                // Zones course stockées en secondes/km : Z5 porte les valeurs
                // les plus BASSES, d'où la lecture descendante.
                zones: paceZones, descending: true, source: 'pace',
                valueOf: (lap) => {
                    if (!lap.durationSeconds || lap.distanceMeters <= 0) return null;
                    return (lap.durationSeconds / lap.distanceMeters) * 1000;
                },
            };
        }
    }

    return null;
}

/** Pourcentages par zone reconstruits depuis les tours, pondérés par leur durée. */
function distributionFromLaps(
    laps: CompletedLap[],
    sport: SportType,
    profile: Profile,
): { source: IntensitySource; pct: number[] } | null {
    const cfg = lapZoneConfig(sport, profile);
    if (!cfg) return null;

    const seconds = new Array(7).fill(0);
    let covered = 0;

    for (const lap of laps) {
        const duration = lap.durationSeconds;
        if (!duration || duration <= 0) continue;
        const value = cfg.valueOf(lap);
        if (value == null || !Number.isFinite(value) || value <= 0) continue;
        const zone = resolveZone(value, cfg.zones, cfg.descending);
        if (zone == null) continue;
        seconds[zone - 1] += duration;
        covered += duration;
    }

    if (covered <= 0) return null;
    return { source: cfg.source, pct: seconds.map(s => Math.round((s / covered) * 1000) / 10) };
}

/**
 * Répartition du temps par zone.
 *
 * Les zones vides au-delà de la plus haute atteinte sont coupées, mais on garde
 * toujours Z1→Z5 : une séance entièrement en Z2 doit se lire comme telle, pas
 * comme une barre unique sans échelle.
 */
export function getZoneDistribution(workout: Workout, profile: Profile): ZoneDistributionInfo | null {
    const cd = workout.completedData;
    if (!cd) return null;

    let pct = cd.zoneDistribution ?? null;
    let source: IntensitySource | null = cd.zoneDistributionSource ?? null;
    let fromLaps = false;

    if (!pct || pct.length < 3 || !source || pct.every(p => !p)) {
        const fallback = distributionFromLaps(cd.laps ?? [], workout.sportType, profile);
        if (!fallback) return null;
        pct = fallback.pct;
        source = fallback.source;
        fromLaps = true;
    }

    const lastActive = pct.reduce((last, p, i) => (p > 0 ? i : last), 0);
    const shown = pct.slice(0, Math.max(lastActive + 1, 5));
    if (shown.length === 0) return null;

    const totalMinutes = cd.actualDurationMinutes ?? 0;

    return {
        source,
        fromLaps,
        bars: shown.map((p, i) => ({
            zone: i + 1,
            pct: p ?? 0,
            minutes: Math.round(((p ?? 0) / 100) * totalMinutes),
        })),
    };
}
