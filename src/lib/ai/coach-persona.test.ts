/******************************************************************************
 * @file    coach-persona.test.ts
 * @brief   Tests du rôle de coach injecté en tête des prompts IA.
 ******************************************************************************/

import { describe, it, expect } from 'vitest';
import { buildCoachRoleIntro } from './coach-persona';
import type { CoachType } from '../data/type';

describe('buildCoachRoleIntro', () => {
    it('renvoie un rôle propre à chaque discipline', () => {
        expect(buildCoachRoleIntro('cycling')).toContain('CYCLISME');
        expect(buildCoachRoleIntro('running')).toContain('COURSE À PIED');
        expect(buildCoachRoleIntro('swimming')).toContain('NATATION');
        expect(buildCoachRoleIntro('triathlon')).toContain('TRIATHLON');
    });

    it('retombe sur le coach triathlon si le profil n’en définit pas', () => {
        const parDefaut = buildCoachRoleIntro('triathlon');
        expect(buildCoachRoleIntro(undefined)).toBe(parDefaut);
        expect(buildCoachRoleIntro(null)).toBe(parDefaut);
    });

    it('retombe sur le coach triathlon pour une valeur inconnue venue de la base', () => {
        expect(buildCoachRoleIntro('trail' as CoachType)).toBe(buildCoachRoleIntro('triathlon'));
    });
});
