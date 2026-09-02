/******************************************************************************
 * @file    lib/billing/promotions.ts
 * @brief   Codes promo — types partagés et logique pure (validité, formatage,
 *          application de la remise). Aucune dépendance Stripe ni serveur :
 *          importable depuis l'admin comme depuis la page /pricing.
 *
 * Stripe reste la seule source de vérité : rien n'est dupliqué en base. Les
 * appels API vivent dans app/actions/promotions.ts, qui convertit les objets
 * Stripe en `PromotionSummary` sérialisable avant de les passer au client.
 ******************************************************************************/

export type PromotionDuration = 'once' | 'repeating' | 'forever';

/** Remise portée par le coupon Stripe — exactement l'un des deux champs est renseigné. */
export interface PromotionDiscount {
    percentOff:     number | null;  // ex: 20 pour -20 %
    amountOffCents: number | null;  // ex: 500 pour -5,00 €
    currency:       string | null;  // ISO 4217 minuscule ('eur'), null si percentOff
}

/** Vue sérialisable d'un `Stripe.PromotionCode` + son coupon, telle qu'exposée au client. */
export interface PromotionSummary extends PromotionDiscount {
    id:               string;   // promo_...
    couponId:         string;   // coupon Stripe sous-jacent
    code:             string;   // code saisi par le client (ex: 'CLUB-TRI-2026')
    name:             string | null; // libellé interne du coupon (ex: 'Club Tri Nantes')
    active:           boolean;
    duration:         PromotionDuration;
    durationInMonths: number | null;
    maxRedemptions:   number | null;
    timesRedeemed:    number;
    expiresAt:        string | null; // ISO
    createdAt:        string;        // ISO
    couponValid:      boolean;       // le coupon sous-jacent est-il encore valide côté Stripe
}

/**
 * Normalise un code saisi par l'utilisateur avant comparaison/API.
 * Stripe stocke les codes en majuscules et les compare à l'identique.
 */
export function normalizePromoCode(raw: string): string {
    return raw.trim().toUpperCase();
}

/** Pourquoi un code n'est pas (ou plus) utilisable — 'active' = utilisable. */
export type PromotionStatus = 'active' | 'disabled' | 'expired' | 'exhausted';

/**
 * Statut effectif d'un code. Stripe ne bascule pas `active` à false quand un code
 * expire ou épuise son quota : il faut recalculer, sinon le dashboard affiche
 * « actif » un code que le Checkout refusera.
 */
export function promotionStatus(promo: PromotionSummary, now: Date = new Date()): PromotionStatus {
    if (!promo.active || !promo.couponValid) return 'disabled';

    if (promo.expiresAt) {
        const expires = new Date(promo.expiresAt);
        if (!Number.isNaN(expires.getTime()) && expires.getTime() <= now.getTime()) return 'expired';
    }
    if (promo.maxRedemptions !== null && promo.timesRedeemed >= promo.maxRedemptions) return 'exhausted';

    return 'active';
}

/** Libellé court de la remise : '-20 %' ou '-5,00 €'. '—' si le coupon n'en porte aucune. */
export function formatDiscount(discount: PromotionDiscount): string {
    if (discount.percentOff !== null) {
        return `-${formatNumber(discount.percentOff)} %`;
    }
    if (discount.amountOffCents !== null) {
        return `-${formatMoneyCents(discount.amountOffCents, discount.currency ?? 'eur')}`;
    }
    return '—';
}

/**
 * Libellé de la portée de la remise : '1er mois', '1re année', '3 mois', 'à vie'.
 * `interval` = périodicité de l'abonnement visé : une remise Stripe 'once' porte
 * sur la première facture, qui vaut un an sur une formule annuelle.
 */
export function formatDuration(
    duration: PromotionDuration,
    durationInMonths: number | null,
    interval: 'month' | 'year' = 'month',
): string {
    switch (duration) {
        case 'once':      return interval === 'year' ? '1re année' : '1er mois';
        case 'forever':   return 'à vie';
        case 'repeating': return durationInMonths && durationInMonths > 1
            ? `${durationInMonths} mois`
            : formatDuration('once', null, interval);
    }
}

/**
 * Montant en centimes → prix affichable ('9 €', '7,50 €').
 * Les centimes ne sont montrés que s'ils existent, pour ne pas alourdir les
 * tarifs ronds de la grille.
 */
export function formatMoneyCents(cents: number, currency: string = 'eur'): string {
    const hasCents = cents % 100 !== 0;
    return new Intl.NumberFormat('fr-FR', {
        style:                 'currency',
        currency:              currency.toUpperCase(),
        minimumFractionDigits: hasCents ? 2 : 0,
        maximumFractionDigits: hasCents ? 2 : 0,
    }).format(cents / 100);
}

function formatNumber(value: number): string {
    return Number.isInteger(value) ? String(value) : String(value).replace('.', ',');
}

// ─── Création d'un code promo (admin) ─────────────────────────────────────────

/** Formulaire de création côté admin, avant traduction en coupon + promotion code Stripe. */
export interface PromotionInput {
    code:             string;
    name:             string;             // libellé interne, '' accepté
    discountType:     'percent' | 'amount';
    value:            number;             // pourcentage (0 < v ≤ 100) ou euros (> 0)
    duration:         PromotionDuration;
    durationInMonths: number | null;      // requis si duration === 'repeating'
    maxRedemptions:   number | null;      // null = illimité
    expiresAt:        string | null;      // 'YYYY-MM-DD', null = pas d'expiration
    firstTimeOnly:    boolean;            // réservé aux clients n'ayant jamais payé
}

const CODE_PATTERN = /^[A-Z0-9_-]{3,40}$/;
const MAX_DURATION_MONTHS = 36;
const MAX_NAME_LENGTH = 40; // limite Stripe sur coupon.name

/**
 * Valide un formulaire de création avant tout appel Stripe.
 * Renvoie le message d'erreur à afficher, ou null si l'entrée est correcte.
 */
export function validatePromotionInput(input: PromotionInput, now: Date = new Date()): string | null {
    const code = normalizePromoCode(input.code);
    if (!CODE_PATTERN.test(code)) {
        return 'Le code doit faire 3 à 40 caractères (lettres, chiffres, tiret ou underscore).';
    }

    if (input.name.trim().length > MAX_NAME_LENGTH) {
        return `Le libellé ne peut pas dépasser ${MAX_NAME_LENGTH} caractères.`;
    }

    if (!Number.isFinite(input.value) || input.value <= 0) {
        return 'La remise doit être strictement positive.';
    }
    if (input.discountType === 'percent' && input.value > 100) {
        return 'Une remise en pourcentage ne peut pas dépasser 100 %.';
    }

    if (input.duration === 'repeating') {
        const months = input.durationInMonths;
        if (!months || !Number.isInteger(months) || months < 1 || months > MAX_DURATION_MONTHS) {
            return `Le nombre de mois doit être un entier entre 1 et ${MAX_DURATION_MONTHS}.`;
        }
    }

    if (input.maxRedemptions !== null) {
        if (!Number.isInteger(input.maxRedemptions) || input.maxRedemptions < 1) {
            return "Le nombre maximum d'utilisations doit être un entier supérieur ou égal à 1.";
        }
    }

    if (input.expiresAt) {
        const expires = new Date(input.expiresAt);
        if (Number.isNaN(expires.getTime())) {
            return "La date d'expiration est invalide.";
        }
        if (expires.getTime() <= now.getTime()) {
            return "La date d'expiration doit être dans le futur.";
        }
    }

    return null;
}

/** Montant saisi en euros → centimes, tel qu'attendu par Stripe. */
export function eurosToCents(euros: number): number {
    return Math.round(euros * 100);
}
