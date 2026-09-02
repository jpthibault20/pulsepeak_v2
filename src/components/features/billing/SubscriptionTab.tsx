'use client';

import React, { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import {
    Check, Zap, ArrowRight,
    CreditCard, AlertCircle, Gift,
} from 'lucide-react';
import { useSubscription } from '@/lib/subscription/context';
import { createPortalSessionAction } from '@/app/actions/billing';
import { formatTrialEnd, isTrialing, trialDaysRemaining } from '@/lib/billing/trial';

export function SubscriptionTab() {
    const { plan: currentPlan, status, cancelAtPeriodEnd, hasStripeCustomer, trialEndsAt, trialEligible } = useSubscription();
    const router = useRouter();
    const [isPending, startTransition] = useTransition();
    const [error, setError] = useState<string | null>(null);

    // Essai en cours : Stripe range le statut en 'active', seul trialEndsAt le distingue.
    const trialing = isTrialing({ trialEndsAt });
    const daysLeft = trialDaysRemaining(trialEndsAt);

    const handleManageSubscription = () => {
        setError(null);
        startTransition(async () => {
            const result = await createPortalSessionAction();
            if (result.url) {
                window.location.href = result.url;
            } else {
                setError('Impossible d\'ouvrir la gestion d\'abonnement pour le moment.');
            }
        });
    };

    return (
        <div className="space-y-6">

            {/* ── Statut actuel ─────────────────────────────────────────── */}
            <div className="bg-slate-100 dark:bg-slate-800/60 border border-slate-300 dark:border-slate-700 rounded-2xl p-5">
                <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl bg-slate-200 dark:bg-slate-700 flex items-center justify-center">
                        <CreditCard size={18} className="text-slate-600 dark:text-slate-300" />
                    </div>
                    <div className="flex-1">
                        <p className="text-slate-900 dark:text-white font-semibold text-sm">Abonnement actuel</p>
                        <p className="text-slate-500 dark:text-slate-400 text-xs mt-0.5">
                            {currentPlan === 'free' && 'Aucun abonnement actif'}
                            {currentPlan === 'dev'  && 'Accès complet · Octroi spécial'}
                            {currentPlan === 'pro'  && (trialing
                                ? `Plan Pro · Essai gratuit${cancelAtPeriodEnd ? ' · Résiliation en cours' : ''}`
                                : `Plan Pro · ${status === 'active' ? (cancelAtPeriodEnd ? 'Résiliation en cours' : 'Actif') : status}`)}
                        </p>
                    </div>
                    {currentPlan === 'free' ? (
                        <button
                            onClick={() => router.push('/pricing')}
                            className="px-2.5 py-1 rounded-full text-xs font-bold border bg-slate-200 dark:bg-slate-700 text-slate-600 dark:text-slate-300 border-slate-300 dark:border-slate-600 hover:opacity-80 transition-opacity"
                        >
                            GRATUIT
                        </button>
                    ) : (
                        <span className={`
                            px-2.5 py-1 rounded-full text-xs font-bold border
                            ${currentPlan === 'dev' ? 'bg-blue-50 dark:bg-blue-500/20 text-blue-600 dark:text-blue-300 border-blue-200 dark:border-blue-500/30' : ''}
                            ${currentPlan === 'pro' ? 'bg-amber-50 dark:bg-amber-500/20 text-amber-600 dark:text-amber-300 border-amber-200 dark:border-amber-500/30' : ''}
                        `}>
                            {currentPlan === 'dev' ? 'ACCÈS COMPLET' : 'PRO'}
                        </span>
                    )}
                </div>

                {currentPlan === 'pro' && trialing && (
                    <div className="mt-4 flex items-start gap-2 bg-emerald-50 dark:bg-emerald-500/5 border border-emerald-200 dark:border-emerald-500/15 rounded-xl p-3">
                        <Gift size={14} className="text-emerald-600 dark:text-emerald-400 mt-0.5 shrink-0" />
                        <p className="text-emerald-700 dark:text-emerald-300/80 text-xs leading-relaxed">
                            Mois offert en cours : {daysLeft} jour{daysLeft > 1 ? 's' : ''} restant{daysLeft > 1 ? 's' : ''}.
                            {cancelAtPeriodEnd
                                ? ` Aucun débit ne sera effectué, votre accès Pro s'arrête le ${formatTrialEnd(trialEndsAt)}.`
                                : ` Premier prélèvement le ${formatTrialEnd(trialEndsAt)} — résiliez avant cette date pour ne rien payer.`}
                        </p>
                    </div>
                )}

                {currentPlan === 'free' && (
                    <div className="mt-4 flex items-start gap-2 bg-amber-50 dark:bg-amber-500/5 border border-amber-200 dark:border-amber-500/15 rounded-xl p-3">
                        <AlertCircle size={14} className="text-amber-600 dark:text-amber-400 mt-0.5 shrink-0" />
                        <p className="text-amber-600 dark:text-amber-300/80 text-xs leading-relaxed">
                            Vous êtes sur le plan Gratuit (fonctionnalités limitées).
                            {trialEligible
                                ? " Votre 1er mois de Pro est offert : testez l'accès complet sans être débité."
                                : ' Passez au Pro pour un accès complet.'}
                        </p>
                    </div>
                )}

                {currentPlan === 'pro' && cancelAtPeriodEnd && (
                    <div className="mt-4 flex items-start gap-2 bg-amber-50 dark:bg-amber-500/5 border border-amber-200 dark:border-amber-500/15 rounded-xl p-3">
                        <AlertCircle size={14} className="text-amber-600 dark:text-amber-400 mt-0.5 shrink-0" />
                        <p className="text-amber-600 dark:text-amber-300/80 text-xs leading-relaxed">
                            Votre abonnement ne sera pas renouvelé et repassera en Gratuit à la fin de la période en cours.
                        </p>
                    </div>
                )}
            </div>

            {/* ── Action ────────────────────────────────────────────────── */}
            {currentPlan === 'pro' && hasStripeCustomer ? (
                <div>
                    <button
                        onClick={handleManageSubscription}
                        disabled={isPending}
                        className="w-full flex items-center justify-center gap-2 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 disabled:opacity-60 text-slate-900 dark:text-white font-semibold py-3 rounded-xl transition-colors text-sm border border-slate-300 dark:border-slate-700"
                    >
                        <CreditCard size={14} />
                        {isPending ? 'Ouverture…' : 'Gérer mon abonnement'}
                    </button>
                    <p className="text-slate-500 text-xs text-center mt-2">
                        Facture, moyen de paiement, résiliation — géré via Stripe.
                    </p>
                </div>
            ) : currentPlan === 'free' ? (
                <button
                    onClick={() => router.push('/pricing')}
                    className="w-full flex items-center justify-center gap-2 bg-amber-600 hover:bg-amber-500 text-white font-semibold py-3 rounded-xl transition-colors text-sm shadow-lg shadow-amber-900/20"
                >
                    {trialEligible ? <Gift size={14} /> : <Zap size={14} />}
                    {trialEligible ? 'Profiter du mois offert' : 'Voir les offres'}
                    <ArrowRight size={14} />
                </button>
            ) : (
                // 'dev', ou 'pro' octroyé à la main sans passer par Stripe (pas de stripeCustomerId) :
                // il n'y a rien à gérer via le Billing Portal, pas de client Stripe derrière.
                <div className="bg-slate-100 dark:bg-slate-800/40 border border-slate-300/50 dark:border-slate-700/50 rounded-xl p-4">
                    <p className="text-slate-500 text-xs leading-relaxed text-center">
                        Accès accordé manuellement — aucun abonnement Stripe à gérer.
                    </p>
                </div>
            )}

            {error && (
                <p className="text-center text-red-500 text-xs">{error}</p>
            )}

            {currentPlan === 'free' && (
                <div className="bg-slate-100 dark:bg-slate-800/40 border border-slate-300/50 dark:border-slate-700/50 rounded-xl p-4">
                    <p className="text-slate-500 text-xs leading-relaxed text-center flex items-center justify-center gap-1.5">
                        <Check size={12} className="text-emerald-500 shrink-0" />
                        Sans engagement · résiliable à tout moment depuis Stripe
                    </p>
                </div>
            )}
        </div>
    );
}
