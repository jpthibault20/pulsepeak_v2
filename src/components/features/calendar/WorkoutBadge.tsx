import React, { useState } from 'react';
import Link from 'next/link';
import {
    Clock, Zap, Check, X,
    Bike, Footprints, Waves, Dumbbell, Activity
} from 'lucide-react';
import type { Workout } from '@/lib/data/DatabaseTypes';
import { getWorkoutTSS } from '@/lib/stats/computeTSS';

interface WorkoutBadgeProps {
    workout: Workout;
    /**
     * Cible du badge. Un vrai lien apporte le prefetch, le Ctrl+clic vers un
     * nouvel onglet et « copier le lien » — impossibles avec un onClick.
     */
    href?: string;
    /** Utilisé uniquement quand `href` est absent (cas hérités). */
    onClick?: (e: React.MouseEvent) => void;
    isCompact?: boolean;
    // Active le glisser-déposer (vue ordinateur) : uniquement pour les séances non complétées.
    enableDrag?: boolean;
}

// Payload transporté par le drag natif HTML5. Le type MIME custom permet aux
// cellules du calendrier de n'accepter QUE les drops de séances.
export const WORKOUT_DND_MIME = 'application/x-pulsepeak-workout';

// 1. Configuration des styles par Sport (Couleur + Icone)
const SPORT_CONFIG: Record<string, { icon: React.ElementType, color: string, bg: string }> = {
    cycling: { icon: Bike, color: 'text-purple-400', bg: 'bg-purple-500' },
    running: { icon: Footprints, color: 'text-orange-400', bg: 'bg-orange-500' },
    swimming: { icon: Waves, color: 'text-cyan-400', bg: 'bg-cyan-500' },
    strength: { icon: Dumbbell, color: 'text-purple-400', bg: 'bg-purple-500' },
    default: { icon: Activity, color: 'text-slate-400', bg: 'bg-slate-500' }
};

export function WorkoutBadge({ workout, href, onClick, isCompact = false, enableDrag = false }: WorkoutBadgeProps) {
    // --- Extraction des données ---
    const sportKey = workout.sportType?.toLowerCase() || 'default';
    const config = SPORT_CONFIG[sportKey] || SPORT_CONFIG.default;
    const SportIcon = config.icon;

    const isCompleted = workout.status === 'completed';
    const isMissed = workout.status === 'missed';

    // Une séance est déplaçable uniquement si elle n'est pas complétée (pending/missed).
    const canDrag = enableDrag && !isCompleted;
    const [isDragging, setIsDragging] = useState(false);

    const handleDragStart = (e: React.DragEvent) => {
        e.dataTransfer.effectAllowed = 'move';
        // Un <a> est nativement draggable : le navigateur pousse son URL dans le
        // dataTransfer. On efface d'abord pour que seul le MIME custom subsiste,
        // sinon un drop hors calendrier ouvrirait/collerait le lien.
        e.dataTransfer.clearData();
        e.dataTransfer.setData(
            WORKOUT_DND_MIME,
            JSON.stringify({ id: workout.id, date: workout.date }),
        );
        setIsDragging(true);
    };

    const duration = workout.completedData?.actualDurationMinutes || workout.plannedData?.durationMinutes || 0;
    // Affichage : TSS canonique pour les séances complétées, TSS planifié pour les pending.
    const tss = isCompleted
        ? getWorkoutTSS(workout)
        : (workout.plannedData?.plannedTSS ?? 0);

    // --- Style dynamique du conteneur ---
    // Si manqué : fond rougeatre très léger + bordure rouge
    // Si fait : fond vert très léger
    let containerStyle = "border-l-2 bg-slate-100 dark:bg-slate-800 border-slate-300 dark:border-slate-700 hover:border-slate-400 dark:hover:border-slate-500 hover:bg-slate-200 dark:hover:bg-slate-750";

    if (isCompleted) {
        containerStyle = "border-l-2 border-emerald-500 bg-emerald-50 dark:bg-emerald-950/10 hover:bg-emerald-100 dark:hover:bg-emerald-950/20";
    } else if (isMissed) {
        containerStyle = "border-l-2 border-red-500 bg-red-50 dark:bg-red-950/10 hover:bg-red-100 dark:hover:bg-red-950/20";
    } else {
        // En attente : on utilise la couleur du sport pour la bordure gauche
        const sportBorder = config.bg.replace('bg-', 'border-');
        containerStyle = `border-l-2 ${sportBorder} bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-750`;
    }

    const shared = {
        draggable: canDrag,
        onDragStart: canDrag ? handleDragStart : undefined,
        onDragEnd: canDrag ? () => setIsDragging(false) : undefined,
        title: canDrag ? 'Glisser vers un autre jour pour replanifier' : undefined,
        className: `
            relative flex flex-col gap-1
            w-full rounded-r-md shadow-sm transition-all duration-200
            overflow-hidden group
            ${canDrag ? 'cursor-grab active:cursor-grabbing' : 'cursor-pointer'}
            ${isDragging ? 'opacity-40' : ''}
            ${containerStyle}
            ${isCompact ? 'p-1.5' : 'p-2'}
            mb-1.5
        `,
    };

    const inner = (
        <>
            {/* --- EN-TÊTE : Icone Sport + Titre + Badge Indoor --- */}
            <div className="flex items-start justify-between gap-1.5">
                <div className="flex items-center gap-2 min-w-0">
                    {/* Icône Sport (Colorée) */}
                    <div className={`shrink-0 ${config.color} opacity-90`}>
                        <SportIcon size={isCompact ? 13 : 15} strokeWidth={2.5} />
                    </div>

                    {/* Titre tronqué */}
                    <span className={`truncate font-medium text-slate-700 dark:text-slate-200 ${isCompact ? 'text-[10px]' : 'text-xs'}`}>
                        {workout.title}
                    </span>
                </div>

                {/* --- BADGE INDOOR / OUTDOOR ---
                <div
                    title={isIndoor ? "Indoor / Home Trainer" : "Extérieur"}
                    className={`
                        shrink-0 flex items-center justify-center rounded-sm px-1 py-0.5
                        text-[9px] font-bold uppercase tracking-wider border
                        ${isIndoor
                            ? 'bg-indigo-50 dark:bg-indigo-500/10 text-indigo-700 dark:text-indigo-300 border-indigo-200/60 dark:border-indigo-500/20'
                            : 'bg-amber-50 dark:bg-amber-500/10 text-amber-700 dark:text-amber-300 border-amber-200/60 dark:border-amber-500/20'
                        }
                    `}
                >
                    {isIndoor ? (
                        <Home size={10} className="mr-0.5" />
                    ) : (
                        <Sun size={10} className="mr-0.5" />
                    )}
                </div> */}
            </div>

            {/* --- LIGNE DE DÉTAILS (Temps, TSS, Statut) --- */}
            {!isCompact && (
                <div className="flex items-center justify-between text-[11px] text-slate-500 dark:text-slate-400 mt-1">

                    {/* Groupe Metrics */}
                    <div className="flex items-center gap-3">
                        {/* Temps */}
                        <div className="flex items-center gap-1 hover:text-slate-600 dark:hover:text-slate-300 transition-colors">
                            <Clock size={11} />
                            <span>{duration}&apos;</span>
                        </div>

                        {/* TSS (Affiché seulement si > 0) */}
                        {tss ? (
                            <div className="flex items-center gap-1 hover:text-yellow-500/80 transition-colors">
                                <Zap size={11} className={isCompleted ? "text-yellow-600" : "text-slate-500 dark:text-slate-500"} />
                                <span>{tss}</span>
                            </div>
                        ) : null}
                    </div>

                    {/* Indicateur de Statut (Icone seule) */}
                    <div>
                        {isCompleted && (
                            <div className="flex items-center gap-1 text-emerald-500 bg-emerald-500/10 px-1.5 rounded-full">
                                <Check size={10} strokeWidth={3} />
                            </div>
                        )}
                        {isMissed && (
                            <div className="flex items-center text-red-500 bg-red-500/10 px-1 rounded-full">
                                <X size={10} strokeWidth={3} />
                            </div>
                        )}
                    </div>
                </div>
            )}
        </>
    );

    // Un vrai <a> quand une cible existe : prefetch, Ctrl+clic, copier le lien.
    if (href) {
        return <Link href={href} {...shared}>{inner}</Link>;
    }
    return <div onClick={onClick} {...shared}>{inner}</div>;
}
