'use client';

import React, { createContext, useContext } from 'react';

// ─── Types ────────────────────────────────────────────────────────────────────

export type Plan     = 'free' | 'dev' | 'pro';
export type Status   = 'active' | 'trial' | 'past_due' | 'cancelled';
export type UserRole = 'user' | 'freeUse' | 'admin';

type BillingStatus = 'active' | 'past_due' | 'canceled' | 'incomplete';

/** Convertit le statut Stripe stocké en base (profiles.billingStatus) vers le Status du contexte. */
export function toSubscriptionStatus(billingStatus: BillingStatus | undefined | null): Status {
    switch (billingStatus) {
        case 'canceled':   return 'cancelled';
        case 'past_due':   return 'past_due';
        case 'incomplete': return 'past_due';
        case 'active':
        default:           return 'active';
    }
}

export interface Subscription {
    plan:   Plan;
    status: Status;
    role:   UserRole;
    trialEndsAt?:       string | null;
    currentPeriodEnd?:  string | null;
    cancelAtPeriodEnd?: boolean;
    /**
     * true seulement si un vrai client Stripe existe (checkout complété au moins une fois).
     * Un plan 'pro' octroyé à la main (admin) sans passer par Stripe reste à false — dans ce
     * cas il n'y a rien à gérer via le Billing Portal.
     */
    hasStripeCustomer?: boolean;
    /** L'utilisateur n'a pas encore consommé son mois offert (voir lib/billing/trial.ts). */
    trialEligible?: boolean;
}

// ─── Feature map ──────────────────────────────────────────────────────────────

export type Feature =
    | 'generate-plan'
    | 'regenerate-workout'
    | 'custom-plan-theme'
    | 'annual-stats'
    | 'advanced-stats'
    | 'chat-ai'
    | 'calendar-write';

// Features strictement réservées au plan payant. 'generate-plan' n'y figure pas :
// le free y a droit dans la limite d'un quota mensuel (voir FREE_PLAN_MONTHLY_AI_GENERATIONS
// et actions/schedule/_internals/rate-limit.ts) — c'est le serveur qui bloque au-delà du quota,
// pas ce gate client.
const FEATURE_PLANS: Record<Exclude<Feature, 'generate-plan'>, Plan[]> = {
    'regenerate-workout': ['pro'],
    'custom-plan-theme':  ['pro'],
    'annual-stats':       ['pro'],
    'advanced-stats':     ['pro'],
    'chat-ai':            ['pro'],
    'calendar-write':     ['pro'],
};

/**
 * admin, freeUse et le plan 'dev' ont accès illimité à toutes les features.
 * Le plan 'dev' = octroi manuel (bêta-testeurs, partenaires) assigné depuis /admin.
 */
export function hasFullAccess(role: UserRole, plan: Plan = 'free'): boolean {
    return role === 'admin' || role === 'freeUse' || plan === 'dev';
}

/**
 * Détermine si un utilisateur peut accéder à une feature donnée.
 * - generate-plan → toujours true (quota mensuel géré côté serveur pour le free)
 * - free (autres features) → aucun accès
 * - pro/dev/admin/freeUse → accès complet
 */
export function canAccess(feature: Feature, plan: Plan, role: UserRole = 'user'): boolean {
    if (feature === 'generate-plan') return true;
    if (hasFullAccess(role, plan)) return true;
    if (plan === 'free') return false;
    return FEATURE_PLANS[feature].includes(plan);
}

/** Retourne true si l'utilisateur est sur le plan gratuit (sans abonnement actif). */
export function isFreePlan(plan: Plan, role: UserRole = 'user'): boolean {
    return plan === 'free' && role !== 'admin' && role !== 'freeUse';
}

// ─── Context ──────────────────────────────────────────────────────────────────

const SubscriptionContext = createContext<Subscription>({
    plan:   'free',
    status: 'active',
    role:   'user',
});

interface SubscriptionProviderProps {
    children:      React.ReactNode;
    subscription?: Partial<Subscription>;
}

export function SubscriptionProvider({ children, subscription }: SubscriptionProviderProps) {
    const value: Subscription = {
        plan:              subscription?.plan   ?? 'free',
        status:            subscription?.status ?? 'active',
        role:              subscription?.role   ?? 'user',
        trialEndsAt:       subscription?.trialEndsAt      ?? null,
        currentPeriodEnd:  subscription?.currentPeriodEnd ?? null,
        cancelAtPeriodEnd: subscription?.cancelAtPeriodEnd ?? false,
        hasStripeCustomer: subscription?.hasStripeCustomer ?? false,
        trialEligible:     subscription?.trialEligible ?? false,
    };
    return (
        <SubscriptionContext.Provider value={value}>
            {children}
        </SubscriptionContext.Provider>
    );
}

export function useSubscription(): Subscription {
    return useContext(SubscriptionContext);
}
