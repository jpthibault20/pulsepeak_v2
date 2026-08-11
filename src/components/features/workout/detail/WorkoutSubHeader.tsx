'use client';

import React, { useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import type { WorkoutNeighbour } from '@/lib/data/crud';

interface Props {
    /** Libellé et cible du retour, résolus depuis ?from= */
    backLabel: string;
    backHref: string;
    /** Query (`?from=…&month=…&day=…`) à recoller sur les liens séance voisine */
    seanceQuery: string;
    /** Fil d'Ariane contextuel : « Bloc Seuil · Semaine 7 · Mar. 12 août » */
    breadcrumb: string;
    prev: WorkoutNeighbour | null;
    next: WorkoutNeighbour | null;
    /** Position dans la journée, affichée seulement si plusieurs séances ce jour-là */
    dayPosition: { index: number; total: number } | null;
}

/**
 * Barre contextuelle sticky sous la nav globale : retour, fil d'Ariane et
 * navigation entre séances.
 *
 * `top-14` colle exactement à la hauteur de la nav (h-14). Le rail du contenu
 * se cale ensuite à `top-[6.5rem]` = 3.5rem (nav) + 3rem (cette barre).
 */
export const WorkoutSubHeader: React.FC<Props> = ({
    backLabel, backHref, seanceQuery, breadcrumb, prev, next, dayPosition,
}) => {
    const router = useRouter();

    // Raccourcis clavier ← / → / Échap. Neutralisés dès que le focus est dans un
    // champ de saisie, sinon ← déplacerait la séance au lieu du curseur.
    useEffect(() => {
        const onKeyDown = (e: KeyboardEvent) => {
            const el = document.activeElement;
            const tag = el?.tagName;
            const isTyping =
                tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' ||
                (el instanceof HTMLElement && el.isContentEditable);
            if (isTyping || e.metaKey || e.ctrlKey || e.altKey) return;

            if (e.key === 'ArrowLeft' && prev) router.push(`/seance/${prev.id}${seanceQuery}`);
            else if (e.key === 'ArrowRight' && next) router.push(`/seance/${next.id}${seanceQuery}`);
            else if (e.key === 'Escape') router.push(backHref);
        };
        window.addEventListener('keydown', onKeyDown);
        return () => window.removeEventListener('keydown', onKeyDown);
    }, [prev, next, backHref, seanceQuery, router]);

    return (
        <nav
            aria-label="Navigation de la séance"
            className="sticky top-14 z-30 -mx-3 sm:-mx-6 lg:-mx-8 px-3 sm:px-6 lg:px-8 mb-5
                       bg-white/95 dark:bg-slate-950/90 backdrop-blur-xl
                       border-b border-slate-200/80 dark:border-white/6"
        >
            <div className="h-12 flex items-center justify-between gap-3">
                {/* Retour + fil d'Ariane */}
                <div className="flex items-center gap-2 min-w-0">
                    <Link
                        href={backHref}
                        className="flex items-center gap-1 -ml-2 px-2 h-11 shrink-0 text-sm font-medium text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white transition-colors"
                    >
                        <ChevronLeft size={18} aria-hidden="true" />
                        {backLabel}
                    </Link>
                    {breadcrumb && (
                        <>
                            <span className="text-slate-300 dark:text-slate-700 shrink-0" aria-hidden="true">·</span>
                            <span className="hidden md:block text-xs text-slate-500 dark:text-slate-400 truncate">
                                {breadcrumb}
                            </span>
                        </>
                    )}
                </div>

                {/* Précédente / suivante */}
                <div className="flex items-center gap-1 shrink-0">
                    <NeighbourButton dir="prev" target={prev} query={seanceQuery} />
                    {dayPosition && dayPosition.total > 1 && (
                        <span className="px-1 text-[11px] font-medium tabular-nums text-slate-500 dark:text-slate-400">
                            {dayPosition.index}/{dayPosition.total}
                        </span>
                    )}
                    <NeighbourButton dir="next" target={next} query={seanceQuery} />
                </div>
            </div>
        </nav>
    );
};

/**
 * Un <a> désactivé n'existe pas en HTML : en butée on rend un <span> inerte
 * porteur d'aria-disabled plutôt qu'un lien qui ne mène nulle part.
 */
const NeighbourButton: React.FC<{ dir: 'prev' | 'next'; target: WorkoutNeighbour | null; query: string }> = ({ dir, target, query }) => {
    const isPrev = dir === 'prev';
    const Icon = isPrev ? ChevronLeft : ChevronRight;
    const label = isPrev ? 'Séance précédente' : 'Séance suivante';
    const text = isPrev ? 'Préc.' : 'Suiv.';

    const inner = (
        <>
            {isPrev && <Icon size={14} aria-hidden="true" />}
            <span className="hidden sm:inline">{text}</span>
            {!isPrev && <Icon size={14} aria-hidden="true" />}
        </>
    );

    const base = 'flex items-center gap-1 px-2 sm:px-3 h-11 rounded-xl text-xs font-medium transition-colors';

    if (!target) {
        return (
            <span aria-disabled="true" aria-label={label} className={`${base} text-slate-400 dark:text-slate-600 opacity-40 cursor-not-allowed`}>
                {inner}
            </span>
        );
    }

    return (
        <Link
            href={`/seance/${target.id}${query}`}
            aria-label={`${label} : ${target.title}`}
            title={target.title}
            className={`${base} text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800`}
        >
            {inner}
        </Link>
    );
};
