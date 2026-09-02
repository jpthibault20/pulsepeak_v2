import { describe, expect, it } from 'vitest';
import {
    formatDiscount,
    formatDuration,
    formatMoneyCents,
    normalizePromoCode,
    promotionStatus,
    type PromotionSummary,
} from './promotions';

// Intl insère une espace insécable (U+00A0 ou U+202F) avant le symbole monétaire
// selon la version d'ICU — on compare sur une chaîne à espaces normalisées.
const sp = (s: string) => s.replace(/[  ]/g, ' ');

function makePromo(overrides: Partial<PromotionSummary> = {}): PromotionSummary {
    return {
        id:               'promo_1',
        couponId:         'coup_1',
        code:             'CLUB2026',
        name:             'Club Tri Nantes',
        active:           true,
        percentOff:       20,
        amountOffCents:   null,
        currency:         null,
        duration:         'once',
        durationInMonths: null,
        maxRedemptions:   null,
        timesRedeemed:    0,
        expiresAt:        null,
        createdAt:        '2026-01-01T00:00:00.000Z',
        couponValid:      true,
        ...overrides,
    };
}

describe('normalizePromoCode', () => {
    it('met en majuscules et supprime les espaces autour de la saisie', () => {
        expect(normalizePromoCode('  club2026 ')).toBe('CLUB2026');
    });

    it('renvoie une chaîne vide pour une saisie uniquement composée d\'espaces', () => {
        expect(normalizePromoCode('   ')).toBe('');
    });
});

describe('promotionStatus', () => {
    const now = new Date('2026-06-01T12:00:00.000Z');

    it('rend actif un code sans expiration ni quota', () => {
        expect(promotionStatus(makePromo(), now)).toBe('active');
    });

    it('rend désactivé un code coupé côté Stripe', () => {
        expect(promotionStatus(makePromo({ active: false }), now)).toBe('disabled');
    });

    it('rend désactivé un code dont le coupon a été supprimé', () => {
        expect(promotionStatus(makePromo({ couponValid: false }), now)).toBe('disabled');
    });

    it('rend expiré un code dont la date est passée', () => {
        expect(promotionStatus(makePromo({ expiresAt: '2026-05-31T23:59:59.000Z' }), now)).toBe('expired');
    });

    it("reste actif tant que la date d'expiration est future", () => {
        expect(promotionStatus(makePromo({ expiresAt: '2026-06-02T00:00:00.000Z' }), now)).toBe('active');
    });

    it('rend épuisé un code dont le quota est atteint', () => {
        expect(promotionStatus(makePromo({ maxRedemptions: 5, timesRedeemed: 5 }), now)).toBe('exhausted');
    });

    it("reste actif tant que le quota n'est pas atteint", () => {
        expect(promotionStatus(makePromo({ maxRedemptions: 5, timesRedeemed: 4 }), now)).toBe('active');
    });

    it("signale la désactivation en priorité sur l'expiration", () => {
        expect(promotionStatus(makePromo({ active: false, expiresAt: '2026-01-01T00:00:00.000Z' }), now)).toBe('disabled');
    });

    it("ignore une date d'expiration illisible plutôt que de bloquer le code", () => {
        expect(promotionStatus(makePromo({ expiresAt: 'pas-une-date' }), now)).toBe('active');
    });
});

describe('formatDiscount', () => {
    it('formate une remise en pourcentage', () => {
        expect(sp(formatDiscount({ percentOff: 20, amountOffCents: null, currency: null }))).toBe('-20 %');
    });

    it('garde la virgule décimale d\'un pourcentage non entier', () => {
        expect(sp(formatDiscount({ percentOff: 12.5, amountOffCents: null, currency: null }))).toBe('-12,5 %');
    });

    it('formate une remise en euros', () => {
        expect(sp(formatDiscount({ percentOff: null, amountOffCents: 500, currency: 'eur' }))).toBe('-5 €');
    });

    it('renvoie un tiret quand le coupon ne porte aucune remise', () => {
        expect(formatDiscount({ percentOff: null, amountOffCents: null, currency: null })).toBe('—');
    });
});

describe('formatDuration', () => {
    it('traduit une remise unique', () => {
        expect(formatDuration('once', null)).toBe('1er mois');
    });

    it('traduit une remise permanente', () => {
        expect(formatDuration('forever', null)).toBe('à vie');
    });

    it('traduit une remise répétée sur plusieurs mois', () => {
        expect(formatDuration('repeating', 3)).toBe('3 mois');
    });

    it('traite une répétition sur un seul mois comme une remise unique', () => {
        expect(formatDuration('repeating', 1)).toBe('1er mois');
    });

    it('parle de première année pour une remise unique sur une formule annuelle', () => {
        expect(formatDuration('once', null, 'year')).toBe('1re année');
    });

    it('reste sur la durée en mois pour une remise répétée, quelle que soit la périodicité', () => {
        expect(formatDuration('repeating', 3, 'year')).toBe('3 mois');
    });

    it('ne dépend pas de la périodicité pour une remise à vie', () => {
        expect(formatDuration('forever', null, 'year')).toBe('à vie');
    });
});

describe('formatMoneyCents', () => {
    it('masque les centimes sur un prix rond', () => {
        expect(sp(formatMoneyCents(900))).toBe('9 €');
    });

    it('affiche les centimes quand il y en a', () => {
        expect(sp(formatMoneyCents(750))).toBe('7,50 €');
    });

    it('formate un prix gratuit', () => {
        expect(sp(formatMoneyCents(0))).toBe('0 €');
    });
});
