'use server';

/******************************************************************************
 * @file    actions/promotions.ts
 * @brief   Gestion des codes promo (dashboard admin) + validation d'un code
 *          saisi par un client sur /pricing.
 *
 * Stripe est la SEULE source de vérité : rien n'est dupliqué en base. Un code
 * promo = un `coupon` (la remise) + un `promotionCode` (le code saisissable).
 *
 * Limites de l'API Stripe, assumées par l'UI admin :
 *   - un promotion code ne se supprime pas → on le désactive et on supprime le
 *     coupon sous-jacent, ce qui le rend définitivement inutilisable ;
 *   - la remise d'un code existant n'est pas modifiable → « modifier » se limite
 *     à activer/désactiver et renommer ; changer la remise = créer un nouveau code ;
 *   - supprimer un coupon n'annule PAS les remises déjà appliquées aux
 *     abonnements en cours (comportement Stripe voulu : on ne pénalise pas un
 *     client déjà engagé).
 ******************************************************************************/

import Stripe from 'stripe';
import { revalidatePath } from 'next/cache';
import { stripe } from '@/lib/stripe/client';
import { requireAdmin } from '@/lib/admin';
import { ReturnCode } from '@/lib/data/type';
import {
    eurosToCents,
    normalizePromoCode,
    validatePromotionInput,
    type PromotionInput,
    type PromotionSummary,
} from '@/lib/billing/promotions';
import { EXPAND_COUPON, EXPAND_COUPON_LIST, toPromotionSummary } from '@/lib/stripe/promotions';

const LIST_LIMIT = 100;

// ─── Lecture (admin) ──────────────────────────────────────────────────────────

/**
 * Liste tous les codes promo du compte Stripe, les plus récents d'abord.
 * Renvoie un tableau vide (et loggue) si Stripe est injoignable ou non configuré,
 * pour ne jamais faire planter le rendu du dashboard admin.
 */
export async function listPromotionsAction(): Promise<PromotionSummary[]> {
    try {
        await requireAdmin();
        const { data } = await stripe.promotionCodes.list({ limit: LIST_LIMIT, expand: EXPAND_COUPON_LIST });
        return data.map(toPromotionSummary).filter((p): p is PromotionSummary => p !== null);
    } catch (err) {
        console.error('[listPromotionsAction]', err);
        return [];
    }
}

// ─── Écriture (admin) ─────────────────────────────────────────────────────────

export type PromotionMutationResult = {
    state:      ReturnCode;
    error?:     string;
    promotion?: PromotionSummary;
};

/**
 * Crée le coupon (la remise) puis le code promo qui le porte.
 * Si la création du code échoue (code déjà pris, par ex.), le coupon orphelin est
 * supprimé pour ne pas polluer le compte Stripe.
 */
export async function createPromotionAction(input: PromotionInput): Promise<PromotionMutationResult> {
    try {
        await requireAdmin();

        const validationError = validatePromotionInput(input);
        if (validationError) return { state: ReturnCode.RC_Error, error: validationError };

        const code = normalizePromoCode(input.code);
        const name = input.name.trim();

        const coupon = await stripe.coupons.create({
            ...(input.discountType === 'percent'
                ? { percent_off: input.value }
                : { amount_off: eurosToCents(input.value), currency: 'eur' }),
            duration: input.duration,
            ...(input.duration === 'repeating' && input.durationInMonths
                ? { duration_in_months: input.durationInMonths }
                : {}),
            ...(name ? { name } : {}),
        });

        let promo: Stripe.PromotionCode;
        try {
            promo = await stripe.promotionCodes.create({
                promotion: { type: 'coupon', coupon: coupon.id },
                code,
                expand: EXPAND_COUPON,
                ...(input.maxRedemptions ? { max_redemptions: input.maxRedemptions } : {}),
                ...(input.expiresAt ? { expires_at: Math.floor(new Date(input.expiresAt).getTime() / 1000) } : {}),
                ...(input.firstTimeOnly ? { restrictions: { first_time_transaction: true } } : {}),
            });
        } catch (err) {
            await stripe.coupons.del(coupon.id).catch(() => {}); // rollback du coupon orphelin
            throw err;
        }

        revalidatePath('/admin');
        return { state: ReturnCode.RC_OK, promotion: toPromotionSummary(promo) ?? undefined };
    } catch (err) {
        console.error('[createPromotionAction]', err);
        return { state: ReturnCode.RC_Error, error: stripeErrorMessage(err) };
    }
}

/**
 * Seules modifications autorisées par Stripe sur un code existant :
 * son activation et le libellé du coupon. La remise elle-même est immuable.
 */
export async function updatePromotionAction(
    promotionId: string,
    couponId: string,
    changes: { active?: boolean; name?: string },
): Promise<PromotionMutationResult> {
    try {
        await requireAdmin();

        if (changes.name !== undefined) {
            const name = changes.name.trim();
            if (name.length > 40) {
                return { state: ReturnCode.RC_Error, error: 'Le libellé ne peut pas dépasser 40 caractères.' };
            }
            await stripe.coupons.update(couponId, { name });
        }

        const promo = changes.active !== undefined
            ? await stripe.promotionCodes.update(promotionId, { active: changes.active, expand: EXPAND_COUPON })
            : await stripe.promotionCodes.retrieve(promotionId, { expand: EXPAND_COUPON });

        revalidatePath('/admin');
        return { state: ReturnCode.RC_OK, promotion: toPromotionSummary(promo) ?? undefined };
    } catch (err) {
        console.error('[updatePromotionAction]', err);
        return { state: ReturnCode.RC_Error, error: stripeErrorMessage(err) };
    }
}

/**
 * Supprime définitivement un code : désactivation du promotion code (Stripe ne
 * permet pas de le supprimer) puis suppression du coupon, ce qui le rend
 * inutilisable au Checkout. Les abonnements déjà remisés ne sont pas touchés.
 */
export async function deletePromotionAction(promotionId: string, couponId: string): Promise<PromotionMutationResult> {
    try {
        await requireAdmin();

        await stripe.promotionCodes.update(promotionId, { active: false });
        await stripe.coupons.del(couponId);

        revalidatePath('/admin');
        return { state: ReturnCode.RC_OK };
    } catch (err) {
        console.error('[deletePromotionAction]', err);
        return { state: ReturnCode.RC_Error, error: stripeErrorMessage(err) };
    }
}

/** Message Stripe lisible (ex: « code déjà utilisé ») ou message générique. */
function stripeErrorMessage(err: unknown): string {
    if (err instanceof Stripe.errors.StripeError && err.message) return err.message;
    return 'Opération impossible. Réessaie dans quelques instants.';
}
