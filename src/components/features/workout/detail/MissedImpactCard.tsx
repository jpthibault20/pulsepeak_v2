'use client';

import React from 'react';
import { Info, CalendarDays, CheckCircle } from 'lucide-react';
import type { Workout } from '@/lib/data/DatabaseTypes';
import type { WorkoutPlanContext } from '@/lib/data/crud';

/**
 * Conséquence d'une séance ratée, avec deux sorties.
 *
 * Auparavant une séance ratée était un cul-de-sac : badge rouge et aucune
 * action de rattrapage. Le ton reste factuel — on informe de l'impact, on
 * propose de replanifier ou de requalifier. Pas de rouge : il est réservé aux
 * actions destructives.
 */
export const MissedImpactCard: React.FC<{
    workout: Workout;
    context: WorkoutPlanContext | null;
    onReschedule: () => void;
    onMarkDone: () => void;
    disabled?: boolean;
}> = ({ workout, context, onReschedule, onMarkDone, disabled }) => {
    const missedTSS = workout.plannedData?.plannedTSS ?? null;
    const target = context?.weekTargetTSS ?? null;
    const actual = context?.weekActualTSS ?? null;

    return (
        <section
            aria-labelledby="missed-title"
            className="p-4 rounded-2xl bg-slate-50 dark:bg-slate-800/40 border border-slate-200/80 dark:border-slate-700/50"
        >
            <div className="flex items-start gap-3">
                <div className="flex items-center justify-center w-8 h-8 rounded-xl bg-slate-200/70 dark:bg-slate-700/60 shrink-0" aria-hidden="true">
                    <Info size={16} className="text-slate-600 dark:text-slate-300" />
                </div>
                <div className="flex-1 min-w-0">
                    <h2 id="missed-title" className="text-sm font-bold text-slate-900 dark:text-white">
                        {missedTSS
                            ? <>Cette séance manque <span className="tabular-nums">{Math.round(missedTSS)}</span> TSS à ta semaine</>
                            : <>Cette séance n&apos;a pas été réalisée</>}
                    </h2>
                    {target != null && actual != null && (
                        <p className="mt-1 text-xs text-slate-600 dark:text-slate-400 tabular-nums">
                            {Math.round(actual)} TSS réalisés sur {Math.round(target)} prévus
                            {context?.weekNumber != null && ` · semaine ${context.weekNumber}`}
                        </p>
                    )}
                </div>
            </div>

            <div className="mt-4 flex flex-col sm:flex-row gap-2">
                <button
                    onClick={onReschedule}
                    disabled={disabled}
                    className="flex-1 h-11 flex items-center justify-center gap-2 rounded-xl text-sm font-medium text-slate-700 dark:text-slate-200 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors disabled:opacity-40"
                >
                    <CalendarDays size={15} aria-hidden="true" />
                    Replanifier
                </button>
                <button
                    onClick={onMarkDone}
                    disabled={disabled}
                    className="flex-1 h-11 flex items-center justify-center gap-2 rounded-xl text-sm font-medium text-emerald-700 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-500/10 border border-emerald-200 dark:border-emerald-500/20 hover:bg-emerald-100 dark:hover:bg-emerald-500/20 transition-colors disabled:opacity-40"
                >
                    <CheckCircle size={15} aria-hidden="true" />
                    Je l&apos;ai finalement faite
                </button>
            </div>
        </section>
    );
};
