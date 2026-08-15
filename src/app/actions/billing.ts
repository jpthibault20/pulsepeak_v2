'use server';

import { getProfile } from '@/lib/data/crud';
import { stripe } from '@/lib/stripe/client';
import { ReturnCode } from '@/lib/data/type';

export async function createCheckoutSessionAction(priceId: string): Promise<{ state: ReturnCode; url?: string }> {
    try {
        const profile = await getProfile();

        const session = await stripe.checkout.sessions.create({
            mode: 'subscription',
            line_items: [{ price: priceId, quantity: 1 }],
            client_reference_id: profile.id,
            customer: profile.stripeCustomerId,
            customer_email: profile.stripeCustomerId ? undefined : profile.email,
            success_url: `${process.env.NEXT_PUBLIC_BASE_URL}/?checkout=success`,
            cancel_url: `${process.env.NEXT_PUBLIC_BASE_URL}/pricing`,
            // Le webhook n'a pas toujours accès au client_reference_id (ex: customer.subscription.updated
            // sur un renouvellement) — on duplique donc l'userId dans les metadata de la subscription.
            subscription_data: {
                metadata: { userId: profile.id },
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
