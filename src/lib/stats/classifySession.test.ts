/******************************************************************************
 * @file    stats/classifySession.test.ts
 * @brief   Tests unitaires de la répartition par zones et de la classification
 *          du stimulus réellement effectué.
 ******************************************************************************/

import { describe, it, expect } from 'vitest';
import { bucketByZones, classifySessionType } from './classifySession';
import { makeCompletedData, makeLap, makeProfile, makeZones } from '@/test/fixtures';

const ZONES = makeZones(); // maxima : 100 / 150 / 200 / 250 / 300

// ─── Répartition par zones ────────────────────────────────────────────────────

describe('bucketByZones', () => {
    it('répartit les valeurs sur les maxima ascendants', () => {
        expect(bucketByZones([50, 120, 180, 220, 280], ZONES)).toEqual([20, 20, 20, 20, 20]);
    });

    it('range une valeur au-dessus de la dernière zone dans cette dernière zone', () => {
        expect(bucketByZones([500], ZONES)).toEqual([0, 0, 0, 0, 100]);
    });

    it('classe une valeur exactement sur un maximum dans la zone correspondante', () => {
        expect(bucketByZones([100], ZONES)).toEqual([100, 0, 0, 0, 0]);
        expect(bucketByZones([150], ZONES)).toEqual([0, 100, 0, 0, 0]);
    });

    it('rend des pourcentages au dixième', () => {
        expect(bucketByZones([50, 120, 180], ZONES)).toEqual([33.3, 33.3, 33.3, 0, 0]);
    });

    it('inclut Z6 et Z7 quand elles existent', () => {
        const zones = makeZones({ z6: { min: 301, max: 400 }, z7: { min: 401, max: 2000 } });
        expect(bucketByZones([50, 350, 500], zones)).toHaveLength(7);
        expect(bucketByZones([350], zones)).toEqual([0, 0, 0, 0, 0, 100, 0]);
    });

    it('ignore les valeurs négatives ou non finies', () => {
        expect(bucketByZones([50, -10, NaN, Infinity, 120], ZONES)).toEqual([50, 50, 0, 0, 0]);
    });

    it('renvoie un tableau vide sans valeur exploitable', () => {
        expect(bucketByZones([], ZONES)).toEqual([]);
        expect(bucketByZones([-1, NaN], ZONES)).toEqual([]);
    });
});

// ─── Classification ───────────────────────────────────────────────────────────

const PROFIL_FC = makeProfile({ heartRate: { max: 190, resting: 50, zones: ZONES } });

describe('classifySessionType — depuis la distribution par zones', () => {
    it('reconnaît une séance VO2max', () => {
        const cd = makeCompletedData({ zoneDistribution: [40, 20, 15, 10, 15] });
        expect(classifySessionType(cd, 'cycling', null)).toBe('VO2max');
    });

    it('distingue seuil continu et intervalles au seuil', () => {
        const continu = makeCompletedData({ zoneDistribution: [30, 25, 20, 25, 0] });
        expect(classifySessionType(continu, 'cycling', null)).toBe('Seuil');

        const yoyo = makeCompletedData({ zoneDistribution: [30, 25, 20, 25, 0], variabilityIndex: 1.25 });
        expect(classifySessionType(yoyo, 'cycling', null)).toBe('Intervalles');
    });

    it('reconnaît tempo, endurance et récupération', () => {
        expect(classifySessionType(makeCompletedData({ zoneDistribution: [30, 20, 30, 10, 0] }), 'cycling', null))
            .toBe('Tempo');
        expect(classifySessionType(makeCompletedData({ zoneDistribution: [20, 60, 10, 5, 0] }), 'cycling', null))
            .toBe('Endurance');
        expect(classifySessionType(makeCompletedData({ zoneDistribution: [80, 15, 5, 0, 0] }), 'cycling', null))
            .toBe('Récupération');
    });

    it('renvoie « Mixte » quand aucun profil ne domine', () => {
        expect(classifySessionType(makeCompletedData({ zoneDistribution: [40, 40, 10, 5, 0] }), 'cycling', null))
            .toBe('Mixte');
    });

    it('ignore une distribution trop courte pour être lue', () => {
        const cd = makeCompletedData({ zoneDistribution: [50, 50] });
        expect(classifySessionType(cd, 'cycling', null)).toBe('Sortie Libre');
    });
});

describe('classifySessionType — détection d’intervalles sans distribution', () => {
    it('tranche sur le Variability Index puissance', () => {
        expect(classifySessionType(makeCompletedData({ variabilityIndex: 1.2 }), 'cycling', null))
            .toBe('Intervalles');
        expect(classifySessionType(makeCompletedData({ variabilityIndex: 1.05 }), 'cycling', null))
            .toBe('Sortie Libre');
    });

    it('tranche sur la variabilité des puissances de tours', () => {
        const yoyo = makeCompletedData({
            laps: [100, 300, 100, 300].map((avgPower, i) => makeLap({ index: i + 1, avgPower })),
        });
        expect(classifySessionType(yoyo, 'cycling', null)).toBe('Intervalles');

        const lisse = makeCompletedData({
            laps: [200, 200, 200, 200].map((avgPower, i) => makeLap({ index: i + 1, avgPower })),
        });
        expect(classifySessionType(lisse, 'cycling', null)).toBe('Sortie Libre');
    });

    it('retombe sur la FC des tours quand la puissance manque', () => {
        const yoyo = makeCompletedData({
            laps: [110, 170, 110, 170].map((avgHeartRate, i) => makeLap({ index: i + 1, avgHeartRate })),
        });
        expect(classifySessionType(yoyo, 'running', null)).toBe('Intervalles');
    });

    it('exige au moins 4 tours pour conclure', () => {
        const troisTours = makeCompletedData({
            laps: [100, 300, 100].map((avgPower, i) => makeLap({ index: i + 1, avgPower })),
        });
        expect(classifySessionType(troisTours, 'cycling', null)).toBe('Sortie Libre');
    });
});

describe('classifySessionType — repli sur l’IF puis la FC', () => {
    it('lit l’IF sur l’échelle de sa source', () => {
        const cd = makeCompletedData({ intensityFactor: 0.95, tssSource: 'power' });
        expect(classifySessionType(cd, 'cycling', PROFIL_FC)).toBe('Seuil');
    });

    it('n’interprète pas un IF issu d’un TSS forfaitaire', () => {
        const cd = makeCompletedData({
            intensityFactor: 0.95,
            tssSource: 'default',
            heartRate: { avgBPM: 120, maxBPM: null },
        });
        // Retombe sur la FC : 120 bpm ≤ z2.max (150) → Endurance.
        expect(classifySessionType(cd, 'cycling', PROFIL_FC)).toBe('Endurance');
    });

    it('classe par FC moyenne en dernier recours', () => {
        const cases: [number, string][] = [
            [80, 'Récupération'],
            [130, 'Endurance'],
            [180, 'Tempo'],
            [230, 'Seuil'],
            [280, 'VO2max'],
        ];
        for (const [avgBPM, attendu] of cases) {
            const cd = makeCompletedData({ heartRate: { avgBPM, maxBPM: null } });
            expect(classifySessionType(cd, 'running', PROFIL_FC), `${avgBPM} bpm`).toBe(attendu);
        }
    });

    it('renvoie « Sortie Libre » sans aucun signal', () => {
        expect(classifySessionType(makeCompletedData(), 'running', PROFIL_FC)).toBe('Sortie Libre');
        expect(classifySessionType(makeCompletedData({ heartRate: { avgBPM: 130, maxBPM: null } }), 'running', makeProfile()))
            .toBe('Sortie Libre');
    });
});
