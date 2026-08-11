import React from 'react';
import Link from 'next/link';
import { Coffee, Plus, ChevronRight } from 'lucide-react';
import type { Workout, Profile } from '@/lib/data/DatabaseTypes';
import type { WorkoutNeighbour } from '@/lib/data/crud';
import { formatDate } from '@/lib/utils';
import { SPORT_CONFIG, fmtDuration } from './shared';

/**
 * Jour de repos.
 *
 * Auparavant toute la barre d'actions était masquée pour `Rest` : la vue
 * devenait un écran vide sans issue. On garde la sobriété (pas de dégradé
 * sport, pas de CTA vert) mais on donne une information réelle et une sortie.
 */
export const RestDayView: React.FC<{
    workout: Workout;
    profile: Profile;
    nextWorkout: (WorkoutNeighbour & { durationMinutes?: number | null; plannedTSS?: number | null }) | null;
    /** Query (`?from=…&month=…&day=…`) à conserver en passant à la séance suivante */
    seanceQuery: string;
}> = ({ workout, profile, nextWorkout, seanceQuery }) => {
    const atl = Math.round(profile.currentATL ?? 0);
    // Décroissance ATL sur un jour sans charge (constante de temps 7 jours).
    const atlTomorrow = Math.round(atl * Math.exp(-1 / 7));

    const nextCfg = nextWorkout ? (SPORT_CONFIG[nextWorkout.sportType] ?? SPORT_CONFIG.other) : null;
    const NextIcon = nextCfg?.icon;

    return (
        <div className="rounded-2xl bg-slate-50/60 dark:bg-slate-900/30 border border-slate-200/80 dark:border-slate-800 px-6 py-10 text-center">
            <Coffee size={40} className="mx-auto mb-5 text-slate-300 dark:text-slate-700" aria-hidden="true" />

            <h1 tabIndex={-1} className="text-xl font-bold text-slate-900 dark:text-white outline-none">
                Journée de repos
            </h1>
            <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">{formatDate(workout.date)}</p>

            {atl > 0 && (
                <p className="mt-5 mx-auto max-w-md text-sm text-slate-600 dark:text-slate-300 leading-relaxed">
                    Repos complet. Ta fatigue descend de{' '}
                    <strong className="font-mono tabular-nums text-slate-900 dark:text-white">{atl}</strong> à{' '}
                    <strong className="font-mono tabular-nums text-slate-900 dark:text-white">{atlTomorrow}</strong> —
                    c&apos;est là que l&apos;adaptation se fait.
                </p>
            )}

            {nextWorkout && NextIcon && (
                <Link
                    href={`/seance/${nextWorkout.id}${seanceQuery}`}
                    className="mt-7 mx-auto max-w-md flex items-center gap-3 px-4 py-3 rounded-xl bg-white dark:bg-slate-800/60 border border-slate-200/80 dark:border-slate-700/50 hover:border-slate-300 dark:hover:border-slate-600 transition-colors text-left"
                >
                    <div className="flex-1 min-w-0">
                        <p className="text-[10px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-1">
                            Prochaine séance
                        </p>
                        <p className="flex items-center gap-2 text-sm text-slate-900 dark:text-white truncate">
                            <NextIcon size={14} className={nextCfg.color} aria-hidden="true" />
                            <span className="truncate">{formatDate(nextWorkout.date)} · {nextWorkout.title}</span>
                        </p>
                        {nextWorkout.durationMinutes && (
                            <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400 tabular-nums">
                                {fmtDuration(nextWorkout.durationMinutes)}
                                {nextWorkout.plannedTSS ? ` · ${Math.round(nextWorkout.plannedTSS)} TSS` : ''}
                            </p>
                        )}
                    </div>
                    <ChevronRight size={16} className="shrink-0 text-slate-400" aria-hidden="true" />
                </Link>
            )}

            <Link
                href={`/?jour=${workout.date}`}
                className="mt-6 inline-flex items-center justify-center gap-2 h-11 px-5 rounded-xl text-sm font-medium text-slate-700 dark:text-slate-200 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors"
            >
                <Plus size={15} aria-hidden="true" />
                Ajouter une séance ce jour-là
            </Link>
        </div>
    );
};
