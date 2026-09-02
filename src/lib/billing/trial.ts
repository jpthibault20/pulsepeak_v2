/******************************************************************************
 * @file    lib/billing/trial.ts
 * @brief   Règles de l'essai gratuit (1er mois offert) — logique pure.
 *
 * L'essai est porté par Stripe (`subscription_data.trial_period_days` au
 * Checkout, voir app/actions/billing.ts) : la carte est demandée, aucun débit
 * n'a lieu avant la fin de l'essai, puis l'abonnement bascule tout seul en
 * payant. Deux colonnes de `profiles` en gardent la trace, écrites uniquement
 * par le webhook Stripe :
 *   - trialUsedAt : date de consommation du droit à l'essai (jamais réinitialisée)
 *   - trialEndsAt : fin de l'essai en cours (null dès que l'essai est terminé)
 *
 * Module sans dépendance serveur : importable depuis un composant client.
 ******************************************************************************/

import { TRIAL_PERIOD_DAYS } from '@/app/actions/constants';

export { TRIAL_PERIOD_DAYS };

/** Sous-ensemble de `Profile` nécessaire aux règles d'essai. */
export interface TrialFields {
    trialUsedAt?:          string | null;
    trialEndsAt?:          string | null;
    stripeSubscriptionId?: string | null;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Un utilisateur n'a droit à l'essai qu'une seule fois : jamais consommé, et
 * jamais abonné auparavant (un ancien abonné qui se réabonne paie directement).
 */
export function isTrialEligible(profile: TrialFields): boolean {
    if (profile.trialUsedAt) return false;
    if (profile.stripeSubscriptionId) return false;
    return true;
}

/** true tant que l'essai en cours n'est pas arrivé à échéance. */
export function isTrialing(profile: TrialFields, now: Date = new Date()): boolean {
    const end = parseDate(profile.trialEndsAt);
    if (!end) return false;
    return end.getTime() > now.getTime();
}

/**
 * Jours restants avant la fin de l'essai, arrondis au jour supérieur (une fin
 * dans 2 h reste « 1 jour »). 0 si l'essai est fini, absent ou illisible.
 */
export function trialDaysRemaining(trialEndsAt: string | null | undefined, now: Date = new Date()): number {
    const end = parseDate(trialEndsAt);
    if (!end) return 0;
    const remaining = end.getTime() - now.getTime();
    if (remaining <= 0) return 0;
    return Math.ceil(remaining / DAY_MS);
}

/** Date de fin d'essai au format court français, '—' si absente. */
export function formatTrialEnd(trialEndsAt: string | null | undefined): string {
    const end = parseDate(trialEndsAt);
    if (!end) return '—';
    return end.toLocaleDateString('fr-FR', { day: '2-digit', month: 'long', year: 'numeric' });
}

function parseDate(value: string | null | undefined): Date | null {
    if (!value) return null;
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? null : d;
}
