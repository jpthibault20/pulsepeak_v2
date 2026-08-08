import type { CompletedLap, SportType, Zones } from '@/lib/data/type';
import type { Profile } from '@/lib/data/DatabaseTypes';

// ─── Rôle d'un tour ───────────────────────────────────────────────────────────

export type LapRole = 'warmup' | 'work' | 'recovery' | 'cooldown' | 'steady';

export interface AnalyzedLap {
    lap: CompletedLap;
    role: LapRole;
    /** 1..7, ou null si aucune zone exploitable pour ce sport */
    zone: number | null;
    /** Grandeur de comparaison, croissante avec l'effort (watts, ou m/s) */
    intensity: number | null;
    /** Course : secondes par km */
    paceSecPerKm: number | null;
    /** Natation : secondes par 100 m */
    paceSecPer100m: number | null;
}

export interface LapSegment {
    kind: 'warmup' | 'cooldown' | 'series' | 'list';
    laps: AnalyzedLap[];
    /** Séries uniquement : « 5 × 4'00 @ Z4 » */
    repCount?: number;
    repDurationSec?: number;
    zone?: number | null;
}

// ─── Zones ────────────────────────────────────────────────────────────────────

/**
 * Résout la zone d'une valeur.
 *
 * `descending` = true pour les allures : les zones course sont stockées en
 * SECONDES PAR KM, donc Z5 porte les valeurs numériques les plus basses. Un
 * classement par seuils croissants (comme bucketByZones, prévu pour watts et
 * bpm) rangerait un sprint en Z1.
 */
function resolveZone(value: number, zones: Zones, descending: boolean): number | null {
    const list: Array<{ n: number; min: number; max: number }> = [
        { n: 1, ...zones.z1 },
        { n: 2, ...zones.z2 },
        { n: 3, ...zones.z3 },
        { n: 4, ...zones.z4 },
        { n: 5, ...zones.z5 },
        ...(zones.z6 ? [{ n: 6, ...zones.z6 }] : []),
        ...(zones.z7 ? [{ n: 7, ...zones.z7 }] : []),
    ].filter(z => Number.isFinite(z.min) && Number.isFinite(z.max));

    if (list.length === 0) return null;
    const top = list[list.length - 1];

    // Classement par SEUIL et non par intervalle : les bornes saisies laissent
    // des trous (z4 finit à 284 W, z5 démarre à 286 W) et un test de contenance
    // y échoue — 285 W se retrouvait rangé en Z1.
    if (descending) {
        // Allures en sec/km : plus la valeur est basse, plus la zone est haute.
        return (list.find(z => value >= z.min) ?? top).n;
    }
    return (list.find(z => value <= z.max) ?? top).n;
}

/** Zones utilisables pour ce sport, avec le sens de lecture. */
function zonesForSport(sport: SportType, profile: Profile): { zones: Zones; descending: boolean; source: 'power' | 'pace' | 'hr' } | null {
    if (sport === 'cycling' && profile.cycling?.Test?.zones) {
        return { zones: profile.cycling.Test.zones, descending: false, source: 'power' };
    }
    if (sport === 'running' && profile.running?.Test?.zones) {
        return { zones: profile.running.Test.zones, descending: true, source: 'pace' };
    }
    if (profile.heartRate?.zones) {
        return { zones: profile.heartRate.zones, descending: false, source: 'hr' };
    }
    return null;
}

// ─── Analyse ──────────────────────────────────────────────────────────────────

/** Vitesse en m/s — grandeur de comparaison universelle quand la puissance manque. */
function speedOf(lap: CompletedLap): number | null {
    if (!lap.durationSeconds || lap.distanceMeters <= 0) return null;
    return lap.distanceMeters / lap.durationSeconds;
}

export function analyzeLaps(laps: CompletedLap[], sport: SportType, profile: Profile): AnalyzedLap[] {
    const zoneCfg = zonesForSport(sport, profile);

    const base: AnalyzedLap[] = laps.map((lap) => {
        const speed = speedOf(lap);
        const intensity = sport === 'cycling' && lap.avgPower != null ? lap.avgPower : speed;

        let zone: number | null = null;
        if (zoneCfg) {
            if (zoneCfg.source === 'power' && lap.avgPower != null) {
                zone = resolveZone(lap.avgPower, zoneCfg.zones, false);
            } else if (zoneCfg.source === 'pace' && speed) {
                zone = resolveZone(1000 / speed, zoneCfg.zones, true); // sec/km
            } else if (zoneCfg.source === 'hr' && lap.avgHeartRate != null) {
                // La FC moyenne sous 90 s sous-estime massivement l'effort (délai
                // cardiaque) : on refuse de classer un tour court sur cette base.
                if (lap.durationSeconds >= 90) zone = resolveZone(lap.avgHeartRate, zoneCfg.zones, false);
            }
        }

        return {
            lap,
            role: 'steady' as LapRole,
            zone,
            intensity,
            paceSecPerKm: sport === 'running' && speed ? 1000 / speed : null,
            paceSecPer100m: sport === 'swimming' && speed ? 100 / speed : null,
        };
    });

    return assignRoles(base);
}

/**
 * Attribue un rôle à chaque tour.
 *
 * La récupération se détecte RELATIVEMENT aux voisins, jamais sur la zone
 * absolue : dans un 40"/20", le « 20 secondes » se roule souvent à 230 W, donc
 * en Z3. Le juger sur sa zone le classait en travail et faisait éclater la série
 * en trente segments d'un seul tour.
 */
function assignRoles(items: AnalyzedLap[]): AnalyzedLap[] {
    if (items.length === 0) return items;

    const out: AnalyzedLap[] = items.map(it => ({ ...it, role: 'steady' as LapRole }));

    // 1. Récupérations : nettement moins intenses qu'un voisin, et courtes par
    //    rapport à lui. Le garde de durée évite de prendre un bloc d'endurance
    //    de 10 min intercalé entre deux séries pour une récupération.
    for (let i = 0; i < out.length; i++) {
        const it = out[i];
        if (it.intensity == null) continue;

        const neighbours = [items[i - 1], items[i + 1]].filter(
            (n): n is AnalyzedLap => !!n && n.intensity != null,
        );
        if (neighbours.length === 0) continue;

        // La durée de référence est celle du voisin le plus INTENSE, pas du plus
        // long : sinon un échauffement de 10 min voisin d'un sprint de 15 s
        // autorise des « récupérations » de 30 min.
        const peakNeighbour = neighbours.reduce((a, b) => (b.intensity! > a.intensity! ? b : a));
        const peak = peakNeighbour.intensity!;
        const maxRecoveryDuration = Math.max(180, peakNeighbour.lap.durationSeconds * 3);

        if (it.intensity < peak * 0.85 && it.lap.durationSeconds <= maxRecoveryDuration) {
            it.role = 'recovery';
        }
    }

    // 2. Travail : tout ce qui n'est pas récupération et qui sort de l'endurance.
    for (let i = 0; i < out.length; i++) {
        const it = out[i];
        if (it.role === 'recovery') continue;
        if (it.zone != null ? it.zone >= 3 : false) it.role = 'work';
    }

    // 3. Échauffement / retour au calme : premier et dernier tour, longs et faciles.
    const LONG = 8 * 60;
    const first = out[0];
    if (first.role !== 'work' && first.lap.durationSeconds >= LONG) first.role = 'warmup';

    const last = out[out.length - 1];
    if (out.length > 1 && last.role !== 'work' && last.lap.durationSeconds >= LONG) last.role = 'cooldown';

    return out;
}

/**
 * Détecte des splits automatiques (tous les tours à la même distance : 1 km,
 * 1 mile…). Il n'y a alors AUCUNE structure d'intervalle à lire — chercher des
 * séries là-dedans reviendrait à inventer un découpage.
 */
export function isAutoSplit(laps: CompletedLap[]): boolean {
    if (laps.length < 4) return false;
    const distances = laps.slice(0, -1).map(l => l.distanceMeters); // le dernier tour est souvent tronqué
    if (distances.some(d => d <= 0)) return false;
    const ref = distances[0];
    return distances.every(d => Math.abs(d - ref) / ref < 0.02);
}

/**
 * Découpe la séance en segments affichables.
 * Une série = au moins 3 tours de travail de durée homogène (±15 %).
 */
export function segmentLaps(items: AnalyzedLap[]): LapSegment[] {
    if (items.length === 0) return [];

    const segments: LapSegment[] = [];
    let i = 0;

    if (items[0].role === 'warmup') {
        segments.push({ kind: 'warmup', laps: [items[0]] });
        i = 1;
    }

    let tail: LapSegment | null = null;
    let end = items.length;
    if (items[end - 1].role === 'cooldown' && end - 1 > i) {
        tail = { kind: 'cooldown', laps: [items[end - 1]] };
        end -= 1;
    }

    // Corps de séance : on regroupe les tours de travail de durée comparable.
    let buffer: AnalyzedLap[] = [];
    const flush = () => {
        if (buffer.length === 0) return;
        const workLaps = buffer.filter(b => b.role === 'work');
        if (workLaps.length >= 3) {
            const durations = workLaps.map(w => w.lap.durationSeconds).sort((a, b) => a - b);
            segments.push({
                kind: 'series',
                laps: buffer,
                repCount: workLaps.length,
                repDurationSec: durations[Math.floor(durations.length / 2)],
                zone: workLaps[0].zone,
            });
        } else {
            segments.push({ kind: 'list', laps: buffer });
        }
        buffer = [];
    };

    let currentRepDuration: number | null = null;
    for (; i < end; i++) {
        const it = items[i];
        if (it.role === 'work') {
            // Un changement net de format (ex. 5×4' puis 3×1') ouvre une nouvelle série.
            if (currentRepDuration != null && Math.abs(it.lap.durationSeconds - currentRepDuration) / currentRepDuration > 0.15) {
                flush();
                currentRepDuration = it.lap.durationSeconds;
            } else if (currentRepDuration == null) {
                currentRepDuration = it.lap.durationSeconds;
            }
        }
        buffer.push(it);
    }
    flush();

    if (tail) segments.push(tail);
    return segments;
}

// ─── Présentation ─────────────────────────────────────────────────────────────

/**
 * 4 familles sémantiques plutôt que 7 zones : au-delà, le liseré n'est plus
 * lisible d'un coup d'œil et cesse de servir à quoi que ce soit.
 */
export function zoneAccent(zone: number | null): string {
    if (zone == null) return 'bg-slate-300 dark:bg-slate-700';
    if (zone <= 2) return 'bg-sky-400/70 dark:bg-sky-500/60';
    if (zone === 3) return 'bg-emerald-500';
    if (zone === 4) return 'bg-amber-500';
    return 'bg-red-500';
}

export function zoneLabel(zone: number | null): string | null {
    return zone == null ? null : `Z${zone}`;
}

/** « 3:52 » à partir de secondes par km / par 100 m. */
export function fmtPace(secondsPerUnit: number): string {
    const m = Math.floor(secondsPerUnit / 60);
    const s = Math.round(secondsPerUnit % 60);
    if (s === 60) return `${m + 1}:00`;
    return `${m}:${String(s).padStart(2, '0')}`;
}
