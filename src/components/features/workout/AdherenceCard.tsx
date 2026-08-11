'use client';

import React from 'react';
import { CheckCircle2, TrendingDown, TrendingUp, CircleSlash } from 'lucide-react';
import type { SportType } from '@/lib/data/type';
import type { Workout } from '@/lib/data/DatabaseTypes';
import { computeAdherence, type AdherenceAxis, type AdherenceVerdict } from '@/lib/structure/adherence';
import { isStructureTrustworthy } from '@/lib/structure/normalize';

const VERDICT_STYLE: Record<Exclude<AdherenceVerdict, 'inconnu'>, { icon: React.ElementType; chip: string; bar: string }> = {
    respecte: {
        icon: CheckCircle2,
        chip: 'bg-emerald-100 dark:bg-emerald-500/15 text-emerald-800 dark:text-emerald-300 border-emerald-200/70 dark:border-emerald-500/25',
        bar: 'bg-emerald-500',
    },
    durci: {
        icon: TrendingUp,
        chip: 'bg-amber-100 dark:bg-amber-500/15 text-amber-800 dark:text-amber-300 border-amber-200/70 dark:border-amber-500/25',
        bar: 'bg-amber-500',
    },
    allege: {
        icon: TrendingDown,
        chip: 'bg-sky-100 dark:bg-sky-500/15 text-sky-800 dark:text-sky-300 border-sky-200/70 dark:border-sky-500/25',
        bar: 'bg-sky-500',
    },
    partiel: {
        icon: CircleSlash,
        chip: 'bg-slate-100 dark:bg-slate-700/40 text-slate-700 dark:text-slate-200 border-slate-200/70 dark:border-slate-600/40',
        bar: 'bg-slate-400',
    },
};

function fmtMinutes(seconds: number | null): string {
    if (seconds == null) return '—';
    return `${Math.round(seconds / 60)} min`;
}

/** L'intensité est stockée en watts (vélo) ou en m/s : on la rend dans l'unité du sport. */
function fmtIntensity(value: number | null, sport: SportType): string {
    if (value == null || value <= 0) return '—';
    if (sport === 'cycling') return `${Math.round(value)} W`;

    const secondsPerUnit = sport === 'swimming' ? 100 / value : 1000 / value;
    const m = Math.floor(secondsPerUnit / 60);
    const s = Math.round(secondsPerUnit % 60);
    const pace = s === 60 ? `${m + 1}:00` : `${m}:${String(s).padStart(2, '0')}`;
    return sport === 'swimming' ? `${pace}/100m` : `${pace}/km`;
}

const AxisRow: React.FC<{
    label: string;
    axis: AdherenceAxis;
    format: (v: number | null) => string;
}> = ({ label, axis, format }) => {
    if (axis.deltaPct == null) return null;

    const delta = Math.round(axis.deltaPct * 100);
    const off = Math.abs(axis.deltaPct) > 0.1;

    return (
        <div className="flex items-baseline justify-between gap-3 py-1.5 border-t border-slate-200/60 dark:border-slate-700/40 first:border-t-0">
            <span className="text-xs font-medium text-slate-500 dark:text-slate-400 shrink-0">{label}</span>
            <span className="flex items-baseline gap-2 tabular-nums">
                <span className="text-xs text-slate-400 dark:text-slate-500">{format(axis.plannedValue)}</span>
                <span className="text-slate-300 dark:text-slate-600">→</span>
                <span className="text-sm font-semibold text-slate-900 dark:text-white">{format(axis.actualValue)}</span>
                <span className={`text-xs font-semibold ${off ? 'text-amber-700 dark:text-amber-400' : 'text-emerald-700 dark:text-emerald-400'}`}>
                    {delta > 0 ? '+' : ''}{delta} %
                </span>
            </span>
        </div>
    );
};

/**
 * Confronte la séance prescrite à ce qui a été réalisé.
 *
 * Ne s'affiche que si la prescription est exploitable : une séance générée avant
 * l'inversion du pipeline peut porter des durées calculées plutôt que prescrites,
 * et juger le réalisé sur cette base reviendrait à reprocher à l'athlète un écart
 * qui n'existe pas.
 */
export const AdherenceCard: React.FC<{ workout: Workout }> = ({ workout }) => {
    const planned = workout.plannedData;
    const completed = workout.completedData;

    if (!planned || !completed) return null;
    if (!isStructureTrustworthy(planned.structure, planned.durationMinutes)) return null;

    const report = computeAdherence({
        structure: planned.structure,
        sport: workout.sportType,
        laps: completed.laps ?? [],
        actualDurationSeconds: completed.actualDurationMinutes != null
            ? Math.round(completed.actualDurationMinutes * 60)
            : null,
    });

    if (report.verdict === 'inconnu') return null;

    const style = VERDICT_STYLE[report.verdict];
    const Icon = style.icon;

    return (
        <section
            aria-labelledby="adherence-title"
            className="p-4 rounded-2xl bg-white dark:bg-slate-800/40 border border-slate-200/80 dark:border-slate-700/50"
        >
            <div className="flex items-center justify-between gap-3 flex-wrap mb-3">
                <h2 id="adherence-title" className="text-sm font-bold text-slate-900 dark:text-white flex items-center gap-2">
                    <Icon size={15} className="text-slate-400" />
                    {report.headline}
                </h2>
                <span className={`inline-flex items-center px-2 py-0.5 rounded-md text-xs font-bold tabular-nums border ${style.chip}`}>
                    {report.score}/100
                </span>
            </div>

            <div className="h-1.5 rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden mb-3">
                <div className={`h-full ${style.bar}`} style={{ width: `${report.score}%` }} aria-hidden />
            </div>

            <div className="mb-3">
                <AxisRow label="Durée" axis={report.duration} format={fmtMinutes} />
                <AxisRow label="Temps de travail" axis={report.workVolume} format={fmtMinutes} />
                <AxisRow
                    label="Intensité de travail"
                    axis={report.intensity}
                    format={(v) => fmtIntensity(v, workout.sportType)}
                />
            </div>

            <ul className="space-y-1">
                {report.details.map((d, i) => (
                    <li key={i} className="text-xs text-slate-600 dark:text-slate-300 leading-snug flex gap-2">
                        <span className="text-slate-300 dark:text-slate-600 shrink-0">·</span>
                        {d}
                    </li>
                ))}
            </ul>
        </section>
    );
};
