'use client';

import React, { useState } from 'react';
import { Loader2, Minus, Plus } from 'lucide-react';
import { updateWorkoutRPE } from '@/app/actions/schedule/workout-actions';

const RPE_COLORS = ['', 'bg-emerald-400', 'bg-emerald-400', 'bg-green-400', 'bg-lime-400', 'bg-yellow-400', 'bg-amber-400', 'bg-orange-400', 'bg-orange-500', 'bg-red-500', 'bg-red-600'];

// Libellé lu par les lecteurs d'écran : annoncer « 7 » sans échelle est inutile.
const RPE_WORDS = ['', 'très facile', 'très facile', 'facile', 'modéré', 'modéré', 'soutenu', 'difficile', 'très difficile', 'maximal', 'maximal'];

/**
 * Saisie rapide du RPE pour une séance importée sans ressenti.
 * C'est la donnée qui alimente l'analyse de déviation : tant qu'elle manque,
 * toute l'intelligence en aval est aveugle — d'où sa position en tête de page.
 */
export const RPEQuickInput: React.FC<{
    workoutId: string;
    onSaved: () => void;
}> = ({ workoutId, onSaved }) => {
    const [rpe, setRpe] = useState(5);
    const [saving, setSaving] = useState(false);

    const handleSave = async () => {
        setSaving(true);
        try { await updateWorkoutRPE(workoutId, rpe); onSaved(); }
        catch (e) { console.error(e); }
        finally { setSaving(false); }
    };

    return (
        <section
            aria-labelledby="rpe-title"
            className="p-4 rounded-2xl bg-slate-50 dark:bg-slate-800/40 border border-slate-200/60 dark:border-slate-700/40"
        >
            <div className="flex items-center justify-between gap-3 mb-3">
                <h2 id="rpe-title" className="text-xs font-medium text-slate-700 dark:text-slate-300">
                    Comment as-tu ressenti cette séance ?
                </h2>
                <div className="flex items-center gap-1.5 shrink-0">
                    <span className={`w-2 h-2 rounded-full ${RPE_COLORS[rpe]}`} aria-hidden="true" />
                    <span className="text-sm font-bold font-mono text-slate-900 dark:text-white">
                        {rpe}<span className="text-[10px] font-normal text-slate-500 dark:text-slate-400">/10</span>
                    </span>
                </div>
            </div>

            {/* Boutons ±  : 44×44 minimum (WCAG 2.5.5), le visuel reste un cercle de 28px */}
            <div className="flex items-center gap-1 mb-3">
                <button
                    type="button"
                    onClick={() => setRpe((r) => Math.max(1, r - 1))}
                    disabled={rpe <= 1}
                    aria-label="Diminuer le RPE"
                    className="shrink-0 w-11 h-11 flex items-center justify-center text-slate-700 dark:text-slate-200 transition-colors disabled:opacity-40 disabled:cursor-not-allowed group"
                >
                    <span className="w-7 h-7 flex items-center justify-center rounded-full bg-white dark:bg-slate-700 border border-slate-200 dark:border-slate-600 group-hover:bg-slate-100 dark:group-hover:bg-slate-600 transition-colors">
                        <Minus size={14} />
                    </span>
                </button>
                <div className="flex-1 flex flex-col gap-1.5 min-w-0">
                    <input
                        type="range"
                        min={1}
                        max={10}
                        step={1}
                        value={rpe}
                        aria-label="Effort perçu"
                        aria-valuetext={`${rpe} sur 10, ${RPE_WORDS[rpe]}`}
                        onChange={(e) => setRpe(Number(e.target.value))}
                        className="w-full h-1.5 rounded-full appearance-none cursor-pointer accent-slate-600 dark:accent-slate-400 bg-slate-200 dark:bg-slate-700"
                    />
                    <div className="flex justify-between text-[10px] text-slate-500 dark:text-slate-500 px-0.5">
                        <span>Facile</span>
                        <span>Difficile</span>
                    </div>
                </div>
                <button
                    type="button"
                    onClick={() => setRpe((r) => Math.min(10, r + 1))}
                    disabled={rpe >= 10}
                    aria-label="Augmenter le RPE"
                    className="shrink-0 w-11 h-11 flex items-center justify-center text-slate-700 dark:text-slate-200 transition-colors disabled:opacity-40 disabled:cursor-not-allowed group"
                >
                    <span className="w-7 h-7 flex items-center justify-center rounded-full bg-white dark:bg-slate-700 border border-slate-200 dark:border-slate-600 group-hover:bg-slate-100 dark:group-hover:bg-slate-600 transition-colors">
                        <Plus size={14} />
                    </span>
                </button>
            </div>

            <button
                onClick={handleSave}
                disabled={saving}
                className="w-full h-11 flex items-center justify-center gap-2 text-sm font-semibold text-white bg-slate-800 dark:bg-slate-200 dark:text-slate-900 rounded-xl hover:bg-slate-700 dark:hover:bg-slate-300 transition-colors disabled:opacity-50"
            >
                {saving ? <Loader2 size={15} className="animate-spin" /> : 'Valider'}
            </button>
        </section>
    );
};
