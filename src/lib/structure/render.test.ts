import { describe, expect, it } from 'vitest';
import { formatSeconds, formatTarget, renderStructureToText } from './render';
import { makeRepeatBlock, makeSimpleBlock } from '@/test/fixtures';

describe('formatSeconds', () => {
    it('écrit les minutes rondes sans secondes', () => {
        expect(formatSeconds(1200)).toBe('20 min');
    });

    it('conserve les secondes quand la durée ne tombe pas sur la minute', () => {
        expect(formatSeconds(90)).toBe('1 min 30');
        expect(formatSeconds(1875)).toBe('31 min 15');
    });

    it('reste en secondes sous la minute', () => {
        expect(formatSeconds(40)).toBe('40 s');
    });

    it('rend une chaîne vide pour une durée absente', () => {
        expect(formatSeconds(null)).toBe('');
        expect(formatSeconds(0)).toBe('');
    });
});

describe('formatTarget', () => {
    it('applique l\'ordre de priorité watts > allure > FC > RPE', () => {
        expect(formatTarget({ targetPowerWatts: 224, targetHeartRateBPM: 150 })).toBe('224 W');
        expect(formatTarget({ targetPaceMinPerKm: '4:30', targetHeartRateBPM: 150 })).toBe('4:30/km');
        expect(formatTarget({ targetPaceMinPer100m: '1:40' })).toBe('1:40/100m');
        expect(formatTarget({ targetHeartRateBPM: 150, targetRPE: 7 })).toBe('150 bpm');
        expect(formatTarget({ targetRPE: 7 })).toBe('RPE 7');
    });

    it('rend une chaîne vide quand aucune cible n\'est posée', () => {
        expect(formatTarget({})).toBe('');
    });
});

describe('renderStructureToText', () => {
    it('nomme les blocs de bord et suffixe le libellé', () => {
        const text = renderStructureToText([
            makeSimpleBlock({ type: 'Warmup', durationActifSecondes: 1200, targetPowerWatts: 160, description: 'progressif Z1-Z2' }),
            makeSimpleBlock({ type: 'Cooldown', durationActifSecondes: 900, targetPowerWatts: 135, description: '' }),
        ]);

        expect(text).toBe('Échauffement 20 min à 160 W — progressif Z1-Z2. Retour au calme 15 min à 135 W.');
    });

    it('n\'écrit pas deux fois le mot de tête quand le libellé le répète', () => {
        const text = renderStructureToText([
            makeSimpleBlock({ type: 'Warmup', durationActifSecondes: 600, description: 'Échauffement progressif' }),
        ]);

        expect(text).toBe('Échauffement 10 min.');
    });

    it('rend une série en notation N× (actif / récup)', () => {
        const text = renderStructureToText([
            makeRepeatBlock({
                repeat: 3,
                durationActifSecondes: 900, targetPowerWatts: 224,
                durationRecupSecondes: 300, targetRecupPowerWatts: 177,
                description: 'force 50-60 RPM',
            }),
        ]);

        expect(text).toBe('3× (15 min à 224 W / 5 min récup à 177 W) — force 50-60 RPM.');
    });

    it('compte la natation en mètres, avec nage, matériel et repos au bord', () => {
        const text = renderStructureToText([
            makeRepeatBlock({
                repeat: 8,
                durationActifSecondes: null,
                distanceMeters: 50,
                strokeType: 'crawl',
                targetPaceMinPer100m: '1:40',
                equipment: ['plaquettes'],
                durationRecupSecondes: 15,
                description: '',
            }),
        ]);

        expect(text).toBe('8×50 m crawl à 1:40/100m avec plaquettes, 15\'\' R. Total 400 m.');
    });

    it('prescrit le renforcement en séries plutôt qu\'en temps', () => {
        const text = renderStructureToText([
            makeSimpleBlock({ durationActifSecondes: null, sets: 4, reps: 10, loadKg: 60, description: 'squats' }),
        ]);

        expect(text).toBe('4×10 à 60 kg — squats.');
    });

    it('rend une chaîne vide sur une structure absente', () => {
        expect(renderStructureToText([])).toBe('');
    });
});
