'use client';

import { createContext, useContext } from 'react';
import type { Schedule, Profile, Objective, Workout } from '@/lib/data/DatabaseTypes';

interface CalendarContextValue {
    scheduleData: Schedule;
    profile: Profile;
    objectives: Objective[];
    onViewWorkout: (workout: Workout) => void;
    onEditObjective: (obj: Objective) => void;
    onRefresh: () => void;
    onOpenGenModal: () => void;
    onMoveWorkout: (workoutId: string, newDateStr: string) => Promise<void> | void;
}

const CalendarContext = createContext<CalendarContextValue | null>(null);

export function CalendarProvider({
    children,
    value,
}: {
    children: React.ReactNode;
    value: CalendarContextValue;
}) {
    return (
        <CalendarContext.Provider value={value}>
            {children}
        </CalendarContext.Provider>
    );
}

export function useCalendarContext(): CalendarContextValue {
    const ctx = useContext(CalendarContext);
    if (!ctx) throw new Error('useCalendarContext must be used within CalendarProvider');
    return ctx;
}
