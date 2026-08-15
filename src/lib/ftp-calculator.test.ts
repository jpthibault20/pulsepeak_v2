/******************************************************************************
 * @file    ftp-calculator.test.ts
 * @brief   Tests unitaires du calcul de FTP : modèle Puissance Critique à deux
 *          tests ou plus, estimation par coefficient sur un test unique, et
 *          génération des zones Coggan.
 ******************************************************************************/

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { calculateFtp, validatePowerTests, getTestPrecision } from './ftp-calculator';
import type { Zones } from '@/lib/data/type';

beforeEach(() => {
    // calculateFtp journalise sa méthode : on garde la sortie de test lisible.
    vi.spyOn(console, 'log').mockImplementation(() => { });
});

afterEach(() => {
    vi.restoreAllMocks();
});

/** Les bornes doivent monter en escalier, sans chevauchement. */
function expectZonesOrdonnees(zones: Zones) {
    const paliers = [zones.z1, zones.z2, zones.z3, zones.z4, zones.z5, zones.z6, zones.z7]
        .filter((z): z is { min: number; max: number } => !!z);
    for (const z of paliers) expect(z.max).toBeGreaterThanOrEqual(z.min);
    for (let i = 1; i < paliers.length; i++) {
        expect(paliers[i].min).toBeGreaterThan(paliers[i - 1].max);
    }
}

// ─── Modèle Puissance Critique ────────────────────────────────────────────────

describe('calculateFtp — régression sur plusieurs tests', () => {
    it('applique le modèle Puissance Critique dès deux tests', () => {
        const r = calculateFtp({ p5min: 350, p20min: 280 });
        // Régression W = CP·t + W' sur (300 s, 105 000 J) et (1200 s, 336 000 J).
        expect(r.ftp).toBe(257);
        expect(r.seasonData.method).toBe('Critical Power Regression');
        expect(r.seasonData.wPrime).toBe(28000);
        expect(r.seasonData.sourceTests).toEqual(['5min', '20min']);
    });

    it('trie les tests du plus court au plus long', () => {
        const r = calculateFtp({ p20min: 280, p8min: 320, p5min: 350 });
        expect(r.seasonData.sourceTests).toEqual(['5min', '8min', '20min']);
    });

    it('donne une FTP inférieure à la puissance du test le plus long', () => {
        const r = calculateFtp({ p5min: 350, p20min: 280 });
        expect(r.ftp).toBeLessThan(280);
    });

    it('horodate le calcul', () => {
        const r = calculateFtp({ p5min: 350, p20min: 280 });
        expect(r.seasonData.calculatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    });
});

// ─── Test unique ──────────────────────────────────────────────────────────────

describe('calculateFtp — estimation sur un test unique', () => {
    it('applique le coefficient propre à chaque durée', () => {
        expect(calculateFtp({ p20min: 280 }).ftp).toBe(266); // 95 %
        expect(calculateFtp({ p15min: 300 }).ftp).toBe(279); // 93 %
        expect(calculateFtp({ p8min: 320 }).ftp).toBe(288);  // 90 %
        expect(calculateFtp({ p5min: 350 }).ftp).toBe(287);  // 82 %
    });

    it('annonce la méthode et le test utilisé', () => {
        const r = calculateFtp({ p20min: 280 });
        expect(r.seasonData.method).toBe('Single Test Estimation');
        expect(r.seasonData.sourceTests).toEqual(['20min']);
        expect(r.seasonData.wPrime).toBe(0);
    });
});

describe('calculateFtp — FTP saisie directement', () => {
    it('reprend la valeur telle quelle sans test de durée', () => {
        const r = calculateFtp({ ftp: 240 });
        expect(r.ftp).toBe(240);
        expect(r.seasonData.method).toBe('Single Test Estimation');
        expect(r.seasonData.sourceTests).toEqual(['ftp']);
    });

    it('fait primer les tests de durée sur la FTP saisie', () => {
        expect(calculateFtp({ ftp: 999, p20min: 280 }).ftp).toBe(266);
    });
});

describe('calculateFtp — entrées inexploitables', () => {
    it('lève quand aucun test valide n’est fourni', () => {
        expect(() => calculateFtp({})).toThrow('Aucun test de puissance valide fourni');
        expect(() => calculateFtp({ p20min: 0, ftp: 0 })).toThrow();
    });
});

// ─── Zones ────────────────────────────────────────────────────────────────────

describe('calculateFtp — zones générées', () => {
    it('cale les zones sur les coefficients Coggan', () => {
        const { zones } = calculateFtp({ ftp: 300 });
        expect(zones.z1.max).toBe(165); // 55 %
        expect(zones.z2).toEqual({ min: 168, max: 225 }); // 56 → 75 %
        expect(zones.z4).toEqual({ min: 273, max: 315 }); // 91 → 105 %, la zone FTP
    });

    it('plafonne Z6 sur le test de 5 min quand il existe', () => {
        const { zones } = calculateFtp({ p5min: 350, p20min: 280 });
        expect(zones.z6?.max).toBe(350);
        expect(zones.z7?.min).toBe(351);
    });

    it('déduit Z6 de la FTP sans test de 5 min', () => {
        const { zones } = calculateFtp({ ftp: 300 });
        expect(zones.z6?.max).toBe(450); // 150 % de la FTP
    });

    it('produit des paliers ordonnés et sans chevauchement', () => {
        expectZonesOrdonnees(calculateFtp({ ftp: 300 }).zones);
        expectZonesOrdonnees(calculateFtp({ p5min: 350, p20min: 280 }).zones);
    });
});

// ─── Validation ───────────────────────────────────────────────────────────────

describe('validatePowerTests', () => {
    it('accepte dès qu’une valeur exploitable est présente', () => {
        expect(validatePowerTests({ p20min: 280 })).toBe(true);
        expect(validatePowerTests({ ftp: 240 })).toBe(true);
    });

    it('refuse un jeu de tests vide ou nul', () => {
        expect(validatePowerTests({})).toBe(false);
        expect(validatePowerTests({ p5min: 0, p20min: 0, ftp: 0 })).toBe(false);
    });
});

describe('getTestPrecision', () => {
    it('gradue la précision selon le nombre de tests de durée', () => {
        expect(getTestPrecision({})).toEqual({ count: 0, level: 'low' });
        expect(getTestPrecision({ p20min: 280 })).toEqual({ count: 1, level: 'low' });
        expect(getTestPrecision({ p20min: 280, p5min: 350 })).toEqual({ count: 2, level: 'medium' });
        expect(getTestPrecision({ p20min: 280, p5min: 350, p8min: 320 })).toEqual({ count: 3, level: 'high' });
        expect(getTestPrecision({ p5min: 350, p8min: 320, p15min: 300, p20min: 280 }))
            .toEqual({ count: 4, level: 'high' });
    });

    it('ne compte pas la FTP saisie comme un test', () => {
        expect(getTestPrecision({ ftp: 240 })).toEqual({ count: 0, level: 'low' });
    });
});
