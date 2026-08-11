/******************************************************************************
 * @file    _internals/week-finder.test.ts
 * @brief   Tests unitaires de la résolution date → (bloc, semaine) du plan actif.
 *          Le point sensible est le filtre par plan : les blocs archivés
 *          chevauchent les dates du plan courant.
 ******************************************************************************/

import { describe, it, expect } from 'vitest';
import { findBlockAndWeekForDate } from './week-finder';
import { makeBlock, makeWeek } from '@/test/fixtures';
import { parseLocalDate } from '@/lib/utils';

const PLAN_ACTIF = 'plan-actif';

/** Bloc de 4 semaines démarrant le lundi 2 mars 2026, avec ses 4 semaines. */
function setup(planId = PLAN_ACTIF) {
    const weeks = [1, 2, 3, 4].map(n => makeWeek({ id: `w${n}`, weekNumber: n, blockId: 'block-1' }));
    const block = makeBlock({
        id: 'block-1',
        planId,
        startDate: '2026-03-02',
        weekCount: 4,
        weeksId: weeks.map(w => w.id),
    });
    return { block, weeks };
}

describe('findBlockAndWeekForDate', () => {
    it('résout une date sur la bonne semaine du bloc', () => {
        const { block, weeks } = setup();
        const cases: [string, number][] = [
            ['2026-03-02', 1], // premier jour du bloc
            ['2026-03-08', 1], // dernier jour de la semaine 1
            ['2026-03-09', 2],
            ['2026-03-23', 4],
            ['2026-03-29', 4], // dernier jour du bloc
        ];
        for (const [date, weekNumber] of cases) {
            const found = findBlockAndWeekForDate([block], weeks, parseLocalDate(date), PLAN_ACTIF);
            expect(found?.week.weekNumber, date).toBe(weekNumber);
            expect(found?.block.id).toBe('block-1');
        }
    });

    it('renvoie null hors des bornes du bloc', () => {
        const { block, weeks } = setup();
        expect(findBlockAndWeekForDate([block], weeks, parseLocalDate('2026-03-01'), PLAN_ACTIF)).toBeNull();
        expect(findBlockAndWeekForDate([block], weeks, parseLocalDate('2026-03-30'), PLAN_ACTIF)).toBeNull();
    });

    it('ignore les blocs des plans archivés, même s’ils viennent en premier', () => {
        const actif = setup();
        const archive = setup('plan-archive');
        const blocArchive = { ...archive.block, id: 'block-archive' };
        const semainesArchive = archive.weeks.map(w => ({ ...w, id: `old-${w.id}`, blockId: 'block-archive' }));
        blocArchive.weeksId = semainesArchive.map(w => w.id);

        const found = findBlockAndWeekForDate(
            [blocArchive, actif.block],
            [...semainesArchive, ...actif.weeks],
            parseLocalDate('2026-03-10'),
            PLAN_ACTIF,
        );
        expect(found?.block.id).toBe('block-1');
        expect(found?.week.id).toBe('w2');
    });

    it('renvoie null si aucun bloc n’appartient au plan actif', () => {
        const { block, weeks } = setup('plan-archive');
        expect(findBlockAndWeekForDate([block], weeks, parseLocalDate('2026-03-10'), PLAN_ACTIF)).toBeNull();
    });

    it('renvoie null quand la semaine attendue est absente', () => {
        const { block, weeks } = setup();
        const sansSemaine2 = weeks.filter(w => w.weekNumber !== 2);
        expect(findBlockAndWeekForDate([block], sansSemaine2, parseLocalDate('2026-03-10'), PLAN_ACTIF)).toBeNull();
    });

    it('ne rattache que les semaines référencées par le bloc', () => {
        const { block, weeks } = setup();
        const blocPartiel = { ...block, weeksId: ['w1'] };
        expect(findBlockAndWeekForDate([blocPartiel], weeks, parseLocalDate('2026-03-03'), PLAN_ACTIF)?.week.id).toBe('w1');
        expect(findBlockAndWeekForDate([blocPartiel], weeks, parseLocalDate('2026-03-10'), PLAN_ACTIF)).toBeNull();
    });

    it('renvoie null sur une liste de blocs vide', () => {
        expect(findBlockAndWeekForDate([], [], parseLocalDate('2026-03-10'), PLAN_ACTIF)).toBeNull();
    });
});
