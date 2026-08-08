'use client';

import React, { useState, useCallback, useRef, useEffect } from 'react';
import { ChevronLeft, ChevronRight, Plus, Info, X, Target, Home, Dumbbell, Trophy, Zap, CalendarPlus } from 'lucide-react';
import type { Workout, Profile, Objective } from '@/lib/data/DatabaseTypes';
import type { SportType } from '@/lib/data/type';
import { Button } from '@/components/ui/Button';
import { ManualWorkoutModal } from '../workout/ManualWorkoutModal';
import { CreatePlannedWorkoutModal } from '../workout/CreatePlannedWorkoutModal';
import { GenerationModal } from './GenerationModal';
import { ObjectiveModal } from './ObjectiveModal';
import { CalendarGrid } from '@/components/features/calendar/CalendarGrid';
import { MobileCalendarStrip } from '@/components/features/calendar/MobileCalendarStrip';
import { useCalendarDays } from '@/hooks/useCalendarDays';
import { MONTH_NAMES } from '@/lib/utils';
import { Schedule } from '@/lib/data/DatabaseTypes';
import { useSubscription } from '@/lib/subscription/context';
import { FeatureGate } from '@/components/features/billing/FeatureGate';
import { useRouter } from 'next/navigation';
import { CalendarProvider } from './CalendarContext';
import { TriathlonEasterEgg } from './TriathlonEasterEgg';

interface CalendarViewProps {
    scheduleData: Schedule;
    profile: Profile;
    userID: string;
    objectives: Objective[];
    onGenerate: (blockFocus: string, customTheme: string | null, startDate: string, numWeeks: number, availability: { [key: string]: import('@/lib/data/type').AvailabilitySlot }) => void;
    onGenerateToObjective: (planStartDate: string, availability: { [key: string]: import('@/lib/data/type').AvailabilitySlot }) => Promise<void>;
    onAddManualWorkout: (workout: Workout) => void;
    onCreatePlannedWorkoutAI: (dateStr: string, sportType: SportType, duration: number, comment: string) => Promise<void>;
    onSaveObjective: (obj: Objective) => Promise<void>;
    onRefresh: () => void;
    onMoveWorkout: (workoutId: string, newDateStr: string) => Promise<void>;
    onSyncStrava?: () => void;
    isSyncing?: boolean;
    calendarDate: Date;
    onCalendarDateChange: (date: Date) => void;
    calendarMobileDay: Date;
    onCalendarMobileDayChange: (date: Date) => void;
}

export function CalendarView({
    scheduleData,
    profile,
    userID,
    objectives,
    onGenerate,
    onGenerateToObjective,
    onAddManualWorkout,
    onCreatePlannedWorkoutAI,
    onSaveObjective,
    onRefresh,
    onMoveWorkout,
    onSyncStrava,
    isSyncing = false,
    calendarDate,
    onCalendarDateChange: setSelectedDate,
    calendarMobileDay,
    onCalendarMobileDayChange: setSelectedMobileDay,
}: CalendarViewProps) {
    const selectedDate = calendarDate ?? new Date();
    const selectedMobileDay = calendarMobileDay ?? new Date();
    const [showGenModal, setShowGenModal] = useState(false);
    const [showManualModal, setShowManualModal] = useState(false);
    const [showPlannedModal, setShowPlannedModal] = useState(false);
    const [showObjectiveModal, setShowObjectiveModal] = useState(false);
    const [showDayActionModal, setShowDayActionModal] = useState(false);
    const [showSummaryModal, setShowSummaryModal] = useState(false);
    const [dateForAction, setDateForAction] = useState<Date | null>(null);
    const [isGenerating, setIsGenerating] = useState(false);
    const [isSavingObjective, setIsSavingObjective] = useState(false);
    const [showRecalcPrompt, setShowRecalcPrompt] = useState(false);
    const [editingObjective, setEditingObjective] = useState<Objective | null>(null);
    const [easterEgg, setEasterEgg] = useState(false);

    // Defer strava connection check to client only to avoid SSR/client mismatch
    const [isStravaConnected, setIsStravaConnected] = useState(true);
    useEffect(() => {
        setIsStravaConnected(!!profile.strava?.athleteId);
    }, [profile.strava?.athleteId]);
    const longPressRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    const { year, month, weekRows } = useCalendarDays(selectedDate);
    const { plan } = useSubscription();
    const router = useRouter();
    // Displayed month on mobile (updated by scroll, separate from calendarDate to avoid regenerating the day strip)
    const [mobileDisplayMonth, setMobileDisplayMonth] = useState<{ year: number; month: number }>({ year, month });

    // --- Handlers ---
    const handleGeneratePlan = async (
        blockFocus: string,
        customTheme: string | null,
        startDate: string,
        numWeeks: number,
        availability: { [key: string]: import('@/lib/data/type').AvailabilitySlot }
    ) => {
        setIsGenerating(true);
        try {
            onGenerate(blockFocus, customTheme, startDate, numWeeks, availability);
        } finally {
            setIsGenerating(false);
        }
    };

    // Intercept "+" click → show action choice modal
    const handleOpenDayAction = (e: React.MouseEvent, date: Date) => {
        e.stopPropagation();
        setDateForAction(date);
        setShowDayActionModal(true);
    };

    const handlePickWorkout = () => {
        setShowDayActionModal(false);
        setShowManualModal(true);
    };

    const handlePickPlannedWorkout = () => {
        setShowDayActionModal(false);
        setShowPlannedModal(true);
    };

    const handlePickObjective = () => {
        setShowDayActionModal(false);
        setEditingObjective(null);
        setShowObjectiveModal(true);
    };

    const handleEditObjective = (obj: Objective) => {
        setEditingObjective(obj);
        setShowObjectiveModal(true);
    };

    const handleSaveManual = async (workout: Workout) => {
        await onAddManualWorkout(workout);
        setShowManualModal(false);
    };

    const handleSaveObjective = async (obj: Objective) => {
        setIsSavingObjective(true);
        try {
            await onSaveObjective(obj);
            setShowObjectiveModal(false);
            setShowRecalcPrompt(true);
        } finally {
            setIsSavingObjective(false);
        }
    };

    const goToMonthDay = (newYear: number, newMonth: number) => {
        const normalized = new Date(newYear, newMonth);
        setSelectedDate(normalized);
        setMobileDisplayMonth({ year: normalized.getFullYear(), month: normalized.getMonth() });
        const today = new Date();
        if (today.getFullYear() === normalized.getFullYear() && today.getMonth() === normalized.getMonth()) {
            setSelectedMobileDay(today);
        } else {
            setSelectedMobileDay(new Date(normalized.getFullYear(), normalized.getMonth(), 1));
        }
    };

    const handlePrevMonth = () => {
        const d = new Date(mobileDisplayMonth.year, mobileDisplayMonth.month - 1);
        goToMonthDay(d.getFullYear(), d.getMonth());
    };
    const handleActualMonth = () => {
        const today = new Date();
        setSelectedDate(new Date(today.getFullYear(), today.getMonth()));
        setMobileDisplayMonth({ year: today.getFullYear(), month: today.getMonth() });
        setSelectedMobileDay(today);
    };
    const handleNextMonth = () => {
        const d = new Date(mobileDisplayMonth.year, mobileDisplayMonth.month + 1);
        goToMonthDay(d.getFullYear(), d.getMonth());
    };

    // Called by mobile strip when user scrolls to a different month — only updates display, not the day strip
    const handleVisibleMonthChange = useCallback((newYear: number, newMonth: number) => {
        setMobileDisplayMonth({ year: newYear, month: newMonth });
    }, []);

    return (
        <div className="space-y-4 md:space-y-6 animate-in fade-in duration-500 pb-20 md:pb-0">

            {/* Header Controls & Title */}
            <div className="flex flex-col xl:flex-row xl:items-center justify-between gap-4 sticky top-[60px] z-30 bg-slate-100/95 dark:bg-slate-950/95 py-2 backdrop-blur-md xl:static xl:bg-transparent border-b xl:border-none border-slate-200/80 dark:border-slate-800/50">
                <div className="flex items-center justify-between w-full xl:w-auto">
                    <div className="flex items-center space-x-2 md:space-x-4">
                        {/* Navigation Mois */}
                        <div className="flex items-center bg-slate-50 dark:bg-slate-900/50 rounded-full p-1 border border-slate-200 dark:border-slate-800">
                            <button
                                onClick={handlePrevMonth}
                                className="p-1.5 hover:bg-slate-200 dark:hover:bg-slate-700 rounded-full text-slate-500 dark:text-slate-400 transition-colors"
                            >
                                <ChevronLeft size={18} />
                            </button>
                            {/* Desktop: month from calendarDate / Mobile: month from scroll position */}
                            <h2
                                className="text-lg md:text-xl font-bold text-slate-900 dark:text-white w-40 md:w-[180px] text-center capitalize px-1 select-none cursor-default"
                                onMouseDown={() => {
                                    if (easterEgg) return;
                                    longPressRef.current = setTimeout(() => setEasterEgg(true), 3000);
                                }}
                                onMouseUp={() => { if (longPressRef.current) { clearTimeout(longPressRef.current); longPressRef.current = null; } }}
                                onMouseLeave={() => { if (longPressRef.current) { clearTimeout(longPressRef.current); longPressRef.current = null; } }}
                                onTouchStart={() => {
                                    if (easterEgg) return;
                                    longPressRef.current = setTimeout(() => setEasterEgg(true), 3000);
                                }}
                                onTouchEnd={() => { if (longPressRef.current) { clearTimeout(longPressRef.current); longPressRef.current = null; } }}
                                onTouchMove={() => { if (longPressRef.current) { clearTimeout(longPressRef.current); longPressRef.current = null; } }}
                            >
                                <span className="hidden md:inline">{MONTH_NAMES[month]} {year}</span>
                                <span className="md:hidden">{MONTH_NAMES[mobileDisplayMonth.month]} {mobileDisplayMonth.year}</span>
                            </h2>
                            <button
                                onClick={handleNextMonth}
                                className="p-1.5 hover:bg-slate-200 dark:hover:bg-slate-700 rounded-full text-slate-500 dark:text-slate-400 transition-colors"
                            >
                                <ChevronRight size={18} />
                            </button>
                            <div className="h-6 w-px bg-slate-200 dark:bg-slate-800 mx-1" />
                            <button
                                onClick={handleActualMonth}
                                className="p-1.5 hover:bg-slate-200 dark:hover:bg-slate-700 rounded-full text-slate-500 dark:text-slate-400 transition-colors"
                            >
                                <Home size={18} />
                            </button>
                        </div>

                        <button
                            onClick={() => {
                                if (isStravaConnected) {
                                    onSyncStrava?.();
                                } else {
                                    window.location.href = '/api/strava/login';
                                }
                            }}
                            disabled={isStravaConnected && isSyncing}
                            className={isStravaConnected
                                ? `flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-all border border-orange-500/30 text-orange-600 dark:text-orange-400 hover:bg-orange-500/10 hover:border-orange-500/60 ${isSyncing ? 'opacity-50 cursor-not-allowed' : ''}`
                                : 'flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-all border border-orange-500/30 text-white bg-[#FC4C02] hover:bg-[#e04400] hover:border-orange-500/60'
                            }
                            title={isStravaConnected ? 'Synchroniser avec Strava' : 'Connecter Strava'}
                        >
                            {isStravaConnected ? (
                                <svg
                                    className={`w-4 h-4 ${isSyncing ? 'animate-spin' : ''}`}
                                    fill="none"
                                    viewBox="0 0 24 24"
                                    stroke="currentColor"
                                >
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                                </svg>
                            ) : (
                                <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
                                    <path d="M15.387 17.944l-2.089-4.116h-3.065L15.387 24l5.15-10.172h-3.066m-7.008-5.599l2.836 5.598h4.172L10.463 0l-7 13.828h4.169" />
                                </svg>
                            )}
                            <span className="hidden sm:inline">
                                {isStravaConnected ? (isSyncing ? 'Synchro...' : 'Strava') : 'Connecter Strava'}
                            </span>
                        </button>
                    </div>

                    {scheduleData.summary && (
                        <button
                            onClick={() => setShowSummaryModal(true)}
                            className="xl:hidden ml-2 p-2 bg-blue-100 dark:bg-blue-500/10 text-blue-600 dark:text-blue-400 rounded-full border border-blue-200 dark:border-blue-500/20 hover:bg-blue-100 dark:hover:bg-blue-500/20 transition-colors animate-pulse"
                            title="Voir la stratégie"
                        >
                            <Info size={20} />
                        </button>
                    )}

                    {/* Mobile Action Buttons */}
                    <div className="flex xl:hidden gap-2 ml-auto pl-2">
                        <FeatureGate feature="generate-plan" mode="modal" label="Générer un plan IA">
                            <button
                                onClick={() => setShowGenModal(true)}
                                className="p-2 bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors shadow-lg shadow-blue-500/20 dark:shadow-blue-900/20"
                            >
                                <Plus size={20} className="text-white" />
                            </button>
                        </FeatureGate>
                    </div>
                </div>

                {/* Desktop Buttons */}
                <div className="hidden xl:flex items-center gap-3">
                    {/* Badge plan */}
                    {plan === 'dev' && (
                        <button
                            onClick={() => router.push('/pricing')}
                            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-amber-500/30 bg-amber-50 dark:bg-amber-500/5 hover:bg-amber-100 dark:hover:bg-amber-500/10 transition-colors"
                            title="Gérer mon abonnement"
                        >
                            <Zap size={11} className="text-amber-600 dark:text-amber-400" />
                            <span className="text-amber-600 dark:text-amber-300 text-xs font-bold tracking-wider">DEV BÊTA</span>
                        </button>
                    )}
                    {plan === 'pro' && (
                        <span className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-green-500/30 bg-green-100 dark:bg-green-500/5">
                            <Zap size={11} className="text-green-600 dark:text-green-400" />
                            <span className="text-green-600 dark:text-green-300 text-xs font-bold tracking-wider">PRO</span>
                        </span>
                    )}
                    {plan === 'free' && (
                        <span className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-blue-500/30 bg-blue-100 dark:bg-blue-500/5">
                            <Zap size={11} className="text-blue-600 dark:text-blue-400" />
                            <span className="text-blue-600 dark:text-blue-300 text-xs font-bold tracking-wider">GRATUIT</span>
                        </span>
                    )}

                    {scheduleData.summary && (
                        <button
                            onClick={() => setShowSummaryModal(true)}
                            className="flex items-center gap-2 px-3 py-2 text-sm font-medium text-blue-600 dark:text-blue-300 hover:text-slate-900 dark:hover:text-white bg-blue-50 dark:bg-blue-950/30 hover:bg-blue-100 dark:hover:bg-blue-900/50 border border-blue-200 dark:border-blue-500/30 rounded-lg transition-all"
                        >
                            <Info size={16} />
                            <span>Stratégie du bloc</span>
                        </button>
                    )}
                    <div className="h-6 w-px bg-slate-200 dark:bg-slate-800 mx-1" />
                    <FeatureGate feature="generate-plan" mode="modal" label="Générer un plan IA">
                        <Button
                            variant="primary"
                            icon={Plus}
                            onClick={() => setShowGenModal(true)}
                            disabled={isGenerating}
                        >
                            Calculer un nouveau plan
                        </Button>
                    </FeatureGate>
                </div>
            </div>


            {/* Loading Indicator */}
            {isGenerating && (
                <div className="w-full bg-slate-100 dark:bg-slate-800 rounded-lg p-3 text-center text-blue-600 dark:text-blue-400 flex items-center justify-center gap-3 animate-pulse border border-slate-300 dark:border-slate-700">
                    <div className="w-4 h-4 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
                    <p className="text-sm font-medium">L&apos;IA prépare votre plan...</p>
                </div>
            )}

            <CalendarProvider value={{
                scheduleData,
                profile,
                objectives,
                onEditObjective: handleEditObjective,
                onRefresh,
                onOpenGenModal: () => setShowGenModal(true),
                onMoveWorkout,
            }}>
                {/* Desktop Calendar Grid */}
                <div className="hidden md:block">
                    <CalendarGrid
                        weekRows={weekRows}
                        currentMonth={month}
                        currentYear={year}
                        onOpenManualModal={handleOpenDayAction}
                    />
                </div>

                {/* Mobile Strip */}
                <div className="md:hidden">
                    <MobileCalendarStrip
                        weekRows={weekRows}
                        currentMonth={month}
                        currentYear={year}
                        selectedDay={selectedMobileDay}
                        onSelectDay={setSelectedMobileDay}
                        onOpenManualModal={handleOpenDayAction}
                        onVisibleMonthChange={handleVisibleMonthChange}
                    />
                </div>
            </CalendarProvider>

            {/* --- MODALS --- */}

            {/* Popup Résumé Stratégie */}
            {showSummaryModal && scheduleData.summary && (
                <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm animate-in fade-in duration-200">
                    <div
                        className="bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-2xl max-w-lg w-full shadow-2xl overflow-hidden animate-in zoom-in-95 duration-200"
                        onClick={(e) => e.stopPropagation()}
                    >
                        <div className="bg-linear-to-r from-blue-900/20 to-slate-900 p-4 border-b border-slate-200 dark:border-slate-800 flex justify-between items-center">
                            <div className="flex items-center gap-3">
                                <div className="bg-blue-100 dark:bg-blue-500/20 p-2 rounded-lg">
                                    <Target className="text-blue-600 dark:text-blue-400" size={20} />
                                </div>
                                <h3 className="text-slate-900 dark:text-white font-bold text-lg">Stratégie du Bloc</h3>
                            </div>
                            <button onClick={() => setShowSummaryModal(false)} className="text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800 rounded-full p-2 transition-colors">
                                <X size={20} />
                            </button>
                        </div>
                        <div className="p-6">
                            <p className="text-slate-600 dark:text-slate-300 text-base leading-relaxed italic border-l-4 border-blue-500/50 pl-4 py-1">
                                &quot;{scheduleData.summary}&quot;
                            </p>
                        </div>
                        <div className="p-4 bg-slate-100/80 dark:bg-slate-950/50 border-t border-slate-200 dark:border-slate-800 flex justify-end">
                            <Button variant="outline" onClick={() => setShowSummaryModal(false)} className="text-sm">
                                Fermer
                            </Button>
                        </div>
                    </div>
                    <div className="absolute inset-0 -z-10" onClick={() => setShowSummaryModal(false)} />
                </div>
            )}

            {/* Choix action du jour (séance ou objectif) */}
            {showDayActionModal && dateForAction && (
                <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in duration-200">
                    <div
                        className="bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-2xl w-full max-w-sm shadow-2xl overflow-hidden animate-in slide-in-from-bottom-4 sm:zoom-in-95 duration-200"
                        onClick={e => e.stopPropagation()}
                    >
                        <div className="p-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
                            <p className="text-slate-900 dark:text-white font-semibold text-sm">
                                {dateForAction.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' })}
                            </p>
                            <button onClick={() => setShowDayActionModal(false)} className="text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white p-1 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors">
                                <X size={16} />
                            </button>
                        </div>
                        <div className="p-3 space-y-2">
                            <button
                                onClick={handlePickPlannedWorkout}
                                className="w-full flex items-center gap-3 p-3.5 rounded-xl bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 border border-slate-300 dark:border-slate-700 hover:border-slate-300 dark:hover:border-slate-600 transition-all text-left"
                            >
                                <div className="w-9 h-9 rounded-lg bg-emerald-100 dark:bg-emerald-600/20 border border-emerald-200 dark:border-emerald-500/30 flex items-center justify-center shrink-0">
                                    <CalendarPlus size={16} className="text-emerald-600 dark:text-emerald-400" />
                                </div>
                                <div>
                                    <p className="text-slate-900 dark:text-white text-sm font-medium">Générer un entraînement IA</p>
                                    <p className="text-slate-500 text-xs">L&apos;IA crée une séance adaptée à ton plan</p>
                                </div>
                            </button>
                            <button
                                onClick={handlePickWorkout}
                                className="w-full flex items-center gap-3 p-3.5 rounded-xl bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 border border-slate-300 dark:border-slate-700 hover:border-slate-300 dark:hover:border-slate-600 transition-all text-left"
                            >
                                <div className="w-9 h-9 rounded-lg bg-blue-100 dark:bg-blue-600/20 border border-blue-200 dark:border-blue-500/30 flex items-center justify-center shrink-0">
                                    <Dumbbell size={16} className="text-blue-600 dark:text-blue-400" />
                                </div>
                                <div>
                                    <p className="text-slate-900 dark:text-white text-sm font-medium">Enregistrer une activité</p>
                                    <p className="text-slate-500 text-xs">Ajouter manuellement une séance déjà réalisée</p>
                                </div>
                            </button>
                            <button
                                onClick={handlePickObjective}
                                className="w-full flex items-center gap-3 p-3.5 rounded-xl bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 border border-slate-300 dark:border-slate-700 hover:border-slate-300 dark:hover:border-slate-600 transition-all text-left"
                            >
                                <div className="w-9 h-9 rounded-lg bg-rose-100 dark:bg-rose-600/20 border border-rose-200 dark:border-rose-500/30 flex items-center justify-center shrink-0">
                                    <Trophy size={16} className="text-rose-600 dark:text-rose-400" />
                                </div>
                                <div>
                                    <p className="text-slate-900 dark:text-white text-sm font-medium">Ajouter un objectif</p>
                                    <p className="text-slate-500 text-xs">Course, triathlon, cyclosportive...</p>
                                </div>
                            </button>
                        </div>
                    </div>
                    <div className="absolute inset-0 -z-10" onClick={() => setShowDayActionModal(false)} />
                </div>
            )}

            {/* Modal recalcul plan après ajout objectif */}
            {showRecalcPrompt && (
                <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in duration-200">
                    <div
                        className="bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-2xl max-w-sm w-full shadow-2xl p-5 animate-in zoom-in-95 duration-200"
                        onClick={e => e.stopPropagation()}
                    >
                        <div className="flex items-center gap-3 mb-3">
                            <div className="w-10 h-10 rounded-xl bg-rose-100 dark:bg-rose-600/20 border border-rose-200 dark:border-rose-500/30 flex items-center justify-center shrink-0">
                                <Trophy size={18} className="text-rose-600 dark:text-rose-400" />
                            </div>
                            <div>
                                <p className="text-slate-900 dark:text-white font-semibold text-sm">Objectif ajouté !</p>
                                <p className="text-slate-500 dark:text-slate-400 text-xs">Voulez-vous recalculer le plan ?</p>
                            </div>
                        </div>
                        <p className="text-slate-500 dark:text-slate-400 text-xs mb-4 leading-relaxed">
                            Recalculer le plan va remplacer votre plan actif et générer un nouveau programme adapté à votre objectif.
                        </p>
                        <div className="flex gap-2">
                            <button
                                onClick={() => setShowRecalcPrompt(false)}
                                className="flex-1 py-2 px-3 rounded-lg bg-slate-100 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 text-slate-600 dark:text-slate-300 text-sm hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors"
                            >
                                Non, garder le plan
                            </button>
                            <button
                                onClick={async () => {
                                    setShowRecalcPrompt(false);
                                    setShowGenModal(true);
                                }}
                                className="flex-1 py-2 px-3 rounded-lg bg-rose-600 hover:bg-rose-500 text-white text-sm font-medium transition-colors"
                            >
                                Recalculer
                            </button>
                        </div>
                    </div>
                    <div className="absolute inset-0 -z-10" onClick={() => setShowRecalcPrompt(false)} />
                </div>
            )}

            {showGenModal && (
                <GenerationModal
                    isOpen={showGenModal}
                    onClose={() => setShowGenModal(false)}
                    onGenerate={handleGeneratePlan}
                    onGenerateToObjective={onGenerateToObjective}
                    isGenerating={isGenerating}
                    objectives={objectives}
                    profile={profile}
                />
            )}

            {showManualModal && dateForAction && (
                <ManualWorkoutModal
                    date={dateForAction}
                    userID={userID}
                    onClose={() => setShowManualModal(false)}
                    onSave={handleSaveManual}
                />
            )}

            {showPlannedModal && dateForAction && (
                <CreatePlannedWorkoutModal
                    date={dateForAction}
                    onClose={() => setShowPlannedModal(false)}
                    onCreateAI={onCreatePlannedWorkoutAI}
                />
            )}

            {showObjectiveModal && (
                <ObjectiveModal
                    isOpen={showObjectiveModal}
                    onClose={() => { setShowObjectiveModal(false); setEditingObjective(null); }}
                    onSave={handleSaveObjective}
                    initial={editingObjective}
                    initialDate={editingObjective ? undefined : (dateForAction ? `${dateForAction.getFullYear()}-${String(dateForAction.getMonth() + 1).padStart(2, '0')}-${String(dateForAction.getDate()).padStart(2, '0')}` : undefined)}
                    isSaving={isSavingObjective}
                />
            )}
            <TriathlonEasterEgg active={easterEgg} onDone={() => setEasterEgg(false)} />
        </div>
    );
}
