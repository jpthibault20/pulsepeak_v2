import Stripe from 'stripe';

// Server-only. Ne jamais importer depuis un composant 'use client'.
//
// Instanciation paresseuse (Proxy) : construire un Stripe(...) au chargement du
// module ferait planter `next build` tant que STRIPE_SECRET_KEY n'est pas encore
// renseignée dans .env.local (le SDK Stripe lève dès le constructeur si la clé
// est vide) — `next build` importe cette route même sans jamais appeler Stripe.
let client: Stripe | null = null;

function getStripeClient(): Stripe {
    if (!client) {
        if (!process.env.STRIPE_SECRET_KEY) {
            throw new Error('STRIPE_SECRET_KEY manquante — voir .env.local');
        }
        client = new Stripe(process.env.STRIPE_SECRET_KEY);
    }
    return client;
}

export const stripe = new Proxy({} as Stripe, {
    get(_target, prop) {
        return Reflect.get(getStripeClient(), prop);
    },
});
