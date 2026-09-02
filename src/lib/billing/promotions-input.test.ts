import { describe, expect, it } from 'vitest';
import { eurosToCents, validatePromotionInput, type PromotionInput } from './promotions';

const NOW = new Date('2026-06-01T12:00:00.000Z');

function makeInput(overrides: Partial<PromotionInput> = {}): PromotionInput {
    return {
        code:             'CLUB2026',
        name:             'Club Tri Nantes',
        discountType:     'percent',
        value:            20,
        duration:         'once',
        durationInMonths: null,
        maxRedemptions:   null,
        expiresAt:        null,
        firstTimeOnly:    false,
        ...overrides,
    };
}

describe('validatePromotionInput', () => {
    it('accepte un formulaire minimal valide', () => {
        expect(validatePromotionInput(makeInput(), NOW)).toBeNull();
    });

    it('accepte un code saisi en minuscules avec des espaces autour', () => {
        expect(validatePromotionInput(makeInput({ code: '  club2026  ' }), NOW)).toBeNull();
    });

    it('refuse un code trop court', () => {
        expect(validatePromotionInput(makeInput({ code: 'AB' }), NOW)).toMatch(/3 à 40/);
    });

    it('refuse un code contenant des caractères interdits', () => {
        expect(validatePromotionInput(makeInput({ code: 'CLUB 2026' }), NOW)).toMatch(/3 à 40/);
    });

    it('accepte un libellé vide', () => {
        expect(validatePromotionInput(makeInput({ name: '' }), NOW)).toBeNull();
    });

    it('refuse un libellé dépassant la limite Stripe de 40 caractères', () => {
        expect(validatePromotionInput(makeInput({ name: 'x'.repeat(41) }), NOW)).toMatch(/40 caractères/);
    });

    it('refuse une remise nulle ou négative', () => {
        expect(validatePromotionInput(makeInput({ value: 0 }), NOW)).toMatch(/strictement positive/);
        expect(validatePromotionInput(makeInput({ value: -5 }), NOW)).toMatch(/strictement positive/);
    });

    it('refuse un pourcentage supérieur à 100', () => {
        expect(validatePromotionInput(makeInput({ value: 120 }), NOW)).toMatch(/100 %/);
    });

    it('accepte un montant fixe supérieur à 100 € (la limite ne vaut que pour les pourcentages)', () => {
        expect(validatePromotionInput(makeInput({ discountType: 'amount', value: 120 }), NOW)).toBeNull();
    });

    it('exige un nombre de mois pour une remise répétée', () => {
        expect(validatePromotionInput(makeInput({ duration: 'repeating', durationInMonths: null }), NOW))
            .toMatch(/entre 1 et 36/);
    });

    it('refuse un nombre de mois hors bornes', () => {
        expect(validatePromotionInput(makeInput({ duration: 'repeating', durationInMonths: 48 }), NOW))
            .toMatch(/entre 1 et 36/);
    });

    it('accepte une remise répétée correctement bornée', () => {
        expect(validatePromotionInput(makeInput({ duration: 'repeating', durationInMonths: 3 }), NOW)).toBeNull();
    });

    it('refuse un quota d\'utilisations inférieur à 1', () => {
        expect(validatePromotionInput(makeInput({ maxRedemptions: 0 }), NOW)).toMatch(/supérieur ou égal à 1/);
    });

    it('refuse une date d\'expiration déjà passée', () => {
        expect(validatePromotionInput(makeInput({ expiresAt: '2026-05-01' }), NOW)).toMatch(/dans le futur/);
    });

    it('refuse une date d\'expiration illisible', () => {
        expect(validatePromotionInput(makeInput({ expiresAt: 'demain' }), NOW)).toMatch(/invalide/);
    });

    it('accepte une date d\'expiration future', () => {
        expect(validatePromotionInput(makeInput({ expiresAt: '2026-12-31' }), NOW)).toBeNull();
    });
});

describe('eurosToCents', () => {
    it('convertit un montant entier', () => {
        expect(eurosToCents(5)).toBe(500);
    });

    it('arrondit au centime le plus proche', () => {
        expect(eurosToCents(4.995)).toBe(500);
        expect(eurosToCents(7.5)).toBe(750);
    });
});
