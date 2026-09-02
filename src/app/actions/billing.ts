'use server';

import { getProfile } from '@/lib/data/crud';
import { stripe } from '@/lib/stripe/client';
import { ReturnCode } from '@/lib/data/type';
import { TRIAL_PERIOD_DAYS } from '@/app/actions/constants';
import { billingIntervalForPrice, isTrialEligibleForInterval } from '@/lib/billing/trial';

/**
 * Ouvre une session Checkout Stripe.
 *
 * - Essai gratuit : `trial_period_days` n'est ajouté que sur une formule
 *   MENSUELLE, et seulement si l'utilisateur n'a jamais consommé son droit à
 *   l'essai (voir lib/billing/trial.ts). L'annuel est facturé immédiatement :
 *   sa remise (-17 %) tient lieu d'offre. La carte est demandée, aucun débit
 *   avant la fin de l'essai.
 * - Code promo : `allow_promotion_codes` active le champ natif de Stripe sur la
 *   page de paiement — c'est là que le client saisit son code (voir les codes
 *   gérés depuis /admin, actions/promotions.ts).
 */
export async function createCheckoutSessionAction(priceId: string): Promise<{ state: ReturnCode; url?: string }> {
    try {
        const profile = await getProfile();
        const interval = billingIntervalForPrice(priceId, process.env.STRIPE_PRICE_ANNUAL);
        const trialEligible = isTrialEligibleForInterval(profile, interval);

        const session = await stripe.checkout.sessions.create({
            mode: 'subscription',
            line_items: [{ price: priceId, quantity: 1 }],
            client_reference_id: profile.id,
            customer: profile.stripeCustomerId,
            customer_email: profile.stripeCustomerId ? undefined : profile.email,
            success_url: `${process.env.NEXT_PUBLIC_BASE_URL}/?checkout=success`,
            cancel_url: `${process.env.NEXT_PUBLIC_BASE_URL}/pricing`,
            allow_promotion_codes: true,
            // Le webhook n'a pas toujours accès au client_reference_id (ex: customer.subscription.updated
            // sur un renouvellement) — on duplique donc l'userId dans les metadata de la subscription.
            subscription_data: {
                metadata: { userId: profile.id },
                ...(trialEligible ? { trial_period_days: TRIAL_PERIOD_DAYS } : {}),
            },
        });

        if (!session.url) return { state: ReturnCode.RC_Error };
        return { state: ReturnCode.RC_OK, url: session.url };
    } catch (err) {
        console.error('[createCheckoutSessionAction]', err);
        return { state: ReturnCode.RC_Error };
    }
}

export async function createPortalSessionAction(): Promise<{ state: ReturnCode; url?: string }> {
    try {
        const profile = await getProfile();
        if (!profile.stripeCustomerId) return { state: ReturnCode.RC_Error };

        const session = await stripe.billingPortal.sessions.create({
            customer: profile.stripeCustomerId,
            return_url: `${process.env.NEXT_PUBLIC_BASE_URL}/`,
        });

        return { state: ReturnCode.RC_OK, url: session.url };
    } catch (err) {
        console.error('[createPortalSessionAction]', err);
        return { state: ReturnCode.RC_Error };
    }
}
