import React, { useEffect, useLayoutEffect, useRef } from 'react';
import { createPortal } from 'react-dom'; // Import nécessaire pour la téléportation
import { X } from 'lucide-react';
import type { Workout } from '@/lib/data/DatabaseTypes';
import { useSeanceHref } from '@/hooks/useSeanceHref';
import { WorkoutBadge } from './WorkoutBadge';

interface WorkoutPopoverProps {
    workouts: Workout[];
    onClose: () => void;
    // Permet de glisser une séance depuis le popup vers un autre jour (vue ordinateur).
    enableDrag?: boolean;
}

export function WorkoutPopover({ workouts, onClose, enableDrag = false }: WorkoutPopoverProps) {
    const seanceHref = useSeanceHref('calendar');
    // 1. Une référence pour savoir "où" on doit s'accrocher dans le calendrier
    const anchorRef = useRef<HTMLDivElement>(null);
    // 2. Une référence pour la popup elle-même (qui sera dans le body)
    const popoverRef = useRef<HTMLDivElement>(null);

    useLayoutEffect(() => {
        const anchor = anchorRef.current;
        const popover = popoverRef.current;

        // Sécurité si les éléments ne sont pas encore chargés
        if (!anchor || !popover) return;

        // --- CALCULS DE POSITION (Mathématiques pures, plus de CSS relative) ---
        const anchorRect = anchor.parentElement?.getBoundingClientRect(); // On prend le parent (le bouton)
        if (!anchorRect) return;

        const popoverRect = popover.getBoundingClientRect();
        const viewportHeight = window.innerHeight;

        // Espace disponible en bas
        const spaceBelow = viewportHeight - anchorRect.bottom;
        // On décide si on ouvre vers le haut (si moins de 300px en bas)
        const shouldOpenUpwards = spaceBelow < 300;

        // --- APPLICATION DIRECTE DES STYLES (Performance maximale) ---

        // 1. Position Horizontale : Centré par rapport au bouton déclencheur
        const leftPos = anchorRect.left + (anchorRect.width / 2);
        popover.style.left = `${leftPos}px`;

        // 2. Position Verticale
        if (shouldOpenUpwards) {
            // On le place AU-DESSUS du bouton (Bottom du popover = Top du bouton - marge)
            const topPos = anchorRect.top - popoverRect.height - 8;
            popover.style.top = `${topPos}px`;
            // Animation : part d'un peu plus bas
            popover.style.transformOrigin = 'bottom center';
        } else {
            // On le place EN-DESSOUS du bouton
            const topPos = anchorRect.bottom + 8;
            popover.style.top = `${topPos}px`;
            // Animation : part d'un peu plus haut
            popover.style.transformOrigin = 'top center';
        }

        // 3. Lancement de l'animation d'apparition
        requestAnimationFrame(() => {
            popover.style.opacity = '1';
            popover.style.transform = 'translate(-50%, 0) scale(1)';
        });

    }, []); // Tableau vide : ne s'exécute qu'une seule fois au montage

    // Gestion du clic extérieur (inchangé)
    useEffect(() => {
        const handleClickOutside = (e: MouseEvent) => {
            if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
                onClose();
            }
        };
        // On écoute le scroll aussi pour fermer la popup si l'utilisateur scrolle la page
        document.addEventListener('mousedown', handleClickOutside);
        window.addEventListener('scroll', onClose, { capture: true });

        return () => {
            document.removeEventListener('mousedown', handleClickOutside);
            window.removeEventListener('scroll', onClose, { capture: true });
        };
    }, [onClose]);

    // Contenu de la popup
    const popoverContent = (
        <div
            ref={popoverRef}
            style={{
                position: 'fixed', // FIXED est crucial pour sortir du flux du calendrier
                zIndex: 9999,      // Toujours tout en haut
                opacity: 0,
                transform: 'translate(-50%, 0) scale(0.95)',
                backgroundColor: 'var(--surface-popover)',
                width: '18rem', // w-72
            }}
            className="
                border-2 border-slate-300 dark:border-slate-600
                rounded-xl
                shadow-[0_0_50px_-5px_rgba(0,0,0,0.9)]
                overflow-hidden
                flex flex-col
                transition-all duration-200 ease-out
            "
        >
            {/* Header */}
            <div className="flex items-center justify-between px-4 py-3 bg-slate-100 dark:bg-slate-900 border-b border-slate-300 dark:border-slate-600 shrink-0">
                <div className="flex items-center gap-2">
                    <span className="flex h-2 w-2 rounded-full bg-blue-500 shadow-[0_0_8px_rgba(59,130,246,0.8)]"></span>
                    <span className="text-sm font-bold text-slate-800 dark:text-slate-100">
                        {workouts.length} séances
                    </span>
                </div>
                <button
                    onClick={(e) => {
                        e.stopPropagation();
                        onClose();
                    }}
                    className="p-1 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white rounded transition-colors"
                >
                    <X size={16} />
                </button>
            </div>

            {/* Liste */}
            <div className="p-3 space-y-3 max-h-[300px] overflow-y-auto custom-scrollbar bg-(--surface-popover">
                {workouts.map((workout, index) => (
                    <div key={workout.id} className="relative group">
                        {index !== workouts.length - 1 && (
                            <div className="absolute top-8 left-[11px] w-0.5 h-full bg-slate-300 dark:bg-slate-700/50 -z-10" />
                        )}
                        <div className="flex gap-3">
                            <div className="flex flex-col items-center pt-1">
                                <div className="w-6 h-6 rounded-full bg-slate-200 dark:bg-slate-900 border border-slate-300 dark:border-slate-600 flex items-center justify-center text-[10px] font-bold text-slate-600 dark:text-slate-300 shrink-0 shadow-sm z-10">
                                    {index + 1}
                                </div>
                            </div>
                            <div className="flex-1 min-w-0">
                                <WorkoutBadge
                                    workout={workout}
                                    enableDrag={enableDrag}
                                    href={seanceHref(workout.id)}
                                    isCompact={false}
                                />
                            </div>
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );

    // Retourne :
    // 1. Une ancre invisible (pour garder la place dans le DOM React)
    // 2. Le portail qui envoie visuellement la popup dans le BODY
    return (
        <>
            <div ref={anchorRef} className="hidden" />
            {createPortal(popoverContent, document.body)}
        </>
    );
}
