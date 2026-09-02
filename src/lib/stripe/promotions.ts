/******************************************************************************
 * @file    lib/stripe/promotions.ts
 * @brief   Pont entre les objets Stripe et les types sérialisables du domaine
 *          (lib/billing/promotions.ts).
 * @access  Server-only — ne jamais importer depuis un composant 'use client'.
 *
 * Depuis le SDK v22, le coupon d'un promotion code vit sous `promotion.coupon`
 * et n'est PAS renvoyé développé par défaut : tout appel doit demander
 * explicitement l'expansion (EXPAND_COUPON / EXPAND_COUPON_LIST).
 ******************************************************************************/

import Stripe from 'stripe';
import {
    type PromotionDuration,
    type PromotionSummary,
} from '@/lib/billing/promotions';

/** À passer à create/retrieve/update pour obtenir un coupon développé. */
export const EXPAND_COUPON = ['promotion.coupon'];
/** Équivalent pour les listes. */
export const EXPAND_COUPON_LIST = ['data.promotion.coupon'];

/** Coupon développé d'un promotion code, ou null s'il n'a pas été demandé/n'existe pas. */
function couponOf(promo: Stripe.PromotionCode): Stripe.Coupon | null {
    const coupon = promo.promotion.coupon;
    return coupon && typeof coupon !== 'string' ? coupon : null;
}

/**
 * Objet Stripe → vue sérialisable exposée au client (aucun objet Stripe ne
 * franchit la frontière). null si le coupon n'a pas été développé : sans lui, la
 * remise est inconnue et il n'y a rien à afficher.
 */
export function toPromotionSummary(promo: Stripe.PromotionCode): PromotionSummary | null {
    const coupon = couponOf(promo);
    if (!coupon) return null;

    return {
        id:               promo.id,
        couponId:         coupon.id,
        code:             promo.code,
        name:             coupon.name ?? null,
        active:           promo.active,
        percentOff:       coupon.percent_off ?? null,
        amountOffCents:   coupon.amount_off ?? null,
        currency:         coupon.currency ?? null,
        duration:         coupon.duration as PromotionDuration,
        durationInMonths: coupon.duration_in_months ?? null,
        maxRedemptions:   promo.max_redemptions ?? null,
        timesRedeemed:    promo.times_redeemed,
        expiresAt:        promo.expires_at ? new Date(promo.expires_at * 1000).toISOString() : null,
        createdAt:        new Date(promo.created * 1000).toISOString(),
        couponValid:      coupon.valid,
    };
}
