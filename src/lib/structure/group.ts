/**
 * Regroupement des motifs répétés, pour l'AFFICHAGE uniquement.
 *
 * Un bloc `Repeat` ne porte que deux phases (effort + récup). Un motif à trois
 * phases ou plus — « 15 min force, 5 min vélocité, 10 min récup », trois fois —
 * est donc stocké déplié en blocs simples, ce qui est la seule façon honnête de
 * le décrire. Mais déplié, il se lit mal : huit lignes là où l'athlète attend
 * « 3× ».
 *
 * Ce module relit la structure et redonne au motif sa forme compacte, sans
 * jamais modifier la donnée : c'est une lecture, pas une transformation. Une
 * répétition partielle (le dernier bloc sans sa récupération, par exemple) reste
 * affichée telle quelle plutôt que d'être arrondie à une répétition complète.
 */

import type { StructureBlock } from '@/lib/data/type';

export type DisplayItem =
    | { kind: 'single'; block: StructureBlock; index: number }
    | { kind: 'group'; blocks: StructureBlock[]; times: number; index: number };

/** Longueur maximale d'un motif recherché : au-delà, ce n'est plus une série. */
const MAX_PATTERN_LENGTH = 5;

/**
 * Deux blocs sont identiques s'ils prescrivent la même chose. La comparaison
 * porte sur l'objet entier : les blocs d'un même motif sont produits par le même
 * générateur, donc strictement égaux — inutile de deviner quels champs comptent.
 */
function sameBlock(a: StructureBlock, b: StructureBlock): boolean {
    return JSON.stringify(a) === JSON.stringify(b);
}

function patternRepeats(structure: StructureBlock[], start: number, length: number): number {
    let times = 1;
    let next = start + length;
    while (next + length <= structure.length) {
        let matches = true;
        for (let k = 0; k < length; k++) {
            if (!sameBlock(structure[start + k], structure[next + k])) {
                matches = false;
                break;
            }
        }
        if (!matches) break;
        times++;
        next += length;
    }
    return times;
}

export function groupRepeatedBlocks(structure: StructureBlock[]): DisplayItem[] {
    if (!Array.isArray(structure) || structure.length === 0) return [];

    const items: DisplayItem[] = [];
    let i = 0;

    while (i < structure.length) {
        let bestLength = 0;
        let bestTimes = 1;
        let bestCoverage = 0;

        const maxLength = Math.min(MAX_PATTERN_LENGTH, Math.floor((structure.length - i) / 2));
        for (let length = 1; length <= maxLength; length++) {
            const times = patternRepeats(structure, i, length);
            if (times < 2) continue;
            const coverage = times * length;
            // À couverture égale, le motif le plus long gagne : « 2×(A,B,C) »
            // décrit mieux la séance que « 3×(A) » suivi de restes.
            if (coverage > bestCoverage || (coverage === bestCoverage && length > bestLength)) {
                bestCoverage = coverage;
                bestLength = length;
                bestTimes = times;
            }
        }

        if (bestLength > 0) {
            items.push({
                kind: 'group',
                blocks: structure.slice(i, i + bestLength),
                times: bestTimes,
                index: i,
            });
            i += bestLength * bestTimes;
        } else {
            items.push({ kind: 'single', block: structure[i], index: i });
            i += 1;
        }
    }

    return items;
}
