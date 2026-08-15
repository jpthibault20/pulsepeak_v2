import { describe, expect, it } from 'vitest';
import { groupRepeatedBlocks } from './group';
import { makeRepeatBlock, makeSimpleBlock } from '@/test/fixtures';

const force = () => makeSimpleBlock({ durationActifSecondes: 900, targetPowerWatts: 224, description: 'force' });
const velocite = () => makeSimpleBlock({ durationActifSecondes: 300, targetPowerWatts: 177, description: 'vélocité' });
const recup = () => makeSimpleBlock({ type: 'Rest', durationActifSecondes: 600, targetPowerWatts: 177, description: 'récup' });

describe('groupRepeatedBlocks', () => {
    it('recompose le motif à trois phases de la séance du ticket', () => {
        const items = groupRepeatedBlocks([
            makeSimpleBlock({ type: 'Warmup', durationActifSecondes: 1200 }),
            force(), velocite(), recup(),
            force(), velocite(), recup(),
            force(), velocite(),
            makeSimpleBlock({ type: 'Cooldown', durationActifSecondes: 900 }),
        ]);

        expect(items.map(i => i.kind)).toEqual(['single', 'group', 'single', 'single', 'single']);

        const group = items[1];
        expect(group.kind === 'group' && group.times).toBe(2);
        expect(group.kind === 'group' && group.blocks).toHaveLength(3);
    });

    it('ne complète jamais une répétition partielle', () => {
        // Le dernier passage n'a pas sa récupération : il reste affiché à part
        // plutôt que d'être compté comme une troisième répétition complète.
        const items = groupRepeatedBlocks([force(), recup(), force(), recup(), force()]);

        expect(items).toHaveLength(2);
        expect(items[0].kind === 'group' && items[0].times).toBe(2);
        expect(items[1].kind).toBe('single');
    });

    it('préfère le motif le plus long à couverture égale', () => {
        const items = groupRepeatedBlocks([force(), velocite(), force(), velocite()]);
        expect(items).toHaveLength(1);
        expect(items[0].kind === 'group' && items[0].blocks).toHaveLength(2);
        expect(items[0].kind === 'group' && items[0].times).toBe(2);
    });

    it('regroupe deux blocs identiques consécutifs', () => {
        const items = groupRepeatedBlocks([force(), force(), makeSimpleBlock({ type: 'Cooldown', durationActifSecondes: 600 })]);
        expect(items[0].kind === 'group' && items[0].times).toBe(2);
        expect(items[1].kind).toBe('single');
    });

    it('laisse intacte une structure sans répétition', () => {
        const items = groupRepeatedBlocks([
            makeSimpleBlock({ type: 'Warmup', durationActifSecondes: 1200 }),
            makeRepeatBlock({ repeat: 4 }),
            makeSimpleBlock({ type: 'Cooldown', durationActifSecondes: 600 }),
        ]);
        expect(items.map(i => i.kind)).toEqual(['single', 'single', 'single']);
    });

    it('rend une liste vide sur une structure absente', () => {
        expect(groupRepeatedBlocks([])).toEqual([]);
    });
});
