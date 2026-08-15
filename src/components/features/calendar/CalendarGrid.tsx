import React, { useMemo } from 'react';
import { DayCell } from './DayCell';
import { WeekSummaryCell } from './WeekSummaryCell';
import { formatDateKey, DAY_NAMES_SHORT, type DayName } from '@/lib/utils';
import { useCalendarContext } from './CalendarContext';
import { getWorkoutTSS } from '@/lib/stats/computeTSS';

interface CalendarGridProps {
    weekRows: (Date | null)[][];
    currentMonth: number;
    currentYear: number;
    onOpenManualModal: (e: React.MouseEvent, date: Date) => void;
}

export function CalendarGrid({
    weekRows,
    currentMonth,
    onOpenManualModal,
}: CalendarGridProps) {
    const { scheduleData, profile, objectives, onEditObjective, onRefresh, onOpenGenModal, onMoveWorkout } = useCalendarContext();

    const allWeekStats = useMemo(() => {
        return weekRows.map(week => {
            const stats = {
                plannedTSS: 0,
                plannedDuration: 0,
                actualDuration: 0,
                distance: 0,
                completed: 0,
                total: 0,
                completedTSS: 0,
                plannedCount: 0,
                sportBreakdown: {
                    cycling: 0,
                    running: 0,
                    swimming: 0
                } as Record<string, number>,
                sportDuration: {
                    cycling: 0,
                    running: 0,
                    swimming: 0
                } as Record<string, number>
            };

            week.forEach(date => {
                if (!date) return;

                const dateKey = formatDateKey(date);
                const workouts = scheduleData.workouts.filter(w => w.date === dateKey);

                workouts.forEach(workout => {
                    const sport = workout.sportType;

                    // Stats planifiées (toujours comptées)
                    stats.total++;
                    stats.plannedTSS += workout.plannedData?.plannedTSS ?? 0;
                    stats.plannedDuration += workout.plannedData?.durationMinutes ?? 0;

                    if (workout.status === 'pending') stats.plannedCount++;

                    // Comptage des séances par sport
                    if (stats.sportBreakdown[sport] !== undefined) {
                        stats.sportBreakdown[sport]++;
                    } else {
                        stats.sportBreakdown[sport] = 1;
                    }

                    // ✅ Stats réalisées (UN SEUL BLOC)
                    if (workout.status === 'completed' && workout.completedData) {
                        stats.completed++;

                        // Durée totale réalisée
                        const actualMinutes = workout.completedData.actualDurationMinutes ?? 0;
                        stats.actualDuration += actualMinutes;
                        stats.distance += workout.completedData.distanceKm ?? 0;

                        stats.completedTSS += getWorkoutTSS(workout);

                        // Durée par sport
                        if (stats.sportDuration[sport] !== undefined) {
                            stats.sportDuration[sport] += actualMinutes;
                        } else {
                            stats.sportDuration[sport] = actualMinutes;
                        }
                    }
                });
            });

            return stats;
        });
    }, [weekRows, scheduleData.workouts]);


    return (
        <div className="flex flex-col rounded-xl overflow-hidden shadow-lg shadow-slate-900/8 dark:shadow-2xl dark:shadow-black/30 bg-white dark:bg-slate-950 border border-slate-200/80 dark:border-slate-800">

            {/* Header des jours */}
            <div className="grid grid-cols-8 bg-slate-50 dark:bg-slate-900 border-b border-slate-200/80 dark:border-slate-800">
                {(DAY_NAMES_SHORT as readonly DayName[]).map((day) => (
                    <div
                        key={day}
                        className="py-3 text-center text-[11px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-widest"
                    >
                        {day}
                    </div>
                ))}
                {/* Colonne Bilan distincte */}
                <div className="py-3 text-center text-[11px] font-bold text-blue-600 dark:text-blue-400/80 bg-slate-50 dark:bg-slate-900/50 uppercase tracking-widest border-l border-slate-200/80 dark:border-slate-800">
                    Bilan
                </div>
            </div>

            {/* Corps du calendrier : Technique du gap-px pour des bordures fines */}
            <div className="bg-slate-200 dark:bg-slate-800 gap-px grid border-b border-slate-200 dark:border-slate-800 last:border-0">
                {weekRows.map((week, weekIndex) => {
                    const stats = allWeekStats[weekIndex];

                    return (
                        <div key={weekIndex} className="grid grid-cols-8 group">
                            {/* Les 7 jours de la semaine */}
                            {week.map((date, dayIndex) => {
                                // Cellule vide (début/fin de mois hors grille)
                                if (!date) {
                                    return (
                                        <div
                                            key={`empty-${weekIndex}-${dayIndex}`}
                                            className="bg-slate-900/60 dark:bg-slate-950/80 min-h-[120px]"
                                        />
                                    );
                                }

                                const dateKey = formatDateKey(date);
                                const workouts = scheduleData.workouts.filter(w => w.date === dateKey);
                                const dayObjectives = objectives.filter(o => o.date === dateKey);
                                const isCurrentMonth = date.getMonth() === currentMonth;
                                const isToday = formatDateKey(date) === formatDateKey(new Date());
                                const hasPrimaryObj = dayObjectives.some(o => o.priority === 'principale');

                                return (
                                    <div
                                        key={dateKey}
                                        className={`
                                            min-h-[120px] relative transition-colors duration-200
                                            ${!isCurrentMonth ? 'bg-slate-50/80 dark:bg-slate-950/60 opacity-50' : 'bg-white dark:bg-slate-900 hover:bg-slate-50 dark:hover:bg-slate-800'}
                                            ${isToday ? 'ring-inset ring-1 ring-blue-500/30 bg-blue-50 dark:bg-blue-500/5' : ''}
                                            ${hasPrimaryObj ? 'ring-inset ring-1 ring-rose-500/40' : ''}
                                        `}
                                    >
                                        <DayCell
                                            date={date}
                                            workouts={workouts}
                                            objectives={dayObjectives}
                                            isCurrentMonth={isCurrentMonth}
                                            isToday={isToday}
                                            onOpenManualModal={onOpenManualModal}
                                            onEditObjective={onEditObjective}
                                            onMoveWorkout={onMoveWorkout}
                                        />
                                    </div>
                                );
                            })}

                            {/* La cellule de résumé de la semaine (8ème colonne) */}
                            <div className="bg-slate-50 dark:bg-slate-900/40 min-h-[120px] relative border-l border-slate-200/50 dark:border-slate-800/50 hover:bg-white/90 dark:hover:bg-slate-900/80 transition-colors">
                                <WeekSummaryCell
                                    stats={stats}
                                    weekDates={week}
                                    profileAvailability={profile.weeklyAvailability}
                                    activeSports={profile.activeSports}
                                    onRefresh={onRefresh}
                                    onOpenGenModal={onOpenGenModal}
                                />
                            </div>
                        </div>
                    );
                })}
            </div>
        </div>
    );
}
