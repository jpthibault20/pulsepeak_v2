import React from 'react';
import { ArrowRight, TrendingUp, TrendingDown, Equal } from 'lucide-react';
import type { Workout } from '@/lib/data/DatabaseTypes';
import { getWorkoutTSS } from '@/lib/stats/computeTSS';
import { fmtDuration } from './shared';

interface Row {
    label: string;
    planned: string;
    actual: string;
    deltaPct: number;
}

/**
 * Comparatif « ai-je tenu le contrat ? ».
 *
 * Avant, les cibles du plan disparaissaient dès que la séance passait en
 * réalisée : l'athlète perdait la seule information qui donne du sens aux
 * chiffres bruts. On ne montre que les lignes où les deux valeurs existent.
 */
export const PlannedVsActual: React.FC<{ workout: Workout }> = ({ workout }) => {
    const p = workout.plannedData;
    const c = workout.completedData;
    if (!p || !c) return null;

    const rows: Row[] = [];

    const addRow = (
        label: string,
        plannedVal: number | null | undefined,
        actualVal: number | null | undefined,
        fmt: (n: number) => string,
    ) => {
        if (plannedVal == null || actualVal == null) return;
        if (plannedVal <= 0 || actualVal <= 0) return;
        rows.push({
            label,
            planned: fmt(plannedVal),
            actual: fmt(actualVal),
            deltaPct: ((actualVal - plannedVal) / plannedVal) * 100,
        });
    };

    const actualTSS = getWorkoutTSS(workout);

    addRow('Durée', p.durationMinutes, c.actualDurationMinutes, fmtDuration);
    addRow('TSS', p.plannedTSS, actualTSS > 0 ? actualTSS : null, (n) => `${Math.round(n)}`);
    addRow('Distance', p.distanceKm, c.distanceKm, (n) => `${n.toFixed(1)} km`);

    if (rows.length === 0) return null;

    return (
        <section
            aria-labelledby="pva-title"
            className="rounded-2xl bg-white dark:bg-slate-800/60 border border-slate-200/80 dark:border-slate-700/50 overflow-hidden"
        >
            <div className="px-4 py-3 border-b border-slate-200/80 dark:border-slate-700/50">
                <h2 id="pva-title" className="text-[10px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider flex items-center gap-1.5">
                    Prévu <ArrowRight size={11} aria-hidden="true" /> Réalisé
                </h2>
            </div>

            <div className="divide-y divide-slate-200/70 dark:divide-slate-700/40">
                {rows.map((r) => {
                    // Sous 3% d'écart, on considère le contrat tenu : afficher un
                    // « +1% » en couleur ferait passer du bruit pour du signal.
                    const isNeutral = Math.abs(r.deltaPct) < 3;
                    const isOver = r.deltaPct > 0;
                    const DeltaIcon = isNeutral ? Equal : isOver ? TrendingUp : TrendingDown;
                    const deltaColor = isNeutral
                        ? 'text-slate-500 dark:text-slate-400'
                        : isOver
                            ? 'text-amber-600 dark:text-amber-400'
                            : 'text-slate-600 dark:text-slate-300';

                    return (
                        <div key={r.label} className="grid grid-cols-[1fr_auto_auto_5.5rem] items-center gap-3 px-4 py-2.5">
                            <span className="text-xs font-medium text-slate-600 dark:text-slate-400">{r.label}</span>
                            <span className="font-mono tabular-nums text-xs text-slate-500 dark:text-slate-400">{r.planned}</span>
                            <span className="font-mono tabular-nums text-sm font-bold text-slate-900 dark:text-white">{r.actual}</span>
                            <span className={`flex items-center justify-end gap-1 text-[11px] font-semibold tabular-nums ${deltaColor}`}>
                                <DeltaIcon size={11} aria-hidden="true" />
                                {isNeutral ? 'conforme' : `${isOver ? '+' : ''}${Math.round(r.deltaPct)}%`}
                            </span>
                        </div>
                    );
                })}
            </div>
        </section>
    );
};
