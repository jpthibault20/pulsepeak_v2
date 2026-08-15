import { NextResponse, NextRequest } from 'next/server';
import Stripe from 'stripe';
import { stripe } from '@/lib/stripe/client';
import { db } from '@/lib/db';
import { profiles } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';

// Endpoint sans session Supabase (appelé par Stripe) — exclu du proxy d'auth,
// voir src/lib/supabase/proxy.ts. Source de vérité unique pour profiles.plan
// une fois un abonnement Stripe souscrit ; ne touche jamais un profil en plan 'dev'
// (octroi manuel admin, voir src/app/actions/admin.ts:updateUserPlanAction).

function billingIntervalFromSubscription(subscription: Stripe.Subscription): 'month' | 'year' | undefined {
    return subscription.items.data[0]?.price.recurring?.interval as 'month' | 'year' | undefined;
}

type BillingStatus = 'active' | 'past_due' | 'canceled' | 'incomplete';

// Réduit les statuts Stripe (qui incluent aussi trialing/unpaid/paused/incomplete_expired)
// vers le sous-ensemble stocké en base — une valeur hors enum ferait échouer l'écriture.
function toBillingStatus(status: Stripe.Subscription.Status): BillingStatus {
    switch (status) {
        case 'active':
        case 'trialing':
            return 'active';
        case 'past_due':
        case 'unpaid':
            return 'past_due';
        case 'canceled':
        case 'incomplete_expired':
        case 'paused':
            return 'canceled';
        case 'incomplete':
        default:
            return 'incomplete';
    }
}

async function applySubscriptionToProfile(userId: string, subscription: Stripe.Subscription) {
    const [current] = await db.select({ plan: profiles.plan }).from(profiles).where(eq(profiles.id, userId));
    if (current?.plan === 'dev') return; // octroi manuel admin — jamais écrasé par Stripe

    const isActive = subscription.status === 'active' || subscription.status === 'trialing';
    const priceId = subscription.items.data[0]?.price.id;
    const periodEnd = subscription.items.data[0]?.current_period_end;

    await db
        .update(profiles)
        .set({
            plan:                 isActive ? 'pro' : 'free',
            stripeCustomerId:     typeof subscription.customer === 'string' ? subscription.customer : subscription.customer.id,
            stripeSubscriptionId: subscription.id,
            stripePriceId:        priceId,
            billingStatus:        toBillingStatus(subscription.status),
            currentPeriodEnd:     periodEnd ? new Date(periodEnd * 1000) : null,
            cancelAtPeriodEnd:    subscription.cancel_at_period_end,
            billingInterval:      billingIntervalFromSubscription(subscription),
            updatedAt:            new Date(),
        })
        .where(eq(profiles.id, userId));
}

async function clearSubscriptionFromProfile(userId: string) {
    const [current] = await db.select({ plan: profiles.plan }).from(profiles).where(eq(profiles.id, userId));
    if (current?.plan === 'dev') return; // octroi manuel admin — jamais écrasé par Stripe

    await db
        .update(profiles)
        .set({
            plan:                 'free',
            stripeSubscriptionId: null,
            stripePriceId:        null,
            billingStatus:        'canceled',
            currentPeriodEnd:     null,
            cancelAtPeriodEnd:    false,
            billingInterval:      null,
            updatedAt:            new Date(),
        })
        .where(eq(profiles.id, userId));
}

export async function POST(request: NextRequest) {
    const body = await request.text();
    const signature = request.headers.get('stripe-signature');

    if (!signature) {
        return NextResponse.json({ error: 'Signature manquante' }, { status: 400 });
    }

    let event: Stripe.Event;
    try {
        event = stripe.webhooks.constructEvent(body, signature, process.env.STRIPE_WEBHOOK_SECRET!);
    } catch (err) {
        console.error('[stripe/webhook] signature invalide:', err);
        return NextResponse.json({ error: 'Signature invalide' }, { status: 400 });
    }

    try {
        switch (event.type) {
            case 'checkout.session.completed': {
                const session = event.data.object as Stripe.Checkout.Session;
                const userId = session.client_reference_id;
                if (userId && session.subscription) {
                    const subscriptionId = typeof session.subscription === 'string' ? session.subscription : session.subscription.id;
                    const subscription = await stripe.subscriptions.retrieve(subscriptionId);
                    await applySubscriptionToProfile(userId, subscription);
                }
                break;
            }

            case 'customer.subscription.updated': {
                const subscription = event.data.object as Stripe.Subscription;
                const userId = subscription.metadata?.userId;
                if (userId) await applySubscriptionToProfile(userId, subscription);
                break;
            }

            case 'customer.subscription.deleted': {
                const subscription = event.data.object as Stripe.Subscription;
                const userId = subscription.metadata?.userId;
                if (userId) await clearSubscriptionFromProfile(userId);
                break;
            }

            default:
                break;
        }
    } catch (err) {
        console.error(`[stripe/webhook] erreur traitement ${event.type}:`, err);
        return NextResponse.json({ error: 'Erreur traitement webhook' }, { status: 500 });
    }

    return NextResponse.json({ received: true });
}
