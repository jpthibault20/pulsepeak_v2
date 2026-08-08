import type { ElementType } from 'react';
import {
    Activity, Zap, Mountain, RefreshCw, Heart,
    Timer, Gauge, TrendingUp, Flame, Target, Route,
    Bike, FootprintsIcon as Running, Waves,
} from 'lucide-react';
import type { SportType } from '@/lib/data/type';
import type { Workout } from '@/lib/data/DatabaseTypes';
import { getWorkoutTSS } from '@/lib/stats/computeTSS';

// ─── Config par sport ─────────────────────────────────────────────────────────

export const SPORT_CONFIG: Record<SportType, {
    icon: ElementType;
    color: string;
    bgLight: string;
    gradient: string;
    borderAccent: string;
    label: string;
}> = {
    cycling: {
        icon: Bike,
        color: 'text-purple-600 dark:text-purple-400',
        bgLight: 'bg-purple-50 dark:bg-purple-500/10',
        gradient: 'from-purple-500/20 via-purple-500/5 to-transparent',
        borderAccent: 'border-purple-300 dark:border-purple-500/30',
        label: 'Vélo'
    },
    running: {
        icon: Running,
        color: 'text-orange-600 dark:text-orange-400',
        bgLight: 'bg-orange-50 dark:bg-orange-500/10',
        gradient: 'from-orange-500/20 via-orange-500/5 to-transparent',
        borderAccent: 'border-orange-300 dark:border-orange-500/30',
        label: 'Course'
    },
    swimming: {
        icon: Waves,
        color: 'text-cyan-600 dark:text-cyan-400',
        bgLight: 'bg-cyan-50 dark:bg-cyan-500/10',
        gradient: 'from-cyan-500/20 via-cyan-500/5 to-transparent',
        borderAccent: 'border-cyan-300 dark:border-cyan-500/30',
        label: 'Natation'
    },
    other: {
        icon: Mountain,
        color: 'text-emerald-600 dark:text-emerald-400',
        bgLight: 'bg-emerald-50 dark:bg-emerald-500/10',
        gradient: 'from-emerald-500/20 via-emerald-500/5 to-transparent',
        borderAccent: 'border-emerald-300 dark:border-emerald-500/30',
        label: 'Autre'
    },
};

// ─── Formatage ────────────────────────────────────────────────────────────────

export function fmtDuration(minutes: number | undefined | null): string {
    if (!minutes) return '-';
    if (minutes >= 60) {
        const h = Math.floor(minutes / 60);
        const m = Math.round(minutes % 60);
        return `${h}h${String(m).padStart(2, '0')}`;
    }
    return `${Math.round(minutes)} min`;
}

export function fmtDurationSec(totalSeconds: number | undefined): string {
    if (!totalSeconds) return '-';
    const h = Math.floor(totalSeconds / 3600);
    const m = Math.floor((totalSeconds % 3600) / 60);
    const s = Math.floor(totalSeconds % 60);
    if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
    return `${m}:${String(s).padStart(2, '0')}`;
}

// ─── Tuiles de métriques (séance réalisée) ────────────────────────────────────

export interface MetricTile {
    label: string;
    value: string;
    sub?: string;
    icon: ElementType;
    accent?: string;
    large?: boolean;
}

export function getCompletedMetrics(workout: Workout): MetricTile[] {
    const cd = workout.completedData;
    if (!cd) return [];
    const tiles: MetricTile[] = [];
    const sport = workout.sportType;

    if (cd.actualDurationMinutes) {
        tiles.push({ label: 'Durée', value: fmtDurationSec(cd.actualDurationMinutes * 60), icon: Timer, large: true });
    }
    if (cd.distanceKm && cd.distanceKm > 0) {
        tiles.push({ label: 'Distance', value: `${cd.distanceKm.toFixed(1)}`, sub: 'km', icon: Route, large: true });
    }
    // TSS canonique (toutes sources, pas seulement la puissance vélo)
    const displayTSS = getWorkoutTSS(workout);
    if (displayTSS > 0) {
        tiles.push({ label: 'TSS', value: `${Math.round(displayTSS)}`, icon: Zap, accent: 'text-amber-600 dark:text-amber-400', large: true });
    }
    if (cd.heartRate?.avgBPM) {
        tiles.push({ label: 'FC Moy', value: `${cd.heartRate.avgBPM}`, sub: cd.heartRate.maxBPM ? `max ${cd.heartRate.maxBPM}` : 'bpm', icon: Heart, accent: 'text-rose-600 dark:text-rose-400' });
    }
    if (sport === 'cycling' && cd.metrics?.cycling) {
        const c = cd.metrics.cycling;
        if (c.avgPowerWatts) tiles.push({ label: 'Puissance Moy', value: `${c.avgPowerWatts}`, sub: 'W', icon: Gauge });
        if (c.normalizedPowerWatts) tiles.push({ label: 'NP', value: `${c.normalizedPowerWatts}`, sub: 'W', icon: TrendingUp });
        if (c.avgCadenceRPM) tiles.push({ label: 'Cadence', value: `${c.avgCadenceRPM}`, sub: 'rpm', icon: RefreshCw });
        if (c.elevationGainMeters) tiles.push({ label: 'D+', value: `${c.elevationGainMeters}`, sub: 'm', icon: Mountain });
        if (c.avgSpeedKmH) tiles.push({ label: 'Vitesse Moy', value: `${c.avgSpeedKmH.toFixed(1)}`, sub: 'km/h', icon: Gauge });
    }
    if (sport === 'running' && cd.metrics?.running) {
        const r = cd.metrics.running;
        if (r.avgPaceMinPerKm) tiles.push({ label: 'Allure Moy', value: `${r.avgPaceMinPerKm}`, sub: '/km', icon: Gauge });
        if (r.elevationGainMeters) tiles.push({ label: 'D+', value: `${r.elevationGainMeters}`, sub: 'm', icon: Mountain });
        if (r.avgCadenceSPM) tiles.push({ label: 'Cadence', value: `${r.avgCadenceSPM}`, sub: 'spm', icon: RefreshCw });
    }
    if (sport === 'swimming' && cd.metrics?.swimming) {
        const s = cd.metrics.swimming;
        if (s.avgPace100m) tiles.push({ label: 'Allure', value: `${s.avgPace100m}`, sub: '/100m', icon: Gauge });
        if (s.avgSwolf) tiles.push({ label: 'SWOLF', value: `${s.avgSwolf}`, icon: Activity });
    }
    if (cd.caloriesBurned) {
        tiles.push({ label: 'Calories', value: `${cd.caloriesBurned}`, sub: 'kcal', icon: Flame });
    }
    if (cd.perceivedEffort != null) {
        tiles.push({
            label: 'RPE', value: `${cd.perceivedEffort.toFixed(1)}`, sub: '/ 10', icon: Target,
            accent: cd.perceivedEffort >= 8.5 ? 'text-red-600 dark:text-red-400' : cd.perceivedEffort >= 7 ? 'text-orange-600 dark:text-orange-400' : 'text-emerald-600 dark:text-emerald-400'
        });
    }
    return tiles;
}
