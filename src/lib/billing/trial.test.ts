import { describe, expect, it } from 'vitest';
import {
    billingIntervalForPrice,
    formatTrialEnd,
    intervalAllowsTrial,
    isTrialEligible,
    isTrialEligibleForInterval,
    isTrialing,
    trialDaysRemaining,
} from './trial';

describe('isTrialEligible', () => {
    it("accorde l'essai à un profil qui n'a jamais rien souscrit", () => {
        expect(isTrialEligible({})).toBe(true);
    });

    it("refuse l'essai à un profil qui l'a déjà consommé", () => {
        expect(isTrialEligible({ trialUsedAt: '2026-01-15T10:00:00.000Z' })).toBe(false);
    });

    it("refuse l'essai à un ancien abonné, même sans trace d'essai", () => {
        expect(isTrialEligible({ stripeSubscriptionId: 'sub_123' })).toBe(false);
    });
});

describe('intervalAllowsTrial', () => {
    it("réserve le mois offert à la formule mensuelle", () => {
        expect(intervalAllowsTrial('monthly')).toBe(true);
    });

    it("refuse le mois offert sur la formule annuelle", () => {
        expect(intervalAllowsTrial('annual')).toBe(false);
    });
});

describe('isTrialEligibleForInterval', () => {
    it("accorde l'essai à un nouveau profil sur le mensuel", () => {
        expect(isTrialEligibleForInterval({}, 'monthly')).toBe(true);
    });

    it("refuse l'essai sur l'annuel même à un profil qui y aurait droit", () => {
        expect(isTrialEligibleForInterval({}, 'annual')).toBe(false);
    });

    it("refuse l'essai sur le mensuel à un profil qui l'a déjà consommé", () => {
        expect(isTrialEligibleForInterval({ trialUsedAt: '2026-01-15T10:00:00.000Z' }, 'monthly')).toBe(false);
    });
});

describe('billingIntervalForPrice', () => {
    it("reconnaît le prix annuel configuré", () => {
        expect(billingIntervalForPrice('price_annual', 'price_annual')).toBe('annual');
    });

    it('traite tout autre prix comme mensuel', () => {
        expect(billingIntervalForPrice('price_monthly', 'price_annual')).toBe('monthly');
    });

    it("ne bascule pas en annuel quand l'identifiant annuel n'est pas configuré", () => {
        expect(billingIntervalForPrice('price_monthly', undefined)).toBe('monthly');
        expect(billingIntervalForPrice('', '')).toBe('monthly');
    });
});

describe('isTrialing', () => {
    const now = new Date('2026-06-01T12:00:00.000Z');

    it('reconnaît un essai encore en cours', () => {
        expect(isTrialing({ trialEndsAt: '2026-06-10T00:00:00.000Z' }, now)).toBe(true);
    });

    it('ne considère plus un essai échu comme en cours', () => {
        expect(isTrialing({ trialEndsAt: '2026-05-20T00:00:00.000Z' }, now)).toBe(false);
    });

    it('renvoie false sans date de fin', () => {
        expect(isTrialing({}, now)).toBe(false);
    });
});

describe('trialDaysRemaining', () => {
    const now = new Date('2026-06-01T12:00:00.000Z');

    it('compte les jours pleins restants', () => {
        expect(trialDaysRemaining('2026-06-11T12:00:00.000Z', now)).toBe(10);
    });

    it("arrondit au jour supérieur une fin d'essai dans quelques heures", () => {
        expect(trialDaysRemaining('2026-06-01T20:00:00.000Z', now)).toBe(1);
    });

    it('renvoie 0 pour un essai déjà terminé', () => {
        expect(trialDaysRemaining('2026-05-30T12:00:00.000Z', now)).toBe(0);
    });

    it('renvoie 0 sans date de fin', () => {
        expect(trialDaysRemaining(null, now)).toBe(0);
    });

    it('renvoie 0 pour une date illisible', () => {
        expect(trialDaysRemaining('pas-une-date', now)).toBe(0);
    });
});

describe('formatTrialEnd', () => {
    it('formate la date de fin en français', () => {
        expect(formatTrialEnd('2026-06-11T10:00:00.000Z')).toBe('11 juin 2026');
    });

    it('renvoie un tiret sans date', () => {
        expect(formatTrialEnd(null)).toBe('—');
    });
});
