/******************************************************************************
 * @file    stats/computeTSS.test.ts
 * @brief   Tests unitaires de la chaîne « vitesse » : conversions vitesse ↔
 *          allure, dérivation des vitesses seuil depuis le profil, et calcul du
 *          TSS basé sur la vitesse (rTSS course / sTSS natation).
 ******************************************************************************/

import { describe, it, expect } from 'vitest';
import {
    speedKmhToPaceMinPerKm,
    speedMsToPace100m,
    paceToSeconds,
    getRunThresholdSpeedKmh,
    getSwimCSSms,
    computeTSSFromSignals,
    computeWorkoutTSS,
} from './computeTSS';
import { makeCompletedData, makeProfile, makeRunningMetrics } from '@/test/fixtures';

// ─── Fixtures ─────────────────────────────────────────────────────────────────

/** VMA 18 km/h → vitesse seuil 15.84 km/h (× 0.88). */
const PROFILE_RUNNER = makeProfile({ running: { Test: { vma: 18 } } });

/** 400 m en 320 s → CSS 1.25 m/s. */
const PROFILE_SWIMMER = makeProfile({
    swimming: { Test: { recentRaceTimeSec: 320, recentRaceDistanceMeters: 400 } },
});

// ─── Conversions vitesse → allure ─────────────────────────────────────────────

describe('speedKmhToPaceMinPerKm', () => {
    it('convertit une vitesse en allure mm:ss/km', () => {
        expect(speedKmhToPaceMinPerKm(12)).toBe('5:00');   // 300 s/km
        expect(speedKmhToPaceMinPerKm(15)).toBe('4:00');   // 240 s/km
        expect(speedKmhToPaceMinPerKm(10)).toBe('6:00');   // 360 s/km
        expect(speedKmhToPaceMinPerKm(14.4)).toBe('4:10'); // 250 s/km
    });

    it('complète les secondes sur deux chiffres', () => {
        expect(speedKmhToPaceMinPerKm(3600 / 305)).toBe('5:05');
        expect(speedKmhToPaceMinPerKm(3600 / 241)).toBe('4:01');
    });

    it('arrondit les secondes à l’entier le plus proche', () => {
        expect(speedKmhToPaceMinPerKm(3600 / 262.4)).toBe('4:22');
        expect(speedKmhToPaceMinPerKm(3600 / 262.6)).toBe('4:23');
    });

    it('retient la minute quand l’arrondi atteint 60 s', () => {
        // 119.6 s/km s’arrondit à 120 s → 2:00, jamais « 1:60 ».
        expect(speedKmhToPaceMinPerKm(3600 / 119.6)).toBe('2:00');
        expect(speedKmhToPaceMinPerKm(3600 / 359.7)).toBe('6:00');
    });

    it('renvoie null pour une vitesse absente, nulle ou négative', () => {
        expect(speedKmhToPaceMinPerKm(null)).toBeNull();
        expect(speedKmhToPaceMinPerKm(undefined)).toBeNull();
        expect(speedKmhToPaceMinPerKm(0)).toBeNull();
        expect(speedKmhToPaceMinPerKm(-12)).toBeNull();
    });
});

describe('speedMsToPace100m', () => {
    it('convertit une vitesse en allure mm:ss/100 m', () => {
        expect(speedMsToPace100m(1.25)).toBe('1:20'); // 80 s/100 m
        expect(speedMsToPace100m(2)).toBe('0:50');
        expect(speedMsToPace100m(1)).toBe('1:40');
    });

    it('complète les secondes sur deux chiffres', () => {
        expect(speedMsToPace100m(100 / 65)).toBe('1:05');
        expect(speedMsToPace100m(100 / 121)).toBe('2:01');
    });

    it('retient la minute quand l’arrondi atteint 60 s', () => {
        expect(speedMsToPace100m(100 / 59.7)).toBe('1:00');
        expect(speedMsToPace100m(100 / 119.6)).toBe('2:00');
    });

    it('renvoie null pour une vitesse absente, nulle ou négative', () => {
        expect(speedMsToPace100m(null)).toBeNull();
        expect(speedMsToPace100m(undefined)).toBeNull();
        expect(speedMsToPace100m(0)).toBeNull();
        expect(speedMsToPace100m(-1.5)).toBeNull();
    });
});

// ─── Conversion allure → secondes ─────────────────────────────────────────────

describe('paceToSeconds', () => {
    it('convertit une allure mm:ss en secondes', () => {
        expect(paceToSeconds('5:30')).toBe(330);
        expect(paceToSeconds('0:45')).toBe(45);
        expect(paceToSeconds('12:00')).toBe(720);
    });

    it('accepte une seule décimale de secondes et les espaces autour', () => {
        expect(paceToSeconds('10:5')).toBe(605);
        expect(paceToSeconds('  4:00  ')).toBe(240);
    });

    it('renvoie null pour un format invalide ou une valeur absente', () => {
        expect(paceToSeconds(null)).toBeNull();
        expect(paceToSeconds(undefined)).toBeNull();
        expect(paceToSeconds('')).toBeNull();
        expect(paceToSeconds('4:000')).toBeNull();
        expect(paceToSeconds('4h00')).toBeNull();
        expect(paceToSeconds('1:02:03')).toBeNull();
    });
});

// ─── Vitesses seuil dérivées du profil ────────────────────────────────────────

describe('getRunThresholdSpeedKmh', () => {
    it('dérive la vitesse seuil à 88 % de la VMA', () => {
        expect(getRunThresholdSpeedKmh(PROFILE_RUNNER)).toBeCloseTo(15.84, 5);
        expect(getRunThresholdSpeedKmh(makeProfile({ running: { Test: { vma: 20 } } }))).toBeCloseTo(17.6, 5);
    });

    it('renvoie null sans VMA exploitable', () => {
        expect(getRunThresholdSpeedKmh(null)).toBeNull();
        expect(getRunThresholdSpeedKmh(undefined)).toBeNull();
        expect(getRunThresholdSpeedKmh(makeProfile())).toBeNull();
        expect(getRunThresholdSpeedKmh(makeProfile({ running: { Test: {} } }))).toBeNull();
        expect(getRunThresholdSpeedKmh(makeProfile({ running: { Test: { vma: 0 } } }))).toBeNull();
        expect(getRunThresholdSpeedKmh(makeProfile({ running: { Test: { vma: -5 } } }))).toBeNull();
    });
});

describe('getSwimCSSms', () => {
    it('dérive la CSS en m/s depuis le dernier test', () => {
        expect(getSwimCSSms(PROFILE_SWIMMER)).toBeCloseTo(1.25, 5);
        expect(getSwimCSSms(makeProfile({
            swimming: { Test: { recentRaceTimeSec: 1200, recentRaceDistanceMeters: 1500 } },
        }))).toBeCloseTo(1.25, 5);
    });

    it('refuse un effort trop court (< 200 m), trop éloigné du seuil aérobie', () => {
        expect(getSwimCSSms(makeProfile({
            swimming: { Test: { recentRaceTimeSec: 30, recentRaceDistanceMeters: 50 } },
        }))).toBeNull();
        expect(getSwimCSSms(makeProfile({
            swimming: { Test: { recentRaceTimeSec: 120, recentRaceDistanceMeters: 199 } },
        }))).toBeNull();
    });

    it('accepte exactement 200 m', () => {
        expect(getSwimCSSms(makeProfile({
            swimming: { Test: { recentRaceTimeSec: 160, recentRaceDistanceMeters: 200 } },
        }))).toBeCloseTo(1.25, 5);
    });

    it('renvoie null sans test exploitable', () => {
        expect(getSwimCSSms(null)).toBeNull();
        expect(getSwimCSSms(undefined)).toBeNull();
        expect(getSwimCSSms(makeProfile())).toBeNull();
        expect(getSwimCSSms(makeProfile({
            swimming: { Test: { recentRaceTimeSec: 0, recentRaceDistanceMeters: 400 } },
        }))).toBeNull();
    });
});

// ─── TSS dérivé de la vitesse ─────────────────────────────────────────────────

describe('computeTSSFromSignals — course (rTSS, IF²)', () => {
    it('donne 100 TSS pour 1 h exactement à la vitesse seuil', () => {
        const r = computeTSSFromSignals(
            { durationSec: 3600, sport: 'running', avgSpeedKmh: 15.84 },
            PROFILE_RUNNER,
        );
        expect(r).toEqual({ tss: 100, source: 'pace', intensityFactor: 1 });
    });

    it('applique IF² : à moitié de la vitesse seuil, 1 h vaut 25 TSS', () => {
        const r = computeTSSFromSignals(
            { durationSec: 3600, sport: 'running', avgSpeedKmh: 7.92 },
            PROFILE_RUNNER,
        );
        expect(r.tss).toBe(25);
        expect(r.intensityFactor).toBeCloseTo(0.5, 5);
    });

    it('proportionne le TSS à la durée', () => {
        const r = computeTSSFromSignals(
            { durationSec: 1800, sport: 'running', avgSpeedKmh: 15.84 },
            PROFILE_RUNNER,
        );
        expect(r.tss).toBe(50);
    });

    it('bascule sur la FC quand la vitesse manque', () => {
        const profile = makeProfile({
            running: { Test: { vma: 18 } },
            heartRate: { max: 190, resting: 50 },
        });
        const r = computeTSSFromSignals(
            { durationSec: 3600, sport: 'running', avgHR: 155 },
            profile,
        );
        expect(r.source).toBe('hr');
    });

    it('bascule sur le défaut sport sans VMA ni FC', () => {
        const r = computeTSSFromSignals(
            { durationSec: 3600, sport: 'running', avgSpeedKmh: 12 },
            makeProfile(),
        );
        expect(r).toEqual({ tss: 60, source: 'default', intensityFactor: null });
    });
});

describe('computeTSSFromSignals — natation (sTSS, IF³)', () => {
    it('donne 100 TSS pour 1 h exactement à la CSS', () => {
        const r = computeTSSFromSignals(
            { durationSec: 3600, sport: 'swimming', avgSpeedMs: 1.25 },
            PROFILE_SWIMMER,
        );
        expect(r).toEqual({ tss: 100, source: 'pace', intensityFactor: 1 });
    });

    it('cube l’IF : 80 % de la CSS pendant 1 h vaut 51 TSS (0.8³ × 100)', () => {
        const r = computeTSSFromSignals(
            { durationSec: 3600, sport: 'swimming', avgSpeedMs: 1 },
            PROFILE_SWIMMER,
        );
        expect(r.tss).toBe(51);
        expect(r.intensityFactor).toBeCloseTo(0.8, 5);
    });

    it('bascule sur le défaut sport sans CSS ni FC', () => {
        const r = computeTSSFromSignals(
            { durationSec: 3600, sport: 'swimming', avgSpeedMs: 1.25 },
            makeProfile(),
        );
        expect(r).toEqual({ tss: 55, source: 'default', intensityFactor: null });
    });
});

describe('computeTSSFromSignals — durée invalide', () => {
    it('renvoie 0 TSS pour une durée nulle ou négative', () => {
        expect(computeTSSFromSignals({ durationSec: 0, sport: 'running', avgSpeedKmh: 15 }, PROFILE_RUNNER))
            .toEqual({ tss: 0, source: 'default', intensityFactor: null });
        expect(computeTSSFromSignals({ durationSec: -60, sport: 'swimming', avgSpeedMs: 1.25 }, PROFILE_SWIMMER))
            .toEqual({ tss: 0, source: 'default', intensityFactor: null });
    });
});

// ─── Dérivation de la vitesse depuis distance / durée ─────────────────────────

describe('computeWorkoutTSS — extraction de la vitesse', () => {
    it('course : utilise avgSpeedKmH des metrics quand elle est présente', () => {
        const cd = makeCompletedData({
            actualDurationMinutes: 60,
            distanceKm: 5, // volontairement incohérent : les metrics priment
            metrics: {
                cycling: null,
                running: makeRunningMetrics({ avgSpeedKmH: 15.84 }),
                swimming: null,
            },
        });
        expect(computeWorkoutTSS('running', cd, PROFILE_RUNNER)).toEqual({
            tss: 100, source: 'pace', intensityFactor: 1,
        });
    });

    it('course : déduit la vitesse de distance / durée quand les metrics manquent', () => {
        // 15.84 km en 60 min → 15.84 km/h → IF 1 → 100 TSS.
        const cd = makeCompletedData({ actualDurationMinutes: 60, distanceKm: 15.84 });
        expect(computeWorkoutTSS('running', cd, PROFILE_RUNNER)).toEqual({
            tss: 100, source: 'pace', intensityFactor: 1,
        });
    });

    it('course : 10 km en 50 min → 12 km/h', () => {
        const cd = makeCompletedData({ actualDurationMinutes: 50, distanceKm: 10 });
        const r = computeWorkoutTSS('running', cd, PROFILE_RUNNER);
        expect(r.source).toBe('pace');
        expect(r.intensityFactor).toBeCloseTo(0.76, 2); // 12 / 15.84
    });

    it('natation : déduit la vitesse en m/s depuis distance / durée', () => {
        // 4.5 km en 60 min → 1.25 m/s → IF 1 → 100 TSS.
        const cd = makeCompletedData({ actualDurationMinutes: 60, distanceKm: 4.5 });
        expect(computeWorkoutTSS('swimming', cd, PROFILE_SWIMMER)).toEqual({
            tss: 100, source: 'pace', intensityFactor: 1,
        });
    });

    it('natation : ignore avgSpeedKmH (la cascade nage part de distance / durée)', () => {
        const cd = makeCompletedData({ actualDurationMinutes: 30, distanceKm: 0 });
        const r = computeWorkoutTSS('swimming', cd, PROFILE_SWIMMER);
        expect(r.source).toBe('default');
    });

    it('sans distance ni durée exploitable, retombe sur le défaut sport', () => {
        const cd = makeCompletedData({ actualDurationMinutes: 60, distanceKm: 0 });
        expect(computeWorkoutTSS('running', cd, PROFILE_RUNNER)).toEqual({
            tss: 60, source: 'default', intensityFactor: null,
        });
    });
});
