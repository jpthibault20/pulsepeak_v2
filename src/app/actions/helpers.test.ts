/******************************************************************************
 * @file    actions/helpers.test.ts
 * @brief   Tests unitaires des helpers purs de génération de plan : découpage
 *          en blocs, progression du TSS, disponibilités et fenêtre d'affûtage.
 ******************************************************************************/

import { describe, it, expect } from 'vitest';
import {
    computeWeeklyTSS,
    computeBlockSkeletons,
    computeLoadWeekTSS,
    computeRecoveryWeekTSS,
    computeProgressionPerWeek,
    getActiveSports,
    formatActiveSportsFr,
    formatAvailability,
    buildTaperPlan,
    buildAllowedSlots,
} from './helpers';
import { makeObjective, makeSlot } from '@/test/fixtures';

/** Lundi 2 mars 2026 — début de semaine de référence pour les tests d'affûtage. */
const LUNDI = new Date(2026, 2, 2);

// ─── TSS hebdomadaire ─────────────────────────────────────────────────────────

describe('computeWeeklyTSS', () => {
    it('convertit une CTL en charge hebdomadaire (× 7)', () => {
        expect(computeWeeklyTSS(50)).toBe(350);
        expect(computeWeeklyTSS(0)).toBe(0);
        expect(computeWeeklyTSS(72.5)).toBeCloseTo(507.5, 5);
    });
});

// ─── Découpage en blocs ───────────────────────────────────────────────────────

describe('computeBlockSkeletons', () => {
    it('découpe en blocs de 4 semaines', () => {
        expect(computeBlockSkeletons(8)).toEqual([
            { index: 1, duration: 4, isLast: false },
            { index: 2, duration: 4, isLast: true },
        ]);
        expect(computeBlockSkeletons(12).map(b => b.duration)).toEqual([4, 4, 4]);
    });

    it('fait absorber le reliquat par le dernier bloc (≤ 5 semaines)', () => {
        expect(computeBlockSkeletons(6).map(b => b.duration)).toEqual([4, 2]);
        expect(computeBlockSkeletons(10).map(b => b.duration)).toEqual([4, 4, 2]);
        expect(computeBlockSkeletons(13).map(b => b.duration)).toEqual([4, 4, 5]);
    });

    it('ne perd jamais de semaine', () => {
        for (const total of [1, 4, 5, 6, 7, 9, 11, 16, 24, 52]) {
            const sum = computeBlockSkeletons(total).reduce((s, b) => s + b.duration, 0);
            expect(sum).toBe(total);
        }
    });

    it('numérote les blocs consécutivement à partir de 1', () => {
        expect(computeBlockSkeletons(12).map(b => b.index)).toEqual([1, 2, 3]);
    });

    it('ne marque qu’un seul bloc isLast, et seulement s’il y en a plusieurs', () => {
        expect(computeBlockSkeletons(12).filter(b => b.isLast)).toHaveLength(1);
        // Un plan tenant en un seul bloc n'a pas de « dernier » bloc distinct.
        expect(computeBlockSkeletons(4)).toEqual([{ index: 1, duration: 4, isLast: false }]);
        expect(computeBlockSkeletons(5)).toEqual([{ index: 1, duration: 5, isLast: false }]);
    });

    it('renvoie un plan vide pour une durée nulle ou négative', () => {
        expect(computeBlockSkeletons(0)).toEqual([]);
        expect(computeBlockSkeletons(-3)).toEqual([]);
    });
});

// ─── Progression du TSS ───────────────────────────────────────────────────────

describe('computeProgressionPerWeek', () => {
    it('réserve la dernière semaine à la récupération au-delà de 3 semaines', () => {
        // Bloc de 4 semaines = 3 semaines de charge → 2 incréments.
        expect(computeProgressionPerWeek(400, 500, 4)).toBe(50);
        // Bloc de 5 semaines = 4 semaines de charge → 3 incréments.
        expect(computeProgressionPerWeek(400, 550, 5)).toBe(50);
    });

    it('charge toutes les semaines d’un bloc court (≤ 3 semaines)', () => {
        expect(computeProgressionPerWeek(400, 500, 3)).toBe(50);
        expect(computeProgressionPerWeek(400, 500, 2)).toBe(100);
    });

    it('renvoie 0 quand il n’y a qu’une semaine de charge', () => {
        expect(computeProgressionPerWeek(400, 500, 1)).toBe(0);
    });

    it('accepte une progression négative (décharge)', () => {
        expect(computeProgressionPerWeek(500, 400, 4)).toBe(-50);
    });
});

describe('computeLoadWeekTSS', () => {
    it('applique la progression linéaire depuis la semaine 1', () => {
        expect(computeLoadWeekTSS(1, 400, 50)).toBe(400);
        expect(computeLoadWeekTSS(2, 400, 50)).toBe(450);
        expect(computeLoadWeekTSS(3, 400, 50)).toBe(500);
    });

    it('arrondit à l’entier', () => {
        expect(computeLoadWeekTSS(2, 400, 33.333)).toBe(433);
    });
});

describe('computeRecoveryWeekTSS', () => {
    it('applique une décharge de 50 % du TSS de départ du bloc', () => {
        expect(computeRecoveryWeekTSS(400)).toBe(200);
        expect(computeRecoveryWeekTSS(0)).toBe(0);
    });

    it('arrondit à l’entier', () => {
        expect(computeRecoveryWeekTSS(455)).toBe(228);
    });
});

// ─── Sports actifs ────────────────────────────────────────────────────────────

describe('getActiveSports', () => {
    it('ne garde que les disciplines activées', () => {
        expect(getActiveSports({ swimming: true, cycling: false, running: true }))
            .toEqual(['swimming', 'running']);
    });

    it('gère les extrêmes', () => {
        expect(getActiveSports({ swimming: false, cycling: false, running: false })).toEqual([]);
        expect(getActiveSports({ swimming: true, cycling: true, running: true }))
            .toEqual(['swimming', 'cycling', 'running']);
    });
});

describe('formatActiveSportsFr', () => {
    it('traduit les disciplines actives en libellés français', () => {
        expect(formatActiveSportsFr({ swimming: true, cycling: true, running: true }))
            .toBe('natation, cyclisme, course à pied');
    });

    it('n’ajoute pas de virgule en tête quand la première discipline est inactive', () => {
        expect(formatActiveSportsFr({ swimming: false, cycling: false, running: true }))
            .toBe('course à pied');
    });

    it('renvoie une chaîne vide si aucune discipline n’est activée', () => {
        expect(formatActiveSportsFr({ swimming: false, cycling: false, running: false })).toBe('');
    });
});

// ─── Disponibilités ───────────────────────────────────────────────────────────

describe('formatAvailability', () => {
    it('décrit les sports et durées d’un jour', () => {
        const txt = formatAvailability({ Lundi: makeSlot({ cycling: 2, running: 1 }) });
        expect(txt).toBe('- Lundi : vélo 2h, course 1h');
    });

    it('interprète une valeur ≤ 12 comme des heures et > 12 comme des minutes', () => {
        // Ambiguïté héritée de l'ancien format : 12 signifie 12 heures, 13 signifie
        // 13 minutes. Impossible de demander 12 minutes par ce champ.
        expect(formatAvailability({ Lundi: makeSlot({ running: 12 }) })).toBe('- Lundi : course 12h');
        expect(formatAvailability({ Lundi: makeSlot({ running: 13 }) })).toBe('- Lundi : course 13min');
        expect(formatAvailability({ Lundi: makeSlot({ running: 1.5 }) })).toBe('- Lundi : course 1h30');
        expect(formatAvailability({ Lundi: makeSlot({ running: 90 }) })).toBe('- Lundi : course 1h30');
    });

    it('signale les jours laissés au choix de l’IA', () => {
        expect(formatAvailability({ Mardi: makeSlot({ aiChoice: true }) }))
            .toBe('- Mardi : IA LIBRE — tu choisis le sport, la durée et l\'intensité');
        expect(formatAvailability({ Mardi: makeSlot({ aiChoice: true, comment: 'plutôt le matin' }) }))
            .toContain('(plutôt le matin)');
    });

    it('reporte le commentaire d’un jour chargé', () => {
        expect(formatAvailability({ Jeudi: makeSlot({ swimming: 1, comment: 'piscine fermée à 20h' }) }))
            .toBe('- Jeudi : natation 1h (piscine fermée à 20h)');
    });

    it('omet les jours de repos, même commentés', () => {
        expect(formatAvailability({ Dimanche: makeSlot({ comment: 'repos famille' }) })).toBe('');
    });

    it('assemble plusieurs jours ligne par ligne', () => {
        const txt = formatAvailability({
            Lundi: makeSlot({ running: 1 }),
            Mardi: makeSlot(),
            Mercredi: makeSlot({ cycling: 2 }),
        });
        expect(txt.split('\n')).toEqual(['- Lundi : course 1h', '- Mercredi : vélo 2h']);
    });
});

describe('buildAllowedSlots', () => {
    const ACTIFS = ['swimming', 'cycling', 'running'];

    it('indexe les jours français sur 0 = lundi … 6 = dimanche', () => {
        const slots = buildAllowedSlots({
            Lundi: makeSlot({ running: 1 }),
            Dimanche: makeSlot({ cycling: 3 }),
        }, ACTIFS);
        expect([...slots.keys()].sort()).toEqual([0, 6]);
    });

    it('convertit le plafond de durée en minutes', () => {
        const slots = buildAllowedSlots({ Lundi: makeSlot({ cycling: 2, running: 45 }) }, ACTIFS);
        expect(slots.get(0)!.maxMinutes).toEqual({ cycling: 120, running: 45 });
        expect([...slots.get(0)!.sports].sort()).toEqual(['cycling', 'running']);
    });

    it('ouvre toutes les disciplines actives sur un jour IA LIBRE, sans plafond', () => {
        const slots = buildAllowedSlots({ Mardi: makeSlot({ aiChoice: true }) }, ['cycling', 'running']);
        expect([...slots.get(1)!.sports].sort()).toEqual(['cycling', 'running']);
        expect(slots.get(1)!.maxMinutes).toEqual({});
    });

    it('exclut les jours de repos', () => {
        const slots = buildAllowedSlots({ Lundi: makeSlot(), Mardi: makeSlot({ running: 1 }) }, ACTIFS);
        expect(slots.has(0)).toBe(false);
        expect(slots.has(1)).toBe(true);
    });

    it('ignore une clé de jour inconnue', () => {
        const slots = buildAllowedSlots({ Monday: makeSlot({ running: 1 }) }, ACTIFS);
        expect(slots.size).toBe(0);
    });
});

// ─── Affûtage (taper) ─────────────────────────────────────────────────────────

describe('buildTaperPlan', () => {
    it('ne renvoie rien sans objectif', () => {
        expect(buildTaperPlan(LUNDI, []).size).toBe(0);
    });

    it('couvre les 7 jours avant un objectif principal', () => {
        // Course le dimanche 8 mars : lundi = J-6 … dimanche = J-0.
        const plan = buildTaperPlan(LUNDI, [makeObjective({ date: '2026-03-08' })]);
        expect(plan.size).toBe(7);
        expect(plan.get(0)!.daysBefore).toBe(6);
        expect(plan.get(6)!.daysBefore).toBe(0);
        expect(plan.get(0)!.date).toBe('2026-03-02');
        expect(plan.get(6)!.date).toBe('2026-03-08');
    });

    it('limite un objectif secondaire à une fenêtre de 4 jours', () => {
        const plan = buildTaperPlan(LUNDI, [makeObjective({ date: '2026-03-08', priority: 'secondaire' })]);
        expect([...plan.keys()].sort()).toEqual([2, 3, 4, 5, 6]); // J-4 … J-0
    });

    it('rend le déblocage de la veille obligatoire', () => {
        const plan = buildTaperPlan(LUNDI, [makeObjective({ date: '2026-03-08' })]);
        expect(plan.get(5)!.rule.mandatory).toBe(true);   // J-1
        expect(plan.get(6)!.rule.tssRatio).toBe(0);       // J-0, jour de course
    });

    it('ignore une course déjà passée', () => {
        const plan = buildTaperPlan(LUNDI, [makeObjective({ date: '2026-03-01' })]);
        expect(plan.size).toBe(0);
    });

    it('ignore une course hors fenêtre d’affûtage', () => {
        // Dimanche 8 mars + 7 jours = 15 mars : hors des 7 jours pour tous les
        // jours de la semaine du 2 mars.
        const plan = buildTaperPlan(LUNDI, [makeObjective({ date: '2026-03-16' })]);
        expect(plan.size).toBe(0);
    });

    it('fait primer un objectif principal sur un secondaire le même jour', () => {
        const plan = buildTaperPlan(LUNDI, [
            makeObjective({ id: 'sec', name: 'Course B', date: '2026-03-08', priority: 'secondaire' }),
            makeObjective({ id: 'pri', name: 'Course A', date: '2026-03-08', priority: 'principale' }),
        ]);
        expect(plan.get(6)!.objectiveName).toBe('Course A');
        expect(plan.get(6)!.priority).toBe('principale');
    });

    it('retient la course la plus proche entre deux objectifs de même priorité', () => {
        const plan = buildTaperPlan(LUNDI, [
            makeObjective({ id: 'loin', name: 'Loin', date: '2026-03-08' }),
            makeObjective({ id: 'proche', name: 'Proche', date: '2026-03-05' }),
        ]);
        expect(plan.get(0)!.objectiveName).toBe('Proche'); // lundi : J-3 vs J-6
    });

    it('reporte le sport et la date de l’objectif sur chaque jour', () => {
        const plan = buildTaperPlan(LUNDI, [makeObjective({ date: '2026-03-08', sport: 'triathlon' })]);
        for (const info of plan.values()) {
            expect(info.objectiveSport).toBe('triathlon');
            expect(info.objectiveDate).toBe('2026-03-08');
            expect(info.rule.label).toContain(`J-${info.daysBefore}`);
        }
    });
});
