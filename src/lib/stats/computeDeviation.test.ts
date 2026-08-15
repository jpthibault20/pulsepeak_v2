/******************************************************************************
 * @file    stats/computeDeviation.test.ts
 * @brief   Tests unitaires de la détection d'écart planifié / réalisé.
 *
 * La règle centrale : il faut DEUX signaux convergents pour sortir de
 * « normal », et le RPE arbitre entre fatigue réelle et allègement volontaire.
 ******************************************************************************/

import { describe, it, expect } from 'vitest';
import { computeDeviationMetrics } from './computeDeviation';
import {
    makeCompletedData,
    makeCyclingMetrics,
    makeLap,
    makePlannedData,
    makeProfile,
    makeWorkout,
} from '@/test/fixtures';
import type { Workout } from '@/lib/data/DatabaseTypes';
import type { CompletedData, PlannedData } from '@/lib/data/type';

const PROFIL = makeProfile();

/** Séance clé complétée : les seuils y sont appliqués sans tolérance élargie. */
function seance(planned: Partial<PlannedData>, completed: Partial<CompletedData>, workoutType = 'intervalles'): Workout {
    return makeWorkout({
        status: 'completed',
        workoutType,
        plannedData: makePlannedData(planned),
        completedData: makeCompletedData(completed),
    });
}

// ─── Garde-fous ───────────────────────────────────────────────────────────────

describe('computeDeviationMetrics — cas sans analyse possible', () => {
    it('renvoie null sans données réalisées ou planifiées', () => {
        expect(computeDeviationMetrics(makeWorkout({ plannedData: makePlannedData() }), PROFIL)).toBeNull();
        expect(computeDeviationMetrics(makeWorkout({ completedData: makeCompletedData() }), PROFIL)).toBeNull();
    });

    it('renvoie null sans aucune cible chiffrée', () => {
        const w = seance(
            { durationMinutes: 0, plannedTSS: null, targetPowerWatts: null },
            { actualDurationMinutes: 60 },
        );
        expect(computeDeviationMetrics(w, PROFIL)).toBeNull();
    });
});

// ─── Seuil de convergence ─────────────────────────────────────────────────────

describe('computeDeviationMetrics — un seul signal ne suffit pas', () => {
    it('reste « normal » avec un unique écart, même important', () => {
        const w = seance(
            { durationMinutes: 60, plannedTSS: null, targetPowerWatts: null },
            { actualDurationMinutes: 40, perceivedEffort: 8 },
        );
        const r = computeDeviationMetrics(w, PROFIL)!;
        expect(r.signal).toBe('normal');
        expect(r.severity).toBe('info');
        expect(r.score).toBe(0);
        expect(r.convergingSignals).toBe(1);
        expect(r.durationDelta).toBe(-33);
    });

    it('expose les écarts même quand il n’y a rien à signaler', () => {
        const w = seance(
            { durationMinutes: 60, plannedTSS: 100 },
            { actualDurationMinutes: 61, calculatedTSS: 101 },
        );
        const r = computeDeviationMetrics(w, PROFIL)!;
        expect(r.convergingSignals).toBe(0);
        expect(r.durationDelta).toBe(2);
        expect(r.tssDelta).toBe(1);
        expect(r.details).toEqual([]);
    });
});

// ─── Fatigue ──────────────────────────────────────────────────────────────────

describe('computeDeviationMetrics — fatigue', () => {
    const sousPerformance = (perceivedEffort: number | null) => seance(
        { durationMinutes: 60, plannedTSS: 100, targetPowerWatts: 250 },
        {
            actualDurationMinutes: 45,
            calculatedTSS: 70,
            perceivedEffort,
            metrics: { cycling: makeCyclingMetrics({ normalizedPowerWatts: 210 }), running: null, swimming: null },
        },
    );

    it('conclut à la fatigue quand le RPE confirme la sous-performance', () => {
        const r = computeDeviationMetrics(sousPerformance(8), PROFIL)!;
        expect(r.signal).toBe('fatigue');
        expect(r.severity).toBe('critical');
        expect(r.convergingSignals).toBe(3);
        expect(r.durationDelta).toBe(-25);
        expect(r.tssDelta).toBe(-30);
        expect(r.powerDelta).toBe(-16);
        expect(r.score).toBe(-47); // moyenne des écarts « under » × 2
        expect(r.headline).toContain('Fatigue importante');
        expect(r.adaptationReason).toContain('RPE 8/10');
    });

    it('ne crie pas fatigue quand l’athlète était à l’aise', () => {
        const r = computeDeviationMetrics(sousPerformance(3), PROFIL)!;
        expect(r.signal).toBe('normal');
        expect(r.details).toContain('RPE bas — séance volontairement en-dessous des cibles');
    });

    it('ne crie pas fatigue sans signe physiologique ni RPE élevé', () => {
        const r = computeDeviationMetrics(sousPerformance(5), PROFIL)!;
        expect(r.signal).toBe('normal');
        expect(r.details.some(d => d.includes('allégée volontairement'))).toBe(true);
    });

    it('conclut à la fatigue sur FC haute + puissance basse, même avec un RPE bas', () => {
        const w = seance(
            { durationMinutes: 60, plannedTSS: 100, targetPowerWatts: 250, targetHeartRateBPM: 150 },
            {
                actualDurationMinutes: 60,
                calculatedTSS: 100,
                perceivedEffort: 3,
                heartRate: { avgBPM: 162, maxBPM: 175 },
                metrics: { cycling: makeCyclingMetrics({ normalizedPowerWatts: 210 }), running: null, swimming: null },
            },
        );
        const r = computeDeviationMetrics(w, PROFIL)!;
        expect(r.signal).toBe('fatigue');
        expect(r.hrDelta).toBe(12);
        expect(r.powerDelta).toBe(-16);
        expect(r.score).toBe(-50);
        expect(r.adaptationReason).toContain('fatigue centrale');
    });
});

// ─── Forme ────────────────────────────────────────────────────────────────────

describe('computeDeviationMetrics — sur-performance', () => {
    it('signale une bonne forme quand les écarts vont tous vers le haut', () => {
        const w = seance(
            { durationMinutes: 60, plannedTSS: 100 },
            { actualDurationMinutes: 75, calculatedTSS: 130, perceivedEffort: 7 },
        );
        const r = computeDeviationMetrics(w, PROFIL)!;
        expect(r.signal).toBe('superform');
        expect(r.durationDelta).toBe(25);
        expect(r.tssDelta).toBe(30);
        expect(r.score).toBe(55);
        expect(r.headline).toContain('signaux positifs');
        expect(r.adaptationReason).toContain('en faire plus');
    });
});

// ─── Tolérance selon le type de séance ────────────────────────────────────────

describe('computeDeviationMetrics — seuils adaptatifs', () => {
    const ecarts = { durationMinutes: 60, plannedTSS: 100 };
    const realise = { actualDurationMinutes: 48, calculatedTSS: 78, perceivedEffort: 8 }; // −20 % / −22 %

    it('déclenche sur une séance clé', () => {
        const r = computeDeviationMetrics(seance(ecarts, realise, 'seuil'), PROFIL)!;
        expect(r.convergingSignals).toBe(2);
        expect(r.signal).toBe('fatigue');
    });

    it('tolère 50 % d’écart en plus sur une séance d’endurance', () => {
        const r = computeDeviationMetrics(seance(ecarts, realise, 'endurance'), PROFIL)!;
        expect(r.convergingSignals).toBe(0);
        expect(r.signal).toBe('normal');
        // Les écarts restent mesurés, ils ne sont simplement pas alarmants.
        expect(r.durationDelta).toBe(-20);
        expect(r.tssDelta).toBe(-22);
    });
});

// ─── Métriques avancées sur les tours ─────────────────────────────────────────

describe('computeDeviationMetrics — métriques de tours', () => {
    it('mesure le fade rate entre le premier et le dernier tour', () => {
        const w = seance(
            { durationMinutes: 60, plannedTSS: 100 },
            {
                actualDurationMinutes: 60,
                calculatedTSS: 100,
                laps: [250, 230, 200].map((avgPower, i) => makeLap({ index: i + 1, avgPower })),
            },
        );
        const r = computeDeviationMetrics(w, PROFIL)!;
        expect(r.fadeRate).toBe(20); // (250 − 200) / 250
    });

    it('exige au moins trois tours avec puissance pour un fade rate', () => {
        const w = seance(
            { durationMinutes: 60, plannedTSS: 100 },
            {
                actualDurationMinutes: 60,
                calculatedTSS: 100,
                laps: [250, 200].map((avgPower, i) => makeLap({ index: i + 1, avgPower })),
            },
        );
        expect(computeDeviationMetrics(w, PROFIL)!.fadeRate).toBeNull();
    });

    it('mesure le découplage aérobie entre les deux moitiés', () => {
        const laps = [
            { avgPower: 200, avgHeartRate: 140 },
            { avgPower: 200, avgHeartRate: 140 },
            { avgPower: 200, avgHeartRate: 160 },
            { avgPower: 200, avgHeartRate: 160 },
        ].map((l, i) => makeLap({ index: i + 1, durationSeconds: 300, ...l }));

        const w = seance(
            { durationMinutes: 60, plannedTSS: 100 },
            { actualDurationMinutes: 60, calculatedTSS: 100, laps },
        );
        expect(computeDeviationMetrics(w, PROFIL)!.aerobicDecoupling).toBe(12.5);
    });

    it('exige au moins quatre tours avec puissance ET FC pour un découplage', () => {
        const laps = [
            { avgPower: 200, avgHeartRate: 140 },
            { avgPower: 200, avgHeartRate: 160 },
            { avgPower: 200, avgHeartRate: null },
        ].map((l, i) => makeLap({ index: i + 1, ...l }));

        const w = seance(
            { durationMinutes: 60, plannedTSS: 100 },
            { actualDurationMinutes: 60, calculatedTSS: 100, laps },
        );
        expect(computeDeviationMetrics(w, PROFIL)!.aerobicDecoupling).toBeNull();
    });

    it('calcule le coût cardiaque en bpm par watt', () => {
        const w = seance(
            { durationMinutes: 60, plannedTSS: 100 },
            {
                actualDurationMinutes: 60,
                calculatedTSS: 100,
                heartRate: { avgBPM: 150, maxBPM: 175 },
                metrics: { cycling: makeCyclingMetrics({ avgPowerWatts: 250 }), running: null, swimming: null },
            },
        );
        expect(computeDeviationMetrics(w, PROFIL)!.cardiacCost).toBe(0.6);
    });

    it('laisse le coût cardiaque à null sans puissance', () => {
        const w = seance(
            { durationMinutes: 60, plannedTSS: 100 },
            { actualDurationMinutes: 60, calculatedTSS: 100, heartRate: { avgBPM: 150, maxBPM: null } },
        );
        expect(computeDeviationMetrics(w, PROFIL)!.cardiacCost).toBeNull();
    });
});
