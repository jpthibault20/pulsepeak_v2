/******************************************************************************
 * @file    workout/detail/lap-analysis.test.ts
 * @brief   Tests unitaires de la partie « vitesse » de l'analyse des tours :
 *          vitesse d'un tour (m/s), allures dérivées par sport, et formatage.
 ******************************************************************************/

import { describe, it, expect } from 'vitest';
import { analyzeLaps, fmtPace } from './lap-analysis';
import type { CompletedLap } from '@/lib/data/type';
import { makeLap as makeLapFixture, makeProfile } from '@/test/fixtures';

// ─── Fixtures ─────────────────────────────────────────────────────────────────

function makeLap(index: number, durationSeconds: number, distanceMeters: number): CompletedLap {
    return makeLapFixture({ index, name: `Lap ${index}`, durationSeconds, distanceMeters });
}

/** Profil sans zones : l'analyse ne repose alors que sur la vitesse. */
const PROFILE = makeProfile();

// ─── Vitesse d'un tour ────────────────────────────────────────────────────────

describe('analyzeLaps — vitesse et allures dérivées', () => {
    it('course : intensité en m/s et allure en s/km', () => {
        // 1000 m en 240 s → 4.1667 m/s → 240 s/km.
        const [lap] = analyzeLaps([makeLap(1, 240, 1000)], 'running', PROFILE);
        expect(lap.intensity).toBeCloseTo(1000 / 240, 6);
        expect(lap.paceSecPerKm).toBeCloseTo(240, 6);
        expect(lap.paceSecPer100m).toBeNull();
    });

    it('course : une distance partielle donne bien l’allure ramenée au km', () => {
        // 400 m en 72 s → 180 s/km.
        const [lap] = analyzeLaps([makeLap(1, 72, 400)], 'running', PROFILE);
        expect(lap.paceSecPerKm).toBeCloseTo(180, 6);
    });

    it('natation : allure en s/100 m', () => {
        // 200 m en 160 s → 1.25 m/s → 80 s/100 m.
        const [lap] = analyzeLaps([makeLap(1, 160, 200)], 'swimming', PROFILE);
        expect(lap.intensity).toBeCloseTo(1.25, 6);
        expect(lap.paceSecPer100m).toBeCloseTo(80, 6);
        expect(lap.paceSecPerKm).toBeNull();
    });

    it('vélo sans puissance : l’intensité retombe sur la vitesse', () => {
        // 10 km en 1200 s → 8.333 m/s (30 km/h).
        const [lap] = analyzeLaps([makeLap(1, 1200, 10000)], 'cycling', PROFILE);
        expect(lap.intensity).toBeCloseTo(10000 / 1200, 6);
        expect(lap.paceSecPerKm).toBeNull();
        expect(lap.paceSecPer100m).toBeNull();
    });

    it('vélo avec puissance : la puissance prime sur la vitesse', () => {
        const lap: CompletedLap = { ...makeLap(1, 1200, 10000), avgPower: 250 };
        const [analyzed] = analyzeLaps([lap], 'cycling', PROFILE);
        expect(analyzed.intensity).toBe(250);
    });

    it('sans distance ni durée exploitable, aucune vitesse n’est calculée', () => {
        const laps = [makeLap(1, 300, 0), makeLap(2, 0, 1000)];
        const analyzed = analyzeLaps(laps, 'running', PROFILE);
        for (const a of analyzed) {
            expect(a.intensity).toBeNull();
            expect(a.paceSecPerKm).toBeNull();
        }
    });

    it('renvoie un tableau vide pour une liste de tours vide', () => {
        expect(analyzeLaps([], 'running', PROFILE)).toEqual([]);
    });
});

// ─── Formatage d'allure ───────────────────────────────────────────────────────

describe('fmtPace', () => {
    it('formate des secondes par unité en m:ss', () => {
        expect(fmtPace(240)).toBe('4:00');
        expect(fmtPace(232)).toBe('3:52');
        expect(fmtPace(80)).toBe('1:20');
        expect(fmtPace(45)).toBe('0:45');
    });

    it('complète les secondes sur deux chiffres', () => {
        expect(fmtPace(305)).toBe('5:05');
        expect(fmtPace(241)).toBe('4:01');
    });

    it('arrondit les secondes à l’entier le plus proche', () => {
        expect(fmtPace(232.4)).toBe('3:52');
        expect(fmtPace(232.6)).toBe('3:53');
    });

    it('retient la minute quand l’arrondi atteint 60 s', () => {
        expect(fmtPace(119.6)).toBe('2:00');
        expect(fmtPace(59.7)).toBe('1:00');
    });
});
