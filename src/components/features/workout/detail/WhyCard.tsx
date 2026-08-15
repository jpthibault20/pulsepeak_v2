import React from 'react';
import { Sparkles } from 'lucide-react';

/**
 * Justification pédagogique générée avec la séance (plannedData.why). Répond au
 * besoin de comprendre ce qu'on fait quand le plan enchaîne des séances peu
 * intenses. Masqué si absent (séances générées avant l'ajout du champ).
 */
export const WhyCard: React.FC<{ why?: string | null }> = ({ why }) => {
    const text = why?.trim();
    if (!text) return null;

    return (
        <section
            aria-labelledby="why-title"
            className="p-4 rounded-2xl bg-gradient-to-br from-indigo-50 via-purple-50/50 to-blue-50 dark:from-indigo-500/10 dark:via-purple-500/5 dark:to-blue-500/5 border border-indigo-200/60 dark:border-indigo-500/20"
        >
            <div className="flex items-center gap-2 mb-2.5">
                <div className="flex items-center justify-center w-6 h-6 rounded-lg bg-indigo-100 dark:bg-indigo-500/20" aria-hidden="true">
                    <Sparkles size={13} className="text-indigo-600 dark:text-indigo-400" />
                </div>
                <h2 id="why-title" className="text-xs font-bold text-indigo-700 dark:text-indigo-400 uppercase tracking-wider">
                    Pourquoi cette séance
                </h2>
            </div>
            <p className="text-sm text-slate-700 dark:text-slate-300 leading-relaxed whitespace-pre-line">{text}</p>
        </section>
    );
};
