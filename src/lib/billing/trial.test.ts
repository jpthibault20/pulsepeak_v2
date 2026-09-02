import { describe, expect, it } from 'vitest';
import { formatTrialEnd, isTrialEligible, isTrialing, trialDaysRemaining } from './trial';

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
