import React, { useState } from 'react';
import { Plus, BedDouble, Layers, Trophy, Target, X } from 'lucide-react';
import type { Workout, Objective } from '@/lib/data/DatabaseTypes';
import { formatDateKey } from '@/lib/utils';
import { WorkoutBadge, WORKOUT_DND_MIME } from './WorkoutBadge';
import { WorkoutPopover } from './WorkoutPopover';

interface DayCellProps {
    date: Date;
    workouts: Workout[];
    objectives: Objective[];
    isCurrentMonth: boolean;
    isToday: boolean;
    onOpenManualModal: (e: React.MouseEvent, date: Date) => void;
    onViewWorkout: (workout: Workout) => void;
    onEditObjective: (obj: Objective) => void;
    onMoveWorkout: (workoutId: string, newDateStr: string) => Promise<void> | void;
}

export function DayCell({
    date,
    workouts,
    objectives,
    isCurrentMonth,
    isToday,
    onOpenManualModal,
    onViewWorkout,
    onEditObjective,
    onMoveWorkout,
}: DayCellProps) {
    const [showPopover, setShowPopover] = useState(false);
    const [isDragOver, setIsDragOver] = useState(false);

    const dateKey = formatDateKey(date);

    // --- Zone de dépôt (drag & drop) : on n'accepte que les séances déplacées ---
    const handleDragOver = (e: React.DragEvent) => {
        if (!e.dataTransfer.types.includes(WORKOUT_DND_MIME)) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        if (!isDragOver) setIsDragOver(true);
    };

    const handleDragLeave = (e: React.DragEvent) => {
        // On ignore les changements de cible internes (survol d'un enfant).
        if (e.currentTarget.contains(e.relatedTarget as Node)) return;
        setIsDragOver(false);
    };

    const handleDrop = (e: React.DragEvent) => {
        setIsDragOver(false);
        const raw = e.dataTransfer.getData(WORKOUT_DND_MIME);
        if (!raw) return;
        e.preventDefault();
        try {
            const { id, date: sourceDate } = JSON.parse(raw) as { id: string; date: string };
            // Pas de déplacement si on relâche sur le jour d'origine.
            if (!id || sourceDate === dateKey) return;
            onMoveWorkout(id, dateKey);
        } catch {
            // payload invalide : on ignore silencieusement
        }
    };

    // Calcul pour le style multi-séances
    const hasMultiple = workouts.length > 1;
    const isRestDay = workouts.length === 0;
    const allMissed = hasMultiple && workouts.every(w => w.status === 'missed');
    const primaryObj = objectives.find(o => o.priority === 'principale');
    const secondaryObjs = objectives.filter(o => o.priority === 'secondaire');

    return (
        <div
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            className={`
        relative group flex flex-col
        min-h-[140px] p-2
        border-b border-r border-slate-200/80 dark:border-slate-800/60
        transition-all duration-200
        ${!isCurrentMonth ? 'bg-slate-50/50 dark:bg-slate-950/30' : ''}
        ${isToday ? 'bg-blue-50/80 dark:bg-blue-900/5' : ''}
        ${isDragOver ? 'ring-2 ring-inset ring-blue-500/70 bg-blue-50 dark:bg-blue-500/10' : ''}
        hover:bg-slate-50 dark:hover:bg-slate-800/40
      `}
        >
            {/* --- En-tête de la cellule (Date + Bouton Ajout) --- */}
            <div className="flex items-start justify-between mb-2 h-7">
                <div className={`
          flex items-center justify-center w-7 h-7 rounded-full text-sm transition-colors
          ${isToday
                        ? 'bg-blue-600 text-white font-bold shadow-md shadow-blue-500/20 dark:shadow-blue-900/20'
                        : isCurrentMonth ? 'text-slate-600 dark:text-slate-300' : 'text-slate-400 dark:text-slate-600'
                    }
        `}>
                    {date.getDate()}
                </div>

                {/* Bouton d'ajout discret (visible au hover groupe) */}
                <button
                    onClick={(e) => onOpenManualModal(e, date)}
                    className={`
            w-7 h-7 flex items-center justify-center rounded-lg
            text-slate-500 hover:text-slate-900 dark:hover:text-white hover:bg-slate-200 dark:hover:bg-slate-700
            transition-all duration-200
            ${isRestDay ? 'opacity-0 group-hover:opacity-100' : 'opacity-0 group-hover:opacity-100'}
          `}
                    title="Ajouter une séance manuelle"
                >
                    <Plus size={16} />
                </button>
            </div>

            {/* --- Objectifs du jour --- */}
            {objectives.length > 0 && (
                <div className="flex flex-col gap-0.5 mb-1">
                    {primaryObj && (
                        <button onClick={() => onEditObjective(primaryObj)} className="flex items-center gap-1 px-1.5 py-0.5 bg-rose-50 dark:bg-rose-950/60 border border-rose-200 dark:border-rose-500/40 rounded-md hover:bg-rose-100 dark:hover:bg-rose-950/80 transition-colors cursor-pointer text-left w-full">
                            <Trophy size={9} className="text-rose-600 dark:text-rose-400 shrink-0" />
                            <span className="text-rose-600 dark:text-rose-300 text-[10px] font-semibold truncate">{primaryObj.name}</span>
                        </button>
                    )}
                    {secondaryObjs.map(o => (
                        <button key={o.id} onClick={() => onEditObjective(o)} className="flex items-center gap-1 px-1.5 py-0.5 bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-500/30 rounded-md hover:bg-amber-100 dark:hover:bg-amber-950/60 transition-colors cursor-pointer text-left w-full">
                            <Target size={9} className="text-amber-600 dark:text-amber-400 shrink-0" />
                            <span className="text-amber-600 dark:text-amber-300 text-[10px] truncate">{o.name}</span>
                        </button>
                    ))}
                </div>
            )}

            {/* --- Contenu de la cellule --- */}
            <div className="flex-1 flex flex-col justify-start gap-1 relative z-10">

                {/* CAS 1: Jour de Repos */}
                {isRestDay && (
                    <div className="flex-1 flex flex-col items-center justify-center opacity-0 group-hover:opacity-60 transition-opacity duration-300 cursor-default select-none">
                        <div className="flex flex-col items-center gap-1 text-slate-400 dark:text-slate-700">
                            <BedDouble size={18} strokeWidth={1.5} />
                            <span className="text-[10px] uppercase tracking-wider font-medium">Repos</span>
                        </div>
                    </div>
                )}

                {/* CAS 2: Une seule séance */}
                {workouts.length === 1 && (
                    <div className="animate-in fade-in zoom-in-95 duration-200">
                        <WorkoutBadge
                            workout={workouts[0]}
                            onClick={() => onViewWorkout(workouts[0])}
                            isCompact={false}
                            enableDrag
                        />
                    </div>
                )}

                {/* CAS 3: Plusieurs séances (Multi-stack) */}
                {hasMultiple && (
                    <div className="relative animate-in fade-in zoom-in-95 duration-200">
                        <button
                            onClick={() => setShowPopover(!showPopover)}
                            className={`
                                w-full rounded-md p-2 text-left transition-all group/stack shadow-sm
                                ${allMissed
                                    ? 'bg-red-50 dark:bg-red-950/10 hover:bg-red-100 dark:hover:bg-red-950/20 border border-red-200 dark:border-red-500/30 hover:border-red-300 dark:hover:border-red-500/50'
                                    : 'bg-slate-100 dark:bg-slate-800/80 hover:bg-slate-200 dark:hover:bg-slate-700/90 border border-slate-200 dark:border-slate-700/50 hover:border-slate-300 dark:hover:border-slate-600'
                                }
                            `}
                        >
                            <div className="flex items-center gap-2 mb-2">
                                <div className={`p-1 rounded ${allMissed
                                    ? 'bg-red-100 dark:bg-red-500/20 text-red-600 dark:text-red-400'
                                    : getMultiCardStyle(workouts)}`}>
                                    {allMissed ? <X size={14} strokeWidth={2.5} /> : <Layers size={14} />}
                                </div>
                                <span className={`text-xs font-semibold ${allMissed
                                    ? 'text-red-700 dark:text-red-300'
                                    : 'text-slate-700 dark:text-slate-200'}`}>
                                    {workouts.length} {allMissed ? 'Séances manquées' : 'Séances'}
                                </span>
                            </div>

                            {/* Mini visualisation des types de sport */}
                            <div className="flex gap-1">
                                {workouts.map((w) => (
                                    <div
                                        key={w.id}
                                        className={`h-1.5 w-full rounded-full ${allMissed ? 'opacity-40' : 'opacity-80'} ${getSportColorLine(w.sportType)}`}
                                        title={w.title}
                                    />
                                ))}
                            </div>
                        </button>

                        {/* Popover pour voir les détails des multiples séances */}
                        {showPopover && (
                            <div className="absolute top-full left-0 right-0 z-50 mt-1">
                                <WorkoutPopover
                                    workouts={workouts}
                                    onClose={() => setShowPopover(false)}
                                    onViewWorkout={onViewWorkout}
                                    enableDrag
                                />
                            </div>
                        )}
                    </div>
                )}
            </div>
        </div>
    );
}

// Couleur de la carte multi-séances basée sur le sport dominant
function getMultiCardStyle(workouts: Workout[]) {
    const hasCycling = workouts.some(w => w.sportType?.toLowerCase().includes('cycl'));
    if (hasCycling) return 'bg-purple-100 dark:bg-purple-500/20 text-purple-600 dark:text-purple-400';
    const hasRunning = workouts.some(w => w.sportType?.toLowerCase().includes('run'));
    if (hasRunning) return 'bg-orange-100 dark:bg-orange-500/20 text-orange-600 dark:text-orange-400';
    const hasSwimming = workouts.some(w => w.sportType?.toLowerCase().includes('swim'));
    if (hasSwimming) return 'bg-sky-100 dark:bg-sky-500/20 text-sky-600 dark:text-sky-400';
    return 'bg-slate-100 dark:bg-slate-500/20 text-slate-600 dark:text-slate-400';
}

// Fonction utilitaire locale pour les petites barres de couleur
function getSportColorLine(sportType?: string) {
    const type = (sportType || '').toLowerCase();
    if (type.includes('run') || type.includes('course')) return 'bg-orange-500';
    if (type.includes('cycl') || type.includes('vélo')) return 'bg-purple-500';
    if (type.includes('swim') || type.includes('nat')) return 'bg-cyan-400';
    if (type.includes('muscu') || type.includes('strength')) return 'bg-purple-500';
    return 'bg-slate-400';
}
