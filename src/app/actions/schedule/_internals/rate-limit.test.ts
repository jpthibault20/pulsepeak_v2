import { describe, expect, it } from 'vitest';
import { periodKey } from './rate-limit';

describe('periodKey', () => {
    it('retourne le jour courant au format yyyy-MM-dd pour une période journalière', () => {
        expect(periodKey('day', new Date(2026, 7, 15))).toBe('2026-08-15');
    });

    it('retourne le 1er du mois courant pour une période mensuelle, quel que soit le jour', () => {
        expect(periodKey('month', new Date(2026, 7, 15))).toBe('2026-08-01');
        expect(periodKey('month', new Date(2026, 7, 1))).toBe('2026-08-01');
        expect(periodKey('month', new Date(2026, 7, 31))).toBe('2026-08-01');
    });

    it('gère correctement le changement de mois en fin d\'année', () => {
        expect(periodKey('month', new Date(2026, 11, 31))).toBe('2026-12-01');
    });
});
