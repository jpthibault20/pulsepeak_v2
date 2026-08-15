import React from 'react';
import { differenceInCalendarDays } from 'date-fns';
import type { Profile } from '@/lib/data/DatabaseTypes';
import type { WorkoutPlanContext } from '@/lib/data/crud';
import { parseLocalDate } from '@/lib/utils';

/**
 * Position de la séance dans l'entraînement : plan, bloc, semaine, forme du jour.
 *
 * Ces données existaient déjà en base sans jamais apparaître dans le détail —
 * c'est ce qui fait la différence entre un reçu d'activité et une page
 * d'entraînement. Chaque ligne est masquée si la donnée manque (séance libre,
 * hors plan).
 */
export const WorkoutContextCard: React.FC<{
    context: WorkoutPlanContext | null;
    profile: Profile;
    /**
     * Date du jour, calculée côté client uniquement : rendue côté serveur, « aujourd'hui »
     * serait le fuseau du serveur (souvent UTC) et le J−x sauterait à l'hydratation.
     * `null` au premier rendu → la ligne Objectif apparaît juste après le montage.
     */
    today: string | null;
}> = ({ context, profile, today }) => {
    const ctl = Math.round(profile.currentCTL ?? 0);
    const atl = Math.round(profile.currentATL ?? 0);
    const form = ctl - atl;

    let daysToGoal: number | null = null;
    if (context?.planGoalDate && today) {
        daysToGoal = differenceInCalendarDays(parseLocalDate(context.planGoalDate), parseLocalDate(today));
        if (daysToGoal < 0) daysToGoal = null;
    }

    const hasPlanInfo = Boolean(context?.planName || context?.blockType || context?.weekNumber);
    if (!hasPlanInfo && ctl === 0 && atl === 0) return null;

    return (
        <section
            aria-labelledby="context-title"
            className="rounded-2xl bg-white dark:bg-slate-800/60 border border-slate-200/80 dark:border-slate-700/50 overflow-hidden"
        >
            <h2 id="context-title" className="px-4 py-3 text-[10px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider border-b border-slate-200/80 dark:border-slate-700/50">
                Contexte
            </h2>

            <dl className="px-4 py-3 flex flex-col gap-2 text-xs">
                {context?.planName && <Row label="Plan" value={context.planName} />}
                {context?.blockType && (
                    <Row
                        label="Bloc"
                        value={
                            context.blockOrderIndex != null && context.blockWeekCount != null
                                ? `${context.blockTheme || context.blockType} (${context.blockOrderIndex + 1}/${context.blockWeekCount})`
                                : (context.blockTheme || context.blockType)
                        }
                    />
                )}
                {context?.weekNumber != null && (
                    <Row
                        label="Semaine"
                        value={
                            context.weekTargetTSS
                                ? `${context.weekNumber} · ${Math.round(context.weekTargetTSS)} TSS`
                                : `${context.weekNumber}`
                        }
                    />
                )}
                {daysToGoal != null && (
                    <Row label="Objectif" value={daysToGoal === 0 ? "Aujourd'hui" : `J−${daysToGoal}`} highlight />
                )}
            </dl>

            {(ctl > 0 || atl > 0) && (
                <div className="px-4 py-3 border-t border-slate-200/80 dark:border-slate-700/50 flex items-center justify-between gap-2">
                    <div className="flex items-center gap-3 text-xs">
                        <span className="text-slate-500 dark:text-slate-400">
                            CTL <strong className="font-mono tabular-nums text-slate-900 dark:text-white">{ctl}</strong>
                        </span>
                        <span className="text-slate-500 dark:text-slate-400">
                            ATL <strong className="font-mono tabular-nums text-slate-900 dark:text-white">{atl}</strong>
                        </span>
                    </div>
                    <span className={`text-xs font-semibold tabular-nums ${
                        form >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-amber-600 dark:text-amber-400'
                    }`}>
                        Forme {form > 0 ? '+' : ''}{form}
                    </span>
                </div>
            )}
        </section>
    );
};

const Row: React.FC<{ label: string; value: string; highlight?: boolean }> = ({ label, value, highlight }) => (
    <div className="flex items-baseline justify-between gap-3">
        <dt className="text-slate-500 dark:text-slate-400 shrink-0">{label}</dt>
        <dd className={`text-right truncate font-medium ${highlight ? 'text-indigo-600 dark:text-indigo-400' : 'text-slate-900 dark:text-white'}`}>
            {value}
        </dd>
    </div>
);
