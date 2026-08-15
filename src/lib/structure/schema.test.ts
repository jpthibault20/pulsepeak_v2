import { describe, expect, it } from 'vitest';
import { expandCompactBlock, expandCompactStructure, isSchedulable } from './schema';
import type { StructureRepeatBlock, StructureSimpleBlock } from '@/lib/data/type';
import { makeSimpleBlock } from '@/test/fixtures';

describe('expandCompactBlock', () => {
    it('déplie un bloc simple en conservant les seules cibles renseignées', () => {
        const b = expandCompactBlock({ type: 'Warmup', d: 1200, w: 160, l: 'progressif Z1-Z2' }) as StructureSimpleBlock;

        expect(b.type).toBe('Warmup');
        expect(b.durationActifSecondes).toBe(1200);
        expect(b.targetPowerWatts).toBe(160);
        expect(b.description).toBe('progressif Z1-Z2');
        expect(b.targetPaceMinPerKm).toBeNull();
        expect(b.targetHeartRateBPM).toBeNull();
    });

    it('déplie un Repeat en séparant phase active et phase de récupération', () => {
        const b = expandCompactBlock({
            type: 'Repeat', n: 3, d: 900, w: 224, dr: 300, wr: 177, l: 'force',
        }) as StructureRepeatBlock;

        expect(b.repeat).toBe(3);
        expect(b.durationActifSecondes).toBe(900);
        expect(b.targetPowerWatts).toBe(224);
        expect(b.durationRecupSecondes).toBe(300);
        expect(b.targetRecupPowerWatts).toBe(177);
    });

    it('ramène un type inconnu à Active plutôt que de perdre le bloc', () => {
        const b = expandCompactBlock({ type: 'Tempo', d: 600 }) as StructureSimpleBlock;
        expect(b.type).toBe('Active');
    });

    it('force un nombre de répétitions minimal de 1', () => {
        const b = expandCompactBlock({ type: 'Repeat', n: 0, d: 60 }) as StructureRepeatBlock;
        expect(b.repeat).toBe(1);
    });

    it('rejette une nage hors vocabulaire et un matériel vide', () => {
        const b = expandCompactBlock({ type: 'Active', m: 100, nage: 'papillon-inverse', mat: ['  '] }) as StructureSimpleBlock;
        expect(b.strokeType).toBeNull();
        expect(b.equipment).toBeNull();
    });

    it('traite une durée nulle ou négative comme une absence de durée', () => {
        const zero = expandCompactBlock({ type: 'Active', d: 0 }) as StructureSimpleBlock;
        const negative = expandCompactBlock({ type: 'Active', d: -120 }) as StructureSimpleBlock;
        expect(zero.durationActifSecondes).toBeNull();
        expect(negative.durationActifSecondes).toBeNull();
    });
});

describe('isSchedulable', () => {
    it('accepte un bloc mesuré en temps, en distance ou en séries', () => {
        expect(isSchedulable(makeSimpleBlock({ durationActifSecondes: 600 }))).toBe(true);
        expect(isSchedulable(makeSimpleBlock({ durationActifSecondes: null, distanceMeters: 400 }))).toBe(true);
        expect(isSchedulable(makeSimpleBlock({ durationActifSecondes: null, reps: 10, sets: 4 }))).toBe(true);
    });

    it('refuse un bloc sans aucune grandeur exécutable', () => {
        expect(isSchedulable(makeSimpleBlock({ durationActifSecondes: null }))).toBe(false);
    });
});

describe('expandCompactStructure', () => {
    it('écarte les blocs sans prescription exécutable au lieu de leur inventer une durée', () => {
        const structure = expandCompactStructure([
            { type: 'Warmup', d: 900, l: 'échauffement' },
            { type: 'Active', l: 'bloc sans durée ni distance' },
            { type: 'Cooldown', d: 600, l: 'retour au calme' },
        ]);

        expect(structure).toHaveLength(2);
        expect(structure.map(b => b.durationActifSecondes)).toEqual([900, 600]);
    });

    it('ramène un Repeat joué une seule fois à un bloc d\'effort simple', () => {
        // Observé en production : le modèle omettait "n", on affichait
        // « 1× (1 min à 350 W) » pour ce qui devait être une série.
        const structure = expandCompactStructure([
            { type: 'Repeat', d: 60, w: 350, l: 'Intervalles PMA' },
        ]);

        expect(structure).toHaveLength(1);
        expect(structure[0].type).toBe('Active');
        expect(structure[0].durationActifSecondes).toBe(60);
        expect(structure[0].targetPowerWatts).toBe(350);
    });

    it('sort la récupération d\'un Repeat unique en bloc à part plutôt que de la perdre', () => {
        const structure = expandCompactStructure([
            { type: 'Repeat', n: 1, d: 60, w: 350, dr: 120, wr: 150, l: 'PMA' },
        ]);

        expect(structure.map(b => b.type)).toEqual(['Active', 'Rest']);
        expect(structure[1].durationActifSecondes).toBe(120);
        expect(structure[1].targetPowerWatts).toBe(150);
    });

    it('conserve une vraie série sous forme de Repeat', () => {
        const structure = expandCompactStructure([
            { type: 'Repeat', n: 5, d: 60, w: 350, dr: 120, wr: 150, l: 'PMA' },
        ]);

        expect(structure).toHaveLength(1);
        expect(structure[0].type).toBe('Repeat');
        expect(structure[0].type === 'Repeat' && structure[0].repeat).toBe(5);
    });

    it('renvoie un tableau vide pour une réponse non exploitable', () => {
        expect(expandCompactStructure(null)).toEqual([]);
        expect(expandCompactStructure('structure')).toEqual([]);
        expect(expandCompactStructure([])).toEqual([]);
    });
});
