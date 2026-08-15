'use client';

import React, { useState, useMemo, useEffect, useOptimistic, startTransition } from 'react';
import { useRouter } from 'next/navigation';
import {
    CheckCircle, XCircle, CalendarDays, Edit, Trash2, RefreshCw,
    AlertTriangle, Send, X, Unlink, ChevronDown, ChevronUp, Loader2,
} from 'lucide-react';

import type { CompletedDataFeedback, DeviationMetrics } from '@/lib/data/type';
import type { Workout, Profile } from '@/lib/data/DatabaseTypes';
import type { WorkoutNeighbour, WorkoutPlanContext } from '@/lib/data/crud';

import { Button } from '@/components/ui/Button';
import { FeatureGate } from '@/components/features/billing/FeatureGate';
import { createCompletedData } from '@/lib/utils';

import { FeedbackForm } from '@/components/features/workout/FeedbackForm';
import { PlannedStructureView } from '@/components/features/workout/PlannedStructureView';
import { AdherenceCard } from '@/components/features/workout/AdherenceCard';
import { WorkoutSubHeader } from '@/components/features/workout/detail/WorkoutSubHeader';
import { WorkoutHero } from '@/components/features/workout/detail/WorkoutHero';
import { WhyCard } from '@/components/features/workout/detail/WhyCard';
import { RPEQuickInput } from '@/components/features/workout/detail/RPEQuickInput';
import { DeviationCard } from '@/components/features/workout/detail/DeviationCard';
import { MetricsGrid } from '@/components/features/workout/detail/MetricsGrid';
import { IntensityCard } from '@/components/features/workout/detail/IntensityCard';
import { LapsSection } from '@/components/features/workout/detail/LapsSection';
import { PlannedVsActual } from '@/components/features/workout/detail/PlannedVsActual';
import { WorkoutContextCard } from '@/components/features/workout/detail/WorkoutContextCard';
import { MissedImpactCard } from '@/components/features/workout/detail/MissedImpactCard';
import { RestDayView } from '@/components/features/workout/detail/RestDayView';
import { getCompletedMetrics } from '@/components/features/workout/detail/shared';

import { updateWorkoutStatus, moveWorkout, deleteWorkout, unlinkStravaWorkout } from '@/app/actions/schedule/workout-actions';
import { regenerateWorkout } from '@/app/actions/schedule/workout-ai';

export interface WorkoutDetailClientProps {
    workout: Workout;
    profile: Profile;
    context: WorkoutPlanContext | null;
    deviation: DeviationMetrics | null;
    prev: WorkoutNeighbour | null;
    next: WorkoutNeighbour | null;
    workoutsOnDate: Workout[];
    sameDayWorkouts: Workout[];
    backHref: string;
    backLabel: string;
    /** Query (`?from=…&month=…&day=…`) portée par les liens vers une autre séance */
    seanceQuery: string;
    breadcrumb: string;
}

export default function WorkoutDetailClient({
    workout: serverWorkout,
    profile,
    context,
    deviation,
    prev,
    next,
    workoutsOnDate,
    sameDayWorkouts,
    backHref,
    backLabel,
    seanceQuery,
    breadcrumb,
}: WorkoutDetailClientProps) {
    const router = useRouter();

    // Mise à jour optimiste : sans elle, `router.refresh()` seul ferait attendre
    // l'aller-retour serveur avant que le badge « Fait » apparaisse — une
    // régression visible par rapport à l'ancienne vue.
    const [workout, applyOptimistic] = useOptimistic(
        serverWorkout,
        (current: Workout, patch: Partial<Workout>) => ({ ...current, ...patch }),
    );

    const [isCompleting, setIsCompleting] = useState(false);
    const [isEditing, setIsEditing] = useState(false);
    const [isMoving, setIsMoving] = useState(false);
    const [isUnlinking, setIsUnlinking] = useState(false);
    const [showRegenInput, setShowRegenInput] = useState(false);
    const [regenInstruction, setRegenInstruction] = useState('');
    const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
    const [showAdjust, setShowAdjust] = useState(false);
    const [newMoveDate, setNewMoveDate] = useState('');
    const [isMutating, setIsMutating] = useState(false);
    const [isRegenerating, setIsRegenerating] = useState(false);
    const [rpeSaved, setRpeSaved] = useState(false);
    const [error, setError] = useState<string | null>(null);

    // Voir WorkoutContextCard : « aujourd'hui » ne peut être calculé qu'au client.
    const [today, setToday] = useState<string | null>(null);
    useEffect(() => { setToday(new Date().toLocaleDateString('sv-SE')); }, []);

    const isCompleted = workout.status === 'completed';
    const isMissed = workout.status === 'missed';
    const isPending = !isCompleted && !isMissed;
    const isRest = workout.workoutType === 'Rest';
    const isStravaSource = workout.completedData?.source?.type === 'strava';
    const canUnlink = isCompleted && isStravaSource;
    const planned = workout.plannedData;
    const hasRPE = workout.completedData?.perceivedEffort != null || rpeSaved;

    const completedMetrics = useMemo(() => getCompletedMetrics(workout), [workout]);

    const dayPosition = useMemo(() => {
        const idx = workoutsOnDate.findIndex(w => w.id === workout.id);
        if (idx === -1) return null;
        return { index: idx + 1, total: workoutsOnDate.length };
    }, [workoutsOnDate, workout.id]);

    // ─── Handlers ─────────────────────────────────────────────────────────────

    const handleStatusUpdate = (
        status: 'pending' | 'completed' | 'missed',
        feedback?: CompletedDataFeedback,
    ) => {
        setIsMutating(true);
        setError(null);
        startTransition(async () => {
            applyOptimistic({
                status,
                completedData: feedback ? createCompletedData(feedback) : workout.completedData,
            });
            try {
                await updateWorkoutStatus(workout.id, status, feedback);
                setIsCompleting(false);
                setIsEditing(false);
                router.refresh();
            } catch (e) {
                console.error(e);
                setError(e instanceof Error ? e.message : 'Impossible de mettre à jour le statut.');
            } finally {
                setIsMutating(false);
            }
        });
    };

    const handleMove = async () => {
        if (!newMoveDate) return;
        setIsMutating(true);
        setError(null);
        try {
            await moveWorkout(workout.id, newMoveDate);
            setIsMoving(false);
            // On reste sur la page : l'URL reste valide, seule la date change.
            router.refresh();
        } catch (e) {
            console.error(e);
            setError(e instanceof Error ? e.message : 'Impossible de déplacer la séance.');
        } finally {
            setIsMutating(false);
        }
    };

    const handleUnlink = async (targetWorkoutId: string | null) => {
        setIsMutating(true);
        setError(null);
        try {
            await unlinkStravaWorkout(workout.id, targetWorkoutId);
            // Délier peut SUPPRIMER la séance source (quand elle n'a pas de plan) :
            // rester sur /seance/[id] afficherait un 404. On sort systématiquement.
            router.push(backHref);
        } catch (e) {
            console.error(e);
            setError('Impossible de délier la séance.');
            setIsMutating(false);
            setIsUnlinking(false);
        }
    };

    const handleDelete = async () => {
        setIsMutating(true);
        setError(null);
        try {
            await deleteWorkout(workout.id);
            router.push(backHref);
        } catch (e) {
            console.error(e);
            setError(e instanceof Error ? e.message : 'Impossible de supprimer la séance.');
            setIsMutating(false);
        }
    };

    const handleRegenerate = async () => {
        if (!regenInstruction.trim()) { setShowRegenInput(false); return; }
        setIsMutating(true);
        setIsRegenerating(true);
        setError(null);
        try {
            await regenerateWorkout(workout.id, regenInstruction);
            setShowRegenInput(false);
            setRegenInstruction('');
            router.refresh();
        } catch (e) {
            console.error(e);
            setError('Impossible de régénérer la séance.');
        } finally {
            setIsMutating(false);
            setIsRegenerating(false);
        }
    };

    // ─── Jour de repos : page dédiée, pas de barre d'actions ──────────────────

    if (isRest) {
        return (
            <>
                <WorkoutSubHeader
                    backLabel={backLabel} backHref={backHref} seanceQuery={seanceQuery} breadcrumb={breadcrumb}
                    prev={prev} next={next} dayPosition={dayPosition}
                />
                <div className="animate-in fade-in slide-in-from-bottom-2 duration-300 motion-reduce:animate-none">
                    <RestDayView
                        workout={workout}
                        profile={profile}
                        seanceQuery={seanceQuery}
                        nextWorkout={next ? {
                            ...next,
                            durationMinutes: workoutsOnDate.find(w => w.id === next.id)?.plannedData?.durationMinutes ?? null,
                            plannedTSS: workoutsOnDate.find(w => w.id === next.id)?.plannedData?.plannedTSS ?? null,
                        } : null}
                    />
                </div>
            </>
        );
    }

    // ─── Actions secondaires, partagées rail desktop / accordéon mobile ───────

    const adjustActions = (
        <div className="flex flex-col gap-2">
            <button
                onClick={() => setIsMoving(!isMoving)}
                disabled={isMutating || !planned}
                className="w-full h-11 flex items-center gap-2 px-3 rounded-xl text-sm font-medium text-slate-700 dark:text-slate-200 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors disabled:opacity-40"
            >
                <CalendarDays size={15} aria-hidden="true" /> {isCompleted ? 'Replanifier' : 'Déplacer'}
            </button>

            {canUnlink && (
                <button
                    onClick={() => setIsUnlinking(!isUnlinking)}
                    disabled={isMutating}
                    className="w-full h-11 flex items-center gap-2 px-3 rounded-xl text-sm font-medium text-orange-700 dark:text-orange-400 bg-orange-50 dark:bg-orange-500/10 border border-orange-200 dark:border-orange-500/20 hover:bg-orange-100 dark:hover:bg-orange-500/20 transition-colors disabled:opacity-40"
                >
                    <Unlink size={15} aria-hidden="true" /> Délier Strava
                </button>
            )}

            {isPending && (
                <FeatureGate feature="regenerate-workout" mode="modal" label="Régénérer avec l'IA">
                    <button
                        onClick={() => setShowRegenInput(true)}
                        disabled={isMutating}
                        className="w-full h-11 flex items-center gap-2 px-3 rounded-xl text-sm font-medium text-blue-700 dark:text-blue-400 bg-blue-50 dark:bg-blue-500/10 border border-blue-200 dark:border-blue-500/20 hover:bg-blue-100 dark:hover:bg-blue-500/20 transition-colors disabled:opacity-40"
                    >
                        <RefreshCw size={15} aria-hidden="true" /> Régénérer avec l&apos;IA
                    </button>
                </FeatureGate>
            )}

            <button
                onClick={() => setShowDeleteConfirm(true)}
                disabled={isMutating}
                className="w-full h-11 flex items-center gap-2 px-3 rounded-xl text-sm font-medium text-slate-600 dark:text-slate-400 hover:text-red-600 dark:hover:text-red-400 hover:bg-red-50 dark:hover:bg-red-500/10 transition-colors disabled:opacity-40"
            >
                <Trash2 size={15} aria-hidden="true" /> Supprimer
            </button>
        </div>
    );

    const primaryActions = (
        <div className="flex flex-col gap-2">
            {isPending && (
                <>
                    <Button
                        variant="success"
                        onClick={() => setIsCompleting(true)}
                        className="w-full h-12 text-base font-semibold shadow-md shadow-emerald-500/10"
                        disabled={isMutating}
                        icon={CheckCircle}
                    >
                        Marquer comme fait
                    </Button>
                    <button
                        onClick={() => handleStatusUpdate('missed')}
                        disabled={isMutating}
                        className="w-full h-11 flex items-center justify-center gap-2 text-sm font-medium text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-500/10 rounded-xl transition-colors disabled:opacity-40"
                    >
                        <XCircle size={16} aria-hidden="true" /> Marquer comme raté
                    </button>
                </>
            )}

            {isCompleted && (
                <div className="flex gap-2">
                    <button
                        onClick={() => setIsEditing(true)}
                        disabled={isMutating}
                        className="flex-1 h-12 flex items-center justify-center gap-2 text-sm font-medium text-slate-700 dark:text-slate-200 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors disabled:opacity-40"
                    >
                        <Edit size={15} aria-hidden="true" /> Modifier le feedback
                    </button>
                    <button
                        onClick={() => handleStatusUpdate('pending')}
                        disabled={isMutating}
                        aria-label="Repasser en attente"
                        title="Repasser en attente"
                        className="w-12 h-12 flex items-center justify-center text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white border border-slate-200 dark:border-slate-700 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors disabled:opacity-40"
                    >
                        <RefreshCw size={15} aria-hidden="true" />
                    </button>
                </div>
            )}

            {isMissed && (
                <Button
                    variant="success"
                    onClick={() => setIsCompleting(true)}
                    className="w-full h-12 text-base font-semibold"
                    disabled={isMutating}
                    icon={CheckCircle}
                >
                    Je l&apos;ai finalement faite
                </Button>
            )}
        </div>
    );

    // ─── Rendu ────────────────────────────────────────────────────────────────

    return (
        <>
            <WorkoutSubHeader
                backLabel={backLabel} backHref={backHref} seanceQuery={seanceQuery} breadcrumb={breadcrumb}
                prev={prev} next={next} dayPosition={dayPosition}
            />

            {error && (
                <div role="alert" className="mb-4 px-4 py-3 rounded-xl bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-500/30 flex items-start justify-between gap-3">
                    <p className="text-sm text-red-700 dark:text-red-300">{error}</p>
                    <button onClick={() => setError(null)} aria-label="Fermer l'erreur" className="shrink-0 text-red-600 dark:text-red-400">
                        <X size={16} />
                    </button>
                </div>
            )}

            <div className="lg:grid lg:grid-cols-[minmax(0,1fr)_20rem] lg:gap-6 lg:items-start animate-in fade-in slide-in-from-bottom-2 duration-300 motion-reduce:animate-none">

                {/* ── Colonne principale ── */}
                <div className="flex flex-col gap-5 min-w-0">
                    <WorkoutHero workout={workout} />

                    {(isCompleting || isEditing) ? (
                        <FeedbackForm
                            workout={workout}
                            profile={profile}
                            onSave={async (feedback) => { handleStatusUpdate('completed', feedback); }}
                            onCancel={() => { setIsCompleting(false); setIsEditing(false); }}
                        />
                    ) : (
                        <>
                            {isCompleted && (
                                <>
                                    {!hasRPE && (
                                        <RPEQuickInput
                                            workoutId={workout.id}
                                            onSaved={() => { setRpeSaved(true); router.refresh(); }}
                                        />
                                    )}
                                    {hasRPE && (
                                        <DeviationCard
                                            workoutId={workout.id}
                                            deviation={deviation}
                                            onAdaptationComplete={() => router.refresh()}
                                        />
                                    )}
                                    <AdherenceCard workout={workout} />
                                    <PlannedVsActual workout={workout} />
                                    <MetricsGrid tiles={completedMetrics} />
                                    <IntensityCard workout={workout} profile={profile} />
                                    {workout.completedData?.laps && (
                                        <LapsSection
                                            laps={workout.completedData.laps}
                                            sport={workout.sportType}
                                            profile={profile}
                                            mode={workout.mode}
                                        />
                                    )}
                                    {workout.completedData?.notes && (
                                        <section aria-labelledby="notes-title" className="px-4 py-3 rounded-xl bg-slate-50 dark:bg-slate-800/40 border border-slate-200/60 dark:border-slate-700/40">
                                            <h2 id="notes-title" className="text-[10px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-1.5">Notes</h2>
                                            <p className="text-sm text-slate-600 dark:text-slate-300 leading-relaxed">{workout.completedData.notes}</p>
                                        </section>
                                    )}
                                    {planned && (
                                        <CollapsibleSection title="Ce qui était prévu">
                                            <PlannedStructureView description={planned.description} structure={planned.structure} durationMinutes={planned.durationMinutes} />
                                        </CollapsibleSection>
                                    )}
                                </>
                            )}

                            {isMissed && (
                                <MissedImpactCard
                                    workout={workout}
                                    context={context}
                                    onReschedule={() => { setShowAdjust(true); setIsMoving(true); }}
                                    onMarkDone={() => setIsCompleting(true)}
                                    disabled={isMutating}
                                />
                            )}

                            {(isPending || isMissed) && (
                                <>
                                    <WhyCard why={planned?.why} />
                                    <PlannedStructureView description={planned?.description} structure={planned?.structure} durationMinutes={planned?.durationMinutes} />
                                </>
                            )}
                        </>
                    )}

                    {/* Panneaux contextuels */}
                    {isMoving && (
                        <section className="p-4 rounded-2xl bg-white dark:bg-slate-800/80 border border-blue-200 dark:border-blue-500/30 animate-in slide-in-from-top-2 duration-200 motion-reduce:animate-none">
                            <p className="text-sm font-medium text-slate-700 dark:text-slate-200 mb-3">Nouvelle date</p>
                            <div className="flex flex-wrap gap-2 items-center">
                                <input
                                    type="date"
                                    aria-label="Nouvelle date de la séance"
                                    style={{ colorScheme: 'auto' }}
                                    className="flex-1 min-w-40 h-11 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-white rounded-xl px-3 text-sm outline-none focus:ring-2 focus:ring-blue-500"
                                    onChange={(e) => setNewMoveDate(e.target.value)}
                                    defaultValue={workout.date}
                                />
                                <button onClick={() => setIsMoving(false)} className="h-11 px-3 text-sm text-slate-600 hover:text-slate-800 dark:hover:text-slate-200" disabled={isMutating}>Annuler</button>
                                <Button variant="primary" disabled={isMutating || !newMoveDate} onClick={handleMove} className="h-11 text-sm">Confirmer</Button>
                            </div>
                        </section>
                    )}

                    {isUnlinking && (
                        <section className="p-4 rounded-2xl bg-orange-50 dark:bg-orange-950/20 border border-orange-200 dark:border-orange-500/30 animate-in slide-in-from-top-2 duration-200 motion-reduce:animate-none">
                            <p className="text-sm font-medium text-slate-700 dark:text-slate-200 mb-3">Réattribuer l&apos;activité Strava à :</p>
                            <div className="flex flex-col gap-2">
                                {sameDayWorkouts.map(w => (
                                    <button
                                        key={w.id}
                                        onClick={() => handleUnlink(w.id)}
                                        disabled={isMutating}
                                        className="flex items-center gap-3 p-3 min-h-11 rounded-xl text-left text-sm bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 hover:border-blue-400 dark:hover:border-blue-500 hover:bg-blue-50 dark:hover:bg-blue-500/10 transition-colors disabled:opacity-40"
                                    >
                                        <span className="flex-1">
                                            <span className="font-medium text-slate-800 dark:text-slate-100">{w.title}</span>
                                            <span className="ml-2 text-xs text-slate-500 dark:text-slate-400">{w.workoutType} · {w.plannedData?.durationMinutes ?? '?'} min</span>
                                        </span>
                                    </button>
                                ))}
                                <button
                                    onClick={() => handleUnlink(null)}
                                    disabled={isMutating}
                                    className="flex items-center gap-3 p-3 min-h-11 rounded-xl text-left text-sm bg-white dark:bg-slate-800 border border-dashed border-slate-300 dark:border-slate-600 hover:border-orange-400 dark:hover:border-orange-500 hover:bg-orange-50 dark:hover:bg-orange-500/10 transition-colors disabled:opacity-40"
                                >
                                    <span className="font-medium text-slate-600 dark:text-slate-300">Nouvelle séance libre</span>
                                </button>
                                <button onClick={() => setIsUnlinking(false)} disabled={isMutating} className="mt-1 min-h-11 text-xs text-slate-600 hover:text-slate-800 dark:hover:text-slate-300 self-end">
                                    Annuler
                                </button>
                            </div>
                        </section>
                    )}

                    {showRegenInput && (
                        <section className="flex items-end gap-2 animate-in fade-in duration-200 motion-reduce:animate-none">
                            <textarea
                                rows={1}
                                aria-label="Instruction de régénération"
                                placeholder="Ex: Plus court, focus endurance..."
                                className="flex-1 resize-none overflow-hidden bg-white dark:bg-slate-900 border border-blue-300 dark:border-blue-500/50 rounded-xl text-sm px-3 py-2.5 text-slate-900 dark:text-white focus:ring-2 focus:ring-blue-500 outline-none leading-snug"
                                value={regenInstruction}
                                onChange={(e) => {
                                    setRegenInstruction(e.target.value);
                                    e.currentTarget.style.height = 'auto';
                                    e.currentTarget.style.height = `${e.currentTarget.scrollHeight}px`;
                                }}
                                autoFocus
                                onKeyDown={(e) => {
                                    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleRegenerate(); }
                                }}
                            />
                            <button onClick={() => { setShowRegenInput(false); setRegenInstruction(''); }} className="w-11 h-11 flex items-center justify-center text-slate-500 hover:text-slate-700 dark:hover:text-slate-200 shrink-0" disabled={isMutating} aria-label="Annuler la régénération">
                                <X size={18} />
                            </button>
                            <Button variant="primary" onClick={handleRegenerate} disabled={isMutating || !regenInstruction.trim()} className="shrink-0 h-11">
                                {isRegenerating ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
                            </Button>
                        </section>
                    )}

                    {showDeleteConfirm && (
                        <section className="p-4 rounded-2xl bg-red-50 dark:bg-red-950/20 border border-red-200 dark:border-red-500/30 animate-in fade-in duration-200 motion-reduce:animate-none">
                            <div className="flex items-center gap-2 mb-2">
                                <AlertTriangle size={16} className="text-red-500" aria-hidden="true" />
                                <p className="text-sm font-semibold text-red-700 dark:text-red-400">Supprimer cette séance ?</p>
                            </div>
                            <p className="text-xs text-red-600/80 dark:text-red-300/70 mb-3">Cette action est irréversible.</p>
                            <div className="flex gap-2 justify-end">
                                <button onClick={() => setShowDeleteConfirm(false)} className="h-11 px-3 text-xs text-slate-600 hover:text-slate-800 dark:hover:text-slate-200 rounded-xl" disabled={isMutating}>Annuler</button>
                                <button
                                    onClick={handleDelete}
                                    disabled={isMutating}
                                    className="flex items-center gap-1.5 h-11 px-4 text-xs font-medium bg-red-600 hover:bg-red-500 text-white rounded-xl disabled:opacity-50 transition-colors"
                                >
                                    <Trash2 size={12} aria-hidden="true" /> {isMutating ? '...' : 'Supprimer'}
                                </button>
                            </div>
                        </section>
                    )}
                </div>

                {/* ── Rail : sticky en desktop, empilé sous le contenu en mobile ── */}
                <aside
                    aria-label="Contexte et actions"
                    className="mt-5 lg:mt-0 lg:sticky lg:top-[6.5rem] flex flex-col gap-4 min-w-0"
                >
                    {/* Actions primaires : dans le rail en desktop, en barre fixe en mobile */}
                    {!isCompleting && !isEditing && (
                        <div className="hidden lg:block p-4 rounded-2xl bg-white dark:bg-slate-800/60 border border-slate-200/80 dark:border-slate-700/50">
                            {primaryActions}
                        </div>
                    )}

                    {!isCompleting && !isEditing && (
                        <div className="rounded-2xl bg-white dark:bg-slate-800/60 border border-slate-200/80 dark:border-slate-700/50 overflow-hidden">
                            <button
                                onClick={() => setShowAdjust(!showAdjust)}
                                aria-expanded={showAdjust}
                                className="w-full min-h-11 px-4 py-3 flex items-center justify-between gap-2 text-left lg:cursor-default"
                            >
                                <span className="text-[10px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                                    Ajuster la séance
                                </span>
                                <span className="lg:hidden text-slate-400">
                                    {showAdjust ? <ChevronUp size={15} /> : <ChevronDown size={15} />}
                                </span>
                            </button>
                            {/* Replié par défaut en mobile pour ne jamais mettre une action
                                destructive à portée de pouce ; toujours ouvert en desktop. */}
                            <div className={`${showAdjust ? 'block' : 'hidden'} lg:block px-4 pb-4 border-t border-slate-200/80 dark:border-slate-700/50 pt-3`}>
                                {adjustActions}
                            </div>
                        </div>
                    )}

                    <WorkoutContextCard context={context} profile={profile} today={today} />
                </aside>
            </div>

            {/* ── Barre d'action fixe, mobile uniquement ── */}
            {!isCompleting && !isEditing && (
                <div className="lg:hidden fixed bottom-0 left-0 right-0 z-40 px-3 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] bg-white/95 dark:bg-slate-950/90 backdrop-blur-xl border-t border-slate-200/80 dark:border-white/6">
                    {primaryActions}
                </div>
            )}
        </>
    );
}

/** Bloc replié par défaut (« Ce qui était prévu » sur une séance réalisée). */
const CollapsibleSection: React.FC<{ title: string; children: React.ReactNode }> = ({ title, children }) => {
    const [open, setOpen] = useState(false);
    return (
        <section className="rounded-2xl bg-white dark:bg-slate-800/60 border border-slate-200/80 dark:border-slate-700/50 overflow-hidden">
            <button
                onClick={() => setOpen(!open)}
                aria-expanded={open}
                className="w-full min-h-11 px-4 py-3 flex items-center justify-between gap-2"
            >
                <h2 className="text-[10px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider">{title}</h2>
                <span className="text-slate-400">{open ? <ChevronUp size={15} /> : <ChevronDown size={15} />}</span>
            </button>
            {open && (
                <div className="px-4 pb-4 border-t border-slate-200/80 dark:border-slate-700/50 pt-3 animate-in slide-in-from-top-1 duration-200 motion-reduce:animate-none">
                    {children}
                </div>
            )}
        </section>
    );
};
