/******************************************************************************
 * @file    chat-prompt.ts
 * @brief   Construction du prompt système du chat "Coach IA PulsePeak".
 *
 *          Module pur (aucun appel réseau, aucune dépendance serveur) afin de
 *          rester testable : la route /api/chat se contente de l'appeler avec
 *          le contexte envoyé par le client.
 ******************************************************************************/

import { CoachType } from "../data/type";
import { buildCoachRoleIntro } from "./coach-persona";

export interface ChatActiveSports {
    cycling:  boolean;
    running:  boolean;
    swimming: boolean;
}

export interface ChatContext {
    firstName:      string;
    lastName:       string;
    experience:     string;
    currentCTL:     number;
    activeSports:   ChatActiveSports;
    /** Coach choisi par l'athlète (profiles.coachType) — repli triathlon si absent. */
    coachType?:     CoachType | null;
    goal:           string;
    objectiveDate:  string;
    recentWorkouts: {
        date:      string;
        sportType: string;
        title:     string;
        duration:  number;
        tss:       number;
        status:    string;
    }[];
}

const SPORT_LABELS: Record<string, string> = {
    cycling:  'Cyclisme',
    running:  'Course à pied',
    swimming: 'Natation',
};

export function buildChatSystemPrompt(ctx: ChatContext): string {
    const sports = (Object.entries(ctx.activeSports) as [string, boolean][])
        .filter(([, v]) => v)
        .map(([k]) => SPORT_LABELS[k] ?? k)
        .join(', ');

    const workoutsBlock = ctx.recentWorkouts.length > 0
        ? ctx.recentWorkouts
            .slice(-10)
            .map(w => `  • ${w.date} | ${w.sportType} | ${w.title} | ${w.duration}min | TSS ${w.tss} | ${w.status}`)
            .join('\n')
        : '  Aucune séance récente.';

    return `${buildCoachRoleIntro(ctx.coachType)}

Dans cette conversation tu incarnes le Coach IA PulsePeak : bienveillant et concis.
Tu aides l'athlète à progresser, comprendre son entraînement, récupérer intelligemment et rester motivé.

━━━ PROFIL ━━━
Prénom      : ${ctx.firstName} ${ctx.lastName}
Niveau      : ${ctx.experience}
Sports      : ${sports || 'Non définis'}
CTL actuelle: ${ctx.currentCTL}
Objectif    : ${ctx.goal}
Date cible  : ${ctx.objectiveDate}

━━━ SÉANCES RÉCENTES ━━━
${workoutsBlock}

━━━ RÈGLES ━━━
- Toujours en français, ton encourageant et professionnel
- Réponses courtes et actionnables (3-5 phrases sauf si demande détaillée)
- Réfère-toi aux données du profil quand pertinent
- Reste dans ton domaine d'expertise de coach : tes conseils chiffrés suivent les unités de ta discipline
- Ne jamais inventer des données non fournies`;
}
