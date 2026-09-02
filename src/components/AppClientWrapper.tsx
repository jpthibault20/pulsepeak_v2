'use client';

import React, { useState, useCallback, useEffect, useRef, useMemo } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';

// Import des Server Actions (par sous-module schedule)
import { saveAthleteProfile, loadInitialData, type ActivePlanSummary } from '@/app/actions/schedule/profile';
import { CreateAdvancedPlan, CreatePlanToObjective } from '@/app/actions/schedule/plan-creation';
import {
    moveWorkout,
    addManualWorkout,
} from '@/app/actions/schedule/workout-actions';
import { createPlannedWorkoutAI } from '@/app/actions/schedule/workout-ai';
import { syncStravaActivities } from '@/app/actions/schedule/strava-sync';
import {
    saveObjectiveAction,
    deleteObjectiveAction,
} from '@/app/actions/objectives';

// Import des types
import type { SportType } from '@/lib/data/type';
import type { Objective, Workout } from '@/lib/data/DatabaseTypes';
import { SubscriptionProvider, toSubscriptionStatus, type Plan } from '@/lib/subscription/context';
import { isTrialEligible } from '@/lib/billing/trial';
import { FreePlanGate } from '@/components/features/billing/FreePlanGate';

// Import des composants
import { CalendarView } from '@/components/features/calendar/CalendarView';
import { ProfileForm } from '@/components/features/profile/ProfileForm';
import { StatsView } from '@/components/features/stats/StatsView';
import { Nav, View } from '@/components/layout/nav';
import { ChatView, type Message as ChatMessage } from '@/components/features/chat/ChatView';
import { PlanView } from '@/components/features/plan/PlanView';
import { GenerationProgressModal, type GenProgressState } from '@/components/features/calendar/GenerationProgressModal';
import { ConfirmReplacePlanModal } from '@/components/features/plan/ConfirmReplacePlanModal';
import { TutorialOverlay } from '@/components/features/tutorial/TutorialOverlay';
import { WelcomeScreen } from '@/components/features/tutorial/WelcomeScreen';
import { Card } from '@/components/ui';
import { parseLocalDate, formatDateKey } from '@/lib/utils';
import { formatMonthKey, isDayParam, isMonthParam } from '@/lib/calendar-url';
import { Profile, Schedule } from '@/lib/data/DatabaseTypes';
import { useTheme } from '@/components/ThemeProvider';

// Onglets adressables via `?vue=` — les vues d'onboarding en sont exclues,
// elles dépendent de l'état du profil et non d'un choix de navigation.
const VALID_VIEWS: View[] = ['dashboard', 'plan', 'stats', 'settings', 'chat'];

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

    // --- État porté par l'URL ---
    // `/?view=plan&month=2026-10&day=2026-10-14`. Ces trois paramètres survivent
    // à l'aller-retour vers /seance/[id], qui démonte ce composant.
    const router = useRouter();
    const searchParams = useSearchParams();
    const viewParam = searchParams.get('view');
    const monthParam = searchParams.get('month');
    const dayParam = searchParams.get('day');

    // Les patches se composent via une ref, PAS via `searchParams` : deux appels
    // dans le même tick (changer de mois met à jour `month` ET `day`) partiraient
    // sinon du même snapshot périmé, et le second `replace` écraserait le premier
    // — le mois revenait alors à sa valeur d'origine.
    const paramsRef = useRef(searchParams.toString());
    useEffect(() => { paramsRef.current = searchParams.toString(); }, [searchParams]);

    const updateUrlState = useCallback((patch: Record<string, string | null>) => {
        const next = new URLSearchParams(paramsRef.current);
        for (const [k, v] of Object.entries(patch)) {
            if (v === null) next.delete(k);
            else next.set(k, v);
        }
        const qs = next.toString();
        paramsRef.current = qs;
        // replace + scroll:false : changer de mois ne doit ni empiler une entrée
        // d'historique ni renvoyer l'utilisateur en haut de page.
        // Query vide → `/` nu, pas `/?` : l'état par défaut mérite une URL propre.
        router.replace(qs ? `/?${qs}` : '/', { scroll: false });
    }, [router]);

    // --- State Management ---
    const startView: View = initialProfile.firstName
        ? (VALID_VIEWS.includes(viewParam as View) ? (viewParam as View) : 'dashboard')
        : 'welcome';
    const [view, setView] = useState<View>(startView);

    // Un retour navigateur depuis /seance/[id] ne remonte pas le composant :
    // on resynchronise l'onglet affiché sur le paramètre d'URL.
    useEffect(() => {
        if (!initialProfile.firstName) return;
        const target: View = VALID_VIEWS.includes(viewParam as View) ? (viewParam as View) : 'dashboard';
        setView(current => (current === 'onboarding' || current === 'welcome' ? current : target));
    }, [viewParam, initialProfile.firstName]);

    const [profile, setProfile] = useState<Profile>(initialProfile);
    const [schedule, setSchedule] = useState<Schedule | null>(initialSchedule);
    const [objectives, setObjectives] = useState<Objective[]>(initialObjectives);
    const [activePlan, setActivePlan] = useState<ActivePlanSummary | null>(initialActivePlan);
    // Action de génération en attente de confirmation (popup "Remplacer le plan")
    const [pendingReplaceAction, setPendingReplaceAction] = useState<{ run: () => Promise<void> } | null>(null);

    // Calendrier — l'état vit dans l'URL et non dans un useState : ouvrir une
    // séance quitte `/` et démonte ce composant. Sans ça, l'utilisateur qui
    // navigue en octobre, ouvre une séance puis revient se retrouve au mois
    // courant. Bénéfice collatéral : le calendrier devient partageable.
    // Les paramètres sont éditables à la main : on ignore tout ce qui n'est pas
    // une date valide plutôt que de propager un `Invalid Date` au calendrier.
    const calendarDate = useMemo(
        () => (isMonthParam(monthParam) ? parseLocalDate(`${monthParam}-01`) : new Date()),
        [monthParam],
    );
    const calendarMobileDay = useMemo(
        () => (isDayParam(dayParam) ? parseLocalDate(dayParam) : new Date()),
        [dayParam],
    );

    const setCalendarDate = useCallback((d: Date) => {
        updateUrlState({ month: formatMonthKey(d) });
    }, [updateUrlState]);

    // `month` suit le jour sélectionné : sur mobile la navigation se fait au scroll
    // de la bande de jours, sans jamais passer par les flèches de mois — sans ça,
    // revenir d'une séance de juillet rouvrait la bande sur le mois courant.
    const setCalendarMobileDay = useCallback((d: Date) => {
        updateUrlState({ day: formatDateKey(d), month: formatMonthKey(d) });
    }, [updateUrlState]);

    // Chat — persist messages while app is open
    const [chatMessages, setChatMessages] = useState<ChatMessage[]>([
        { role: 'ai', text: `Bonjour\u00a0${initialProfile?.firstName ?? ''}\u00a0! Je suis votre Coach IA PulsePeak. Posez-moi vos questions sur l'entraînement, la récupération ou votre plan.` },
    ]);

    // Etats UI
    const [error, setError] = useState<string | null>(null);
    const [isRefreshing, setIsRefreshing] = useState(false);
    const [isSyncing, setIsSyncing] = useState(false);
    const [syncResult, setSyncResult] = useState<{ message: string; type: 'success' | 'info' } | null>(null);
    const [checkoutBanner, setCheckoutBanner] = useState<'pending' | 'confirmed' | 'timeout' | null>(null);

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

    // --- Retour de paiement Stripe (`/?checkout=success`) ---
    // Le webhook `checkout.session.completed` (src/app/api/stripe/webhook/route.ts)
    // met à jour `profiles.plan` en base, mais arrive de façon asynchrone : il peut
    // encore être en vol quand l'utilisateur atterrit ici après la redirection Stripe.
    // On affiche donc un état "en cours" et on re-fetch le profil à intervalles courts
    // jusqu'à voir passer le plan à 'pro' (ou jusqu'à épuisement des tentatives).
    useEffect(() => {
        if (searchParams.get('checkout') !== 'success') return;
        let cancelled = false;
        setCheckoutBanner('pending');

        (async () => {
            const maxAttempts = 6;
            for (let attempt = 0; attempt < maxAttempts; attempt++) {
                await new Promise(resolve => setTimeout(resolve, attempt === 0 ? 1000 : 2000));
                if (cancelled) return;
                try {
                    const { profile: profileData, schedule: scheduleData, objectives: objectivesData, activePlan: activePlanData } = await loadInitialData();
                    if (cancelled) return;
                    setProfile(profileData as Profile);
                    setSchedule(scheduleData);
                    setObjectives(objectivesData);
                    setActivePlan(activePlanData);
                    if ((profileData as Profile).plan === 'pro' || (profileData as Profile).plan === 'dev') {
                        setCheckoutBanner('confirmed');
                        updateUrlState({ checkout: null });
                        setTimeout(() => { if (!cancelled) setCheckoutBanner(null); }, 5000);
                        return;
                    }
                } catch (e) {
                    console.error('Erreur vérification post-paiement:', e);
                }
            }
            if (!cancelled) {
                setCheckoutBanner('timeout');
                updateUrlState({ checkout: null });
            }
        })();

        return () => { cancelled = true; };
        // eslint-disable-next-line react-hooks/exhaustive-deps
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
    const handleViewChange = useCallback((next: View) => {
        setView(next);
        updateUrlState({ view: next === 'dashboard' ? null : next });
        window.scrollTo({ top: 0, behavior: 'smooth' });
    }, [updateUrlState]);

    // Retour à l'état par défaut (logo, bouton « mois courant ») : on efface les
    // paramètres au lieu d'y écrire aujourd'hui. Tout étant dérivé de l'URL,
    // l'agenda retombe sur le mois courant — et l'URL redevient le domaine nu.
    const handleResetHome = useCallback(() => {
        setView('dashboard');
        updateUrlState({ view: null, month: null, day: null });
    }, [updateUrlState]);

    // Le logo est un élément de navigation : lui seul remonte la page. Le bouton
    // « maison » du calendrier ne fait que recadrer le mois, sans déplacer le scroll.
    const handleLogoClick = useCallback(() => {
        handleResetHome();
        window.scrollTo({ top: 0, behavior: 'smooth' });
    }, [handleResetHome]);

    // --- Onboarding → Tutorial transition ---
    // Track that we came from onboarding (first-time user flow)
    const cameFromOnboarding = useRef(startView === 'welcome');

    const handleOnboardingSuccess = useCallback(() => {
        setView('dashboard');
        window.scrollTo({ top: 0, behavior: 'smooth' });
        // Always show tutorial after first onboarding
        if (cameFromOnboarding.current) {
            setShowTutorial(true);
        }
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
    // Statut, mode, déliaison et suppression sont désormais pilotés depuis
    // /seance/[id], qui appelle directement les Server Actions. Ne restent ici
    // que les actions déclenchées depuis le calendrier.
    const handleMoveWorkout = useCallback(async (workoutId: string, newDateStr: string) => {
        try {
            await moveWorkout(workoutId, newDateStr);
            await refreshData();
        } catch (e) {
            console.error('Erreur déplacement séance:', e);
            setError('Impossible de déplacer la séance.');
        }
    }, [refreshData]);

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

    // --- Render Logic ---
    const showNav = view !== 'onboarding' && view !== 'welcome';

    if (!profile || !schedule) {
        return <div className="text-slate-900 dark:text-white p-10">Erreur critique : Données manquantes.</div>;
    }

    return (
        <SubscriptionProvider subscription={{
            role:              profile.role,
            plan:              (profile.plan ?? 'free') as Plan,
            status:            toSubscriptionStatus(profile.billingStatus),
            currentPeriodEnd:  profile.currentPeriodEnd ?? null,
            cancelAtPeriodEnd: profile.cancelAtPeriodEnd ?? false,
            hasStripeCustomer: !!profile.stripeCustomerId,
            trialEndsAt:       profile.trialEndsAt ?? null,
            trialEligible:     isTrialEligible(profile),
        }}>
            <div className="flex flex-col min-h-dvh">
                {showNav && (
                    <Nav
                        onViewChange={handleViewChange}
                        onLogoClick={handleLogoClick}
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

                    {checkoutBanner && (
                        <div className={`fixed top-[5px] right-2 md:top-20 md:right-4 z-40 px-2 py-1 md:px-4 md:py-2 rounded-full md:rounded-lg shadow-lg flex items-center gap-1.5 md:gap-2 animate-in slide-in-from-top-2 pointer-events-none ${checkoutBanner === 'confirmed'
                            ? 'bg-emerald-500/90 text-white'
                            : checkoutBanner === 'timeout'
                                ? 'bg-amber-500/90 text-white'
                                : 'bg-blue-500/90 text-white'
                            }`}>
                            {checkoutBanner === 'pending' && (
                                <div className="w-3 h-3 md:w-4 md:h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                            )}
                            <span className="text-xs md:text-sm font-medium">
                                {checkoutBanner === 'pending' && 'Paiement confirmé, activation en cours…'}
                                {checkoutBanner === 'confirmed' && '✓ Abonnement Pro activé !'}
                                {checkoutBanner === 'timeout' && 'Paiement reçu — l’activation peut prendre quelques instants, rechargez la page dans un moment.'}
                            </span>
                        </div>
                    )}

                    {isRefreshing && !isSyncing && !checkoutBanner && (
                        <div className="fixed top-[5px] right-2 md:top-20 md:right-4 z-40 bg-blue-500/90 text-white px-2 py-1 md:px-4 md:py-2 rounded-full md:rounded-lg shadow-lg flex items-center gap-1.5 md:gap-2 animate-in slide-in-from-top-2 pointer-events-none">
                            <div className="w-3 h-3 md:w-4 md:h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                            <span className="text-xs md:text-sm font-medium">Synchro...</span>
                        </div>
                    )}

                    {syncResult && !isSyncing && !isRefreshing && !checkoutBanner && (
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
                                onGenerate={handleGenerate}
                                onGenerateToObjective={handleGenerateToObjective}
                                onAddManualWorkout={handleAddManualWorkout}
                                onCreatePlannedWorkoutAI={handleCreatePlannedWorkoutAI}
                                onSaveObjective={handleSaveObjective}
                                onDeleteObjective={handleDeleteObjective}
                                onRefresh={refreshData}
                                onMoveWorkout={handleMoveWorkout}
                                onSyncStrava={handleSyncStrava}
                                isSyncing={isSyncing}
                                calendarDate={calendarDate}
                                onCalendarDateChange={setCalendarDate}
                                calendarMobileDay={calendarMobileDay}
                                onCalendarMobileDayChange={setCalendarMobileDay}
                                onCalendarReset={handleResetHome}
                            />
                        </div>
                    )}

                    {view === 'plan' && (
                        <div className="max-w-2xl mx-auto animate-in fade-in duration-300">
                            <PlanView
                                profile={profile}
                                objectives={objectives}
                                onRefresh={refreshData}
                                onGenerate={handleGenerate}
                                onGenerateToObjective={handleGenerateToObjective}
                                onSaveObjective={handleSaveObjective}
                                onDeleteObjective={handleDeleteObjective}
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
