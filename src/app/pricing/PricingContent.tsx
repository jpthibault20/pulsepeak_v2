'use client';

import React, { useState, useTransition } from 'react';
import Link from 'next/link';
import { Check, Zap, Crown, ArrowLeft, Shield } from 'lucide-react';
import type { Plan } from '@/lib/subscription/context';
import { createCheckoutSessionAction } from '@/app/actions/billing';

interface PriceIds {
    monthly:       string;
    annual:        string;
    monthlyLaunch: string;
}

interface PricingContentProps {
    currentPlan?:      Plan;
    launchOfferActive: boolean;
    priceIds:          PriceIds;
}

const FREE_FEATURES = [
    { label: '1 génération de plan IA par mois', included: true },
    { label: 'Calendrier en lecture seule', included: true },
    { label: 'Stats de base', included: true },
    { label: 'Synchronisation Strava', included: true },
    { label: 'Coach IA (chat)', included: false },
    { label: 'Régénération de séance par IA', included: false },
    { label: 'Modifier le calendrier (déplacer, valider)', included: false },
    { label: 'Stats avancées & analyse de performance', included: false },
];

const PRO_FEATURES = [
    { label: 'Générations de plan IA illimitées', included: true },
    { label: 'Calendrier complet (déplacer, valider, planifier)', included: true },
    { label: 'Coach IA illimité', included: true },
    { label: 'Régénération de séance à la volée', included: true },
    { label: 'Stats avancées & analyse de performance', included: true },
    { label: 'Synchronisation Strava', included: true },
];

export function PricingContent({ currentPlan = 'free', launchOfferActive, priceIds }: PricingContentProps) {
    const [billing, setBilling] = useState<'monthly' | 'annual'>('monthly');
    const [isPending, startTransition] = useTransition();
    const [error, setError] = useState<string | null>(null);

    const monthlyPriceId = launchOfferActive ? priceIds.monthlyLaunch : priceIds.monthly;
    const priceId = billing === 'monthly' ? monthlyPriceId : priceIds.annual;

    const handleSubscribe = () => {
        setError(null);
        startTransition(async () => {
            const result = await createCheckoutSessionAction(priceId);
            if (result.url) {
                window.location.href = result.url;
            } else {
                setError('Impossible de démarrer le paiement. Réessaie dans quelques instants.');
            }
        });
    };

    return (
        <div className="min-h-screen bg-white dark:bg-slate-950 text-slate-900 dark:text-white">

            {/* Header */}
            <div className="border-b border-slate-200 dark:border-slate-800 px-4 py-4">
                <div className="max-w-4xl mx-auto flex items-center justify-between">
                    <Link
                        href="/"
                        className="flex items-center gap-2 text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white transition-colors text-sm"
                    >
                        <ArrowLeft size={16} />
                        Retour à l&apos;application
                    </Link>
                    <span className="text-slate-900 dark:text-white font-bold tracking-tight">PulsePeak</span>
                </div>
            </div>

            {/* Hero */}
            <div className="max-w-4xl mx-auto px-4 pt-12 pb-6 text-center">
                {launchOfferActive && (
                    <div className="inline-flex items-center gap-2 bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/20 rounded-full px-4 py-1.5 text-amber-600 dark:text-amber-300 text-xs font-semibold mb-4">
                        <Zap size={12} />
                        Offre de lancement · 5€/mois jusqu&apos;au 31/12/2026
                    </div>
                )}
                <h1 className="text-3xl sm:text-4xl font-bold mb-3">
                    Choisissez votre plan
                </h1>
                <p className="text-slate-500 dark:text-slate-400 text-base max-w-xl mx-auto leading-relaxed">
                    Essayez PulsePeak gratuitement, puis passez au plan Pro pour un accès complet
                    à la génération de plans IA, au coach IA et aux stats avancées.
                </p>

                {/* Toggle mensuel/annuel */}
                <div className="inline-flex items-center gap-1 bg-slate-100 dark:bg-slate-800 rounded-full p-1 mt-6">
                    <button
                        onClick={() => setBilling('monthly')}
                        className={`px-4 py-1.5 rounded-full text-sm font-semibold transition-colors ${billing === 'monthly' ? 'bg-white dark:bg-slate-700 text-slate-900 dark:text-white shadow-sm' : 'text-slate-500 dark:text-slate-400'}`}
                    >
                        Mensuel
                    </button>
                    <button
                        onClick={() => setBilling('annual')}
                        className={`px-4 py-1.5 rounded-full text-sm font-semibold transition-colors ${billing === 'annual' ? 'bg-white dark:bg-slate-700 text-slate-900 dark:text-white shadow-sm' : 'text-slate-500 dark:text-slate-400'}`}
                    >
                        Annuel · -17%
                    </button>
                </div>
            </div>

            {/* Plans grid */}
            <div className="max-w-4xl mx-auto px-4 pb-12">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 max-w-2xl mx-auto">

                    {/* Free */}
                    <div className={`
                        relative rounded-2xl border p-6 flex flex-col
                        ${currentPlan === 'free'
                            ? 'border-emerald-400 dark:border-emerald-500/50 bg-linear-to-b from-emerald-500/5 to-white dark:to-slate-900 shadow-xl shadow-emerald-900/10'
                            : 'border-slate-200 dark:border-slate-800 bg-white/80 dark:bg-slate-900/60'
                        }
                    `}>
                        {currentPlan === 'free' && (
                            <div className="absolute -top-3 left-1/2 -translate-x-1/2">
                                <span className="bg-emerald-600 text-white text-[11px] font-bold px-3 py-1 rounded-full whitespace-nowrap shadow-lg">
                                    PLAN ACTUEL
                                </span>
                            </div>
                        )}

                        <div className="flex items-center gap-2 mb-2">
                            <span className="text-slate-900 dark:text-white font-bold text-lg">Gratuit</span>
                        </div>
                        <div className="mb-3">
                            <span className="text-4xl font-bold text-slate-900 dark:text-white">0€</span>
                            <span className="text-slate-500 dark:text-slate-400 text-sm ml-1">Pour toujours</span>
                        </div>
                        <p className="text-slate-500 dark:text-slate-400 text-sm leading-relaxed mb-5">
                            Pour essayer PulsePeak avant de s&apos;engager.
                        </p>

                        <ul className="space-y-2.5 flex-1 mb-6">
                            {FREE_FEATURES.map(f => (
                                <li key={f.label} className="flex items-start gap-2.5 text-sm">
                                    {f.included
                                        ? <Check size={14} className="text-emerald-600 dark:text-emerald-400 mt-0.5 shrink-0" />
                                        : <span className="w-3.5 h-3.5 mt-0.5 shrink-0 flex items-center justify-center text-slate-400 dark:text-slate-700 text-lg leading-none">—</span>
                                    }
                                    <span className={f.included ? 'text-slate-600 dark:text-slate-300' : 'text-slate-400 dark:text-slate-600'}>
                                        {f.label}
                                    </span>
                                </li>
                            ))}
                        </ul>

                        {currentPlan === 'free' ? (
                            <div className="flex items-center justify-center gap-2 bg-emerald-50 dark:bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 font-semibold py-3 rounded-xl text-sm border border-emerald-200 dark:border-emerald-500/30">
                                <Check size={14} />
                                Votre plan actuel
                            </div>
                        ) : (
                            <Link
                                href="/"
                                className="flex items-center justify-center gap-2 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-600 dark:text-slate-300 font-semibold py-3 rounded-xl transition-colors text-sm"
                            >
                                Continuer gratuitement
                            </Link>
                        )}
                    </div>

                    {/* Pro */}
                    <div className={`
                        relative rounded-2xl border p-6 flex flex-col
                        ${currentPlan === 'pro'
                            ? 'border-emerald-400 dark:border-emerald-500/50 bg-linear-to-b from-emerald-500/5 to-white dark:to-slate-900 shadow-xl shadow-emerald-900/10'
                            : 'border-amber-500/40 bg-linear-to-b from-amber-500/5 to-white dark:to-slate-900 shadow-xl shadow-amber-900/10'
                        }
                    `}>
                        <div className="absolute -top-3 left-1/2 -translate-x-1/2">
                            <span className={`text-[11px] font-bold px-3 py-1 rounded-full whitespace-nowrap shadow-lg ${currentPlan === 'pro' ? 'bg-emerald-600 text-white' : 'bg-amber-500 text-slate-950'}`}>
                                {currentPlan === 'pro' ? 'PLAN ACTUEL' : '✦ RECOMMANDÉ'}
                            </span>
                        </div>

                        <div className="flex items-center gap-2 mb-2">
                            <span className="text-slate-900 dark:text-white font-bold text-lg">Pro</span>
                            {billing === 'monthly' && launchOfferActive && (
                                <span className="text-[10px] font-bold px-2 py-0.5 rounded-full border bg-amber-50 dark:bg-amber-500/20 text-amber-600 dark:text-amber-300 border-amber-200 dark:border-amber-500/30">
                                    LANCEMENT
                                </span>
                            )}
                        </div>
                        <div className="mb-3">
                            {billing === 'monthly' ? (
                                <>
                                    <span className="text-4xl font-bold text-slate-900 dark:text-white">
                                        {launchOfferActive ? '5€' : '9€'}
                                    </span>
                                    <span className="text-slate-500 dark:text-slate-400 text-sm ml-1">
                                        /mois {launchOfferActive && <span className="line-through">9€</span>}
                                    </span>
                                </>
                            ) : (
                                <>
                                    <span className="text-4xl font-bold text-slate-900 dark:text-white">90€</span>
                                    <span className="text-slate-500 dark:text-slate-400 text-sm ml-1">/an · soit 7,50€/mois</span>
                                </>
                            )}
                        </div>
                        <p className="text-slate-500 dark:text-slate-400 text-sm leading-relaxed mb-5">
                            Accès complet à toutes les fonctionnalités PulsePeak.
                        </p>

                        <ul className="space-y-2.5 flex-1 mb-6">
                            {PRO_FEATURES.map(f => (
                                <li key={f.label} className="flex items-start gap-2.5 text-sm">
                                    <Check size={14} className="text-emerald-600 dark:text-emerald-400 mt-0.5 shrink-0" />
                                    <span className="text-slate-600 dark:text-slate-300">{f.label}</span>
                                </li>
                            ))}
                        </ul>

                        {currentPlan === 'pro' ? (
                            <div className="flex items-center justify-center gap-2 bg-emerald-50 dark:bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 font-semibold py-3 rounded-xl text-sm border border-emerald-200 dark:border-emerald-500/30">
                                <Check size={14} />
                                Votre plan actuel
                            </div>
                        ) : (
                            <button
                                onClick={handleSubscribe}
                                disabled={isPending || !priceId}
                                className="flex items-center justify-center gap-2 bg-amber-600 hover:bg-amber-500 disabled:opacity-60 disabled:cursor-not-allowed text-white font-semibold py-3 rounded-xl transition-colors shadow-lg shadow-amber-900/30 text-sm"
                            >
                                <Zap size={14} />
                                {isPending ? 'Redirection…' : `Passer au Pro`}
                            </button>
                        )}
                    </div>
                </div>

                {error && (
                    <p className="text-center text-red-500 text-sm mt-4">{error}</p>
                )}

                {/* Garanties */}
                <div className="mt-10 grid grid-cols-1 sm:grid-cols-3 gap-4 text-center">
                    {[
                        { icon: Shield, label: 'Sans engagement', desc: 'Résiliez à tout moment depuis votre profil' },
                        { icon: Zap, label: 'Accès immédiat', desc: 'Disponible dès la confirmation du paiement' },
                        { icon: Crown, label: 'Paiement sécurisé', desc: 'Géré entièrement par Stripe' },
                    ].map(g => {
                        const Icon = g.icon;
                        return (
                            <div key={g.label} className="flex flex-col items-center gap-2">
                                <div className="w-9 h-9 rounded-xl bg-slate-100 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 flex items-center justify-center">
                                    <Icon size={15} className="text-slate-500 dark:text-slate-400" />
                                </div>
                                <p className="text-slate-900 dark:text-white text-sm font-semibold">{g.label}</p>
                                <p className="text-slate-500 dark:text-slate-500 text-xs">{g.desc}</p>
                            </div>
                        );
                    })}
                </div>
            </div>
        </div>
    );
}
