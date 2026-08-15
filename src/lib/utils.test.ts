/******************************************************************************
 * @file    utils.test.ts
 * @brief   Tests unitaires des utilitaires de date (le fuseau est géré à la
 *          main partout dans le projet) et de la conversion formulaire →
 *          CompletedData.
 ******************************************************************************/

import { describe, it, expect } from 'vitest';
import { formatDateKey, parseLocalDate, formatDuration, createCompletedData } from './utils';
import type { CompletedDataFeedback } from '@/lib/data/type';

// ─── Dates ────────────────────────────────────────────────────────────────────

describe('formatDateKey', () => {
    it('formate une Date en YYYY-MM-DD', () => {
        expect(formatDateKey(new Date(2026, 4, 19))).toBe('2026-05-19');
        expect(formatDateKey(new Date(2026, 11, 31))).toBe('2026-12-31');
    });

    it('complète le mois et le jour sur deux chiffres', () => {
        expect(formatDateKey(new Date(2026, 0, 5))).toBe('2026-01-05');
        expect(formatDateKey(new Date(2026, 8, 9))).toBe('2026-09-09');
    });

    it('lit le jour LOCAL, pas le jour UTC', () => {
        // 1er janvier 00h30 à Paris = 31 décembre 23h30 UTC. toISOString() aurait
        // renvoyé la veille — c'est précisément le piège que formatDateKey évite.
        const nuitDeNouvelAn = new Date(2026, 0, 1, 0, 30);
        expect(nuitDeNouvelAn.toISOString().slice(0, 10)).toBe('2025-12-31');
        expect(formatDateKey(nuitDeNouvelAn)).toBe('2026-01-01');
    });
});

describe('parseLocalDate', () => {
    it('rend minuit LOCAL, pas minuit UTC', () => {
        const d = parseLocalDate('2026-05-19');
        expect(d.getFullYear()).toBe(2026);
        expect(d.getMonth()).toBe(4);
        expect(d.getDate()).toBe(19);
        expect(d.getHours()).toBe(0);
        expect(d.getMinutes()).toBe(0);
    });

    it('tronque une string ISO complète à sa partie date', () => {
        const d = parseLocalDate('2026-05-19T22:45:00.000Z');
        expect(d.getDate()).toBe(19);
        expect(d.getHours()).toBe(0);
    });

    it('fait l’aller-retour avec formatDateKey', () => {
        for (const key of ['2026-01-01', '2026-02-28', '2026-07-14', '2026-12-31']) {
            expect(formatDateKey(parseLocalDate(key))).toBe(key);
        }
    });
});

describe('formatDuration', () => {
    it('affiche les durées sous l’heure en minutes', () => {
        expect(formatDuration(0)).toBe('0min');
        expect(formatDuration(45)).toBe('45min');
        expect(formatDuration(59)).toBe('59min');
    });

    it('omet les minutes sur une heure pile', () => {
        expect(formatDuration(60)).toBe('1h');
        expect(formatDuration(120)).toBe('2h');
    });

    it('complète les minutes sur deux chiffres', () => {
        expect(formatDuration(65)).toBe('1h05');
        expect(formatDuration(90)).toBe('1h30');
        expect(formatDuration(125)).toBe('2h05');
    });
});

// ─── Formulaire → CompletedData ───────────────────────────────────────────────

function makeFeedback(overrides: Partial<CompletedDataFeedback> = {}): CompletedDataFeedback {
    return {
        rpe: 6,
        actualDuration: 60,
        distance: 20,
        notes: 'Bonnes sensations',
        sportType: 'cycling',
        ...overrides,
    };
}

describe('createCompletedData', () => {
    it('reporte les champs communs quel que soit le sport', () => {
        const cd = createCompletedData(makeFeedback({ avgHeartRate: 145, calories: 600 }));
        expect(cd.actualDurationMinutes).toBe(60);
        expect(cd.distanceKm).toBe(20);
        expect(cd.perceivedEffort).toBe(6);
        expect(cd.notes).toBe('Bonnes sensations');
        expect(cd.source).toEqual({ type: 'manual' });
        expect(cd.heartRate?.avgBPM).toBe(145);
        expect(cd.caloriesBurned).toBe(600);
    });

    it('marque la saisie comme manuelle, sans tours ni trace GPS', () => {
        const cd = createCompletedData(makeFeedback());
        expect(cd.source.type).toBe('manual');
        expect(cd.laps).toEqual([]);
        expect(cd.map).toEqual({ polyline: null });
    });

    it('ne remplit que les metrics du sport concerné — vélo', () => {
        const cd = createCompletedData(makeFeedback({
            sportType: 'cycling', avgPower: 210, normalizedPower: 230, avgSpeed: 30, tss: 85,
        }));
        expect(cd.metrics.running).toBeNull();
        expect(cd.metrics.swimming).toBeNull();
        expect(cd.metrics.cycling).toMatchObject({
            avgPowerWatts: 210, normalizedPowerWatts: 230, avgSpeedKmH: 30, tss: 85,
        });
    });

    it('ne remplit que les metrics du sport concerné — course', () => {
        const cd = createCompletedData(makeFeedback({ sportType: 'running', avgPace: '4:30', avgCadence: 176 }));
        expect(cd.metrics.cycling).toBeNull();
        expect(cd.metrics.swimming).toBeNull();
        expect(cd.metrics.running).toMatchObject({ avgPaceMinPerKm: '4:30', avgCadenceSPM: 176 });
    });

    it('ne remplit que les metrics du sport concerné — natation', () => {
        const cd = createCompletedData(makeFeedback({ sportType: 'swimming', avgPace: '1:45', avgSwolf: 38 }));
        expect(cd.metrics.cycling).toBeNull();
        expect(cd.metrics.running).toBeNull();
        expect(cd.metrics.swimming).toMatchObject({ avgPace100m: '1:45', avgSwolf: 38 });
    });

    it('laisse les trois metrics vides pour un sport « other »', () => {
        const cd = createCompletedData(makeFeedback({ sportType: 'other' }));
        expect(cd.metrics).toEqual({ cycling: null, running: null, swimming: null });
    });

    it('laisse le TSS course et natation à null — il est calculé côté serveur', () => {
        const run = createCompletedData(makeFeedback({ sportType: 'running', tss: 90 }));
        const swim = createCompletedData(makeFeedback({ sportType: 'swimming', tss: 90 }));
        expect(run.metrics.running?.tss).toBeNull();
        expect(swim.metrics.swimming?.tss).toBeNull();
    });

    it('normalise les champs optionnels absents en null', () => {
        const cd = createCompletedData(makeFeedback());
        expect(cd.heartRate?.avgBPM).toBeNull();
        expect(cd.heartRate?.maxBPM).toBeNull();
        expect(cd.caloriesBurned).toBeNull();
        expect(cd.metrics.cycling?.avgPowerWatts).toBeNull();
    });
});
