/******************************************************************************
 * @file    calendar-url.test.ts
 * @brief   Tests unitaires de l'état calendrier porté par l'URL. Les paramètres
 *          viennent de l'extérieur : ce qui n'est pas parsable doit être ignoré,
 *          jamais propagé.
 ******************************************************************************/

import { describe, it, expect } from 'vitest';
import {
    isMonthParam,
    isDayParam,
    formatMonthKey,
    toSeanceOrigin,
    buildAppHref,
    buildSeanceQuery,
    buildSeanceHref,
} from './calendar-url';

// ─── Validation des paramètres ────────────────────────────────────────────────

describe('isMonthParam', () => {
    it('accepte un mois YYYY-MM valide', () => {
        expect(isMonthParam('2026-01')).toBe(true);
        expect(isMonthParam('2026-09')).toBe(true);
        expect(isMonthParam('2026-12')).toBe(true);
    });

    it('rejette les mois hors bornes ou mal formés', () => {
        expect(isMonthParam('2026-00')).toBe(false);
        expect(isMonthParam('2026-13')).toBe(false);
        expect(isMonthParam('2026-1')).toBe(false);
        expect(isMonthParam('26-01')).toBe(false);
        expect(isMonthParam('2026-01-05')).toBe(false);
    });

    it('rejette les valeurs absentes ou non numériques', () => {
        expect(isMonthParam(null)).toBe(false);
        expect(isMonthParam(undefined)).toBe(false);
        expect(isMonthParam('')).toBe(false);
        expect(isMonthParam('janvier')).toBe(false);
    });
});

describe('isDayParam', () => {
    it('accepte un jour YYYY-MM-DD valide', () => {
        expect(isDayParam('2026-01-01')).toBe(true);
        expect(isDayParam('2026-07-14')).toBe(true);
        expect(isDayParam('2026-12-31')).toBe(true);
    });

    it('rejette les jours et mois hors bornes', () => {
        expect(isDayParam('2026-01-00')).toBe(false);
        expect(isDayParam('2026-01-32')).toBe(false);
        expect(isDayParam('2026-13-01')).toBe(false);
        expect(isDayParam('2026-01-5')).toBe(false);
        expect(isDayParam('2026-01')).toBe(false);
    });

    it('rejette les valeurs absentes', () => {
        expect(isDayParam(null)).toBe(false);
        expect(isDayParam(undefined)).toBe(false);
        expect(isDayParam('')).toBe(false);
    });

    it('ne contrôle que la SYNTAXE, pas le calendrier réel', () => {
        // Le 31 février passe le filtre : c'est un garde-fou de format, pas une
        // validation de date. Le rendu du calendrier retombe sur le mois courant.
        expect(isDayParam('2026-02-31')).toBe(true);
    });
});

// ─── Formatage ────────────────────────────────────────────────────────────────

describe('formatMonthKey', () => {
    it('formate une Date en YYYY-MM local', () => {
        expect(formatMonthKey(new Date(2026, 0, 5))).toBe('2026-01');
        expect(formatMonthKey(new Date(2026, 11, 31))).toBe('2026-12');
    });

    it('reste sur le mois local en fin de mois tardive', () => {
        expect(formatMonthKey(new Date(2026, 0, 1, 0, 30))).toBe('2026-01');
    });
});

describe('toSeanceOrigin', () => {
    it('conserve les provenances connues', () => {
        expect(toSeanceOrigin('plan')).toBe('plan');
        expect(toSeanceOrigin('stats')).toBe('stats');
        expect(toSeanceOrigin('calendar')).toBe('calendar');
    });

    it('retombe sur « calendar » pour toute valeur inattendue', () => {
        expect(toSeanceOrigin('profil')).toBe('calendar');
        expect(toSeanceOrigin(null)).toBe('calendar');
        expect(toSeanceOrigin(undefined)).toBe('calendar');
        expect(toSeanceOrigin('')).toBe('calendar');
    });
});

// ─── Construction des liens ───────────────────────────────────────────────────

describe('buildAppHref', () => {
    it('renvoie la racine nue sans vue ni état', () => {
        expect(buildAppHref(null, {})).toBe('/');
    });

    it('porte la vue demandée', () => {
        expect(buildAppHref('stats', {})).toBe('/?view=stats');
    });

    it('reconduit le mois et le jour consultés', () => {
        expect(buildAppHref(null, { month: '2026-01' })).toBe('/?month=2026-01');
        expect(buildAppHref('plan', { month: '2026-01', day: '2026-01-05' }))
            .toBe('/?view=plan&month=2026-01&day=2026-01-05');
    });

    it('laisse tomber un état invalide au lieu de le propager', () => {
        expect(buildAppHref(null, { month: '2026-13', day: 'hier' })).toBe('/');
        expect(buildAppHref(null, { month: null, day: undefined })).toBe('/');
    });
});

describe('buildSeanceQuery', () => {
    it('porte toujours la provenance', () => {
        expect(buildSeanceQuery('calendar', {})).toBe('?from=calendar');
        expect(buildSeanceQuery('stats', {})).toBe('?from=stats');
    });

    it('ajoute l’état calendrier valide', () => {
        expect(buildSeanceQuery('calendar', { month: '2026-03', day: '2026-03-02' }))
            .toBe('?from=calendar&month=2026-03&day=2026-03-02');
    });
});

describe('buildSeanceHref', () => {
    it('construit le lien complet vers une séance', () => {
        expect(buildSeanceHref('abc-123', 'plan', { month: '2026-03' }))
            .toBe('/seance/abc-123?from=plan&month=2026-03');
    });

    it('reste valide sans état calendrier', () => {
        expect(buildSeanceHref('abc-123', 'calendar', {})).toBe('/seance/abc-123?from=calendar');
    });
});
