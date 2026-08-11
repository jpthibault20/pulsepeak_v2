import { describe, expect, it } from 'vitest';
import { computeAdherence, plannedIntensityOf, plannedWorkIntensity, plannedWorkSeconds } from './adherence';
import { makeLap, makeRepeatBlock, makeSimpleBlock } from '@/test/fixtures';

/** Séance vélo : 20 min échauffement, 4×(5 min à 250 W / 2 min à 150 W), 10 min retour au calme. */
const CYCLING_STRUCTURE = [
    makeSimpleBlock({ type: 'Warmup', durationActifSecondes: 1200, targetPowerWatts: 160 }),
    makeRepeatBlock({
        repeat: 4,
        durationActifSecondes: 300, targetPowerWatts: 250,
        durationRecupSecondes: 120, targetRecupPowerWatts: 150,
    }),
    makeSimpleBlock({ type: 'Cooldown', durationActifSecondes: 600, targetPowerWatts: 140 }),
];

/** Tours correspondant exactement à la prescription ci-dessus. */
function faithfulLaps() {
    const laps = [makeLap({ index: 1, durationSeconds: 1200, distanceMeters: 10000, avgPower: 160 })];
    for (let i = 0; i < 4; i++) {
        laps.push(makeLap({ index: laps.length + 1, durationSeconds: 300, distanceMeters: 3000, avgPower: 250 }));
        laps.push(makeLap({ index: laps.length + 1, durationSeconds: 120, distanceMeters: 800, avgPower: 150 }));
    }
    laps.push(makeLap({ index: laps.length + 1, durationSeconds: 600, distanceMeters: 4000, avgPower: 140 }));
    return laps;
}

describe('plannedIntensityOf', () => {
    it('prend les watts en vélo', () => {
        expect(plannedIntensityOf(makeSimpleBlock({ targetPowerWatts: 250 }), 'cycling')).toBe(250);
    });

    it('convertit une allure en vitesse, pour rester croissante avec l\'effort', () => {
        const slow = plannedIntensityOf(makeSimpleBlock({ targetPaceMinPerKm: '6:00' }), 'running')!;
        const fast = plannedIntensityOf(makeSimpleBlock({ targetPaceMinPerKm: '4:00' }), 'running')!;
        expect(fast).toBeGreaterThan(slow);
        expect(fast).toBeCloseTo(1000 / 240, 5);
    });

    it('convertit une allure natation aux 100 m', () => {
        expect(plannedIntensityOf(makeSimpleBlock({ targetPaceMinPer100m: '1:40' }), 'swimming')).toBeCloseTo(1, 5);
    });

    it('ne renvoie rien sans cible exploitable', () => {
        expect(plannedIntensityOf(makeSimpleBlock({ targetRPE: 7 }), 'cycling')).toBeNull();
    });
});

describe('agrégats de la prescription', () => {
    it('ne compte comme travail que les phases actives des blocs d\'effort', () => {
        // 4 × 5 min ; ni l'échauffement, ni les récups, ni le retour au calme.
        expect(plannedWorkSeconds(CYCLING_STRUCTURE)).toBe(1200);
    });

    it('retient l\'intensité de travail la plus élevée, hors échauffement', () => {
        expect(plannedWorkIntensity(CYCLING_STRUCTURE, 'cycling')).toBe(250);
    });
});

describe('computeAdherence', () => {
    it('déclare respectée une séance exécutée telle que prescrite', () => {
        const report = computeAdherence({
            structure: CYCLING_STRUCTURE,
            sport: 'cycling',
            laps: faithfulLaps(),
            actualDurationSeconds: 3480,
        });

        expect(report.verdict).toBe('respecte');
        expect(report.score).toBe(100);
    });

    it('détecte une série écourtée', () => {
        // Deux intervalles sur quatre seulement.
        const laps = [
            makeLap({ durationSeconds: 1200, distanceMeters: 10000, avgPower: 160 }),
            makeLap({ durationSeconds: 300, distanceMeters: 3000, avgPower: 250 }),
            makeLap({ durationSeconds: 120, distanceMeters: 800, avgPower: 150 }),
            makeLap({ durationSeconds: 300, distanceMeters: 3000, avgPower: 250 }),
            makeLap({ durationSeconds: 600, distanceMeters: 4000, avgPower: 140 }),
        ];

        const report = computeAdherence({
            structure: CYCLING_STRUCTURE,
            sport: 'cycling',
            laps,
            actualDurationSeconds: 2520,
        });

        expect(report.verdict).toBe('allege');
        expect(report.workVolume.deltaPct).toBeCloseTo(-0.5, 5);
        expect(report.details.join(' ')).toContain('Volume de travail');
        expect(report.score).toBeLessThan(60);
    });

    it('détecte une intensité au-dessus de la cible', () => {
        const laps = faithfulLaps().map(l => (l.avgPower === 250 ? { ...l, avgPower: 300 } : l));

        const report = computeAdherence({
            structure: CYCLING_STRUCTURE,
            sport: 'cycling',
            laps,
            actualDurationSeconds: 3480,
        });

        expect(report.verdict).toBe('durci');
        expect(report.intensity.deltaPct).toBeCloseTo(0.2, 5);
    });

    it('mesure encore la durée quand les tours ne portent aucune puissance', () => {
        const report = computeAdherence({
            structure: CYCLING_STRUCTURE,
            sport: 'cycling',
            laps: [],
            actualDurationSeconds: 3480,
        });

        expect(report.duration.deltaPct).toBeCloseTo(0, 5);
        expect(report.intensity.deltaPct).toBeNull();
        // Un seul axe mesuré ne suffit pas à décerner un « respectée ».
        expect(report.verdict).toBe('partiel');
    });

    it('reste sans verdict quand il n\'y a rien à comparer', () => {
        const report = computeAdherence({
            structure: CYCLING_STRUCTURE,
            sport: 'cycling',
            laps: [],
            actualDurationSeconds: null,
        });

        expect(report.verdict).toBe('inconnu');
        expect(report.score).toBe(0);
    });

    it('reste sans verdict sur une séance sans structure de référence', () => {
        const report = computeAdherence({
            structure: [],
            sport: 'cycling',
            laps: faithfulLaps(),
            actualDurationSeconds: 3480,
        });

        expect(report.verdict).toBe('inconnu');
        expect(report.headline).toContain('sans structure');
    });

    it('juge une séance de course sur la vitesse et non sur l\'allure', () => {
        const structure = [
            makeSimpleBlock({ type: 'Warmup', durationActifSecondes: 600, targetPaceMinPerKm: '6:00' }),
            makeRepeatBlock({
                repeat: 5,
                durationActifSecondes: 180, targetPaceMinPerKm: '4:00',
                durationRecupSecondes: 90, targetRecupPaceMinPerKm: '6:30',
            }),
            makeSimpleBlock({ type: 'Cooldown', durationActifSecondes: 300, targetPaceMinPerKm: '6:00' }),
        ];

        // 5 intervalles de 3 min à 4:00/km = 750 m chacun.
        const laps = [makeLap({ durationSeconds: 600, distanceMeters: 1670 })];
        for (let i = 0; i < 5; i++) {
            laps.push(makeLap({ durationSeconds: 180, distanceMeters: 750 }));
            laps.push(makeLap({ durationSeconds: 90, distanceMeters: 230 }));
        }
        laps.push(makeLap({ durationSeconds: 300, distanceMeters: 835 }));

        const report = computeAdherence({
            structure,
            sport: 'running',
            laps,
            actualDurationSeconds: 2250,
        });

        expect(report.verdict).toBe('respecte');
        expect(report.workVolume.actualValue).toBe(900);
    });
});
