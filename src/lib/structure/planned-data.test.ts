import { describe, expect, it } from 'vitest';
import { buildPlannedDataFromStructure } from './planned-data';
import { structureTotalSeconds } from './normalize';

/**
 * La séance du ticket : « Échauffement 20 min progressif Z1-Z2 (120-200 W).
 * Corps de séance : 3x (15 min Z3 (205-243 W) en force, cadence 50-60 RPM, suivi
 * de 5 min Z2 (151-203 W) en vélocité, cadence >95 RPM). Récupération 10 min Z2
 * entre chaque bloc. Retour au calme 15 min Z1. »
 *
 * Le motif compte TROIS phases par répétition (force / vélocité / récupération),
 * ce qu'un bloc Repeat à deux phases ne sait pas porter : il est donc déplié en
 * blocs simples, conformément au contrat du type. 20 + 3×20 + 2×10 + 15 = 115 min.
 */
const TICKET_STRUCTURE = [
    { type: 'Warmup', d: 1200, w: 160, l: 'progressif Z1-Z2' },
    { type: 'Active', d: 900, w: 224, l: 'force, cadence 50-60 RPM' },
    { type: 'Active', d: 300, w: 177, l: 'vélocité, cadence >95 RPM' },
    { type: 'Rest', d: 600, w: 177, l: 'récupération entre blocs' },
    { type: 'Active', d: 900, w: 224, l: 'force, cadence 50-60 RPM' },
    { type: 'Active', d: 300, w: 177, l: 'vélocité, cadence >95 RPM' },
    { type: 'Rest', d: 600, w: 177, l: 'récupération entre blocs' },
    { type: 'Active', d: 900, w: 224, l: 'force, cadence 50-60 RPM' },
    { type: 'Active', d: 300, w: 177, l: 'vélocité, cadence >95 RPM' },
    { type: 'Cooldown', d: 900, w: 135, l: '' },
];

describe('buildPlannedDataFromStructure', () => {
    it('déduit la durée de la structure au lieu de la subir', () => {
        const { plannedData } = buildPlannedDataFromStructure({
            rawStructure: TICKET_STRUCTURE,
            sportType: 'cycling',
            fallbackDurationMinutes: 125,
            plannedTSS: 110,
        });

        // 125 min était la consigne amont ; la prescription réelle en fait 115.
        expect(plannedData.durationMinutes).toBe(115);
    });

    it('garantit que le texte affiché et la durée annoncée décrivent la même séance', () => {
        const { plannedData } = buildPlannedDataFromStructure({
            rawStructure: TICKET_STRUCTURE,
            sportType: 'cycling',
            fallbackDurationMinutes: 125,
            plannedTSS: 110,
        });

        expect(structureTotalSeconds(plannedData.structure!)).toBe(plannedData.durationMinutes * 60);
    });

    it('ne produit aucune durée fabriquée sur la séance du ticket', () => {
        const { plannedData, issues } = buildPlannedDataFromStructure({
            rawStructure: TICKET_STRUCTURE,
            sportType: 'cycling',
            fallbackDurationMinutes: 125,
            plannedTSS: 110,
        });

        expect(plannedData.description).not.toContain('31 min 15');
        expect(plannedData.description).toContain('Échauffement 20 min à 160 W');
        expect(plannedData.description).toContain('15 min à 224 W — force, cadence 50-60 RPM');
        expect(issues.map(i => i.code)).not.toContain('MISSING_DURATION');
    });

    it('lit la cible dominante dans les intervalles', () => {
        const { plannedData } = buildPlannedDataFromStructure({
            rawStructure: TICKET_STRUCTURE,
            sportType: 'cycling',
            fallbackDurationMinutes: 125,
            plannedTSS: 110,
        });

        expect(plannedData.targetPowerWatts).toBe(224);
    });

    it('ramène une séance trop longue dans le créneau, texte compris', () => {
        const { plannedData, adjustedToSlot } = buildPlannedDataFromStructure({
            rawStructure: [
                { type: 'Warmup', d: 900, w: 150, l: '' },
                { type: 'Repeat', n: 6, d: 300, w: 250, dr: 120, wr: 150, l: 'seuil' },
                { type: 'Cooldown', d: 600, w: 130, l: '' },
            ],
            sportType: 'cycling',
            slotMinutes: 45,
            fallbackDurationMinutes: 45,
            plannedTSS: 60,
        });

        expect(adjustedToSlot).toBe(true);
        expect(plannedData.durationMinutes).toBeLessThanOrEqual(46);
        // Le texte est rendu APRÈS l'ajustement : il annonce le bon nombre de répétitions.
        const repeats = plannedData.structure!.find(b => b.type === 'Repeat');
        expect(plannedData.description).toContain(`${repeats!.type === 'Repeat' ? repeats!.repeat : 0}× (`);
    });

    it('signale une séance tronquée sans la maquiller, et n\'écrit jamais « 1× »', () => {
        // Reproduction de la séance remontée en production : le modèle s'arrête
        // après un intervalle et omet "n". Rien ne doit être inventé pour
        // combler, mais l'anomalie doit remonter, et la durée affichée doit
        // décrire la structure réelle — pas la durée demandée.
        const { plannedData, issues } = buildPlannedDataFromStructure({
            rawStructure: [
                { type: 'Warmup', n: 1, d: 600, w: 170, l: '' },
                { type: 'Active', n: 1, d: 180, w: 240, l: 'Montée en puissance' },
                { type: 'Rest', n: 1, d: 120, w: 150, l: '' },
                { type: 'Repeat', d: 60, w: 350, l: 'Intervalles PMA' },
            ],
            sportType: 'cycling',
            slotMinutes: 60,
            fallbackDurationMinutes: 60,
            plannedTSS: 80,
        });

        expect(plannedData.durationMinutes).toBe(16);
        expect(plannedData.description).not.toContain('1×');
        expect(plannedData.description).toContain('1 min à 350 W — Intervalles PMA');
        expect(issues.map(i => i.code)).toContain('UNDER_SLOT');
    });

    it('rend la récupération intercalée d\'une série, dans le texte comme dans les totaux', () => {
        const { plannedData, issues } = buildPlannedDataFromStructure({
            rawStructure: [
                { type: 'Warmup', n: 1, d: 900, dr: 0, w: 180, l: '' },
                { type: 'Repeat', n: 4, d: 300, dr: 180, w: 330, wr: 150, l: 'Intervalles VO2max' },
                { type: 'Cooldown', n: 1, d: 600, dr: 0, w: 140, l: '' },
            ],
            sportType: 'cycling',
            slotMinutes: 75,
            fallbackDurationMinutes: 75,
            plannedTSS: 95,
        });

        expect(plannedData.description).toContain('4× (5 min à 330 W / 3 min récup à 150 W)');
        // 15 + 4×(5+3) + 10 : la récup compte dans la durée de la séance.
        expect(plannedData.durationMinutes).toBe(57);
        expect(issues.map(i => i.code)).not.toContain('MISSING_RECOVERY');
    });

    it('signale une série privée de récupération sans lui en inventer une', () => {
        const { plannedData, issues } = buildPlannedDataFromStructure({
            rawStructure: [
                { type: 'Repeat', n: 4, d: 300, w: 330, l: 'Intervalles VO2max' },
            ],
            sportType: 'cycling',
            fallbackDurationMinutes: 60,
            plannedTSS: 95,
        });

        expect(issues.map(i => i.code)).toContain('MISSING_RECOVERY');
        expect(plannedData.structure![0].durationActifSecondes).toBe(300);
        expect(plannedData.structure![0].type === 'Repeat' && plannedData.structure![0].durationRecupSecondes).toBeNull();
    });

    it('se replie sans inventer d\'intervalles quand l\'IA ne renvoie rien d\'exploitable', () => {
        const { plannedData, issues } = buildPlannedDataFromStructure({
            rawStructure: [{ type: 'Active', l: 'séance vélo' }],
            sportType: 'cycling',
            fallbackDurationMinutes: 60,
            plannedTSS: 50,
        });

        expect(plannedData.structure).toEqual([]);
        expect(plannedData.durationMinutes).toBe(60);
        // La durée annoncée est la seule information encore fiable : on l'écrit,
        // et rien d'autre — surtout pas un découpage reconstitué.
        expect(plannedData.description).toBe('Séance de 60 min.');
        expect(plannedData.targetPowerWatts).toBeNull();
        expect(issues.map(i => i.code)).toEqual(['EMPTY']);
    });

    it('conserve la natation en mètres et calcule le volume total', () => {
        const { plannedData } = buildPlannedDataFromStructure({
            rawStructure: [
                { type: 'Warmup', m: 400, nage: 'mixte', l: 'échauffement varié' },
                { type: 'Repeat', n: 8, m: 50, nage: 'crawl', p100: '1:40', dr: 15, l: 'série seuil' },
                { type: 'Cooldown', m: 200, nage: 'dos', l: '' },
            ],
            sportType: 'swimming',
            fallbackDurationMinutes: 45,
            plannedTSS: 50,
        });

        expect(plannedData.distanceMeters).toBe(1000);
        expect(plannedData.targetPaceMinPer100m).toBe('1:40');
        expect(plannedData.durationMinutes).toBe(45); // aucune durée : on garde celle annoncée
        expect(plannedData.description).toContain('8×50 m crawl à 1:40/100m');
    });

    it('rétablit une série dont l\'IA a inversé effort et récupération', () => {
        const { plannedData, issues } = buildPlannedDataFromStructure({
            rawStructure: [
                { type: 'Repeat', n: 4, d: 120, w: 140, dr: 300, wr: 260, l: 'seuil' },
            ],
            sportType: 'cycling',
            fallbackDurationMinutes: 30,
            plannedTSS: 40,
        });

        const repeat = plannedData.structure![0];
        expect(repeat.durationActifSecondes).toBe(300);
        expect(repeat.targetPowerWatts).toBe(260);
        expect(issues.map(i => i.code)).toContain('INVERTED_REPEAT');
    });
});
