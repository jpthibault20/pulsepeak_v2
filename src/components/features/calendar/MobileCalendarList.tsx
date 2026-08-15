import React, { useMemo } from 'react';
import { Plus, BedDouble } from 'lucide-react';
import { WorkoutBadge } from './WorkoutBadge';
import { formatDateKey, DAY_NAMES_SHORT, MONTH_NAMES } from '@/lib/utils';
import { useSeanceHref } from '@/hooks/useSeanceHref';
import { Schedule } from '@/lib/data/DatabaseTypes';

interface MobileCalendarListProps {
    weekRows: (Date | null)[][];
    currentMonth: number;
    scheduleData: Schedule;
    onOpenManualModal: (e: React.MouseEvent, date: Date) => void;
}

export function MobileCalendarList({
    weekRows,
    currentMonth,
    scheduleData,
    onOpenManualModal,
}: MobileCalendarListProps) {
    const seanceHref = useSeanceHref('calendar');
    // ✅ CORRECTION : Calculer les stats de toutes les semaines EN AMONT
    const allWeekStats = useMemo(() => {
        return weekRows.map(week => {
            const stats = {
                plannedTSS: 0,
                plannedDuration: 0,
                actualDuration: 0,
                distance: 0,
                completed: 0,
                total: 0,
                sportBreakdown: { cycling: 0, running: 0, swimming: 0, other: 0 },
            };

            week.forEach(date => {
                if (!date) return;

                const dateKey = formatDateKey(date);
                const workouts = scheduleData.workouts.filter(w => w.date === dateKey);

                workouts.forEach(workout => {
                    stats.total++;
                    stats.plannedTSS += workout.plannedData?.plannedTSS ?? 0;
                    stats.plannedDuration += workout.plannedData?.durationMinutes ?? 0;
                    stats.sportBreakdown[workout.sportType]++;

                    if (workout.status === 'completed' && workout.completedData) {
                        stats.completed++;
                        stats.actualDuration += workout.completedData.actualDurationMinutes;
                        stats.distance += workout.completedData.distanceKm ?? 0;
                    }
                });
            });

            return stats;
        });
    }, [weekRows, scheduleData.workouts]);

    return (
        <div className="space-y-3">
            {weekRows.flatMap((week, weekIndex) => {
                // ✅ Récupérer les stats pré-calculées
                const stats = allWeekStats[weekIndex];
                const weekWorkouts = week.flatMap(date =>
                    date ? scheduleData.workouts
                        .filter(w => w.date === formatDateKey(date))
                        .map(w => ({ date, workout: w }))
                        : []
                );

                return (
                    <div key={weekIndex} className="space-y-2">
                        {/* Week Header */}
                        {weekWorkouts.length > 0 && (
                            <div className="text-xs text-slate-500 px-2">
                                Semaine {weekIndex + 1} • {stats.total} séances
                            </div>
                        )}

                        {/* Workouts */}
                        {weekWorkouts.map(({ date, workout }) => {
                            const isToday = formatDateKey(date) === formatDateKey(new Date());
                            const isCurrentMonth = date.getMonth() === currentMonth;

                            return (
                                <div
                                    key={`${date.toISOString()}-${workout.id}`}
                                    className={`
                                        rounded-lg border
                                        ${isToday ? 'border-blue-500/50 bg-blue-900/10' : 'border-slate-800 bg-slate-900'}
                                        ${!isCurrentMonth ? 'opacity-40' : 'opacity-100'}
                                    `}
                                >
                                    {/* Date Header */}
                                    <div className="flex items-center justify-between px-3 py-2 border-b border-slate-800">
                                        <span className={`text-sm font-medium ${isToday ? 'text-blue-400' : 'text-slate-400'}`}>
                                            {DAY_NAMES_SHORT[date.getDay()]} {date.getDate()} {MONTH_NAMES[date.getMonth()]}
                                        </span>
                                        <button
                                            onClick={(e) => onOpenManualModal(e, date)}
                                            className="p-1.5 hover:bg-slate-800 rounded-lg transition-colors"
                                        >
                                            <Plus size={16} className="text-slate-500" />
                                        </button>
                                    </div>

                                    {/* Workout Card */}
                                    <div className="p-3">
                                        <WorkoutBadge
                                            workout={workout}
                                            href={seanceHref(workout.id)}
                                            isCompact={false}
                                        />
                                    </div>
                                </div>
                            );
                        })}

                        {/* Empty state */}
                        {weekWorkouts.length === 0 && (
                            <div className="flex flex-col items-center justify-center py-6 text-slate-600 gap-2">
                                <BedDouble size={20} className="text-slate-700" />
                                <span className="text-xs">Semaine de repos</span>
                            </div>
                        )}
                    </div>
                );
            })}
        </div>
    );
}
