/******************************************************************************
 * @file    stats/computePMC.test.ts
 * @brief   Tests unitaires du Performance Management Chart : CTL (42 j), ATL
 *          (7 j), TSB, agrégat hebdomadaire et répartition par zones.
 *
 * Horloge figée au 2026-03-15 : `computePMC` et `computeWeeklyTSS` construisent
 * leur fenêtre à partir de `new Date()`.
 ******************************************************************************/

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { computePMC, computeWeeklyTSS, getTSBStatus, aggregateZones } from './computePMC';
import { makeCompletedData, makeCompletedWorkout, makePlannedData, makeWorkout, makeZones } from '@/test/fixtures';

const TODAY = new Date(2026, 2, 15); // 15 mars 2026, minuit local

/** `YYYY-MM-DD` du jour situé `daysAgo` jours avant TODAY (heure locale). */
function dayKey(daysAgo: number): string {
    const d = new Date(TODAY);
    d.setDate(d.getDate() - daysAgo);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/**
 * Une séance complétée à `tss` par jour, sur `days` jours consécutifs.
 * `until` = nombre de jours avant aujourd'hui où s'arrête la série (0 = ce jour).
 */
function dailyLoad(days: number, tss: number, until = 0) {
    return Array.from({ length: days }, (_, i) => makeCompletedWorkout(dayKey(until + i), tss));
}

beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(TODAY);
});

afterEach(() => {
    vi.useRealTimers();
});

// ─── Fenêtre d'affichage ──────────────────────────────────────────────────────

describe('computePMC — fenêtre', () => {
    it('renvoie un point par jour, du plus ancien à aujourd’hui', () => {
        const points = computePMC([], 50, 50, 7);
        expect(points).toHaveLength(7);
        expect(points[0].date).toBe(dayKey(6));
        expect(points[6].date).toBe(dayKey(0));
    });

    it('respecte une fenêtre explicite startDate / endDate', () => {
        const points = computePMC([], 50, 50, 90, dayKey(10), dayKey(4));
        expect(points).toHaveLength(7);
        expect(points[0].date).toBe(dayKey(10));
        expect(points.at(-1)!.date).toBe(dayKey(4));
    });

    it('n’extrapole jamais dans le futur : la fenêtre est bornée à aujourd’hui', () => {
        const points = computePMC([], 50, 50, 90, dayKey(3), dayKey(-30));
        expect(points.at(-1)!.date).toBe(dayKey(0));
    });
});

// ─── Dynamique CTL / ATL ──────────────────────────────────────────────────────

describe('computePMC — décroissance sans entraînement', () => {
    it('fait décroître CTL et ATL jour après jour après un arrêt', () => {
        // 190 jours de charge qui s'arrêtent il y a 10 jours : la fenêtre
        // affichée ne contient que du repos, en partant d'une CTL établie.
        const points = computePMC(dailyLoad(190, 80, 10), 50, 50, 10);
        expect(points[0].ctl).toBeGreaterThan(70);
        for (let i = 1; i < points.length; i++) {
            expect(points[i].ctl).toBeLessThan(points[i - 1].ctl);
            expect(points[i].atl).toBeLessThan(points[i - 1].atl);
        }
    });

    it('vide l’ATL (7 j) bien avant la CTL (42 j)', () => {
        // Le warm-up de 180 jours à zéro écrase déjà l'ATL ; la CTL, elle, garde
        // une trace résiduelle.
        const points = computePMC([], 80, 80, 5);
        const last = points.at(-1)!;
        expect(last.atl).toBe(0);
        expect(last.ctl).toBeGreaterThan(0);
    });
});

describe('computePMC — charge constante', () => {
    it('fait converger CTL et ATL vers la charge quotidienne', () => {
        const points = computePMC(dailyLoad(400, 100), 50, 50, 7);
        const last = points.at(-1)!;
        expect(last.ctl).toBeGreaterThan(98);
        expect(last.ctl).toBeLessThanOrEqual(100);
        expect(last.atl).toBeGreaterThan(98);
        expect(last.atl).toBeLessThanOrEqual(100);
        expect(Math.abs(last.tsb)).toBeLessThan(2);
    });

    it('fait monter l’ATL plus vite que la CTL sur un pic isolé', () => {
        const points = computePMC([makeCompletedWorkout(dayKey(0), 300)], 30, 30, 3);
        const last = points.at(-1)!;
        expect(last.atl).toBeGreaterThan(last.ctl);
        expect(last.tsb).toBeLessThan(0);
    });

    it('expose le TSS du jour dans chaque point', () => {
        const points = computePMC([makeCompletedWorkout(dayKey(1), 120)], 50, 50, 3);
        expect(points.find(p => p.date === dayKey(1))!.tss).toBe(120);
        expect(points.find(p => p.date === dayKey(0))!.tss).toBe(0);
    });

    it('vérifie l’identité TSB = CTL − ATL', () => {
        const points = computePMC(dailyLoad(30, 80), 40, 40, 10);
        for (const p of points) {
            // Les trois champs sont arrondis indépendamment au dixième : l'écart
            // cumulé ne peut pas dépasser un pas d'arrondi.
            expect(Math.abs(p.tsb - (p.ctl - p.atl))).toBeLessThanOrEqual(0.11);
        }
    });
});

describe('computePMC — sélection des séances', () => {
    it('cumule plusieurs séances du même jour', () => {
        const workouts = [
            makeCompletedWorkout(dayKey(1), 60, { id: 'a' }),
            makeCompletedWorkout(dayKey(1), 40, { id: 'b' }),
        ];
        const points = computePMC(workouts, 0, 0, 3);
        expect(points.find(p => p.date === dayKey(1))!.tss).toBe(100);
    });

    it('ignore les séances pending et missed', () => {
        const workouts = [
            makeWorkout({ id: 'p', date: dayKey(1), status: 'pending', plannedData: makePlannedData({ plannedTSS: 200 }) }),
            makeWorkout({ id: 'm', date: dayKey(1), status: 'missed', plannedData: makePlannedData({ plannedTSS: 200 }) }),
        ];
        const points = computePMC(workouts, 0, 0, 3);
        expect(points.every(p => p.tss === 0)).toBe(true);
    });

    it('ignore une séance complétée sans TSS exploitable', () => {
        const workout = makeWorkout({
            date: dayKey(1),
            status: 'completed',
            completedData: makeCompletedData({ calculatedTSS: 0 }),
        });
        const points = computePMC([workout], 0, 0, 3);
        expect(points.every(p => p.tss === 0)).toBe(true);
    });
});

// ─── Agrégat hebdomadaire ─────────────────────────────────────────────────────

describe('computeWeeklyTSS', () => {
    it('renvoie une fenêtre glissante de 7 jours par semaine demandée', () => {
        const points = computeWeeklyTSS([], 4);
        expect(points).toHaveLength(4);
        expect(points.at(-1)!.weekStart).toBe(dayKey(6));
        expect(points[0].weekStart).toBe(dayKey(27));
    });

    it('sépare le TSS planifié du TSS réalisé', () => {
        const workouts = [
            makeWorkout({
                id: 'planifiee',
                date: dayKey(2),
                status: 'pending',
                plannedData: makePlannedData({ plannedTSS: 90 }),
            }),
            makeCompletedWorkout(dayKey(3), 70, { plannedData: makePlannedData({ plannedTSS: 80 }) }),
        ];
        const last = computeWeeklyTSS(workouts, 2).at(-1)!;
        expect(last.planned).toBe(170); // 90 + 80 : le planifié compte quel que soit le statut
        expect(last.actual).toBe(70);   // seul le réalisé de la séance complétée
    });

    it('n’attribue pas une séance à deux semaines', () => {
        const workouts = [makeCompletedWorkout(dayKey(7), 100)];
        const points = computeWeeklyTSS(workouts, 4);
        expect(points.filter(p => p.actual > 0)).toHaveLength(1);
    });
});

// ─── Statut TSB ───────────────────────────────────────────────────────────────

describe('getTSBStatus', () => {
    it('classe la fraîcheur par paliers', () => {
        expect(getTSBStatus(25).label).toBe('Frais & Performant');
        expect(getTSBStatus(5).label).toBe('Équilibré');
        expect(getTSBStatus(-5).label).toBe('Légèrement Fatigué');
        expect(getTSBStatus(-15).label).toBe('Chargé');
        expect(getTSBStatus(-30).label).toBe('Surmenage — Récupère !');
    });

    it('utilise des bornes strictes : la valeur pivot tombe dans le palier inférieur', () => {
        expect(getTSBStatus(10).label).toBe('Équilibré');
        expect(getTSBStatus(0).label).toBe('Légèrement Fatigué');
        expect(getTSBStatus(-10).label).toBe('Chargé');
        expect(getTSBStatus(-20).label).toBe('Surmenage — Récupère !');
    });

    it('fournit toujours une couleur et un fond', () => {
        for (const tsb of [30, 5, 0, -12, -50]) {
            const s = getTSBStatus(tsb);
            expect(s.color).toMatch(/^#[0-9a-f]{6}$/i);
            expect(s.bgColor).toMatch(/^#[0-9a-f]{8}$/i);
        }
    });
});

// ─── Répartition par zones ────────────────────────────────────────────────────

describe('aggregateZones', () => {
    it('pondère les distributions exactes par la durée des séances', () => {
        const workouts = [
            makeWorkout({
                id: 'a', status: 'completed',
                completedData: makeCompletedData({
                    actualDurationMinutes: 60,
                    heartRate: { avgBPM: null, maxBPM: null, zoneDistribution: [100, 0, 0, 0, 0] },
                }),
            }),
            makeWorkout({
                id: 'b', status: 'completed',
                completedData: makeCompletedData({
                    actualDurationMinutes: 180,
                    heartRate: { avgBPM: null, maxBPM: null, zoneDistribution: [0, 100, 0, 0, 0] },
                }),
            }),
        ];
        // 60 min en Z1, 180 min en Z2 → 25 % / 75 %.
        expect(aggregateZones(workouts)).toEqual([25, 75, 0, 0, 0]);
    });

    it('retombe sur la FC moyenne quand aucune distribution n’est stockée', () => {
        const workouts = [
            makeWorkout({
                id: 'a', status: 'completed',
                completedData: makeCompletedData({ actualDurationMinutes: 60, heartRate: { avgBPM: 120, maxBPM: null } }),
            }),
            makeWorkout({
                id: 'b', status: 'completed',
                completedData: makeCompletedData({ actualDurationMinutes: 60, heartRate: { avgBPM: 320, maxBPM: null } }),
            }),
        ];
        // 120 bpm → Z2 (101-150) ; 320 bpm → au-dessus de Z5 (max 300) → dernière zone.
        expect(aggregateZones(workouts, makeZones())).toEqual([0, 50, 0, 0, 50]);
    });

    it('range une FC sous la première zone en Z1', () => {
        const workouts = [
            makeWorkout({
                status: 'completed',
                completedData: makeCompletedData({ actualDurationMinutes: 60, heartRate: { avgBPM: 40, maxBPM: null } }),
            }),
        ];
        expect(aggregateZones(workouts, makeZones({ z1: { min: 90, max: 110 } }))).toEqual([100, 0, 0, 0, 0]);
    });

    it('renvoie une répartition vide sans donnée exploitable', () => {
        expect(aggregateZones([])).toEqual([0, 0, 0, 0, 0]);
        expect(aggregateZones([makeWorkout({ status: 'pending' })], makeZones())).toEqual([0, 0, 0, 0, 0]);
        expect(aggregateZones([makeWorkout({ status: 'completed', completedData: makeCompletedData() })]))
            .toEqual([0, 0, 0, 0, 0]);
    });
});
