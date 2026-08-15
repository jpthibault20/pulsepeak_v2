/******************************************************************************
 * @file    _internals/rate-limit.ts
 * @brief   Limitation de débit des appels IA (plan / workout) par utilisateur.
 *          Free : 1 génération de plan par mois (voir FREE_PLAN_MONTHLY_AI_GENERATIONS).
 *          Pro/dev/admin : quotas journaliers très larges (garde-fou anti-abus).
 * @access  Module privé — ne pas importer depuis un composant client.
 ******************************************************************************/

import { format } from 'date-fns';
import { atomicIncrementAICallCount, getProfile } from '@/lib/data/crud';
import { FREE_PLAN_MONTHLY_AI_GENERATIONS } from '../../constants';

const AI_DAILY_LIMIT_FREE_WORKOUT = 10;
const AI_DAILY_LIMITS_PRO = { plan: 999, workout: 999 } as const;

export type CallPeriod = 'day' | 'month';

/**
 * Clé de période comparée à la colonne `date` de reset en base — toujours un
 * "yyyy-MM-dd" valide (jour courant, ou 1er du mois courant pour le quota mensuel).
 */
export function periodKey(period: CallPeriod, now: Date): string {
    if (period === 'month') {
        return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
    }
    return format(now, 'yyyy-MM-dd');
}

/**
 * Vérifie et incrémente le compteur d'appels IA courant pour l'utilisateur.
 * Déclenche une erreur si le quota du plan est atteint.
 *
 * @param type 'plan' (génération complète) ou 'workout' (séance unique)
 * @throws Error si la limite est dépassée
 */
export async function checkAndIncrementAICallLimit(type: 'plan' | 'workout'): Promise<void> {
    const profile = await getProfile();
    const isPro = profile?.plan === 'pro' || profile?.plan === 'dev'
               || profile?.role === 'admin';

    // Free + génération de plan : quota mensuel (1/mois). Tout le reste : quota journalier.
    const period = !isPro && type === 'plan' ? 'month' : 'day';
    const limit  = isPro
        ? AI_DAILY_LIMITS_PRO[type]
        : (type === 'plan' ? FREE_PLAN_MONTHLY_AI_GENERATIONS : AI_DAILY_LIMIT_FREE_WORKOUT);

    await atomicIncrementAICallCount(type, periodKey(period, new Date()), limit, period);
}
