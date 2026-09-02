/******************************************************************************
 * @file    _internals/workout-helpers.test.ts
 * @brief   Tests unitaires de la conversion formulaire de feedback →
 *          CompletedData, avec la cascade TSS et la priorité du TSS saisi.
 ******************************************************************************/

import { describe, it, expect } from 'vitest';
import { assertCalendarWriteAccess, findWorkoutIndex, hasCalendarWriteAccess, transformFeedbackToCompletedData } from './workout-helpers';
import { makeProfile, makeWorkout } from '@/test/fixtures';
import type { CompletedDataFeedback } from '@/lib/data/type';

function makeFeedback(overrides: Partial<CompletedDataFeedback> = {}): CompletedDataFeedback {
    return {
        rpe: 6,
        actualDuration: 60,
        distance: 0,
        notes: '',
        sportType: 'cycling',
        ...overrides,
    };
}

const PROFIL = makeProfile({
    cycling: { Test: { ftp: 250 } },
    running: { Test: { vma: 18 } },              // seuil 15.84 km/h
    swimming: { Test: { recentRaceTimeSec: 320, recentRaceDistanceMeters: 400 } }, // CSS 1.25 m/s
    heartRate: { max: 190, resting: 50 },
});

// ─── Recherche par ID ─────────────────────────────────────────────────────────

describe('findWorkoutIndex', () => {
    const workouts = [
        makeWorkout({ id: 'a', date: '2026-03-02' }),
        makeWorkout({ id: 'b', date: '2026-03-02' }),
        makeWorkout({ id: 'c', date: '2026-03-03' }),
    ];

    it('trouve la séance par son identifiant', () => {
        expect(findWorkoutIndex(workouts, 'a')).toBe(0);
        expect(findWorkoutIndex(workouts, 'c')).toBe(2);
    });

    it('distingue deux séances du même jour', () => {
        // Le matching par date renvoyait la première du jour : régression à ne
        // jamais réintroduire.
        expect(findWorkoutIndex(workouts, 'b')).toBe(1);
    });

    it('renvoie -1 pour un identifiant inconnu', () => {
        expect(findWorkoutIndex(workouts, 'inexistant')).toBe(-1);
        expect(findWorkoutIndex([], 'a')).toBe(-1);
    });
});

// ─── Accès en écriture au calendrier (plan free = lecture seule) ──────────────

describe('hasCalendarWriteAccess', () => {
    it('refuse l\'écriture à un user en plan free', () => {
        expect(hasCalendarWriteAccess({ plan: 'free', role: 'user' })).toBe(false);
    });

    it('autorise l\'écriture au plan pro', () => {
        expect(hasCalendarWriteAccess({ plan: 'pro', role: 'user' })).toBe(true);
    });

    it('autorise l\'écriture au plan dev (octroi manuel admin)', () => {
        expect(hasCalendarWriteAccess({ plan: 'dev', role: 'user' })).toBe(true);
    });

    it('autorise l\'écriture à un admin même en plan free', () => {
        expect(hasCalendarWriteAccess({ plan: 'free', role: 'admin' })).toBe(true);
    });
});

describe('assertCalendarWriteAccess', () => {
    it('lève une erreur pour un user free', () => {
        expect(() => assertCalendarWriteAccess({ plan: 'free', role: 'user' })).toThrow();
    });

    it('ne lève rien pour un user pro', () => {
        expect(() => assertCalendarWriteAccess({ plan: 'pro', role: 'user' })).not.toThrow();
    });
});

// ─── Conversion feedback → CompletedData ──────────────────────────────────────

describe('transformFeedbackToCompletedData — champs communs', () => {
    it('reporte durée, distance, RPE et notes', () => {
        const cd = transformFeedbackToCompletedData(
            makeFeedback({ actualDuration: 75, distance: 32.5, rpe: 7, notes: 'Vent de face' }),
        );
        expect(cd.actualDurationMinutes).toBe(75);
        expect(cd.distanceKm).toBe(32.5);
        expect(cd.perceivedEffort).toBe(7);
        expect(cd.notes).toBe('Vent de face');
    });

    it('marque la source comme manuelle et sans tours', () => {
        const cd = transformFeedbackToCompletedData(makeFeedback());
        expect(cd.source).toEqual({ type: 'manual', stravaId: null });
        expect(cd.laps).toEqual([]);
    });

    it('normalise les champs absents', () => {
        const cd = transformFeedbackToCompletedData(makeFeedback({ notes: '' }));
        expect(cd.notes).toBe('');
        expect(cd.distanceKm).toBe(0);
        expect(cd.heartRate?.avgBPM).toBeNull();
        expect(cd.caloriesBurned).toBeNull();
    });

    it('n’instancie que les metrics du sport concerné', () => {
        const run = transformFeedbackToCompletedData(makeFeedback({ sportType: 'running' }));
        expect(run.metrics.running).not.toBeNull();
        expect(run.metrics.cycling).toBeNull();
        expect(run.metrics.swimming).toBeNull();
    });
});

describe('transformFeedbackToCompletedData — TSS', () => {
    it('respecte un TSS vélo saisi à la main, sans passer par la cascade', () => {
        const cd = transformFeedbackToCompletedData(
            makeFeedback({ sportType: 'cycling', tss: 142, intensityFactor: 0.88, avgPower: 180 }),
            PROFIL,
        );
        expect(cd.calculatedTSS).toBe(142);
        expect(cd.tssSource).toBe('power');
        expect(cd.metrics.cycling?.tss).toBe(142);
        expect(cd.intensityFactor).toBe(0.88);
        expect(cd.metrics.cycling?.intensityFactor).toBe(0.88);
    });

    it('ignore un TSS saisi hors vélo et recalcule', () => {
        const cd = transformFeedbackToCompletedData(
            makeFeedback({ sportType: 'running', tss: 999, distance: 15.84, actualDuration: 60 }),
            PROFIL,
        );
        expect(cd.calculatedTSS).toBe(100);
        expect(cd.tssSource).toBe('pace');
    });

    it('calcule le TSS vélo par la puissance quand il n’est pas saisi', () => {
        const cd = transformFeedbackToCompletedData(
            makeFeedback({ sportType: 'cycling', normalizedPower: 250, actualDuration: 60 }),
            PROFIL,
        );
        expect(cd.calculatedTSS).toBe(100);
        expect(cd.tssSource).toBe('power');
        expect(cd.metrics.cycling?.tss).toBe(100);
        expect(cd.metrics.cycling?.intensityFactor).toBe(1);
    });

    it('calcule le TSS course par l’allure', () => {
        const cd = transformFeedbackToCompletedData(
            makeFeedback({ sportType: 'running', avgSpeed: 15.84, actualDuration: 60 }),
            PROFIL,
        );
        expect(cd.tssSource).toBe('pace');
        expect(cd.calculatedTSS).toBe(100);
        expect(cd.metrics.running?.tss).toBe(100);
    });

    it('calcule le TSS natation depuis distance et durée', () => {
        const cd = transformFeedbackToCompletedData(
            makeFeedback({ sportType: 'swimming', distance: 4.5, actualDuration: 60 }),
            PROFIL,
        );
        expect(cd.tssSource).toBe('pace');
        expect(cd.calculatedTSS).toBe(100);
        expect(cd.metrics.swimming?.tss).toBe(100);
    });

    it('bascule sur la FC quand la métrique primaire manque', () => {
        const cd = transformFeedbackToCompletedData(
            makeFeedback({ sportType: 'cycling', avgHeartRate: 155, actualDuration: 60 }),
            PROFIL,
        );
        expect(cd.tssSource).toBe('hr');
        expect(cd.metrics.cycling?.tss).toBeNull(); // pas la métrique primaire du vélo
    });

    it('retombe sur le défaut sport sans profil', () => {
        const cd = transformFeedbackToCompletedData(makeFeedback({ sportType: 'cycling', actualDuration: 60 }));
        expect(cd.tssSource).toBe('default');
        expect(cd.calculatedTSS).toBe(50);
    });
});
