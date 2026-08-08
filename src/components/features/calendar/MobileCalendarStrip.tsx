'use client';

import React, { useMemo, useRef, useEffect, useState, useCallback } from 'react';
import { Plus, BedDouble, Trophy, Target, Calendar, MapPin, Mountain } from 'lucide-react';
import type { Workout, Objective } from '@/lib/data/DatabaseTypes';
import { WorkoutBadge } from './WorkoutBadge';
import { MobileWeekBar } from './MobileWeekBar';
import { useCalendarContext } from './CalendarContext';
import { formatDateKey, DAY_NAMES_SHORT, MONTH_NAMES, parseLocalDate } from '@/lib/utils';
import type { WeekStats } from '@/hooks/useWeekStats';
import { getWorkoutTSS } from '@/lib/stats/computeTSS';

interface MobileCalendarStripProps {
    weekRows: (Date | null)[][];
    currentMonth: number;
    currentYear: number;
    selectedDay: Date;
    onSelectDay: (date: Date) => void;
    onOpenManualModal: (e: React.MouseEvent, date: Date) => void;
    onVisibleMonthChange?: (year: number, month: number) => void;
}

function getDayLabel(date: Date): string {
    return DAY_NAMES_SHORT[(date.getDay() + 6) % 7];
}

const SPORT_DOT: Record<string, string> = {
    cycling: 'bg-purple-400',
    running: 'bg-orange-500',
    swimming: 'bg-sky-500',
    strength: 'bg-purple-500',
    default: 'bg-slate-400',
};

function getDotColor(workout: Workout): string {
    if (workout.status === 'completed') return 'bg-emerald-500';
    if (workout.status === 'missed') return 'bg-red-500';
    return SPORT_DOT[workout.sportType?.toLowerCase()] ?? SPORT_DOT.default;
}

const SPORT_LABELS: Record<string, string> = {
    cycling: 'Vélo',
    running: 'Course',
    swimming: 'Natation',
    triathlon: 'Triathlon',
    duathlon: 'Duathlon',
};

function generateMonthDays(year: number, month: number): Date[] {
    const days: Date[] = [];
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    for (let d = 1; d <= daysInMonth; d++) {
        days.push(new Date(year, month, d));
    }
    return days;
}

// ── Memoized day button — only re-renders when its own props change ──
interface DayButtonProps {
    date: Date;
    dateKey: string;
    isSelected: boolean;
    isToday: boolean;
    workouts: Workout[];
    hasPrimary: boolean;
    hasSecondary: boolean;
    isFirstOfMonth: boolean;
    showSeparator: boolean;
    onSelect: (date: Date) => void;
}

const DayButton = React.memo(function DayButton({
    date, dateKey, isSelected, isToday, workouts,
    hasPrimary, hasSecondary, isFirstOfMonth, showSeparator, onSelect,
}: DayButtonProps) {
    const monthKey = `${date.getFullYear()}-${date.getMonth()}`;
    return (
        <>
            {isFirstOfMonth && showSeparator && (
                <div className="shrink-0 flex flex-col items-center justify-end px-1 pb-1">
                    <span className="text-[10px] font-bold text-blue-500 dark:text-blue-400 uppercase tracking-wide whitespace-nowrap">
                        {MONTH_NAMES[date.getMonth()].slice(0, 4)}
                    </span>
                    <div className="w-px h-6 bg-slate-300 dark:bg-slate-600 mt-1" />
                </div>
            )}
            <button
                data-selected={isSelected ? 'true' : 'false'}
                data-month={monthKey}
                data-datekey={dateKey}
                onClick={() => onSelect(date)}
                style={{ scrollSnapAlign: 'center' }}
                className={`
                    shrink-0 flex flex-col items-center
                    w-[46px] pt-2.5 pb-2.5 rounded-2xl
                    focus:outline-none
                    ${isSelected
                        ? 'bg-blue-600 shadow-md shadow-blue-500/20 dark:shadow-blue-900/40'
                        : isToday
                            ? 'bg-slate-100 dark:bg-slate-800 ring-1 ring-blue-400/60 dark:ring-blue-500/60'
                            : hasPrimary
                                ? 'bg-rose-50 dark:bg-rose-950/40 ring-1 ring-rose-500/40'
                                : hasSecondary
                                    ? 'bg-amber-50 dark:bg-amber-950/30 ring-1 ring-amber-500/30'
                                    : 'bg-transparent active:bg-slate-100/80 dark:active:bg-slate-800/60'
                    }
                `}
            >
                <span className={`
                    text-[9px] font-semibold uppercase tracking-widest leading-none mb-1.5
                    ${isSelected ? 'text-blue-200' : isToday ? 'text-blue-600 dark:text-blue-400' : 'text-slate-500'}
                `}>
                    {getDayLabel(date)}
                </span>
                <span className={`
                    text-[15px] font-bold leading-none
                    ${isSelected ? 'text-white' : 'text-slate-700 dark:text-slate-200'}
                `}>
                    {date.getDate()}
                </span>
                <div className="flex gap-[3px] mt-1.5 h-[5px] items-center">
                    {workouts.length === 0
                        ? <div className="w-[5px] h-[5px] rounded-full bg-transparent" />
                        : workouts.slice(0, 3).map((w, i) => (
                            <div key={i} className={`w-[5px] h-[5px] rounded-full ${getDotColor(w)}`} />
                        ))
                    }
                </div>
            </button>
        </>
    );
});

export function MobileCalendarStrip({
    weekRows,
    currentMonth,
    currentYear,
    selectedDay,
    onSelectDay,
    onOpenManualModal,
    onVisibleMonthChange,
}: MobileCalendarStripProps) {
    const { scheduleData, profile, objectives, onEditObjective, onRefresh, onOpenGenModal } = useCalendarContext();
    const scrollRef = useRef<HTMLDivElement>(null);
    const todayKey = useMemo(() => formatDateKey(new Date()), []);
    const parentSelectedKey = formatDateKey(selectedDay);
    // Local key that updates instantly during scroll, synced with parent otherwise
    const [localSelectedKey, setLocalSelectedKey] = useState(parentSelectedKey);
    const selectedKey = localSelectedKey;
    // Counter to force auto-scroll even when parentSelectedKey string is the same
    const parentChangeCount = useRef(0);
    const [scrollTrigger, setScrollTrigger] = useState(0);
    const prevParentDay = useRef(selectedDay);
    // Sync local state when parent changes (e.g. click from outside, home button)
    useEffect(() => {
        // Detect parent change even if the key string is the same (new Date object)
        if (selectedDay !== prevParentDay.current) {
            prevParentDay.current = selectedDay;
            setLocalSelectedKey(parentSelectedKey);
            parentChangeCount.current++;
            setScrollTrigger(parentChangeCount.current);
        }
    }, [selectedDay, parentSelectedKey]);
    const lastReportedMonth = useRef<string>('');
    const initialScrollDone = useRef(false);

    // ── Pre-compute lookup maps (O(n) once instead of O(n×m) per render) ──
    const workoutsByDate = useMemo(() => {
        const map = new Map<string, Workout[]>();
        for (const w of scheduleData.workouts) {
            const arr = map.get(w.date);
            if (arr) arr.push(w); else map.set(w.date, [w]);
        }
        return map;
    }, [scheduleData.workouts]);

    const objectivesByDate = useMemo(() => {
        const map = new Map<string, Objective[]>();
        for (const o of objectives) {
            const arr = map.get(o.date);
            if (arr) arr.push(o); else map.set(o.date, [o]);
        }
        return map;
    }, [objectives]);

    // ── Dynamic month range: start with prev/current/next ──
    const [monthRange, setMonthRange] = useState({ min: -1, max: 1 });
    const [anchor] = useState(() => ({ year: currentYear, month: currentMonth }));

    const allDays = useMemo(() => {
        const { year: aY, month: aM } = anchor;
        const days: Date[] = [];
        for (let offset = monthRange.min; offset <= monthRange.max; offset++) {
            const m = new Date(aY, aM + offset, 1);
            days.push(...generateMonthDays(m.getFullYear(), m.getMonth()));
        }
        return days;
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [monthRange]);

    // O(1) lookup: dateKey → Date (avoid linear search in scroll handler)
    const daysByKey = useMemo(() => {
        const map = new Map<string, Date>();
        for (const d of allDays) map.set(formatDateKey(d), d);
        return map;
    }, [allDays]);

    // Workouts & objectives for selected day (used below the strip)
    const dayWorkouts = useMemo(() => workoutsByDate.get(selectedKey) ?? [], [selectedKey, workoutsByDate]);
    const dayObjectives = useMemo(() => objectivesByDate.get(selectedKey) ?? [], [selectedKey, objectivesByDate]);

    // Track whether the selection came from scrolling (skip auto-scroll)
    const selectedFromScroll = useRef(false);
    const isProgrammaticScroll = useRef(false);
    const scrollEndTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
    // Refs to avoid stale closures in scroll handler
    const selectedKeyRef = useRef(selectedKey);
    selectedKeyRef.current = selectedKey;
    const daysByKeyRef = useRef(daysByKey);
    daysByKeyRef.current = daysByKey;
    const onSelectDayRef = useRef(onSelectDay);
    onSelectDayRef.current = onSelectDay;

    // ── Auto-scroll to selected day (only on click or mount, not on scroll-selection) ──
    useEffect(() => {
        if (selectedFromScroll.current) {
            selectedFromScroll.current = false;
            return;
        }
        const el = scrollRef.current?.querySelector<HTMLElement>('[data-selected="true"]');
        if (el) {
            isProgrammaticScroll.current = true;
            el.scrollIntoView({
                behavior: initialScrollDone.current ? 'smooth' : 'auto',
                block: 'nearest',
                inline: 'center',
            });
            initialScrollDone.current = true;
            clearTimeout(scrollEndTimer.current);
            scrollEndTimer.current = setTimeout(() => { isProgrammaticScroll.current = false; }, 350);
        }
    }, [scrollTrigger]);

    // ── Expand range when approaching edges + detect visible month ──
    const expandMonth = useCallback((direction: 'prev' | 'next') => {
        const container = scrollRef.current;
        if (!container) return;

        if (direction === 'prev') {
            const prevWidth = container.scrollWidth;
            const prevScroll = container.scrollLeft;
            setMonthRange(prev => ({ ...prev, min: prev.min - 1 }));
            requestAnimationFrame(() => {
                const newWidth = container.scrollWidth;
                container.scrollLeft = prevScroll + (newWidth - prevWidth);
            });
        } else {
            setMonthRange(prev => ({ ...prev, max: prev.max + 1 }));
        }
    }, []);

    // Cache button positions to avoid querySelectorAll on every scroll frame
    const btnCacheRef = useRef<{ el: HTMLElement; center: number; dk: string; month: string }[]>([]);
    const btnCacheDirty = useRef(true);
    // Invalidate cache when days change (month expansion)
    useEffect(() => { btnCacheDirty.current = true; }, [allDays]);

    const rebuildBtnCache = useCallback(() => {
        const container = scrollRef.current;
        if (!container) return;
        const btns = container.querySelectorAll<HTMLElement>('[data-datekey]');
        const cache: typeof btnCacheRef.current = [];
        btns.forEach(btn => {
            cache.push({
                el: btn,
                center: btn.offsetLeft + btn.offsetWidth / 2,
                dk: btn.dataset.datekey!,
                month: btn.dataset.month!,
            });
        });
        btnCacheRef.current = cache;
        btnCacheDirty.current = false;
    }, []);

    // Binary search for the closest button to centerX
    const findClosest = useCallback((centerX: number) => {
        const cache = btnCacheRef.current;
        if (cache.length === 0) return null;
        let lo = 0, hi = cache.length - 1;
        while (lo < hi) {
            const mid = (lo + hi) >> 1;
            if (cache[mid].center < centerX) lo = mid + 1; else hi = mid;
        }
        // Check lo and lo-1 for the actual closest
        const candidate = cache[lo];
        const prev = lo > 0 ? cache[lo - 1] : null;
        if (prev && Math.abs(prev.center - centerX) < Math.abs(candidate.center - centerX)) {
            return prev;
        }
        return candidate;
    }, []);

    useEffect(() => {
        const container = scrollRef.current;
        if (!container) return;
        let ticking = false;
        const EDGE_THRESHOLD = 100;

        const handleScroll = () => {
            if (ticking) return;
            ticking = true;
            requestAnimationFrame(() => {
                ticking = false;
                if (!container) return;

                if (container.scrollLeft < EDGE_THRESHOLD) {
                    expandMonth('prev');
                }
                if (container.scrollLeft + container.clientWidth > container.scrollWidth - EDGE_THRESHOLD) {
                    expandMonth('next');
                }

                // Rebuild cache if invalidated (month expansion, first scroll)
                if (btnCacheDirty.current) rebuildBtnCache();

                const centerX = container.scrollLeft + container.clientWidth / 2;
                const closest = findClosest(centerX);

                if (closest) {
                    // Report visible month
                    if (closest.month !== lastReportedMonth.current) {
                        lastReportedMonth.current = closest.month;
                        const [y, mo] = closest.month.split('-').map(Number);
                        onVisibleMonthChange?.(y, mo);
                    }

                    // Select the centered day in real-time while scrolling
                    if (!isProgrammaticScroll.current && closest.dk !== selectedKeyRef.current) {
                        selectedKeyRef.current = closest.dk;
                        setLocalSelectedKey(closest.dk);
                        // Debounce the parent update
                        clearTimeout(scrollEndTimer.current);
                        scrollEndTimer.current = setTimeout(() => {
                            selectedFromScroll.current = true;
                            const dayDate = daysByKeyRef.current.get(closest.dk);
                            if (dayDate) onSelectDayRef.current(dayDate);
                        }, 150);
                    }
                }
            });
        };

        container.addEventListener('scroll', handleScroll, { passive: true });
        return () => {
            container.removeEventListener('scroll', handleScroll);
            clearTimeout(scrollEndTimer.current);
        };
    }, [expandMonth, onVisibleMonthChange, rebuildBtnCache, findClosest]);

    // ── Week stats for the selected day ──
    const selectedWeek = useMemo(() => {
        const fromRows = weekRows.find(week =>
            week.some(d => d !== null && formatDateKey(d) === selectedKey)
        );
        if (fromRows && fromRows.length > 0) return fromRows;

        const d = new Date(selectedDay);
        const dayIdx = (d.getDay() + 6) % 7;
        const monday = new Date(d);
        monday.setDate(d.getDate() - dayIdx);
        const week: Date[] = [];
        for (let i = 0; i < 7; i++) {
            const wd = new Date(monday);
            wd.setDate(monday.getDate() + i);
            week.push(wd);
        }
        return week;
    }, [weekRows, selectedKey, selectedDay]);

    const weekStartDate = useMemo(() => {
        const firstNonNull = selectedWeek.find(d => d !== null);
        if (!firstNonNull) return null;
        const idx = selectedWeek.indexOf(firstNonNull);
        const monday = new Date(firstNonNull);
        monday.setDate(monday.getDate() - idx);
        return formatDateKey(monday);
    }, [selectedWeek]);

    const weekStats = useMemo<WeekStats>(() => {
        const stats: WeekStats = {
            plannedTSS: 0, plannedDuration: 0, actualDuration: 0, distance: 0,
            completed: 0, completedTSS: 0, total: 0, plannedCount: 0,
            sportBreakdown: { cycling: 0, running: 0, swimming: 0, other: 0 },
            sportDuration: { cycling: 0, running: 0, swimming: 0, other: 0 },
        };
        const dates = new Set(
            selectedWeek.filter((d): d is Date => d !== null).map(d => formatDateKey(d))
        );
        scheduleData.workouts.forEach(w => {
            if (!dates.has(w.date)) return;
            stats.total++;
            stats.plannedTSS += w.plannedData?.plannedTSS ?? 0;
            stats.plannedDuration += w.plannedData?.durationMinutes ?? 0;
            if (w.status === 'pending') stats.plannedCount++;
            const sport = w.sportType as keyof typeof stats.sportBreakdown;
            if (stats.sportBreakdown[sport] !== undefined) {
                stats.sportBreakdown[sport]++;
            }
            if (w.status === 'completed' && w.completedData) {
                stats.completed++;
                stats.actualDuration += w.completedData.actualDurationMinutes;
                stats.distance += w.completedData.distanceKm ?? 0;
                stats.completedTSS += getWorkoutTSS(w);
                if (stats.sportDuration[sport] !== undefined) {
                    stats.sportDuration[sport] += w.completedData.actualDurationMinutes;
                }
            }
        });
        return stats;
    }, [selectedWeek, scheduleData.workouts]);

    const { isPastWeek, isFarFuture, weeksAhead } = useMemo(() => {
        const today = new Date();
        const day = today.getDay();
        const daysToMon = day === 0 ? -6 : 1 - day;
        const thisMonday = new Date(today);
        thisMonday.setDate(today.getDate() + daysToMon);
        thisMonday.setHours(0, 0, 0, 0);

        const weekStart = weekStartDate ? new Date(weekStartDate + 'T00:00:00') : null;
        const past = weekStart ? weekStart < thisMonday : false;
        const ahead = weekStart
            ? Math.round((weekStart.getTime() - thisMonday.getTime()) / (7 * 24 * 60 * 60 * 1000))
            : 0;
        return { isPastWeek: past, isFarFuture: ahead >= 2, weeksAhead: ahead };
    }, [weekStartDate]);

    return (
        <div className="space-y-4">

            {/* ── Horizontal Day Strip (multi-month, lazy-loaded) ── */}
            <div
                ref={scrollRef}
                className="flex gap-1 overflow-x-auto pb-1 items-end"
                style={{
                    scrollbarWidth: 'none',
                    msOverflowStyle: 'none',
                    scrollSnapType: 'x mandatory',
                    paddingLeft: 'calc(50% - 23px)',
                    paddingRight: 'calc(50% - 23px)',
                }}
            >
                {allDays.map((date, idx) => {
                    const key = formatDateKey(date);
                    const wks = workoutsByDate.get(key) ?? [];
                    const dayObjs = objectivesByDate.get(key) ?? [];
                    const hasPrimary = dayObjs.some(o => o.priority === 'principale');
                    const hasSecondary = !hasPrimary && dayObjs.length > 0;

                    return (
                        <DayButton
                            key={key}
                            date={date}
                            dateKey={key}
                            isSelected={key === selectedKey}
                            isToday={key === todayKey}
                            workouts={wks}
                            hasPrimary={hasPrimary}
                            hasSecondary={hasSecondary}
                            isFirstOfMonth={date.getDate() === 1}
                            showSeparator={idx > 0}
                            onSelect={onSelectDay}
                        />
                    );
                })}
            </div>

            {/* ── Week Summary Bar ── */}
            <MobileWeekBar
                stats={weekStats}
                weekStartDate={weekStartDate}
                isPastWeek={isPastWeek}
                isFarFuture={isFarFuture}
                weeksAhead={weeksAhead}
                profileAvailability={profile.weeklyAvailability}
                activeSports={profile.activeSports}
                onRefresh={onRefresh}
                onOpenGenModal={onOpenGenModal}
            />

            {/* ── Selected Day Header ── */}
            <div className="flex items-center justify-between px-1">
                <div>
                    <p className="text-[11px] font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                        {(() => {
                            const d = daysByKey.get(selectedKey) ?? selectedDay;
                            return `${getDayLabel(d)} ${d.getDate()} ${MONTH_NAMES[d.getMonth()]}`;
                        })()}
                    </p>
                    <p className="text-xs text-slate-500 mt-0.5">
                        {dayWorkouts.length > 0
                            ? `${dayWorkouts.length} séance${dayWorkouts.length > 1 ? 's' : ''}`
                            : 'Aucune séance planifiée'}
                        {dayObjectives.length > 0 && (
                            <span className="text-rose-600 dark:text-rose-400 ml-1">
                                · {dayObjectives.length} objectif{dayObjectives.length > 1 ? 's' : ''}
                            </span>
                        )}
                    </p>
                </div>
                <button
                    onClick={e => onOpenManualModal(e, daysByKey.get(selectedKey) ?? selectedDay)}
                    className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 active:bg-slate-200 dark:active:bg-slate-700 rounded-xl text-slate-600 dark:text-slate-300 text-sm font-medium transition-colors border border-slate-200/60 dark:border-slate-700/60"
                >
                    <Plus size={14} />
                    Ajouter
                </button>
            </div>

            {/* ── Objective Cards ── */}
            {dayObjectives.length > 0 && (
                <div className="space-y-2">
                    {dayObjectives.map(obj => {
                        const isPrimary = obj.priority === 'principale';
                        return (
                            <div
                                key={obj.id}
                                onClick={() => onEditObjective(obj)}
                                className={`flex items-start gap-2.5 p-3 rounded-xl border cursor-pointer transition-colors ${isPrimary
                                    ? 'bg-rose-50 dark:bg-rose-950/40 border-rose-200 dark:border-rose-500/40'
                                    : 'bg-amber-50 dark:bg-amber-950/30 border-amber-200 dark:border-amber-500/30'
                                    }`}
                            >
                                <div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${isPrimary ? 'bg-rose-100 dark:bg-rose-600/20 border border-rose-200 dark:border-rose-500/30' : 'bg-amber-100 dark:bg-amber-600/20 border border-amber-200 dark:border-amber-500/30'
                                    }`}>
                                    {isPrimary
                                        ? <Trophy size={13} className="text-rose-600 dark:text-rose-400" />
                                        : <Target size={13} className="text-amber-600 dark:text-amber-400" />
                                    }
                                </div>
                                <div className="flex-1 min-w-0">
                                    <div className="flex items-center gap-1.5 flex-wrap">
                                        <span className="text-slate-900 dark:text-white text-sm font-semibold truncate">{obj.name}</span>
                                        <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full border ${isPrimary
                                            ? 'text-rose-600 dark:text-rose-400 bg-rose-100 dark:bg-rose-500/10 border-rose-200 dark:border-rose-500/30'
                                            : 'text-amber-600 dark:text-amber-400 bg-amber-100 dark:bg-amber-500/10 border-amber-200 dark:border-amber-500/30'
                                            }`}>
                                            {isPrimary ? 'Principal' : 'Secondaire'}
                                        </span>
                                    </div>
                                    <p className="text-slate-500 text-xs mt-0.5">{SPORT_LABELS[obj.sport] ?? obj.sport}</p>
                                    <div className="flex flex-wrap gap-2.5 mt-1">
                                        <span className="flex items-center gap-1 text-xs text-slate-500 dark:text-slate-400">
                                            <Calendar size={9} />
                                            {parseLocalDate(obj.date).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' })}
                                        </span>
                                        {obj.distanceKm && (
                                            <span className="flex items-center gap-1 text-xs text-slate-500 dark:text-slate-400">
                                                <MapPin size={9} />
                                                {obj.distanceKm} km
                                            </span>
                                        )}
                                        {obj.elevationGainM && (
                                            <span className="flex items-center gap-1 text-xs text-slate-500 dark:text-slate-400">
                                                <Mountain size={9} />
                                                {obj.elevationGainM} m D+
                                            </span>
                                        )}
                                    </div>
                                    {obj.comment && (
                                        <p className="text-slate-500 text-xs mt-1 italic line-clamp-1">{obj.comment}</p>
                                    )}
                                </div>
                            </div>
                        );
                    })}
                </div>
            )}

            {/* Divider */}
            <div className="h-px bg-slate-200 dark:bg-slate-800/80" />

            {/* ── Day Workouts ── */}
            {dayWorkouts.length > 0 ? (
                <div className="space-y-3">
                    {dayWorkouts.map(workout => (
                        <WorkoutBadge
                            key={workout.id}
                            workout={workout}
                            href={`/seance/${workout.id}?retour=agenda`}
                            isCompact={false}
                        />
                    ))}
                </div>
            ) : (
                <div className="flex flex-col items-center justify-center py-10 gap-3">
                    <div className="w-14 h-14 rounded-2xl bg-slate-100/60 dark:bg-slate-800/50 flex items-center justify-center">
                        <BedDouble size={22} className="text-slate-400 dark:text-slate-600" />
                    </div>
                    <div className="text-center">
                        <p className="text-sm text-slate-500">Jour de repos</p>
                        <p className="text-xs text-slate-500 dark:text-slate-600 mt-0.5">Aucune séance planifiée</p>
                    </div>
                </div>
            )}
        </div>
    );
}
