/******************************************************************************
 * @file    stats/intensityScale.test.ts
 * @brief   Tests unitaires de la lecture qualitative d'un Intensity Factor.
 *          Le point clé : un même IF ne se lit pas pareil selon la métrique qui
 *          l'a produit.
 ******************************************************************************/

import { describe, it, expect } from 'vitest';
import { intensityScaleKey, readIntensityLevel, intensityScaleBounds } from './intensityScale';
import { makeProfile } from '@/test/fixtures';

const SANS_FC_REPOS = makeProfile({ heartRate: { max: 190 } });
const AVEC_FC_REPOS = makeProfile({ heartRate: { max: 190, resting: 50 } });

// ─── Choix de l'échelle ───────────────────────────────────────────────────────

describe('intensityScaleKey', () => {
    it('associe chaque source à son échelle', () => {
        expect(intensityScaleKey('power', null)).toBe('power');
        expect(intensityScaleKey('pace', null)).toBe('pace');
    });

    it('distingue Karvonen de %FCmax selon la présence d’une FC de repos', () => {
        expect(intensityScaleKey('hr', AVEC_FC_REPOS)).toBe('hrReserve');
        expect(intensityScaleKey('hr', SANS_FC_REPOS)).toBe('hrMax');
        expect(intensityScaleKey('hr', makeProfile({ heartRate: { max: 190, resting: 0 } }))).toBe('hrMax');
        expect(intensityScaleKey('hr', null)).toBe('hrMax');
    });

    it('refuse d’interpréter un TSS forfaitaire', () => {
        expect(intensityScaleKey('default', AVEC_FC_REPOS)).toBeNull();
    });
});

// ─── Lecture d'un IF ──────────────────────────────────────────────────────────

describe('readIntensityLevel — échelle puissance', () => {
    it('range l’IF sur les coefficients Coggan', () => {
        expect(readIntensityLevel(0.50, 'power', null)).toBe('Récupération');
        expect(readIntensityLevel(0.65, 'power', null)).toBe('Endurance');
        expect(readIntensityLevel(0.80, 'power', null)).toBe('Tempo');
        expect(readIntensityLevel(0.95, 'power', null)).toBe('Seuil');
        expect(readIntensityLevel(1.10, 'power', null)).toBe('VO2max');
    });

    it('range une valeur pivot dans le palier supérieur', () => {
        // Les bornes sont des maxima exclusifs : 0.55 n'est plus de la récup.
        expect(readIntensityLevel(0.55, 'power', null)).toBe('Endurance');
        expect(readIntensityLevel(0.75, 'power', null)).toBe('Tempo');
        expect(readIntensityLevel(1.05, 'power', null)).toBe('VO2max');
    });
});

describe('readIntensityLevel — échelle allure', () => {
    it('lit 1.00 comme le seuil', () => {
        expect(readIntensityLevel(1.00, 'pace', null)).toBe('Seuil');
    });

    it('ne classe pas un footing tranquille en récupération', () => {
        // 0.80 ≈ 70 % VMA : de l'endurance fondamentale, pas de la récup.
        expect(readIntensityLevel(0.80, 'pace', null)).toBe('Endurance');
        expect(readIntensityLevel(0.60, 'pace', null)).toBe('Récupération');
        expect(readIntensityLevel(0.90, 'pace', null)).toBe('Tempo');
        expect(readIntensityLevel(1.20, 'pace', null)).toBe('VO2max');
    });
});

describe('readIntensityLevel — échelles cardiaques', () => {
    it('lit le même ratio différemment selon Karvonen ou %FCmax', () => {
        expect(readIntensityLevel(0.70, 'hr', SANS_FC_REPOS)).toBe('Endurance');
        expect(readIntensityLevel(0.70, 'hr', AVEC_FC_REPOS)).toBe('Tempo');
    });

    it('couvre toute l’échelle %FCmax', () => {
        expect(readIntensityLevel(0.55, 'hr', SANS_FC_REPOS)).toBe('Récupération');
        expect(readIntensityLevel(0.80, 'hr', SANS_FC_REPOS)).toBe('Tempo');
        expect(readIntensityLevel(0.85, 'hr', SANS_FC_REPOS)).toBe('Seuil');
        expect(readIntensityLevel(0.95, 'hr', SANS_FC_REPOS)).toBe('VO2max');
    });
});

describe('readIntensityLevel — valeurs non interprétables', () => {
    it('refuse un IF nul, négatif ou non fini', () => {
        expect(readIntensityLevel(0, 'power', null)).toBeNull();
        expect(readIntensityLevel(-0.5, 'power', null)).toBeNull();
        expect(readIntensityLevel(NaN, 'power', null)).toBeNull();
        expect(readIntensityLevel(Infinity, 'power', null)).toBeNull();
    });

    it('refuse toute lecture sur un TSS forfaitaire', () => {
        expect(readIntensityLevel(0.85, 'default', AVEC_FC_REPOS)).toBeNull();
    });
});

// ─── Bornes ───────────────────────────────────────────────────────────────────

describe('intensityScaleBounds', () => {
    it('expose quatre bornes strictement croissantes par échelle', () => {
        for (const key of ['power', 'hrMax', 'hrReserve', 'pace'] as const) {
            const bounds = intensityScaleBounds(key);
            expect(bounds).toHaveLength(4);
            for (let i = 1; i < bounds.length; i++) {
                expect(bounds[i]).toBeGreaterThan(bounds[i - 1]);
            }
        }
    });
});
