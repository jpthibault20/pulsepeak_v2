'use client';

import React from 'react';
import { useRouter } from 'next/navigation';
import { Lock, Zap, ArrowRight, Check } from 'lucide-react';
import { useSubscription, isFreePlan } from '@/lib/subscription/context';

interface FreePlanGateProps {
    children: React.ReactNode;
    featureLabel: string;   // ex: "Calendrier d'entraînement"
    featureDesc?: string;   // sous-titre optionnel
}

const PRO_HIGHLIGHTS = [
    'Générations de plan IA illimitées',
    'Coach IA disponible 24/7',
    'Calendrier d\'entraînement complet',
    'Stats avancées & analyse de performance',
    'Synchronisation Strava',
];

export function FreePlanGate({ children, featureLabel, featureDesc }: FreePlanGateProps) {
    const { plan, role } = useSubscription();
    const router = useRouter();

    if (!isFreePlan(plan, role)) {
        return <>{children}</>;
    }

    return (
        <div className="flex items-center justify-center min-h-[65vh] px-4 py-8 animate-in fade-in duration-300">
            <div className="w-full max-w-md">

                {/* Icône */}
                <div className="flex justify-center mb-6">
                    <div className="w-20 h-20 rounded-2xl bg-linear-to-br from-amber-600/20 to-amber-800/10 border border-amber-200 dark:border-amber-500/20 flex items-center justify-center shadow-xl shadow-amber-900/10">
                        <Lock size={34} className="text-amber-600 dark:text-amber-400" />
                    </div>
                </div>

                {/* Titre */}
                <div className="text-center mb-8">
                    <h2 className="text-2xl font-bold text-slate-900 dark:text-white mb-2">{featureLabel}</h2>
                    <p className="text-slate-500 dark:text-slate-400 text-sm leading-relaxed">
                        {featureDesc ?? 'Cette fonctionnalité est réservée aux abonnés PulsePeak.'}
                    </p>
                </div>

                {/* Carte plan Pro */}
                <div className="bg-white dark:bg-slate-900 border border-amber-200 dark:border-amber-500/25 rounded-2xl p-5 mb-4 shadow-xl shadow-black/20">
                    <div className="flex items-start justify-between mb-4">
                        <div>
                            <div className="flex items-center gap-2 mb-1">
                                <span className="text-slate-900 dark:text-white font-bold text-lg">Plan Pro</span>
                            </div>
                            <p className="text-slate-500 text-xs">Accès complet · Sans engagement</p>
                        </div>
                        <div className="text-right">
                            <span className="text-3xl font-bold text-slate-900 dark:text-white">5€</span>
                            <span className="text-slate-500 dark:text-slate-400 text-sm">/mois</span>
                        </div>
                    </div>

                    <ul className="space-y-2 mb-5">
                        {PRO_HIGHLIGHTS.map(h => (
                            <li key={h} className="flex items-center gap-2.5 text-sm text-slate-600 dark:text-slate-300">
                                <Check size={13} className="text-emerald-600 dark:text-emerald-400 shrink-0" />
                                {h}
                            </li>
                        ))}
                    </ul>

                    <button
                        onClick={() => router.push('/pricing')}
                        className="w-full flex items-center justify-center gap-2 bg-amber-600 hover:bg-amber-500 text-white font-semibold py-3.5 rounded-xl transition-colors shadow-lg shadow-amber-900/30 text-sm"
                    >
                        <Zap size={15} />
                        Voir les offres
                        <ArrowRight size={15} />
                    </button>
                </div>

                {/* Plan gratuit mention */}
                <p className="text-center text-slate-500 dark:text-slate-600 text-xs">
                    Vous êtes sur le plan <span className="text-slate-500 font-medium">Gratuit</span> · Aucune fonctionnalité disponible
                </p>
            </div>
        </div>
    );
}
