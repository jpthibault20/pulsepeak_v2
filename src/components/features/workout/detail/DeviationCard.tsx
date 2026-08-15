'use client';

import React, { useState } from 'react';
import {
    RefreshCw, Sparkles, ChevronDown, ChevronUp,
    BatteryLow, ArrowUpRight, Loader2,
} from 'lucide-react';
import type { DeviationMetrics } from '@/lib/data/type';
import { regenerateWeekFromDeviation } from '@/app/actions/schedule/workout-ai';

/**
 * Signal de déviation (fatigue / superforme) détecté sur une séance réalisée.
 *
 * La déviation est résolue CÔTÉ SERVEUR et passée en prop : le calcul écrit en
 * base (cache `aiDeviationCache`) et le faire au montage rejouait un UPDATE à
 * chaque remontage de l'arbre — ce que `router.refresh()` provoque. Ici le
 * composant est purement présentationnel et la carte s'affiche sans flash.
 */
export const DeviationCard: React.FC<{
    workoutId: string;
    deviation: DeviationMetrics | null;
    onAdaptationComplete?: () => void;
}> = ({ workoutId, deviation, onAdaptationComplete }) => {
    const [showAdaptation, setShowAdaptation] = useState(false);
    const [adaptLevel, setAdaptLevel] = useState<'conservative' | 'recommended' | 'ambitious'>('recommended');
    const [adapting, setAdapting] = useState(false);
    const [adaptResult, setAdaptResult] = useState<{ updatedCount: number } | null>(null);
    const [detailsExpanded, setDetailsExpanded] = useState(false);

    const handleAdapt = async () => {
        setAdapting(true);
        try {
            const result = await regenerateWeekFromDeviation(workoutId, adaptLevel);
            setAdaptResult(result);
            onAdaptationComplete?.();
        } catch (e) {
            console.error(e);
        } finally {
            setAdapting(false);
        }
    };

    if (!deviation || deviation.signal === 'normal') return null;

    const isFatigue = deviation.signal === 'fatigue';
    const isCritical = deviation.severity === 'critical';

    const bgClass = isFatigue
        ? 'from-amber-50 via-orange-50/50 to-amber-50 dark:from-amber-500/10 dark:via-orange-500/5 dark:to-amber-500/5'
        : 'from-teal-50 via-cyan-50/50 to-teal-50 dark:from-teal-500/10 dark:via-cyan-500/5 dark:to-teal-500/5';
    const borderClass = isFatigue
        ? 'border-amber-200/80 dark:border-amber-500/25'
        : 'border-teal-200/80 dark:border-teal-500/25';
    const iconBgClass = isFatigue
        ? 'bg-amber-100 dark:bg-amber-500/20'
        : 'bg-teal-100 dark:bg-teal-500/20';
    const iconColorClass = isFatigue
        ? 'text-amber-600 dark:text-amber-400'
        : 'text-teal-600 dark:text-teal-400';
    const headlineClass = isFatigue
        ? 'text-amber-800 dark:text-amber-300'
        : 'text-teal-800 dark:text-teal-300';
    const SignalIcon = isFatigue ? BatteryLow : ArrowUpRight;

    return (
        <section
            aria-labelledby="deviation-title"
            className={`p-4 rounded-2xl bg-gradient-to-br ${bgClass} border ${borderClass} animate-in fade-in duration-300 motion-reduce:animate-none`}
        >
            {/* En-tête */}
            <div className="flex items-start gap-3 mb-3">
                <div className={`flex items-center justify-center w-8 h-8 rounded-xl ${iconBgClass} shrink-0`} aria-hidden="true">
                    <SignalIcon size={16} className={iconColorClass} />
                </div>
                <div className="flex-1 min-w-0">
                    <h2 id="deviation-title" className={`text-sm font-bold ${headlineClass}`}>
                        {deviation.headline}
                    </h2>
                    <p className="text-xs text-slate-600 dark:text-slate-400 mt-1 leading-relaxed">
                        {deviation.adaptationReason}
                    </p>
                </div>
                {isCritical && (
                    <span className={`shrink-0 px-2 py-0.5 rounded-full text-[10px] font-bold ${
                        isFatigue ? 'bg-amber-200 dark:bg-amber-500/30 text-amber-800 dark:text-amber-300'
                                  : 'bg-teal-200 dark:bg-teal-500/30 text-teal-800 dark:text-teal-300'
                    }`}>
                        {isFatigue ? 'Important' : 'Significatif'}
                    </span>
                )}
            </div>

            {/* Détails repliables */}
            {deviation.details.length > 0 && (
                <div className="mb-3">
                    <button
                        onClick={() => setDetailsExpanded(!detailsExpanded)}
                        aria-expanded={detailsExpanded}
                        className="flex items-center gap-1 min-h-11 text-xs font-medium text-slate-600 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200 transition-colors"
                    >
                        {detailsExpanded ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
                        {detailsExpanded ? 'Masquer les détails' : `Voir les détails (${deviation.details.length} signaux)`}
                    </button>
                    {detailsExpanded && (
                        <div className="mt-2 space-y-1.5 animate-in slide-in-from-top-1 duration-200 motion-reduce:animate-none">
                            {deviation.details.map((detail, i) => (
                                <div key={i} className="flex items-start gap-2 text-xs text-slate-600 dark:text-slate-400">
                                    <span className={`mt-1 w-1.5 h-1.5 rounded-full shrink-0 ${
                                        isFatigue ? 'bg-amber-400' : 'bg-teal-400'
                                    }`} />
                                    {detail}
                                </div>
                            ))}
                            {deviation.aerobicDecoupling !== null && (
                                <div className="flex items-start gap-2 text-xs text-slate-600 dark:text-slate-500">
                                    <span className="mt-1 w-1.5 h-1.5 rounded-full shrink-0 bg-slate-300" />
                                    Découplage aérobie : {deviation.aerobicDecoupling}%
                                    {deviation.aerobicDecoupling > 5 ? ' (endurance de base à travailler)' : deviation.aerobicDecoupling < 3 ? ' (bonne base aérobie)' : ''}
                                </div>
                            )}
                            {deviation.fadeRate !== null && deviation.fadeRate > 3 && (
                                <div className="flex items-start gap-2 text-xs text-slate-600 dark:text-slate-500">
                                    <span className="mt-1 w-1.5 h-1.5 rounded-full shrink-0 bg-slate-300" />
                                    Fade rate : {deviation.fadeRate}%
                                    {deviation.fadeRate > 8 ? ' (fatigue musculaire marquée)' : ' (acceptable)'}
                                </div>
                            )}
                            {deviation.cardiacCost !== null && (
                                <div className="flex items-start gap-2 text-xs text-slate-600 dark:text-slate-500">
                                    <span className="mt-1 w-1.5 h-1.5 rounded-full shrink-0 bg-slate-300" />
                                    Coût cardiaque : {deviation.cardiacCost} bpm/W
                                </div>
                            )}
                        </div>
                    )}
                </div>
            )}

            {/* Résultat de l'adaptation */}
            {adaptResult && (
                <div
                    role="status"
                    aria-live="polite"
                    className="mb-3 px-3 py-2 rounded-xl bg-emerald-50 dark:bg-emerald-500/10 border border-emerald-200 dark:border-emerald-500/20 animate-in slide-in-from-top-2 duration-200 motion-reduce:animate-none"
                >
                    <p className="text-xs font-medium text-emerald-700 dark:text-emerald-400">
                        {adaptResult.updatedCount > 0
                            ? `${adaptResult.updatedCount} séance${adaptResult.updatedCount > 1 ? 's' : ''} adaptée${adaptResult.updatedCount > 1 ? 's' : ''} pour le reste de la semaine.`
                            : 'Aucune séance à adapter cette semaine.'}
                    </p>
                </div>
            )}

            {/* CTA : adapter la semaine */}
            {!adaptResult && !showAdaptation && (
                <button
                    onClick={() => setShowAdaptation(true)}
                    className={`w-full flex items-center justify-center gap-2 px-4 py-2.5 min-h-11 rounded-xl text-sm font-medium border transition-colors ${
                        isFatigue
                            ? 'text-amber-700 dark:text-amber-300 bg-white/60 dark:bg-slate-900/30 border-amber-200 dark:border-amber-500/20 hover:bg-amber-100 dark:hover:bg-amber-500/15'
                            : 'text-teal-700 dark:text-teal-300 bg-white/60 dark:bg-slate-900/30 border-teal-200 dark:border-teal-500/20 hover:bg-teal-100 dark:hover:bg-teal-500/15'
                    }`}
                >
                    <RefreshCw size={14} />
                    Voir la semaine adaptée
                </button>
            )}

            {/* Panneau d'adaptation */}
            {showAdaptation && !adaptResult && (
                <div className="mt-1 animate-in slide-in-from-top-2 duration-200 motion-reduce:animate-none">
                    <p className="text-xs font-medium text-slate-600 dark:text-slate-300 mb-2.5">Niveau d&apos;adaptation :</p>
                    <div className="grid grid-cols-3 gap-2 mb-3">
                        {(['conservative', 'recommended', 'ambitious'] as const).map(level => {
                            const labels = {
                                conservative: { name: 'Léger', desc: '~10%' },
                                recommended: { name: 'Recommandé', desc: '~20%' },
                                ambitious: { name: 'Fort', desc: '~30%' },
                            };
                            const isSelected = adaptLevel === level;
                            return (
                                <button
                                    key={level}
                                    onClick={() => setAdaptLevel(level)}
                                    aria-pressed={isSelected}
                                    className={`flex flex-col items-center justify-center gap-0.5 px-3 py-2 min-h-11 rounded-xl text-xs border transition-all ${
                                        isSelected
                                            ? isFatigue
                                                ? 'bg-amber-100 dark:bg-amber-500/20 border-amber-300 dark:border-amber-500/40 text-amber-800 dark:text-amber-300 font-bold'
                                                : 'bg-teal-100 dark:bg-teal-500/20 border-teal-300 dark:border-teal-500/40 text-teal-800 dark:text-teal-300 font-bold'
                                            : 'bg-white/40 dark:bg-slate-900/20 border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-400'
                                    }`}
                                >
                                    <span>{labels[level].name}</span>
                                    <span className="text-[10px] opacity-60">{labels[level].desc}</span>
                                </button>
                            );
                        })}
                    </div>
                    <div className="flex gap-2">
                        <button
                            onClick={() => setShowAdaptation(false)}
                            className="flex-1 px-3 py-2 min-h-11 text-xs text-slate-600 hover:text-slate-800 dark:hover:text-slate-200 rounded-xl transition-colors"
                            disabled={adapting}
                        >
                            Annuler
                        </button>
                        <button
                            onClick={handleAdapt}
                            disabled={adapting}
                            className={`flex-1 flex items-center justify-center gap-2 px-4 py-2 min-h-11 rounded-xl text-xs font-bold text-white transition-colors disabled:opacity-60 ${
                                isFatigue
                                    ? 'bg-amber-500 hover:bg-amber-600 dark:bg-amber-600 dark:hover:bg-amber-500'
                                    : 'bg-teal-500 hover:bg-teal-600 dark:bg-teal-600 dark:hover:bg-teal-500'
                            }`}
                        >
                            {adapting ? (
                                <>
                                    <Loader2 size={14} className="animate-spin" />
                                    Adaptation en cours...
                                </>
                            ) : (
                                <>
                                    <Sparkles size={14} />
                                    Adapter ma semaine
                                </>
                            )}
                        </button>
                    </div>
                </div>
            )}
        </section>
    );
};
