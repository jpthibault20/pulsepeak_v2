/******************************************************************************
 * @file    chat-prompt.test.ts
 * @brief   Tests du prompt système du chat Coach IA (contexte + rôle du coach).
 ******************************************************************************/

import { describe, it, expect } from 'vitest';
import { buildChatSystemPrompt, type ChatContext } from './chat-prompt';
import { buildCoachRoleIntro } from './coach-persona';

const makeCtx = (overrides: Partial<ChatContext> = {}): ChatContext => ({
    firstName:      'Léa',
    lastName:       'Martin',
    experience:     'Intermédiaire',
    currentCTL:     42,
    activeSports:   { cycling: true, running: true, swimming: false },
    goal:           'Ironman 70.3',
    objectiveDate:  '2026-09-12',
    recentWorkouts: [],
    ...overrides,
});

describe('buildChatSystemPrompt', () => {
    it('ouvre le prompt avec le rôle du coach choisi par l’athlète', () => {
        const prompt = buildChatSystemPrompt(makeCtx({ coachType: 'swimming' }));
        expect(prompt.startsWith(buildCoachRoleIntro('swimming'))).toBe(true);
        expect(prompt).toContain('NATATION');
        expect(prompt).not.toContain('CYCLISME');
    });

    it('retombe sur le coach triathlon quand le contexte n’envoie pas de coachType', () => {
        const prompt = buildChatSystemPrompt(makeCtx());
        expect(prompt.startsWith(buildCoachRoleIntro('triathlon'))).toBe(true);
    });

    it('liste les disciplines actives en français', () => {
        expect(buildChatSystemPrompt(makeCtx())).toContain('Sports      : Cyclisme, Course à pied');
    });

    it('affiche un repli quand aucune discipline n’est active', () => {
        const ctx = makeCtx({ activeSports: { cycling: false, running: false, swimming: false } });
        expect(buildChatSystemPrompt(ctx)).toContain('Sports      : Non définis');
    });

    it('reprend le profil de l’athlète', () => {
        const prompt = buildChatSystemPrompt(makeCtx());
        expect(prompt).toContain('Prénom      : Léa Martin');
        expect(prompt).toContain('CTL actuelle: 42');
        expect(prompt).toContain('Objectif    : Ironman 70.3');
        expect(prompt).toContain('Date cible  : 2026-09-12');
    });

    it('annonce l’absence de séance récente plutôt qu’une liste vide', () => {
        expect(buildChatSystemPrompt(makeCtx())).toContain('Aucune séance récente.');
    });

    it('formate les séances récentes et n’en garde que 10', () => {
        const workouts = Array.from({ length: 12 }, (_, i) => ({
            date:      `2026-08-${String(i + 1).padStart(2, '0')}`,
            sportType: 'cycling',
            title:     `Séance ${i + 1}`,
            duration:  60,
            tss:       50,
            status:    'completed',
        }));
        const prompt = buildChatSystemPrompt(makeCtx({ recentWorkouts: workouts }));

        expect(prompt).toContain('• 2026-08-12 | cycling | Séance 12 | 60min | TSS 50 | completed');
        expect(prompt).not.toContain('Séance 1 |');
        expect(prompt).not.toContain('Séance 2 |');
        expect(prompt).toContain('Séance 3 |');
    });
});
