import { describe, expect, it } from 'vitest';
import { canAccess, hasFullAccess, isFreePlan, toSubscriptionStatus } from './context';

describe('hasFullAccess', () => {
    it('accorde un accès complet à un admin', () => {
        expect(hasFullAccess('admin', 'free')).toBe(true);
    });

    it('accorde un accès complet au rôle freeUse quel que soit le plan', () => {
        expect(hasFullAccess('freeUse', 'free')).toBe(true);
    });

    it('accorde un accès complet au plan dev (octroi manuel admin)', () => {
        expect(hasFullAccess('user', 'dev')).toBe(true);
    });

    it('refuse l\'accès complet à un user free', () => {
        expect(hasFullAccess('user', 'free')).toBe(false);
    });
});

describe('canAccess', () => {
    it('generate-plan est toujours accessible, même en free (quota géré côté serveur)', () => {
        expect(canAccess('generate-plan', 'free', 'user')).toBe(true);
    });

    it('refuse une feature pro-only à un user free', () => {
        expect(canAccess('chat-ai', 'free', 'user')).toBe(false);
        expect(canAccess('calendar-write', 'free', 'user')).toBe(false);
    });

    it('autorise une feature pro-only à un user pro', () => {
        expect(canAccess('chat-ai', 'pro', 'user')).toBe(true);
        expect(canAccess('calendar-write', 'pro', 'user')).toBe(true);
    });

    it('autorise une feature pro-only au plan dev', () => {
        expect(canAccess('advanced-stats', 'dev', 'user')).toBe(true);
    });
});

describe('isFreePlan', () => {
    it('est vrai pour un user en plan free', () => {
        expect(isFreePlan('free', 'user')).toBe(true);
    });

    it('est faux pour un admin même en plan free (octroi implicite)', () => {
        expect(isFreePlan('free', 'admin')).toBe(false);
    });

    it('est faux pour un plan pro', () => {
        expect(isFreePlan('pro', 'user')).toBe(false);
    });
});

describe('toSubscriptionStatus', () => {
    it('mappe canceled (Stripe) vers cancelled (contexte)', () => {
        expect(toSubscriptionStatus('canceled')).toBe('cancelled');
    });

    it('mappe incomplete vers past_due', () => {
        expect(toSubscriptionStatus('incomplete')).toBe('past_due');
    });

    it('retombe sur active quand le statut est absent', () => {
        expect(toSubscriptionStatus(undefined)).toBe('active');
        expect(toSubscriptionStatus(null)).toBe('active');
    });
});
