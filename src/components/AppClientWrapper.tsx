'use client';

import React, { useState, useCallback, useEffect, useRef } from 'react';

// Import des Server Actions (par sous-module schedule)
import { saveAthleteProfile, loadInitialData, type ActivePlanSummary } from '@/app/actions/schedule/profile';
import { CreateAdvancedPlan, CreatePlanToObjective } from '@/app/actions/schedule/plan-creation';
import {
    updateWorkoutStatus,
    toggleWorkoutMode,
    moveWorkout,
    addManualWorkout,
    deleteWorkout,
    unlinkStravaWorkout,
} from '@/app/actions/schedule/workout-actions';
import { regenerateWorkout, createPlannedWorkoutAI } from '@/app/actions/schedule/workout-ai';
import { syncStravaActivities } from '@/app/actions/schedule/strava-sync';
import {
    saveObjectiveAction,
    deleteObjectiveAction,
} from '@/app/actions/objectives';

// Import des types
import type { CompletedDataFeedback, SportType } from '@/lib/data/type';
import type { Objective, Workout } from '@/lib/data/DatabaseTypes';
import { SubscriptionProvider, type Plan } from '@/lib/subscription/context';
import { FreePlanGate } from '@/components/features/billing/FreePlanGate';

// Import des composants
import { CalendarView } from '@/components/features/calendar/CalendarView';
import { ProfileForm } from '@/components/features/profile/ProfileForm';
import { StatsView } from '@/components/features/stats/StatsView';
import { WorkoutDetailView } from '@/components/features/workout/WorkoutDetailView';
import { Nav, View } from '@/components/layout/nav';
import { ChatView, type Message as ChatMessage } from '@/components/features/chat/ChatView';
import { PlanView } from '@/components/features/plan/PlanView';
import { GenerationProgressModal, type GenProgressState } from '@/components/features/calendar/GenerationProgressModal';
import { ConfirmReplacePlanModal } from '@/components/features/plan/ConfirmReplacePlanModal';
import { TutorialOverlay } from '@/components/features/tutorial/TutorialOverlay';
import { WelcomeScreen } from '@/components/features/tutorial/WelcomeScreen';
import { Card } from '@/components/ui';
import { createCompletedData } from '@/lib/utils';
import { Profile, Schedule } from '@/lib/data/DatabaseTypes';
import { useTheme } from '@/components/ThemeProvider';

// Definition des Props reçues du Server Component
interface AppClientWrapperProps {
    initialProfile: Profile;
    initialSchedule: Schedule;
    initialObjectives: Objective[];
    initialActivePlan: ActivePlanSummary | null;
}

// --- Composant Principal ---
export default function AppClientWrapper({ initialProfile, initialSchedule, initialObjectives, initialActivePlan }: AppClientWrapperProps) {

    // --- Sync theme from DB profile ---
    const { setThemeFromProfile } = useTheme();
    const themeAppliedRef = useRef(false);
    useEffect(() => {
        if (!themeAppliedRef.current && initialProfile.theme) {
            setThemeFromProfile(initialProfile.theme);
            themeAppliedRef.current = true;
        }
    }, [initialProfile.theme, setThemeFromProfile]);

    // --- State Management ---
    const startView: View = initialProfile.firstName ? 'dashboard' : 'welcome';
    const [view, setView] = useState<View>(startView);

    const [profile, setProfile] = useState<Profile>(initialProfile);
    const [schedule, setSchedule] = useState<Schedule | null>(initialSchedule);
    const [objectives, setObjectives] = useState<Objective[]>(initialObjectives);
    const [activePlan, setActivePlan] = useState<ActivePlanSummary | null>(initialActivePlan);
    const [selectedWorkout, setSelectedWorkout] = useState<Workout | null>(null);
    const [previousView, setPreviousView] = useState<View>('dashboard');

    // Action de génération en attente de confirmation (popup "Remplacer le plan")
    const [pendingReplaceAction, setPendingReplaceAction] = useState<{ run: () => Promise<void> } | null>(null);

    // Calendrier — persist le mois sélectionné entre les changements de vue
    const [calendarDate, setCalendarDate] = useState(new Date());
    const [calendarMobileDay, setCalendarMobileDay] = useState(new Date());

    // Chat — persist messages while app is open
    const [chatMessages, setChatMessages] = useState<ChatMessage[]>([
        { role: 'ai', text: `Bonjour\u00a0${initialProfile?.firstName ?? ''}\u00a0! Je suis votre Coach IA PulsePeak. Posez-moi vos questions sur l'entraînement, la récupération ou votre plan.` },
    ]);

    // Etats UI
    const [error, setError] = useState<string | null>(null);
    const [isRefreshing, setIsRefreshing] = useState(false);
    const [isSyncing, setIsSyncing] = useState(false);
    const [syncResult, setSyncResult] = useState<{ message: string; type: 'success' | 'info' } | null>(null);

    const [genProgress, setGenProgress] = useState<GenProgressState | null>(null);
    const genProgressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    // Tutorial state — show after onboarding completes (first time only)
    const [showTutorial, setShowTutorial] = useState(false);

    useEffect(() => {
        return () => {
            if (genProgressTimerRef.current) clearTimeout(genProgressTimerRef.current);
        };
    }, []);

    // Listen for tutorial replay request from settings
    useEffect(() => {
        const handler = () => setShowTutorial(true);
        window.addEventListener('pulsepeak:show-tutorial', handler);
        return () => window.removeEventListener('pulsepeak:show-tutorial', handler);
    }, []);

    // --- Re-Fetch des données ---
    const refreshData = useCallback(async () => {
        try {
            setIsRefreshing(true);
            const { profile: profileData, schedule: scheduleData, objectives: objectivesData, activePlan: activePlanData } = await loadInitialData();
            setProfile(profileData as Profile);
            setSchedule(scheduleData);
            setObjectives(objectivesData);
            setActivePlan(activePlanData);
            setError(null);
        } catch (e) {
            console.error('Erreur refresh données:', e);
            setError('Erreur lors de l\'actualisation des données.');
        } finally {
            setIsRefreshing(false);
        }
    }, []);

    // --- Strava Sync Handler ---
    const profileRef = useRef(profile);
    profileRef.current = profile;

    const handleSyncStrava = useCallback(async () => {
        if (!profileRef.current.strava?.athleteId) return;
        try {
            setIsSyncing(true);
            setError(null);
            setSyncResult(null);
            const result = await syncStravaActivities();
            if (result.count && result.count > 0) {
                await refreshData();
                setSyncResult({ message: `${result.count} activité${result.count > 1 ? 's' : ''} synchronisée${result.count > 1 ? 's' : ''}`, type: 'success' });
            } else {
                setSyncResult({ message: 'A jour', type: 'info' });
            }
            setTimeout(() => setSyncResult(null), 4000);
        } catch (e) {
            console.error('Erreur synchro Strava:', e);
            setError('Impossible de synchroniser avec Strava.');
        } finally {
            setIsSyncing(false);
        }
    }, [refreshData]);

    React.useEffect(() => {
        if (!initialProfile?.firstName) return;
        if (!initialProfile?.strava?.athleteId) return;
        let cancelled = false;
        handleSyncStrava().finally(() => {
            if (cancelled) return;
        });
        return () => { cancelled = true; };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [initialProfile?.firstName, initialProfile?.strava?.athleteId]);

    // --- Navigation Handler ---
    const handleViewChange = useCallback((view: View) => {
        if (view !== 'workout-detail') {
            setSelectedWorkout(null);
        }
        setView(view);
        window.scrollTo({ top: 0, behavior: 'smooth' });
    }, []);

    // --- Onboarding → Tutorial transition ---
    // Track that we came from onboarding (first-time user flow)
    const cameFromOnboarding = useRef(startView === 'welcome');

    const handleOnboardingSuccess = useCallback(() => {
        setView('dashboard');
        setSelectedWorkout(null);
        window.scrollTo({ top: 0, behavior: 'smooth' });
        // Always show tutorial after first onboarding
        if (cameFromOnboarding.current) {
            setShowTutorial(true);
        }
    }, []);

    const handleViewWorkout = useCallback((workout: Workout) => {
        setView(current => {
            setPreviousView(current);
            return 'workout-detail';
        });
        setSelectedWorkout(workout);
    }, []);

    // --- Plan Generation Handlers ---
    // Logique de génération réelle, séparée du gate de confirmation : on l'appelle
    // soit directement (pas de plan actif), soit après que l'utilisateur a validé
    // la modale de remplacement (ConfirmReplacePlanModal).
    const runAdvancedPlan = useCallback(async (
        blockFocus: string,
        customTheme: string | null,
        startDate: string,
        numWeeks: number,
        weeklyAvailability: { [key: string]: import('@/lib/data/type').AvailabilitySlot }
    ) => {
        const p = profileRef.current;
        const sports = [
            p.activeSports.cycling ? 'Cyclisme' : '',
            p.activeSports.running ? 'Course à pied' : '',
            p.activeSports.swimming ? 'Natation' : '',
        ].filter(Boolean).join(', ');

        setGenProgress({
            active: true,
            minimized: false,
            done: false,
            startedAt: Date.now(),
            profileInfo: {
                firstName: p.firstName,
                experience: p.experience,
                currentCTL: p.currentCTL,
                sports,
            },
        });

        try {
            setIsRefreshing(true);
            await CreateAdvancedPlan(blockFocus, customTheme, startDate, numWeeks, p.id, weeklyAvailability);
            await refreshData();
            setGenProgress(prev => prev ? { ...prev, done: true, minimized: false } : null);
            if (genProgressTimerRef.current) clearTimeout(genProgressTimerRef.current);
            genProgressTimerRef.current = setTimeout(() => setGenProgress(null), 1500);
        } catch (e) {
            console.error('Erreur génération plan:', e);
            setGenProgress(null);
            setError('Impossible de générer le plan. Réessayez.');
        } finally {
            setIsRefreshing(false);
        }
    }, [refreshData]);

    const runPlanToObjective = useCallback(async (
        planStartDate: string,
        weeklyAvailability: { [key: string]: import('@/lib/data/type').AvailabilitySlot }
    ) => {
        const p = profileRef.current;
        const sports = [
            p.activeSports.cycling ? 'Cyclisme' : '',
            p.activeSports.running ? 'Course à pied' : '',
            p.activeSports.swimming ? 'Natation' : '',
        ].filter(Boolean).join(', ');

        setGenProgress({
            active: true,
            minimized: false,
            done: false,
            startedAt: Date.now(),
            profileInfo: {
                firstName: p.firstName,
                experience: p.experience,
                currentCTL: p.currentCTL,
                sports,
            },
        });

        try {
            setIsRefreshing(true);
            const result = await CreatePlanToObjective(p.id, planStartDate, weeklyAvailability);
            if ('error' in result && result.error) {
                setGenProgress(null);
                setError(result.error);
                return;
            }
            await refreshData();
            setGenProgress(prev => prev ? { ...prev, done: true, minimized: false } : null);
            if (genProgressTimerRef.current) clearTimeout(genProgressTimerRef.current);
            genProgressTimerRef.current = setTimeout(() => setGenProgress(null), 1500);
        } catch (e) {
            console.error('Erreur génération plan vers objectif:', e);
            setGenProgress(null);
            setError('Impossible de générer le plan. Réessayez.');
        } finally {
            setIsRefreshing(false);
        }
    }, [refreshData]);

    // Gate de confirmation : si un plan est déjà actif, on diffère l'appel
    // dans `pendingReplaceAction` et on affiche la modale. Sinon, exécution directe.
    const handleGenerate = useCallback(async (
        blockFocus: string,
        customTheme: string | null,
        startDate: string,
        numWeeks: number,
        weeklyAvailability: { [key: string]: import('@/lib/data/type').AvailabilitySlot }
    ) => {
        if (activePlan) {
            setPendingReplaceAction({
                run: () => runAdvancedPlan(blockFocus, customTheme, startDate, numWeeks, weeklyAvailability),
            });
            return;
        }
        await runAdvancedPlan(blockFocus, customTheme, startDate, numWeeks, weeklyAvailability);
    }, [activePlan, runAdvancedPlan]);

    const handleGenerateToObjective = useCallback(async (
        planStartDate: string,
        weeklyAvailability: { [key: string]: import('@/lib/data/type').AvailabilitySlot }
    ) => {
        if (activePlan) {
            setPendingReplaceAction({
                run: () => runPlanToObjective(planStartDate, weeklyAvailability),
            });
            return;
        }
        await runPlanToObjective(planStartDate, weeklyAvailability);
    }, [activePlan, runPlanToObjective]);

    const handleConfirmReplace = useCallback(async () => {
        const action = pendingReplaceAction;
        if (!action) return;
        // On ferme la modale AVANT de lancer la génération pour laisser place
        // à GenerationProgressModal (sinon les deux modales se superposent).
        setPendingReplaceAction(null);
        await action.run();
    }, [pendingReplaceAction]);

    const handleCancelReplace = useCallback(() => {
        setPendingReplaceAction(null);
    }, []);

    // --- Objective Handlers ---
    const handleSaveObjective = useCallback(async (obj: Objective) => {
        try {
            const result = await saveObjectiveAction(obj);
            if (result.objective) {
                setObjectives(prev => {
                    const exists = prev.some(o => o.id === result.objective!.id);
                    return exists
                        ? prev.map(o => o.id === result.objective!.id ? result.objective! : o)
                        : [...prev, result.objective!];
                });
            }
        } catch (e) {
            console.error('Erreur sauvegarde objectif:', e);
            setError('Impossible de sauvegarder l\'objectif.');
        }
    }, []);

    const handleDeleteObjective = useCallback(async (id: string) => {
        try {
            await deleteObjectiveAction(id);
            setObjectives(prev => prev.filter(o => o.id !== id));
        } catch (e) {
            console.error('Erreur suppression objectif:', e);
            setError('Impossible de supprimer l\'objectif.');
        }
    }, []);

    // --- Profile Handler ---
    const handleSaveProfile = useCallback(async (data: Profile) => {
        try {
            await saveAthleteProfile(data);
            await refreshData();
        } catch (e) {
            console.error('Erreur sauvegarde profil:', e);
            setError('Impossible de sauvegarder le profil.');
        }
    }, [refreshData]);

    // --- Workout Handlers ---
    const handleUpdateStatus = useCallback(async (
        workoutId: string,
        status: 'pending' | 'completed' | 'missed',
        feedback?: CompletedDataFeedback
    ) => {
        try {
            await updateWorkoutStatus(workoutId, status, feedback);
            if (schedule && feedback) {
                const updatedWorkout = schedule.workouts.find(w => w.id === workoutId);
                if (updatedWorkout) {
                    setSelectedWorkout({
                        ...updatedWorkout,
                        status,
                        completedData: createCompletedData(feedback),
                    });
                }
            }
            await refreshData();
        } catch (e) {
            console.error('Erreur mise à jour statut:', e);
            setError('Impossible de mettre à jour le statut.');
        }
    }, [refreshData, schedule]);

    const handleToggleMode = useCallback(async (workoutId: string) => {
        try {
            await toggleWorkoutMode(workoutId);
            if (schedule) {
                const workout = schedule.workouts.find(w => w.id === workoutId);
                if (workout) {
                    const newMode = workout.mode === 'Outdoor' ? 'Indoor' : 'Outdoor';
                    setSelectedWorkout({ ...workout, mode: newMode });
                }
            }
            await refreshData();
        } catch (e) {
            console.error('Erreur toggle mode:', e);
            setError('Impossible de changer le mode.');
        }
    }, [refreshData, schedule]);

    const handleMoveWorkout = useCallback(async (workoutId: string, newDateStr: string) => {
        try {
            await moveWorkout(workoutId, newDateStr);
            await refreshData();
        } catch (e) {
            console.error('Erreur déplacement séance:', e);
            setError('Impossible de déplacer la séance.');
        }
    }, [refreshData]);

    const handleUnlinkStrava = useCallback(async (workoutId: string, targetWorkoutId: string | null) => {
        try {
            await unlinkStravaWorkout(workoutId, targetWorkoutId);
            await refreshData();
            handleViewChange('dashboard');
        } catch (e) {
            console.error('Erreur déliaison Strava:', e);
            setError('Impossible de délier la séance.');
        }
    }, [refreshData, handleViewChange]);

    const handleCreatePlannedWorkoutAI = useCallback(async (dateStr: string, sportType: SportType, duration: number, comment: string) => {
        try {
            await createPlannedWorkoutAI(dateStr, sportType, duration, comment);
            await refreshData();
        } catch (e) {
            console.error('Erreur création séance IA:', e);
            throw e; // Remonter pour que le progress modal affiche l'erreur
        }
    }, [refreshData]);

    const handleAddManualWorkout = useCallback(async (workout: Workout) => {
        try {
            await addManualWorkout(workout);
            await refreshData();
        } catch (e) {
            console.error('Erreur ajout séance:', e);
            setError('Impossible d\'ajouter la séance.');
        }
    }, [refreshData]);

    const handleDeleteWorkout = useCallback(async (workoutId: string) => {
        try {
            await deleteWorkout(workoutId);
            await refreshData();
            setView('dashboard');
            setSelectedWorkout(null);
        } catch (e) {
            console.error('Erreur suppression séance:', e);
            setError('Impossible de supprimer la séance.');
        }
    }, [refreshData]);

    const handleRegenerateWorkout = useCallback(async (workoutId: string, instruction?: string) => {
        try {
            await regenerateWorkout(workoutId, instruction);
            const { schedule: newSchedule } = await loadInitialData();
            setSchedule(newSchedule);
            if (newSchedule) {
                const regeneratedWorkout = newSchedule.workouts.find(w => w.id === workoutId);
                if (regeneratedWorkout) {
                    setSelectedWorkout(regeneratedWorkout);
                }
            }
        } catch (e) {
            console.error('Erreur régénération séance:', e);
            setError('Impossible de régénérer la séance.');
        }
    }, []);

    // --- Render Logic ---
    const showNav = view !== 'onboarding' && view !== 'welcome';

    if (!profile || !schedule) {
        return <div className="text-slate-900 dark:text-white p-10">Erreur critique : Données manquantes.</div>;
    }

    return (
        <SubscriptionProvider subscription={{ role: profile.role, plan: (profile.plan ?? 'free') as Plan }}>
            <div className="flex flex-col min-h-dvh">
                {showNav && (
                    <Nav
                        onViewChange={handleViewChange}
                        currentView={view}
                        appName="PulsePeak"
                    />
                )}

                <main className="flex-1 w-full max-w-7xl mx-auto px-3 sm:px-6 lg:px-8 py-4 sm:py-8 pb-20 sm:pb-8">

                    {error && (
                        <Card className="bg-red-50 dark:bg-red-900/50 border-red-200 dark:border-red-500/50 mb-6 animate-in slide-in-from-top-2">
                            <div className="p-4">
                                <div className="flex items-start justify-between gap-2">
                                    <div className="flex-1">
                                        <p className="text-red-600 dark:text-red-300 font-bold flex items-center gap-2">
                                            <span className="text-lg">⚠️</span>
                                            Erreur
                                        </p>
                                        <p className="text-red-600 dark:text-red-400 text-sm mt-1">{error}</p>
                                    </div>
                                    <button onClick={() => setError(null)} className="text-red-600 dark:text-red-400 hover:text-red-600 dark:hover:text-red-300 transition-colors">✕</button>
                                </div>
                            </div>
                        </Card>
                    )}

                    {isSyncing && (
                        <div className="fixed top-[5px] right-2 md:top-20 md:right-4 z-40 bg-orange-500/90 text-white px-2 py-1 md:px-4 md:py-2 rounded-full md:rounded-lg shadow-lg flex items-center gap-1.5 md:gap-2 animate-in slide-in-from-top-2 pointer-events-none">
                            <div className="w-3 h-3 md:w-4 md:h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                            <span className="text-xs md:text-sm font-medium">Strava...</span>
                        </div>
                    )}

                    {isRefreshing && !isSyncing && (
                        <div className="fixed top-[5px] right-2 md:top-20 md:right-4 z-40 bg-blue-500/90 text-white px-2 py-1 md:px-4 md:py-2 rounded-full md:rounded-lg shadow-lg flex items-center gap-1.5 md:gap-2 animate-in slide-in-from-top-2 pointer-events-none">
                            <div className="w-3 h-3 md:w-4 md:h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                            <span className="text-xs md:text-sm font-medium">Synchro...</span>
                        </div>
                    )}

                    {syncResult && !isSyncing && !isRefreshing && (
                        <div className={`fixed top-[5px] right-2 md:top-20 md:right-4 z-40 px-2 py-1 md:px-4 md:py-2 rounded-full md:rounded-lg shadow-lg flex items-center gap-1.5 md:gap-2 animate-in slide-in-from-top-2 pointer-events-none ${syncResult.type === 'success'
                            ? 'bg-emerald-500/90 text-white'
                            : 'bg-slate-600/90 text-white'
                            }`}>
                            <span className="text-xs md:text-sm">{syncResult.type === 'success' ? '✓' : '—'}</span>
                            <span className="text-xs md:text-sm font-medium">{syncResult.message}</span>
                        </div>
                    )}

                    {view === 'welcome' && (
                        <WelcomeScreen onContinue={() => setView('onboarding')} />
                    )}

                    {view === 'onboarding' && (
                        <div className="max-w-2xl mx-auto py-4 sm:py-8">
                            <ProfileForm
                                initialData={profile}
                                onSave={handleSaveProfile}
                                onSuccess={handleOnboardingSuccess}
                                onCancel={() => handleViewChange('dashboard')}
                                objectives={objectives}
                                onSaveObjective={handleSaveObjective}
                                onDeleteObjective={handleDeleteObjective}
                            />
                        </div>
                    )}

                    {view === 'settings' && (
                        <div className="max-w-2xl mx-auto py-4 sm:py-8 animate-in fade-in duration-300">
                            <ProfileForm
                                initialData={profile}
                                onSave={handleSaveProfile}
                                onSuccess={() => handleViewChange('dashboard')}
                                onCancel={() => handleViewChange('dashboard')}
                                isSettings
                                objectives={objectives}
                                onSaveObjective={handleSaveObjective}
                                onDeleteObjective={handleDeleteObjective}
                            />
                        </div>
                    )}

                    {view === 'dashboard' && (
                        <div className="animate-in fade-in duration-300">
                            <CalendarView
                                scheduleData={schedule}
                                profile={profile}
                                userID={profile.id}
                                objectives={objectives}
                                onViewWorkout={handleViewWorkout}
                                onGenerate={handleGenerate}
                                onGenerateToObjective={handleGenerateToObjective}
                                onAddManualWorkout={handleAddManualWorkout}
                                onCreatePlannedWorkoutAI={handleCreatePlannedWorkoutAI}
                                onSaveObjective={handleSaveObjective}
                                onRefresh={refreshData}
                                onMoveWorkout={handleMoveWorkout}
                                onSyncStrava={handleSyncStrava}
                                isSyncing={isSyncing}
                                calendarDate={calendarDate}
                                onCalendarDateChange={setCalendarDate}
                                calendarMobileDay={calendarMobileDay}
                                onCalendarMobileDayChange={setCalendarMobileDay}
                            />
                        </div>
                    )}

                    {view === 'plan' && (
                        <div className="max-w-2xl mx-auto animate-in fade-in duration-300">
                            <PlanView
                                profile={profile}
                                objectives={objectives}
                                onRefresh={refreshData}
                                onViewWorkout={(workoutId) => {
                                    const w = schedule.workouts.find(wo => wo.id === workoutId);
                                    if (w) { setSelectedWorkout(w); setPreviousView('plan'); setView('workout-detail'); }
                                }}
                                onGenerate={handleGenerate}
                                onGenerateToObjective={handleGenerateToObjective}
                            />
                        </div>
                    )}

                    {view === 'workout-detail' && selectedWorkout && (
                        <div className="animate-in slide-in-from-right-4 duration-300">
                            <WorkoutDetailView
                                workout={selectedWorkout}
                                sameDayWorkouts={schedule?.workouts.filter(w =>
                                    w.date === selectedWorkout.date &&
                                    w.id !== selectedWorkout.id &&
                                    w.status === 'pending' &&
                                    w.sportType === selectedWorkout.sportType
                                ) ?? []}
                                profile={profile}
                                onClose={() => handleViewChange(previousView)}
                                onUpdate={handleUpdateStatus}
                                onToggleMode={handleToggleMode}
                                onMoveWorkout={handleMoveWorkout}
                                onUnlinkStrava={handleUnlinkStrava}
                                onDelete={handleDeleteWorkout}
                                onRegenerate={handleRegenerateWorkout}
                                onRefresh={refreshData}
                            />
                        </div>
                    )}

                    {view === 'stats' && (
                        <div className="animate-in fade-in duration-300">
                            <StatsView
                                scheduleData={schedule}
                                profile={profile}
                                objectives={objectives}
                            />
                        </div>
                    )}

                    {view === 'chat' && (
                        <div className="animate-in fade-in duration-200 -mx-3 sm:-mx-6 lg:-mx-8 -my-4 sm:-my-8">
                            <FreePlanGate
                                featureLabel="Coach IA"
                                featureDesc="Posez toutes vos questions à votre coach personnel disponible 24/7."
                            >
                                <ChatView
                                    profile={profile}
                                    schedule={schedule ?? undefined}
                                    messages={chatMessages}
                                    onMessagesChange={setChatMessages}
                                />
                            </FreePlanGate>
                        </div>
                    )}
                </main>
            </div>

            {genProgress && (
                <GenerationProgressModal
                    state={genProgress}
                    onMinimize={() => setGenProgress(prev => prev ? { ...prev, minimized: true } : null)}
                    onRestore={() => setGenProgress(prev => prev ? { ...prev, minimized: false } : null)}
                />
            )}

            {pendingReplaceAction && activePlan && (
                <ConfirmReplacePlanModal
                    isOpen
                    activePlanName={activePlan.name}
                    onConfirm={handleConfirmReplace}
                    onCancel={handleCancelReplace}
                />
            )}

            {showTutorial && (
                <TutorialOverlay onComplete={() => setShowTutorial(false)} />
            )}

        </SubscriptionProvider>
    );
}
