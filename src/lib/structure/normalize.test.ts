import { describe, expect, it } from 'vitest';
import {
    blockTotalSeconds,
    deriveDurationMinutes,
    deriveTopLevelTargets,
    fitStructureToSlot,
    isRepeatInverted,
    isStructureTrustworthy,
    repairStructure,
    structureTotalMeters,
    structureTotalSeconds,
    validateStructure,
} from './normalize';
import { makeRepeatBlock, makeSimpleBlock } from '@/test/fixtures';

describe('totaux', () => {
    it('compte les répétitions ET les récupérations d\'une série', () => {
        const b = makeRepeatBlock({ repeat: 3, durationActifSecondes: 900, durationRecupSecondes: 300 });
        expect(blockTotalSeconds(b)).toBe(3 * 1200);
    });

    it('additionne les blocs d\'une structure complète', () => {
        const structure = [
            makeSimpleBlock({ type: 'Warmup', durationActifSecondes: 1200 }),
            makeRepeatBlock({ repeat: 3, durationActifSecondes: 900, durationRecupSecondes: 300 }),
            makeSimpleBlock({ type: 'Cooldown', durationActifSecondes: 900 }),
        ];
        expect(structureTotalSeconds(structure)).toBe(1200 + 3600 + 900);
    });

    it('multiplie la distance par le nombre de répétitions en natation', () => {
        const structure = [
            makeSimpleBlock({ durationActifSecondes: null, distanceMeters: 400 }),
            makeRepeatBlock({ repeat: 8, durationActifSecondes: null, distanceMeters: 50 }),
        ];
        expect(structureTotalMeters(structure)).toBe(400 + 400);
    });
});

describe('isRepeatInverted', () => {
    it('détecte une récupération plus puissante que la phase active', () => {
        expect(isRepeatInverted(makeRepeatBlock({ targetPowerWatts: 150, targetRecupPowerWatts: 250 }))).toBe(true);
        expect(isRepeatInverted(makeRepeatBlock({ targetPowerWatts: 250, targetRecupPowerWatts: 150 }))).toBe(false);
    });

    it('lit une allure à l\'envers : plus basse veut dire plus rapide', () => {
        expect(isRepeatInverted(makeRepeatBlock({ targetPaceMinPerKm: '5:00', targetRecupPaceMinPerKm: '4:00' }))).toBe(true);
        expect(isRepeatInverted(makeRepeatBlock({ targetPaceMinPerKm: '4:00', targetRecupPaceMinPerKm: '6:00' }))).toBe(false);
    });

    it('retombe sur la FC quand ni puissance ni allure ne sont disponibles', () => {
        expect(isRepeatInverted(makeRepeatBlock({ targetHeartRateBPM: 130, targetRecupHeartRateBPM: 170 }))).toBe(true);
    });

    it('ne conclut rien sans paire de cibles comparable', () => {
        expect(isRepeatInverted(makeRepeatBlock({ targetPowerWatts: 250 }))).toBe(false);
    });
});

describe('repairStructure', () => {
    it('échange les phases inversées et signale la correction', () => {
        const { structure, issues } = repairStructure([
            makeRepeatBlock({
                durationActifSecondes: 300, targetPowerWatts: 150,
                durationRecupSecondes: 900, targetRecupPowerWatts: 250,
            }),
        ]);

        const fixed = structure[0];
        expect(fixed.durationActifSecondes).toBe(900);
        expect(fixed.targetPowerWatts).toBe(250);
        expect(fixed.type === 'Repeat' && fixed.durationRecupSecondes).toBe(300);
        expect(issues.map(i => i.code)).toEqual(['INVERTED_REPEAT']);
    });

    it('laisse intacte une série correctement ordonnée', () => {
        const input = [makeRepeatBlock({ targetPowerWatts: 250, targetRecupPowerWatts: 150 })];
        const { structure, issues } = repairStructure(input);
        expect(structure[0]).toEqual(input[0]);
        expect(issues).toEqual([]);
    });
});

describe('validateStructure', () => {
    it('signale une structure vide', () => {
        expect(validateStructure([]).map(i => i.code)).toEqual(['EMPTY']);
    });

    it('signale une durée manquante sur un sport qui se compte en temps', () => {
        const issues = validateStructure([makeSimpleBlock({ durationActifSecondes: null, targetPowerWatts: 200 })]);
        expect(issues.map(i => i.code)).toContain('MISSING_DURATION');
    });

    it('accepte un bloc de natation mesuré en mètres', () => {
        const issues = validateStructure(
            [makeSimpleBlock({ durationActifSecondes: null, distanceMeters: 400, targetPaceMinPer100m: '1:40' })],
            { countsInDistance: true },
        );
        expect(issues.map(i => i.code)).not.toContain('MISSING_DURATION');
    });

    it('signale un bloc d\'effort sans aucune cible chiffrée', () => {
        const issues = validateStructure([makeSimpleBlock({ type: 'Active', durationActifSecondes: 600 })]);
        expect(issues.map(i => i.code)).toContain('NO_TARGET');
    });

    it('n\'exige pas de cible sur un échauffement ou un retour au calme', () => {
        const issues = validateStructure([
            makeSimpleBlock({ type: 'Warmup', durationActifSecondes: 600 }),
            makeSimpleBlock({ type: 'Cooldown', durationActifSecondes: 600 }),
        ]);
        expect(issues.map(i => i.code)).not.toContain('NO_TARGET');
    });

    it('signale un dépassement du créneau au-delà de la tolérance de 5 %', () => {
        const structure = [makeSimpleBlock({ durationActifSecondes: 3700, targetPowerWatts: 200 })];
        expect(validateStructure(structure, { slotSeconds: 3600 }).map(i => i.code)).not.toContain('OVER_SLOT');

        const tooLong = [makeSimpleBlock({ durationActifSecondes: 4200, targetPowerWatts: 200 })];
        expect(validateStructure(tooLong, { slotSeconds: 3600 }).map(i => i.code)).toContain('OVER_SLOT');
    });

    it('signale une série chronométrée privée de sa récupération intercalée', () => {
        // Observé en production : « 4× (5 min à 330 W) » sans le moindre temps
        // de récup — le modèle sautait "dr", qui était optionnel.
        const issues = validateStructure([
            makeRepeatBlock({
                repeat: 4,
                durationActifSecondes: 300, targetPowerWatts: 330,
                durationRecupSecondes: null,
            }),
        ]);

        expect(issues.map(i => i.code)).toContain('MISSING_RECOVERY');
    });

    it('ne réclame pas de récupération à un bloc joué une seule fois', () => {
        const issues = validateStructure([
            makeRepeatBlock({ repeat: 1, durationActifSecondes: 300, targetPowerWatts: 330, durationRecupSecondes: null }),
        ]);

        expect(issues.map(i => i.code)).not.toContain('MISSING_RECOVERY');
    });

    it('ne réclame pas de récupération à une série comptée en mètres', () => {
        const issues = validateStructure(
            [makeRepeatBlock({
                repeat: 8,
                durationActifSecondes: null, distanceMeters: 50,
                targetPaceMinPer100m: '1:40', durationRecupSecondes: null,
            })],
            { countsInDistance: true },
        );

        expect(issues.map(i => i.code)).not.toContain('MISSING_RECOVERY');
    });

    it('signale une séance tronquée, très en deçà du temps disponible', () => {
        // Le cas observé en production : 16 min de blocs pour un créneau d'une
        // heure. Le modèle s'est arrêté en route ; rien ne le signalait.
        const truncated = [
            makeSimpleBlock({ type: 'Warmup', durationActifSecondes: 600, targetPowerWatts: 170 }),
            makeSimpleBlock({ type: 'Active', durationActifSecondes: 180, targetPowerWatts: 240 }),
            makeSimpleBlock({ type: 'Rest', durationActifSecondes: 120, targetPowerWatts: 150 }),
            makeSimpleBlock({ type: 'Active', durationActifSecondes: 60, targetPowerWatts: 350 }),
        ];

        expect(validateStructure(truncated, { slotSeconds: 3600 }).map(i => i.code)).toContain('UNDER_SLOT');
    });

    it('ne reproche pas sa brièveté à une séance proche du créneau', () => {
        const structure = [makeSimpleBlock({ durationActifSecondes: 3000, targetPowerWatts: 200 })];
        expect(validateStructure(structure, { slotSeconds: 3600 }).map(i => i.code)).not.toContain('UNDER_SLOT');
    });

    it('ne juge pas du créneau une séance qui ne se compte pas en temps', () => {
        const swim = [makeSimpleBlock({ durationActifSecondes: null, distanceMeters: 400, targetPaceMinPer100m: '1:40' })];
        const codes = validateStructure(swim, { countsInDistance: true, slotSeconds: 3600 }).map(i => i.code);
        expect(codes).not.toContain('UNDER_SLOT');
        expect(codes).not.toContain('OVER_SLOT');
    });
});

describe('fitStructureToSlot', () => {
    it('ne touche à rien quand la séance tient dans le créneau', () => {
        const structure = [makeSimpleBlock({ durationActifSecondes: 3000 })];
        const result = fitStructureToSlot(structure, 3600);
        expect(result.adjusted).toBe(false);
        expect(result.structure).toEqual(structure);
    });

    it('retire des répétitions à la série la plus coûteuse avant de toucher au reste', () => {
        const structure = [
            makeSimpleBlock({ type: 'Warmup', durationActifSecondes: 900 }),
            makeRepeatBlock({ repeat: 5, durationActifSecondes: 300, durationRecupSecondes: 120 }),
            makeSimpleBlock({ type: 'Cooldown', durationActifSecondes: 600 }),
        ];

        const { structure: fitted, adjusted } = fitStructureToSlot(structure, 45 * 60);

        expect(adjusted).toBe(true);
        expect(fitted[1].type === 'Repeat' && fitted[1].repeat).toBe(3);
        // Les bords restent intacts tant que réduire la série suffit.
        expect(fitted[0].durationActifSecondes).toBe(900);
        expect(fitted[2].durationActifSecondes).toBe(600);
    });

    it('ne descend jamais une série sous deux répétitions', () => {
        const structure = [makeRepeatBlock({ repeat: 4, durationActifSecondes: 600, durationRecupSecondes: 0 })];
        const { structure: fitted } = fitStructureToSlot(structure, 10 * 60);
        expect(fitted[0].type === 'Repeat' && fitted[0].repeat).toBe(2);
    });

    it('rogne ensuite les bords de séance, proportionnellement et sans passer sous 5 min', () => {
        const structure = [
            makeSimpleBlock({ type: 'Warmup', durationActifSecondes: 1200 }),
            makeSimpleBlock({ type: 'Active', durationActifSecondes: 1800 }),
            makeSimpleBlock({ type: 'Cooldown', durationActifSecondes: 1200 }),
        ];

        const { structure: fitted, adjusted } = fitStructureToSlot(structure, 60 * 60);

        expect(adjusted).toBe(true);
        // Budget = créneau + 5 % : on ne rabote pas une séance pour deux minutes.
        expect(structureTotalSeconds(fitted)).toBeLessThanOrEqual(60 * 60 * 1.05);
        expect(fitted[1].durationActifSecondes).toBe(1800); // le corps de séance n'est pas touché
        expect(fitted[0].durationActifSecondes).toBeGreaterThanOrEqual(300);
        expect(fitted[2].durationActifSecondes).toBeGreaterThanOrEqual(300);
    });

    it('rend la séance en l\'état plutôt que de dénaturer un bloc irréductible', () => {
        const structure = [makeSimpleBlock({ type: 'Active', durationActifSecondes: 5400 })];
        const { structure: fitted, adjusted } = fitStructureToSlot(structure, 3600);
        expect(adjusted).toBe(false);
        expect(fitted[0].durationActifSecondes).toBe(5400);
    });
});

describe('deriveDurationMinutes', () => {
    it('déduit la durée de la somme des blocs', () => {
        const structure = [
            makeSimpleBlock({ type: 'Warmup', durationActifSecondes: 1200 }),
            makeRepeatBlock({ repeat: 3, durationActifSecondes: 900, durationRecupSecondes: 300 }),
            makeSimpleBlock({ type: 'Cooldown', durationActifSecondes: 900 }),
        ];
        expect(deriveDurationMinutes(structure, 999)).toBe(95);
    });

    it('retombe sur la durée annoncée quand la structure ne se compte pas en temps', () => {
        const structure = [makeSimpleBlock({ durationActifSecondes: null, distanceMeters: 400 })];
        expect(deriveDurationMinutes(structure, 45)).toBe(45);
    });
});

describe('deriveTopLevelTargets', () => {
    it('retient la cible des intervalles, pas celle de l\'échauffement', () => {
        const targets = deriveTopLevelTargets([
            makeSimpleBlock({ type: 'Warmup', durationActifSecondes: 1200, targetPowerWatts: 160 }),
            makeRepeatBlock({ repeat: 3, targetPowerWatts: 224, targetRecupPowerWatts: 177 }),
        ]);
        expect(targets.targetPowerWatts).toBe(224);
    });

    it('retient l\'allure la plus rapide, donc la plus basse', () => {
        const targets = deriveTopLevelTargets([
            makeSimpleBlock({ type: 'Warmup', targetPaceMinPerKm: '6:00' }),
            makeRepeatBlock({ targetPaceMinPerKm: '4:00' }),
        ]);
        expect(targets.targetPaceMinPerKm).toBe('4:00');
    });

    it('totalise la distance de natation', () => {
        const targets = deriveTopLevelTargets([
            makeSimpleBlock({ type: 'Warmup', durationActifSecondes: null, distanceMeters: 400 }),
            makeRepeatBlock({ repeat: 8, durationActifSecondes: null, distanceMeters: 50, targetPaceMinPer100m: '1:40' }),
        ]);
        expect(targets.distanceMeters).toBe(800);
        expect(targets.targetPaceMinPer100m).toBe('1:40');
    });
});

describe('isStructureTrustworthy', () => {
    it('rejette la signature des durées fabriquées par l\'ancien pipeline', () => {
        // 125 min réparties à parts égales sur 4 blocs = 1875 s chacun, soit 31:15.
        // La somme tombe pile sur la durée annoncée : seule la non-rondeur trahit.
        const legacy = [
            makeSimpleBlock({ type: 'Warmup', durationActifSecondes: 1875 }),
            makeSimpleBlock({ type: 'Active', durationActifSecondes: 1875 }),
            makeSimpleBlock({ type: 'Rest', durationActifSecondes: 1875 }),
            makeSimpleBlock({ type: 'Cooldown', durationActifSecondes: 1875 }),
        ];
        expect(structureTotalSeconds(legacy)).toBe(125 * 60);
        expect(isStructureTrustworthy(legacy, 125)).toBe(false);
    });

    it('accepte une prescription en minutes rondes', () => {
        const honest = [
            makeSimpleBlock({ type: 'Warmup', durationActifSecondes: 1200 }),
            makeRepeatBlock({ repeat: 3, durationActifSecondes: 900, durationRecupSecondes: 300 }),
            makeSimpleBlock({ type: 'Cooldown', durationActifSecondes: 900 }),
        ];
        expect(isStructureTrustworthy(honest, 95)).toBe(true);
    });

    it('tolère les durées courtes non rondes, qui sont de vraies prescriptions', () => {
        const shortIntervals = [makeRepeatBlock({ repeat: 30, durationActifSecondes: 40, durationRecupSecondes: 20 })];
        expect(isStructureTrustworthy(shortIntervals, 30)).toBe(true);
    });

    it('rejette une structure qui contredit franchement la durée annoncée', () => {
        const structure = [makeSimpleBlock({ durationActifSecondes: 3600 })];
        expect(isStructureTrustworthy(structure, 120)).toBe(false);
    });

    it('accepte une séance de natation comptée uniquement en distance', () => {
        const swim = [makeRepeatBlock({ repeat: 8, durationActifSecondes: null, distanceMeters: 50 })];
        expect(isStructureTrustworthy(swim, 45)).toBe(true);
    });

    it('rejette une structure absente', () => {
        expect(isStructureTrustworthy([], 60)).toBe(false);
        expect(isStructureTrustworthy(null, 60)).toBe(false);
    });
});
