/******************************************************************************
 * @file    strava-mapper.test.ts
 * @brief   Tests unitaires du mapping activité Strava → CompletedData.
 *
 * `crud` est mocké : le module est importé pour le repli `getProfile()`, mais
 * un test unitaire ne doit jamais toucher la base. Tous les cas passent le
 * profil en argument, sauf celui qui vérifie précisément ce repli.
 ******************************************************************************/

import { describe, it, expect, vi } from 'vitest';
import { mapStravaSport, mapStravaToCompletedData } from './strava-mapper';
import { makeProfile, makeZones } from '@/test/fixtures';

vi.mock('@/lib/data/crud', () => ({
    getProfile: vi.fn(async () => null),
}));

const PROFIL = makeProfile({
    cycling: { Test: { ftp: 250, zones: makeZones() } },        // maxima 100/150/200/250/300
    running: { Test: { vma: 18 } },                             // seuil 15.84 km/h
    swimming: { Test: { recentRaceTimeSec: 320, recentRaceDistanceMeters: 400 } }, // CSS 1.25 m/s
    heartRate: { max: 190, resting: 50, zones: makeZones() },
});

/** Activité Strava minimale : seuls les champs obligatoires du mapper. */
function activite(overrides: Record<string, unknown> = {}) {
    return {
        id: 12345,
        type: 'Ride',
        moving_time: 3600,
        distance: 30000,
        total_elevation_gain: 500,
        average_speed: 8.3333,  // ≈ 30 km/h
        max_speed: 13.8889,     // ≈ 50 km/h
        ...overrides,
    } as Parameters<typeof mapStravaToCompletedData>[0];
}

// ─── Correspondance des sports ────────────────────────────────────────────────

describe('mapStravaSport', () => {
    it('regroupe les variantes de course', () => {
        for (const t of ['Run', 'TrailRun', 'VirtualRun']) expect(mapStravaSport(t)).toBe('running');
    });

    it('regroupe les variantes de vélo', () => {
        for (const t of ['Ride', 'VirtualRide', 'GravelRide', 'MountainBikeRide', 'EBikeRide']) {
            expect(mapStravaSport(t)).toBe('cycling');
        }
    });

    it('reconnaît la natation', () => {
        expect(mapStravaSport('Swim')).toBe('swimming');
    });

    it('range tout le reste dans « other »', () => {
        for (const t of ['Walk', 'Hike', 'WeightTraining', 'Yoga', '', 'run']) {
            expect(mapStravaSport(t)).toBe('other');
        }
    });
});

// ─── Champs communs ───────────────────────────────────────────────────────────

describe('mapStravaToCompletedData — champs communs', () => {
    it('convertit durée, distance et métadonnées', async () => {
        const cd = await mapStravaToCompletedData(activite({
            moving_time: 3600,
            distance: 30456,
            description: 'Sortie club',
            calories: 800,
            perceived_exertion: 7,
            map: { summary_polyline: 'abc123' },
        }), null, PROFIL);

        expect(cd.actualDurationMinutes).toBe(60);
        expect(cd.distanceKm).toBe(30.46); // arrondi au centième
        expect(cd.notes).toBe('Sortie club');
        expect(cd.caloriesBurned).toBe(800);
        expect(cd.perceivedEffort).toBe(7);
        expect(cd.map).toEqual({ polyline: 'abc123' });
    });

    it('tronque la durée à la minute inférieure', async () => {
        const cd = await mapStravaToCompletedData(activite({ moving_time: 3599 }), null, PROFIL);
        expect(cd.actualDurationMinutes).toBe(59);
    });

    it('trace l’origine Strava pour la déduplication', async () => {
        const cd = await mapStravaToCompletedData(activite({ id: 987654 }), null, PROFIL);
        expect(cd.source).toEqual({ type: 'strava', stravaId: 987654 });
    });

    it('normalise les champs absents', async () => {
        const cd = await mapStravaToCompletedData(activite(), null, PROFIL);
        expect(cd.notes).toBe('');
        expect(cd.caloriesBurned).toBeNull();
        expect(cd.perceivedEffort).toBeNull();
        expect(cd.map).toEqual({ polyline: null });
        expect(cd.laps).toEqual([]);
        expect(cd.heartRate?.avgBPM).toBeNull();
    });
});

// ─── Métriques par sport ──────────────────────────────────────────────────────

describe('mapStravaToCompletedData — vélo', () => {
    const veloComplet = () => activite({
        average_watts: 200,
        weighted_average_watts: 230,
        max_watts: 600,
        average_heartrate: 145,
        max_heartrate: 175,
        average_cadence: 88,
    });

    it('convertit les vitesses en km/h et remplit les métriques puissance', async () => {
        const cd = await mapStravaToCompletedData(veloComplet(), null, PROFIL);
        const c = cd.metrics.cycling!;
        expect(c.avgSpeedKmH).toBeCloseTo(30, 3);
        expect(c.maxSpeedKmH).toBeCloseTo(50, 3);
        expect(c.avgPowerWatts).toBe(200);
        expect(c.normalizedPowerWatts).toBe(230);
        expect(c.elevationGainMeters).toBe(500);
        expect(cd.metrics.running).toBeNull();
        expect(cd.metrics.swimming).toBeNull();
    });

    it('calcule le Variability Index NP / moyenne', async () => {
        const cd = await mapStravaToCompletedData(veloComplet(), null, PROFIL);
        expect(cd.variabilityIndex).toBe(1.15);
    });

    it('calcule le TSS par la puissance et le reporte sur les métriques vélo', async () => {
        const cd = await mapStravaToCompletedData(veloComplet(), null, PROFIL);
        expect(cd.tssSource).toBe('power');       // NP 230 / FTP 250 → IF 0.92
        expect(cd.calculatedTSS).toBe(85);
        expect(cd.intensityFactor).toBe(0.92);
        expect(cd.metrics.cycling?.tss).toBe(85);
    });
});

describe('mapStravaToCompletedData — course', () => {
    const course = () => activite({
        type: 'Run',
        moving_time: 3600,
        distance: 15840,
        average_speed: 4.4,   // 15.84 km/h = vitesse seuil du profil
        max_speed: 5.5,
        average_cadence: 88,  // Strava compte un seul pied
    });

    it('dérive l’allure et double la cadence', async () => {
        const cd = await mapStravaToCompletedData(course(), null, PROFIL);
        expect(cd.metrics.running?.avgPaceMinPerKm).toBe('3:47');
        expect(cd.metrics.running?.avgCadenceSPM).toBe(176);
        expect(cd.metrics.cycling).toBeNull();
    });

    it('calcule le TSS par l’allure', async () => {
        const cd = await mapStravaToCompletedData(course(), null, PROFIL);
        expect(cd.tssSource).toBe('pace');
        expect(cd.calculatedTSS).toBe(100);
        expect(cd.metrics.running?.tss).toBe(100);
    });
});

describe('mapStravaToCompletedData — natation', () => {
    it('dérive l’allure aux 100 m et le TSS par la CSS', async () => {
        const cd = await mapStravaToCompletedData(activite({
            type: 'Swim',
            moving_time: 2400,
            distance: 3000,
            average_speed: 1.25,
            max_speed: 1.6,
        }), null, PROFIL);

        expect(cd.metrics.swimming?.avgPace100m).toBe('1:20');
        expect(cd.tssSource).toBe('pace');
        expect(cd.calculatedTSS).toBe(67); // 40 min à IF 1
        expect(cd.metrics.swimming?.tss).toBe(67);
    });
});

describe('mapStravaToCompletedData — sport non suivi', () => {
    it('ne remplit aucune métrique spécifique', async () => {
        const cd = await mapStravaToCompletedData(activite({ type: 'WeightTraining' }), null, PROFIL);
        expect(cd.metrics).toEqual({ cycling: null, running: null, swimming: null });
    });
});

// ─── Tours ────────────────────────────────────────────────────────────────────

describe('mapStravaToCompletedData — tours', () => {
    const streamWatts = { watts: { data: Array(60).fill(180) } };

    const avecTours = () => activite({
        average_watts: 180,
        weighted_average_watts: 180,
        laps: [
            {
                lap_index: 1, name: 'Lap 1', moving_time: 1800, distance: 15000,
                average_watts: 180, average_heartrate: 140, average_cadence: 85,
                average_speed: 8.3333, start_index: 0, end_index: 29,
            },
            {
                lap_index: 2, name: '', moving_time: 1800, distance: 15000,
                average_watts: 190, average_speed: 8.3333, start_index: 30, end_index: 59,
            },
        ],
    });

    it('mappe chaque tour avec sa vitesse au dixième', async () => {
        const cd = await mapStravaToCompletedData(avecTours(), streamWatts, PROFIL);
        expect(cd.laps).toHaveLength(2);
        expect(cd.laps[0]).toMatchObject({
            index: 1, name: 'Lap 1', durationSeconds: 1800, distanceMeters: 15000,
            avgPower: 180, avgHeartRate: 140, avgSpeedKmh: 30,
        });
    });

    it('nomme les tours sans libellé', async () => {
        const cd = await mapStravaToCompletedData(avecTours(), streamWatts, PROFIL);
        expect(cd.laps[1].name).toBe('Lap 2');
    });

    it('calcule NP et puissance max par tour depuis le stream', async () => {
        const cd = await mapStravaToCompletedData(avecTours(), streamWatts, PROFIL);
        expect(cd.laps[0].normalizedPower).toBe(180);
        expect(cd.laps[0].maxPower).toBe(180);
    });

    it('laisse NP à null sans stream de puissance', async () => {
        const cd = await mapStravaToCompletedData(avecTours(), null, PROFIL);
        expect(cd.laps[0].normalizedPower).toBeNull();
        expect(cd.laps[0].maxPower).toBeNull();
    });
});

// ─── Répartition par zones et type détecté ────────────────────────────────────

describe('mapStravaToCompletedData — analyse', () => {
    it('privilégie les zones de puissance quand le capteur est là', async () => {
        const cd = await mapStravaToCompletedData(
            activite({ average_watts: 180, weighted_average_watts: 180 }),
            { watts: { data: Array(60).fill(180) }, heartrate: { data: Array(60).fill(120) } },
            PROFIL,
        );
        expect(cd.zoneDistributionSource).toBe('power');
        expect(cd.zoneDistribution).toEqual([0, 0, 100, 0, 0]); // 180 W → Z3
        expect(cd.detectedType).toBe('Tempo');
    });

    it('retombe sur les zones FC hors vélo', async () => {
        const cd = await mapStravaToCompletedData(
            activite({ type: 'Run', average_speed: 4.4, average_heartrate: 120 }),
            { heartrate: { data: Array(60).fill(120) } },
            PROFIL,
        );
        expect(cd.zoneDistributionSource).toBe('hr');
        expect(cd.zoneDistribution).toEqual([0, 100, 0, 0, 0]); // 120 bpm → Z2
        expect(cd.detectedType).toBe('Endurance');
    });

    it('n’invente pas de répartition sans stream', async () => {
        const cd = await mapStravaToCompletedData(activite({ average_watts: 180 }), null, PROFIL);
        expect(cd.zoneDistribution).toBeUndefined();
        expect(cd.zoneDistributionSource).toBeUndefined();
    });
});

// ─── Repli sans profil ────────────────────────────────────────────────────────

describe('mapStravaToCompletedData — sans profil', () => {
    it('retombe sur le TSS forfaitaire du sport', async () => {
        const cd = await mapStravaToCompletedData(activite({ average_watts: 200 }));
        expect(cd.tssSource).toBe('default');
        expect(cd.calculatedTSS).toBe(50); // 1 h de vélo
    });
});
