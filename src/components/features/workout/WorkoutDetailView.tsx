'use client';

import React, { useState, useMemo, useEffect, useCallback } from 'react';
import {
    Activity, Clock, Zap, Mountain,
    ChevronLeft, ChevronRight, CheckCircle, XCircle,
    CalendarDays, Edit, Trash2, RefreshCw,
    AlertTriangle, Send, X, MapPin,
    Bike, FootprintsIcon as Running, Waves, Heart,
    Timer, Gauge, TrendingUp, Unlink,
    Sparkles, ChevronDown, ChevronUp,
    Flame, Target, Route, Plus, Minus
} from 'lucide-react';
import type { SportType, CompletedDataFeedback, CompletedLap, DeviationMetrics } from '@/lib/data/type';
import type { Workout } from '@/lib/data/DatabaseTypes';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { FeatureGate } from '@/components/features/billing/FeatureGate';
import { formatDate } from '@/lib/utils';
import { FeedbackForm } from './FeedbackForm';
import { PlannedStructureView } from './PlannedStructureView';
import { Profile } from '@/lib/data/DatabaseTypes';
import { getWorkoutDeviation, regenerateWeekFromDeviation } from '@/app/actions/schedule/workout-ai';
import { updateWorkoutRPE } from '@/app/actions/schedule/workout-actions';
import { BatteryLow, ArrowUpRight, Loader2 } from 'lucide-react';
import { getWorkoutTSS } from '@/lib/stats/computeTSS';

// --- Types ---
interface WorkoutDetailViewProps {
    workout: Workout;
    sameDayWorkouts: Workout[];
    profile: Profile;
    onClose: () => void;
    onUpdate: (
        workoutId: string,
        status: 'pending' | 'completed' | 'missed',
        feedback?: CompletedDataFeedback
    ) => Promise<void>;
    onToggleMode: (workoutId: string) => Promise<void>;
    onMoveWorkout: (workoutId: string, newDateStr: string) => Promise<void>;
    onUnlinkStrava: (workoutId: string, targetWorkoutId: string | null) => Promise<void>;
    onDelete: (workoutId: string) => Promise<void>;
    onRegenerate: (workoutId: string, instruction?: string) => Promise<void>;
    onRefresh?: () => Promise<void>;
    onNavigate?: (direction: 'prev' | 'next') => void;
    hasPrev?: boolean;
    hasNext?: boolean;
}

// --- Sport Config ---
const SPORT_CONFIG: Record<SportType, {
    icon: React.ElementType;
    color: string;
    bgLight: string;
    gradient: string;
    borderAccent: string;
    label: string;
}> = {
    cycling: {
        icon: Bike,
        color: 'text-purple-600 dark:text-purple-400',
        bgLight: 'bg-purple-50 dark:bg-purple-500/10',
        gradient: 'from-purple-500/20 via-purple-500/5 to-transparent',
        borderAccent: 'border-purple-300 dark:border-purple-500/30',
        label: 'Vélo'
    },
    running: {
        icon: Running,
        color: 'text-orange-600 dark:text-orange-400',
        bgLight: 'bg-orange-50 dark:bg-orange-500/10',
        gradient: 'from-orange-500/20 via-orange-500/5 to-transparent',
        borderAccent: 'border-orange-300 dark:border-orange-500/30',
        label: 'Course'
    },
    swimming: {
        icon: Waves,
        color: 'text-cyan-600 dark:text-cyan-400',
        bgLight: 'bg-cyan-50 dark:bg-cyan-500/10',
        gradient: 'from-cyan-500/20 via-cyan-500/5 to-transparent',
        borderAccent: 'border-cyan-300 dark:border-cyan-500/30',
        label: 'Natation'
    },
    other: {
        icon: Mountain,
        color: 'text-emerald-600 dark:text-emerald-400',
        bgLight: 'bg-emerald-50 dark:bg-emerald-500/10',
        gradient: 'from-emerald-500/20 via-emerald-500/5 to-transparent',
        borderAccent: 'border-emerald-300 dark:border-emerald-500/30',
        label: 'Autre'
    },
};

// --- Helpers ---
function fmtDuration(minutes: number | undefined | null): string {
    if (!minutes) return '-';
    if (minutes >= 60) {
        const h = Math.floor(minutes / 60);
        const m = Math.round(minutes % 60);
        return `${h}h${String(m).padStart(2, '0')}`;
    }
    return `${Math.round(minutes)} min`;
}

function fmtDurationSec(totalSeconds: number | undefined): string {
    if (!totalSeconds) return '-';
    const h = Math.floor(totalSeconds / 3600);
    const m = Math.floor((totalSeconds % 3600) / 60);
    const s = Math.floor(totalSeconds % 60);
    if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
    return `${m}:${String(s).padStart(2, '0')}`;
}

// --- Metric tile ---
interface MetricTile {
    label: string;
    value: string;
    sub?: string;
    icon: React.ElementType;
    accent?: string;
    large?: boolean;
}

function getCompletedMetrics(workout: Workout): MetricTile[] {
    const cd = workout.completedData;
    if (!cd) return [];
    const tiles: MetricTile[] = [];
    const sport = workout.sportType;

    if (cd.actualDurationMinutes) {
        tiles.push({ label: 'Durée', value: fmtDurationSec(cd.actualDurationMinutes * 60), icon: Timer, large: true });
    }
    if (cd.distanceKm && cd.distanceKm > 0) {
        tiles.push({ label: 'Distance', value: `${cd.distanceKm.toFixed(1)}`, sub: 'km', icon: Route, large: true });
    }
    // TSS canonique (toutes sources, pas seulement la puissance vélo)
    const displayTSS = getWorkoutTSS(workout);
    if (displayTSS > 0) {
        tiles.push({ label: 'TSS', value: `${Math.round(displayTSS)}`, icon: Zap, accent: 'text-amber-600 dark:text-amber-400', large: true });
    }
    if (cd.heartRate?.avgBPM) {
        tiles.push({ label: 'FC Moy', value: `${cd.heartRate.avgBPM}`, sub: cd.heartRate.maxBPM ? `max ${cd.heartRate.maxBPM}` : 'bpm', icon: Heart, accent: 'text-rose-600 dark:text-rose-400' });
    }
    if (sport === 'cycling' && cd.metrics?.cycling) {
        const c = cd.metrics.cycling;
        if (c.avgPowerWatts) tiles.push({ label: 'Puissance Moy', value: `${c.avgPowerWatts}`, sub: 'W', icon: Gauge });
        if (c.normalizedPowerWatts) tiles.push({ label: 'NP', value: `${c.normalizedPowerWatts}`, sub: 'W', icon: TrendingUp });
        if (c.avgCadenceRPM) tiles.push({ label: 'Cadence', value: `${c.avgCadenceRPM}`, sub: 'rpm', icon: RefreshCw });
        if (c.elevationGainMeters) tiles.push({ label: 'D+', value: `${c.elevationGainMeters}`, sub: 'm', icon: Mountain });
        if (c.avgSpeedKmH) tiles.push({ label: 'Vitesse Moy', value: `${c.avgSpeedKmH.toFixed(1)}`, sub: 'km/h', icon: Gauge });
    }
    if (sport === 'running' && cd.metrics?.running) {
        const r = cd.metrics.running;
        if (r.avgPaceMinPerKm) tiles.push({ label: 'Allure Moy', value: `${r.avgPaceMinPerKm}`, sub: '/km', icon: Gauge });
        if (r.elevationGainMeters) tiles.push({ label: 'D+', value: `${r.elevationGainMeters}`, sub: 'm', icon: Mountain });
        if (r.avgCadenceSPM) tiles.push({ label: 'Cadence', value: `${r.avgCadenceSPM}`, sub: 'spm', icon: RefreshCw });
    }
    if (sport === 'swimming' && cd.metrics?.swimming) {
        const s = cd.metrics.swimming;
        if (s.avgPace100m) tiles.push({ label: 'Allure', value: `${s.avgPace100m}`, sub: '/100m', icon: Gauge });
        if (s.avgSwolf) tiles.push({ label: 'SWOLF', value: `${s.avgSwolf}`, icon: Activity });
    }
    if (cd.caloriesBurned) {
        tiles.push({ label: 'Calories', value: `${cd.caloriesBurned}`, sub: 'kcal', icon: Flame });
    }
    if (cd.perceivedEffort != null) {
        tiles.push({
            label: 'RPE', value: `${cd.perceivedEffort.toFixed(1)}`, sub: '/ 10', icon: Target,
            accent: cd.perceivedEffort >= 8.5 ? 'text-red-600 dark:text-red-400' : cd.perceivedEffort >= 7 ? 'text-orange-600 dark:text-orange-400' : 'text-emerald-600 dark:text-emerald-400'
        });
    }
    return tiles;
}

// =====================================================
// RPE Quick Input (for Strava workouts without RPE)
// =====================================================
const RPE_COLORS = ['', 'bg-emerald-400', 'bg-emerald-400', 'bg-green-400', 'bg-lime-400', 'bg-yellow-400', 'bg-amber-400', 'bg-orange-400', 'bg-orange-500', 'bg-red-500', 'bg-red-600'];

const RPEQuickInput: React.FC<{
    workoutId: string;
    onSaved: () => void;
}> = ({ workoutId, onSaved }) => {
    const [rpe, setRpe] = useState(5);
    const [saving, setSaving] = useState(false);

    const handleSave = async () => {
        setSaving(true);
        try { await updateWorkoutRPE(workoutId, rpe); onSaved(); }
        catch (e) { console.error(e); }
        finally { setSaving(false); }
    };

    return (
        <div className="mb-4 px-4 py-3 rounded-2xl bg-slate-50 dark:bg-slate-800/40 border border-slate-200/60 dark:border-slate-700/40">
            {/* Header : question + valeur courante */}
            <div className="flex items-center justify-between gap-3 mb-3">
                <p className="text-xs font-medium text-slate-700 dark:text-slate-300">Comment as-tu ressenti cette séance ?</p>
                <div className="flex items-center gap-1.5 shrink-0">
                    <span className={`w-2 h-2 rounded-full ${RPE_COLORS[rpe]}`} />
                    <span className="text-sm font-bold font-mono text-slate-900 dark:text-white">
                        {rpe}<span className="text-[10px] font-normal text-slate-400">/10</span>
                    </span>
                </div>
            </div>

            {/* Slider entouré des boutons -/+, avec labels alignés sous la barre */}
            <div className="flex items-center gap-2 mb-3">
                <button
                    type="button"
                    onClick={() => setRpe((r) => Math.max(1, r - 1))}
                    disabled={rpe <= 1}
                    aria-label="Diminuer le RPE"
                    className="shrink-0 w-7 h-7 flex items-center justify-center rounded-full bg-white dark:bg-slate-700 border border-slate-200 dark:border-slate-600 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-600 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                >
                    <Minus size={14} />
                </button>
                <div className="flex-1 flex flex-col gap-1.5 min-w-0">
                    <input
                        type="range"
                        min={1}
                        max={10}
                        step={1}
                        value={rpe}
                        onChange={(e) => setRpe(Number(e.target.value))}
                        className="w-full h-1.5 rounded-full appearance-none cursor-pointer accent-slate-600 dark:accent-slate-400 bg-slate-200 dark:bg-slate-700"
                    />
                    <div className="flex justify-between text-[10px] text-slate-400 dark:text-slate-500 px-0.5">
                        <span>Facile</span>
                        <span>Difficile</span>
                    </div>
                </div>
                <button
                    type="button"
                    onClick={() => setRpe((r) => Math.min(10, r + 1))}
                    disabled={rpe >= 10}
                    aria-label="Augmenter le RPE"
                    className="shrink-0 w-7 h-7 flex items-center justify-center rounded-full bg-white dark:bg-slate-700 border border-slate-200 dark:border-slate-600 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-600 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                >
                    <Plus size={14} />
                </button>
            </div>

            {/* CTA pleine largeur */}
            <button
                onClick={handleSave}
                disabled={saving}
                className="w-full h-9 flex items-center justify-center gap-2 text-xs font-semibold text-white bg-slate-800 dark:bg-slate-200 dark:text-slate-900 rounded-lg hover:bg-slate-700 dark:hover:bg-slate-300 transition-colors disabled:opacity-50"
            >
                {saving ? <Loader2 size={13} className="animate-spin" /> : 'Valider'}
            </button>
        </div>
    );
};

// =====================================================
// Why Card — "pourquoi cette séance"
// =====================================================
// Justification pédagogique générée avec la séance (plannedData.why). Répond au
// besoin de comprendre ce qu'on fait quand le plan enchaîne des séances peu
// intenses. Masqué si absent (séances générées avant l'ajout du champ).
const WhyCard: React.FC<{ why?: string | null }> = ({ why }) => {
    const text = why?.trim();
    if (!text) return null;

    return (
        <div className="mb-5 p-4 rounded-2xl bg-gradient-to-br from-indigo-50 via-purple-50/50 to-blue-50 dark:from-indigo-500/10 dark:via-purple-500/5 dark:to-blue-500/5 border border-indigo-200/60 dark:border-indigo-500/20">
            <div className="flex items-center gap-2 mb-2.5">
                <div className="flex items-center justify-center w-6 h-6 rounded-lg bg-indigo-100 dark:bg-indigo-500/20">
                    <Sparkles size={13} className="text-indigo-600 dark:text-indigo-400" />
                </div>
                <span className="text-xs font-bold text-indigo-700 dark:text-indigo-400 uppercase tracking-wider">Pourquoi cette séance</span>
            </div>
            <p className="text-sm text-slate-700 dark:text-slate-300 leading-relaxed whitespace-pre-line">{text}</p>
        </div>
    );
};

// =====================================================
// Deviation Card Component
// =====================================================
const DeviationCard: React.FC<{
    workout: Workout;
    onAdaptationComplete?: () => void;
}> = ({ workout, onAdaptationComplete }) => {
    // Cache DB → affichage immédiat si disponible
    const [deviation, setDeviation] = useState<DeviationMetrics | null>(workout.aiDeviationCache ?? null);
    const [loading, setLoading] = useState(false);
    const [showAdaptation, setShowAdaptation] = useState(false);
    const [adaptLevel, setAdaptLevel] = useState<'conservative' | 'recommended' | 'ambitious'>('recommended');
    const [adapting, setAdapting] = useState(false);
    const [adaptResult, setAdaptResult] = useState<{ updatedCount: number } | null>(null);
    const [detailsExpanded, setDetailsExpanded] = useState(false);
    const hasFetched = React.useRef(false);

    const fetchDeviation = useCallback(async () => {
        setLoading(true);
        try {
            const result = await getWorkoutDeviation(workout);
            setDeviation(result);
        } catch {
            // silently fail
        } finally {
            setLoading(false);
        }
    }, [workout]);

    useEffect(() => {
        if (deviation || hasFetched.current) return;
        hasFetched.current = true;
        if (workout.completedData && workout.plannedData) {
            fetchDeviation();
        }
    }, [workout.completedData, workout.plannedData, fetchDeviation, deviation]);

    const handleAdapt = async () => {
        setAdapting(true);
        try {
            const result = await regenerateWeekFromDeviation(workout.id, adaptLevel);
            setAdaptResult(result);
            onAdaptationComplete?.();
        } catch (e) {
            console.error(e);
        } finally {
            setAdapting(false);
        }
    };

    if (loading || !deviation || deviation.signal === 'normal') return null;

    const isFatigue = deviation.signal === 'fatigue';
    const isCritical = deviation.severity === 'critical';

    const bgClass = isFatigue
        ? 'from-amber-50 via-orange-50/50 to-amber-50 dark:from-amber-500/10 dark:via-orange-500/5 dark:to-amber-500/5'
        : 'from-teal-50 via-cyan-50/50 to-teal-50 dark:from-teal-500/10 dark:via-cyan-500/5 dark:to-teal-500/5';
    const borderClass = isFatigue
        ? 'border-amber-200/80 dark:border-amber-500/25'
        : 'border-teal-200/80 dark:border-teal-500/25';
    const iconBgClass = isFatigue
        ? 'bg-amber-100 dark:bg-amber-500/20'
        : 'bg-teal-100 dark:bg-teal-500/20';
    const iconColorClass = isFatigue
        ? 'text-amber-600 dark:text-amber-400'
        : 'text-teal-600 dark:text-teal-400';
    const headlineClass = isFatigue
        ? 'text-amber-800 dark:text-amber-300'
        : 'text-teal-800 dark:text-teal-300';
    const SignalIcon = isFatigue ? BatteryLow : ArrowUpRight;

    return (
        <div className={`mb-5 p-4 rounded-2xl bg-gradient-to-br ${bgClass} border ${borderClass} animate-in fade-in duration-300`}>
            {/* Header */}
            <div className="flex items-start gap-3 mb-3">
                <div className={`flex items-center justify-center w-8 h-8 rounded-xl ${iconBgClass} shrink-0`}>
                    <SignalIcon size={16} className={iconColorClass} />
                </div>
                <div className="flex-1 min-w-0">
                    <p className={`text-sm font-bold ${headlineClass}`}>
                        {deviation.headline}
                    </p>
                    <p className="text-xs text-slate-600 dark:text-slate-400 mt-1 leading-relaxed">
                        {deviation.adaptationReason}
                    </p>
                </div>
                {isCritical && (
                    <span className={`shrink-0 px-2 py-0.5 rounded-full text-[10px] font-bold ${
                        isFatigue ? 'bg-amber-200 dark:bg-amber-500/30 text-amber-800 dark:text-amber-300'
                                  : 'bg-teal-200 dark:bg-teal-500/30 text-teal-800 dark:text-teal-300'
                    }`}>
                        {isFatigue ? 'Important' : 'Significatif'}
                    </span>
                )}
            </div>

            {/* Details (expandable) */}
            {deviation.details.length > 0 && (
                <div className="mb-3">
                    <button
                        onClick={() => setDetailsExpanded(!detailsExpanded)}
                        className="flex items-center gap-1 text-xs font-medium text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 transition-colors"
                    >
                        {detailsExpanded ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
                        {detailsExpanded ? 'Masquer les détails' : `Voir les détails (${deviation.details.length} signaux)`}
                    </button>
                    {detailsExpanded && (
                        <div className="mt-2 space-y-1.5 animate-in slide-in-from-top-1 duration-200">
                            {deviation.details.map((detail, i) => (
                                <div key={i} className="flex items-start gap-2 text-xs text-slate-600 dark:text-slate-400">
                                    <span className={`mt-1 w-1.5 h-1.5 rounded-full shrink-0 ${
                                        isFatigue ? 'bg-amber-400' : 'bg-teal-400'
                                    }`} />
                                    {detail}
                                </div>
                            ))}
                            {deviation.aerobicDecoupling !== null && (
                                <div className="flex items-start gap-2 text-xs text-slate-500 dark:text-slate-500">
                                    <span className="mt-1 w-1.5 h-1.5 rounded-full shrink-0 bg-slate-300" />
                                    Découplage aérobie : {deviation.aerobicDecoupling}%
                                    {deviation.aerobicDecoupling > 5 ? ' (endurance de base à travailler)' : deviation.aerobicDecoupling < 3 ? ' (bonne base aérobie)' : ''}
                                </div>
                            )}
                            {deviation.fadeRate !== null && deviation.fadeRate > 3 && (
                                <div className="flex items-start gap-2 text-xs text-slate-500 dark:text-slate-500">
                                    <span className="mt-1 w-1.5 h-1.5 rounded-full shrink-0 bg-slate-300" />
                                    Fade rate : {deviation.fadeRate}%
                                    {deviation.fadeRate > 8 ? ' (fatigue musculaire marquée)' : ' (acceptable)'}
                                </div>
                            )}
                            {deviation.cardiacCost !== null && (
                                <div className="flex items-start gap-2 text-xs text-slate-500 dark:text-slate-500">
                                    <span className="mt-1 w-1.5 h-1.5 rounded-full shrink-0 bg-slate-300" />
                                    Coût cardiaque : {deviation.cardiacCost} bpm/W
                                </div>
                            )}
                        </div>
                    )}
                </div>
            )}

            {/* Adaptation result */}
            {adaptResult && (
                <div className="mb-3 px-3 py-2 rounded-xl bg-emerald-50 dark:bg-emerald-500/10 border border-emerald-200 dark:border-emerald-500/20">
                    <p className="text-xs font-medium text-emerald-700 dark:text-emerald-400">
                        {adaptResult.updatedCount > 0
                            ? `${adaptResult.updatedCount} séance${adaptResult.updatedCount > 1 ? 's' : ''} adaptée${adaptResult.updatedCount > 1 ? 's' : ''} pour le reste de la semaine.`
                            : 'Aucune séance à adapter cette semaine.'}
                    </p>
                </div>
            )}

            {/* CTA: Adapt week */}
            {!adaptResult && !showAdaptation && (
                <button
                    onClick={() => setShowAdaptation(true)}
                    className={`w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium border transition-colors ${
                        isFatigue
                            ? 'text-amber-700 dark:text-amber-300 bg-white/60 dark:bg-slate-900/30 border-amber-200 dark:border-amber-500/20 hover:bg-amber-100 dark:hover:bg-amber-500/15'
                            : 'text-teal-700 dark:text-teal-300 bg-white/60 dark:bg-slate-900/30 border-teal-200 dark:border-teal-500/20 hover:bg-teal-100 dark:hover:bg-teal-500/15'
                    }`}
                >
                    <RefreshCw size={14} />
                    Voir la semaine adaptée
                </button>
            )}

            {/* Adaptation panel */}
            {showAdaptation && !adaptResult && (
                <div className="mt-1 animate-in slide-in-from-top-2 duration-200">
                    <p className="text-xs font-medium text-slate-600 dark:text-slate-300 mb-2.5">Niveau d&apos;adaptation :</p>
                    <div className="grid grid-cols-3 gap-2 mb-3">
                        {(['conservative', 'recommended', 'ambitious'] as const).map(level => {
                            const labels = {
                                conservative: { name: 'Léger', desc: '~10%' },
                                recommended: { name: 'Recommandé', desc: '~20%' },
                                ambitious: { name: 'Fort', desc: '~30%' },
                            };
                            const isSelected = adaptLevel === level;
                            return (
                                <button
                                    key={level}
                                    onClick={() => setAdaptLevel(level)}
                                    className={`flex flex-col items-center gap-0.5 px-3 py-2 rounded-xl text-xs border transition-all ${
                                        isSelected
                                            ? isFatigue
                                                ? 'bg-amber-100 dark:bg-amber-500/20 border-amber-300 dark:border-amber-500/40 text-amber-800 dark:text-amber-300 font-bold'
                                                : 'bg-teal-100 dark:bg-teal-500/20 border-teal-300 dark:border-teal-500/40 text-teal-800 dark:text-teal-300 font-bold'
                                            : 'bg-white/40 dark:bg-slate-900/20 border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-400'
                                    }`}
                                >
                                    <span>{labels[level].name}</span>
                                    <span className="text-[10px] opacity-60">{labels[level].desc}</span>
                                </button>
                            );
                        })}
                    </div>
                    <div className="flex gap-2">
                        <button
                            onClick={() => setShowAdaptation(false)}
                            className="flex-1 px-3 py-2 text-xs text-slate-500 hover:text-slate-700 dark:hover:text-slate-200 rounded-xl transition-colors"
                            disabled={adapting}
                        >
                            Annuler
                        </button>
                        <button
                            onClick={handleAdapt}
                            disabled={adapting}
                            className={`flex-1 flex items-center justify-center gap-2 px-4 py-2 rounded-xl text-xs font-bold text-white transition-colors disabled:opacity-60 ${
                                isFatigue
                                    ? 'bg-amber-500 hover:bg-amber-600 dark:bg-amber-600 dark:hover:bg-amber-500'
                                    : 'bg-teal-500 hover:bg-teal-600 dark:bg-teal-600 dark:hover:bg-teal-500'
                            }`}
                        >
                            {adapting ? (
                                <>
                                    <Loader2 size={14} className="animate-spin" />
                                    Adaptation en cours...
                                </>
                            ) : (
                                <>
                                    <Sparkles size={14} />
                                    Adapter ma semaine
                                </>
                            )}
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
};

// =====================================================
// Laps Table Component
// =====================================================
const LapsSection: React.FC<{ laps: CompletedLap[]; sport: SportType }> = ({ laps, sport }) => {
    const [expanded, setExpanded] = useState(false);

    if (!laps || laps.length === 0) return null;

    const visibleLaps = expanded ? laps : laps.slice(0, 3);
    const hasMore = laps.length > 3;

    return (
        <div className="mb-5">
            <button
                onClick={() => setExpanded(!expanded)}
                className="flex items-center justify-between w-full mb-3 group"
            >
                <h3 className="text-sm font-bold text-slate-900 dark:text-white flex items-center gap-2">
                    <Activity size={15} className="text-slate-400" />
                    Laps
                    <span className="text-xs font-normal text-slate-500 dark:text-slate-400">({laps.length})</span>
                </h3>
                {hasMore && (
                    <span className="text-xs text-slate-500 dark:text-slate-400 group-hover:text-slate-700 dark:group-hover:text-slate-200 flex items-center gap-1 transition-colors">
                        {expanded ? 'Réduire' : 'Tout voir'}
                        {expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                    </span>
                )}
            </button>

            <div className="space-y-2">
                {visibleLaps.map((lap, i) => (
                    <div
                        key={lap.index}
                        className="flex items-center gap-3 px-3.5 py-2.5 rounded-xl bg-white dark:bg-slate-800/60 border border-slate-200/80 dark:border-slate-700/50 hover:border-slate-300 dark:hover:border-slate-600 transition-colors"
                    >
                        {/* Lap number */}
                        <div className="flex items-center justify-center w-7 h-7 rounded-lg bg-slate-100 dark:bg-slate-700/60 text-xs font-bold text-slate-600 dark:text-slate-300 shrink-0">
                            {i + 1}
                        </div>

                        {/* Metrics row */}
                        <div className="flex-1 flex flex-wrap items-center gap-x-4 gap-y-1 min-w-0">
                            <span className="text-sm font-semibold text-slate-900 dark:text-white font-mono">
                                {fmtDurationSec(lap.durationSeconds)}
                            </span>
                            {lap.distanceMeters > 0 && (
                                <span className="text-xs text-slate-500 dark:text-slate-400">
                                    {(lap.distanceMeters / 1000).toFixed(2)} km
                                </span>
                            )}
                            {sport === 'cycling' && lap.avgPower != null && (
                                <span className="text-xs font-medium text-purple-600 dark:text-purple-400">
                                    {lap.avgPower} W
                                </span>
                            )}
                            {lap.avgHeartRate != null && (
                                <span className="text-xs text-rose-500 dark:text-rose-400">
                                    {lap.avgHeartRate} bpm
                                </span>
                            )}
                            {lap.avgSpeedKmh != null && (
                                <span className="text-xs text-slate-500 dark:text-slate-400">
                                    {lap.avgSpeedKmh.toFixed(1)} km/h
                                </span>
                            )}
                            {lap.avgCadence != null && (
                                <span className="text-xs text-slate-400 dark:text-slate-500">
                                    {lap.avgCadence} {sport === 'cycling' ? 'rpm' : 'spm'}
                                </span>
                            )}
                        </div>
                    </div>
                ))}
            </div>

            {hasMore && !expanded && (
                <button
                    onClick={() => setExpanded(true)}
                    className="w-full mt-2 py-2 text-xs text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 text-center transition-colors"
                >
                    + {laps.length - 3} laps de plus
                </button>
            )}
        </div>
    );
};

// =====================================================
// Planned Description — délégué à PlannedStructureView
// (affichage visuel structuré si `structure` présente, sinon fallback texte)
// =====================================================
const PlannedStructure: React.FC<{ workout: Workout }> = ({ workout }) => (
    <PlannedStructureView
        description={workout.plannedData?.description}
        structure={workout.plannedData?.structure}
    />
);


// =====================================================
// MAIN COMPONENT
// =====================================================
export const WorkoutDetailView: React.FC<WorkoutDetailViewProps> = ({
    workout,
    sameDayWorkouts,
    profile,
    onClose,
    onUpdate,
    onMoveWorkout,
    onUnlinkStrava,
    onDelete,
    onRegenerate,
    onRefresh,
    onNavigate,
    hasPrev = false,
    hasNext = false,
}) => {
    const [isCompleting, setIsCompleting] = useState(false);
    const [isEditing, setIsEditing] = useState(false);
    const [isMoving, setIsMoving] = useState(false);
    const [showRegenInput, setShowRegenInput] = useState(false);
    const [regenInstruction, setRegenInstruction] = useState('');
    const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
    const [newMoveDate, setNewMoveDate] = useState('');
    const [isMutating, setIsMutating] = useState(false);
    const [isRegenerating, setIsRegenerating] = useState(false);
    const [isUnlinking, setIsUnlinking] = useState(false);
    const [rpeSaved, setRpeSaved] = useState(false);

    const sportConfig = SPORT_CONFIG[workout.sportType] ?? SPORT_CONFIG.other;
    const SportIcon = sportConfig.icon;
    const isCompleted = workout.status === 'completed';
    const isMissed = workout.status === 'missed';
    const isPending = !isCompleted && !isMissed;
    const isStravaSource = workout.completedData?.source?.type === 'strava';
    const canUnlink = isCompleted && isStravaSource;
    const planned = workout.plannedData;
    // RPE dispo = déjà en DB ou vient d'être sauvé dans cette session
    const hasRPE = workout.completedData?.perceivedEffort != null || rpeSaved;

    const completedMetrics = useMemo(() => getCompletedMetrics(workout), [workout]);

    // --- Handlers ---
    const handleUnlink = async (targetWorkoutId: string | null) => {
        setIsMutating(true);
        try {
            await onUnlinkStrava(workout.id, targetWorkoutId);
        } catch (e) { console.error(e); }
        finally { setIsMutating(false); setIsUnlinking(false); }
    };

    const handleMove = async () => {
        if (!newMoveDate) return;
        setIsMutating(true);
        try {
            await onMoveWorkout(workout.id, newMoveDate);
            onClose();
        } catch (e) { console.error(e); }
        finally { setIsMutating(false); }
    };

    const handleRegenerateClick = async () => {
        if (!regenInstruction.trim()) { setShowRegenInput(false); return; }
        setIsMutating(true); setIsRegenerating(true);
        try {
            await onRegenerate(workout.id, regenInstruction);
            setShowRegenInput(false); setRegenInstruction('');
        } catch (e) { console.error(e); }
        finally { setIsMutating(false); setIsRegenerating(false); }
    };

    const handleDeleteClick = async () => {
        setIsMutating(true);
        try { await onDelete(workout.id); }
        catch (e) { console.error(e); setIsMutating(false); }
    };

    const handleStatusUpdate = async (status: 'pending' | 'completed' | 'missed', feedback?: CompletedDataFeedback) => {
        setIsMutating(true);
        try {
            await onUpdate(workout.id, status, feedback);
            setIsCompleting(false); setIsEditing(false);
            // Retour au calendrier après un changement de statut simple
            // (repasser en attente depuis "fait", ou marquer comme raté)
            if ((status === 'pending' && isCompleted) || status === 'missed') onClose();
        } catch (e) { console.error(e); }
        finally { setIsMutating(false); }
    };

    // =====================================================
    // RENDER
    // =====================================================
    return (
        <div className="w-full max-w-2xl mx-auto py-4 md:py-8 animate-in fade-in duration-300 pb-24 md:pb-8">

            {/* Back button + navigation séance précédente / suivante */}
            <div className="flex items-center justify-between mb-5">
                <button onClick={onClose} className="flex items-center gap-1 text-sm text-slate-500 hover:text-slate-900 dark:hover:text-white transition-colors">
                    <ChevronLeft size={18} /> Retour
                </button>
                {onNavigate && (
                    <div className="flex items-center gap-2">
                        <button
                            onClick={() => onNavigate('prev')}
                            disabled={!hasPrev}
                            aria-label="Séance précédente"
                            className="flex items-center gap-1 px-3 py-1.5 rounded-xl text-xs font-medium text-slate-600 dark:text-slate-300 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                        >
                            <ChevronLeft size={14} /> Précédente
                        </button>
                        <button
                            onClick={() => onNavigate('next')}
                            disabled={!hasNext}
                            aria-label="Séance suivante"
                            className="flex items-center gap-1 px-3 py-1.5 rounded-xl text-xs font-medium text-slate-600 dark:text-slate-300 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                        >
                            Suivante <ChevronRight size={14} />
                        </button>
                    </div>
                )}
            </div>

            {/* ═══════════════════════════════════════════════════
                HEADER with gradient accent
            ═══════════════════════════════════════════════════ */}
            <div className={`relative mb-6 p-5 rounded-2xl bg-white dark:bg-slate-900/60 border border-slate-200/80 dark:border-slate-800 shadow-sm overflow-hidden`}>
                {/* Gradient overlay */}
                <div className={`absolute inset-0 bg-gradient-to-br ${sportConfig.gradient} pointer-events-none`} />

                <div className="relative">
                    {/* Badges row */}
                    <div className="flex flex-wrap items-center gap-2 mb-3">
                        <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold ${sportConfig.color} ${sportConfig.bgLight}`}>
                            <SportIcon size={13} />
                            {sportConfig.label}
                        </span>
                        {workout.workoutType && <Badge type={workout.workoutType} />}
                        {workout.mode && (
                            <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400 border border-slate-200/60 dark:border-slate-700">
                                {workout.mode}
                            </span>
                        )}
                        {isCompleted && (
                            <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-emerald-100 dark:bg-emerald-500/15 text-emerald-700 dark:text-emerald-400">
                                <CheckCircle size={10} /> Fait
                            </span>
                        )}
                        {isMissed && (
                            <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-red-100 dark:bg-red-500/10 text-red-600 dark:text-red-400">
                                <XCircle size={10} /> Raté
                            </span>
                        )}
                    </div>

                    {/* Title */}
                    <h1 className={`text-xl md:text-2xl font-bold leading-tight mb-1.5 ${isMissed ? 'text-slate-400 dark:text-slate-500' : 'text-slate-900 dark:text-white'}`}>
                        {workout.title}
                    </h1>

                    {/* Date + Strava link */}
                    <div className="flex items-center gap-3">
                        <p className="text-sm text-slate-500 flex items-center gap-1.5">
                            <CalendarDays size={14} />
                            {formatDate(workout.date)}
                        </p>
                        {isStravaSource && workout.completedData?.source?.stravaUrl && (
                            <a
                                href={workout.completedData.source.stravaUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="inline-flex items-center gap-1 text-xs font-medium text-orange-500 hover:text-orange-600 dark:text-orange-400 dark:hover:text-orange-300 transition-colors"
                            >
                                Voir sur Strava
                            </a>
                        )}
                    </div>

                    {/* Quick planned stats (pending + missed, inline in header) */}
                    {(isPending || isMissed) && planned && (
                        <div className="flex items-center gap-4 mt-4 pt-3 border-t border-slate-200/60 dark:border-slate-700/40">
                            {planned.durationMinutes && (
                                <div className="flex items-center gap-1.5 text-sm">
                                    <Clock size={14} className="text-slate-400" />
                                    <span className="font-bold text-slate-900 dark:text-white">{fmtDuration(planned.durationMinutes)}</span>
                                </div>
                            )}
                            {planned.plannedTSS != null && planned.plannedTSS > 0 && (
                                <div className="flex items-center gap-1.5 text-sm">
                                    <Zap size={14} className="text-amber-500" />
                                    <span className="font-bold text-slate-900 dark:text-white">{planned.plannedTSS} <span className="font-normal text-slate-500 text-xs">TSS</span></span>
                                </div>
                            )}
                            {planned.distanceKm != null && planned.distanceKm > 0 && (
                                <div className="flex items-center gap-1.5 text-sm">
                                    <MapPin size={14} className="text-slate-400" />
                                    <span className="font-bold text-slate-900 dark:text-white">{planned.distanceKm} <span className="font-normal text-slate-500 text-xs">km</span></span>
                                </div>
                            )}
                            {planned.targetPowerWatts != null && (
                                <div className="flex items-center gap-1.5 text-sm">
                                    <Gauge size={14} className="text-purple-500" />
                                    <span className="font-bold text-slate-900 dark:text-white">{planned.targetPowerWatts} <span className="font-normal text-slate-500 text-xs">W cible</span></span>
                                </div>
                            )}
                            {planned.targetPaceMinPerKm != null && (
                                <div className="flex items-center gap-1.5 text-sm">
                                    <Gauge size={14} className="text-orange-500" />
                                    <span className="font-bold text-slate-900 dark:text-white">{planned.targetPaceMinPerKm} <span className="font-normal text-slate-500 text-xs">/km cible</span></span>
                                </div>
                            )}
                        </div>
                    )}
                </div>
            </div>

            {/* ═══════════════════════════════════════════════════
                COMPLETED VIEW
            ═══════════════════════════════════════════════════ */}
            {isCompleted && (
                <>
                    {/* RPE Quick Input — shown when no RPE yet */}
                    {!hasRPE && (
                        <RPEQuickInput workoutId={workout.id} onSaved={() => { setRpeSaved(true); onRefresh?.(); }} />
                    )}

                    {/* Deviation Card (fatigue / superform detection) */}
                    {workout.plannedData && hasRPE && (
                        <DeviationCard workout={workout} onAdaptationComplete={() => { onRefresh?.(); }} />
                    )}

                    {/* Metrics Grid */}
                    {completedMetrics.length > 0 && (
                        <div className="grid grid-cols-3 gap-2.5 mb-5">
                            {completedMetrics.map((tile, i) => {
                                const TileIcon = tile.icon;
                                return (
                                    <div
                                        key={i}
                                        className={`flex flex-col gap-1.5 p-3 rounded-xl bg-white dark:bg-slate-800/60 border border-slate-200/80 dark:border-slate-700/50 ${tile.large ? 'col-span-1' : ''}`}
                                    >
                                        <div className="flex items-center gap-1.5">
                                            <TileIcon size={11} className={tile.accent || 'text-slate-400 dark:text-slate-500'} />
                                            <span className="text-[10px] font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">{tile.label}</span>
                                        </div>
                                        <div className="flex items-baseline gap-1">
                                            <span className="text-lg font-bold font-mono text-slate-900 dark:text-white leading-none">{tile.value}</span>
                                            {tile.sub && <span className="text-[10px] text-slate-400 dark:text-slate-500 font-medium">{tile.sub}</span>}
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    )}

                    {/* Laps */}
                    {workout.completedData?.laps && (
                        <LapsSection laps={workout.completedData.laps} sport={workout.sportType} />
                    )}

                    {/* Notes */}
                    {workout.completedData?.notes && (
                        <div className="mb-5 px-4 py-3 rounded-xl bg-slate-50 dark:bg-slate-800/40 border border-slate-200/60 dark:border-slate-700/40">
                            <p className="text-[10px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-1.5">Notes</p>
                            <p className="text-sm text-slate-600 dark:text-slate-300 leading-relaxed">{workout.completedData.notes}</p>
                        </div>
                    )}
                </>
            )}

            {/* ═══════════════════════════════════════════════════
                PLANNED / PENDING VIEW
                (affiché aussi pour une séance ratée : on garde le contenu prévu)
            ═══════════════════════════════════════════════════ */}
            {(isPending || isMissed) && (
                <>
                    <WhyCard why={planned?.why} />
                    <PlannedStructure workout={workout} />
                </>
            )}

            {/* ═══════════════════════════════════════════════════
                ACTIONS
            ═══════════════════════════════════════════════════ */}
            {workout.workoutType !== 'Rest' && !isCompleting && !isEditing && (
                <div className="mb-5">
                    {showRegenInput ? (
                        <div className="flex items-end gap-2 animate-in fade-in duration-200">
                            <textarea
                                rows={1}
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
                                    if (e.key === 'Enter' && !e.shiftKey) {
                                        e.preventDefault();
                                        handleRegenerateClick();
                                    }
                                }}
                            />
                            <button onClick={() => { setShowRegenInput(false); setRegenInstruction(''); }} className="p-2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 shrink-0" disabled={isMutating}>
                                <X size={18} />
                            </button>
                            <Button variant="primary" onClick={handleRegenerateClick} disabled={isMutating || !regenInstruction.trim()} className="shrink-0">
                                {isRegenerating ? <RefreshCw size={16} className="animate-spin" /> : <Send size={16} />}
                            </Button>
                        </div>
                    ) : (
                        <div className="flex items-center gap-2">
                            <button
                                onClick={() => setIsMoving(!isMoving)}
                                disabled={isMutating || !planned}
                                className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-medium text-slate-600 dark:text-slate-300 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors disabled:opacity-40"
                            >
                                <CalendarDays size={14} /> {isCompleted ? 'Replanifier' : 'Déplacer'}
                            </button>
                            {canUnlink && (
                                <button
                                    onClick={() => setIsUnlinking(!isUnlinking)}
                                    disabled={isMutating}
                                    className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-medium text-orange-600 dark:text-orange-400 bg-orange-50 dark:bg-orange-500/10 border border-orange-200 dark:border-orange-500/20 hover:bg-orange-100 dark:hover:bg-orange-500/20 transition-colors disabled:opacity-40"
                                >
                                    <Unlink size={14} /> Délier
                                </button>
                            )}
                            {isPending && (
                                <FeatureGate feature="regenerate-workout" mode="modal" label="Régénérer avec l'IA">
                                    <button
                                        onClick={() => setShowRegenInput(true)}
                                        disabled={isMutating}
                                        className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-medium text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-500/10 border border-blue-200 dark:border-blue-500/20 hover:bg-blue-100 dark:hover:bg-blue-500/20 transition-colors disabled:opacity-40"
                                    >
                                        <RefreshCw size={14} /> Régénérer IA
                                    </button>
                                </FeatureGate>
                            )}
                            <div className="flex-1" />
                            <button
                                onClick={() => setShowDeleteConfirm(true)}
                                disabled={isMutating}
                                className="p-2 rounded-xl text-slate-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-500/10 transition-colors disabled:opacity-40"
                                title="Supprimer"
                            >
                                <Trash2 size={16} />
                            </button>
                        </div>
                    )}
                </div>
            )}

            {/* Move panel */}
            {isMoving && (
                <div className="mb-5 p-4 rounded-2xl bg-white dark:bg-slate-800/80 border border-blue-200 dark:border-blue-500/30 animate-in slide-in-from-top-2 duration-200">
                    <p className="text-sm font-medium text-slate-700 dark:text-slate-200 mb-3">Nouvelle date</p>
                    <div className="flex gap-2 items-center">
                        <input
                            type="date"
                            style={{ colorScheme: 'auto' }}
                            className="flex-1 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-white rounded-xl px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-500"
                            onChange={(e) => setNewMoveDate(e.target.value)}
                            defaultValue={workout.date}
                        />
                        <button onClick={() => setIsMoving(false)} className="px-3 py-2 text-sm text-slate-500 hover:text-slate-700 dark:hover:text-slate-200" disabled={isMutating}>Annuler</button>
                        <Button variant="primary" disabled={isMutating || !newMoveDate} onClick={handleMove} className="h-9 text-sm">Confirmer</Button>
                    </div>
                </div>
            )}

            {/* Unlink panel */}
            {isUnlinking && (
                <div className="mb-5 p-4 rounded-2xl bg-orange-50 dark:bg-orange-950/20 border border-orange-200 dark:border-orange-500/30 animate-in slide-in-from-top-2 duration-200">
                    <p className="text-sm font-medium text-slate-700 dark:text-slate-200 mb-3">Réattribuer l&apos;activité Strava à :</p>
                    <div className="flex flex-col gap-2">
                        {sameDayWorkouts.map(w => (
                            <button
                                key={w.id}
                                onClick={() => handleUnlink(w.id)}
                                disabled={isMutating}
                                className="flex items-center gap-3 p-3 rounded-xl text-left text-sm bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 hover:border-blue-400 dark:hover:border-blue-500 hover:bg-blue-50 dark:hover:bg-blue-500/10 transition-colors disabled:opacity-40"
                            >
                                <div className="flex-1">
                                    <span className="font-medium text-slate-800 dark:text-slate-100">{w.title}</span>
                                    <span className="ml-2 text-xs text-slate-500 dark:text-slate-400">{w.workoutType} · {w.plannedData?.durationMinutes ?? '?'} min</span>
                                </div>
                            </button>
                        ))}
                        <button
                            onClick={() => handleUnlink(null)}
                            disabled={isMutating}
                            className="flex items-center gap-3 p-3 rounded-xl text-left text-sm bg-white dark:bg-slate-800 border border-dashed border-slate-300 dark:border-slate-600 hover:border-orange-400 dark:hover:border-orange-500 hover:bg-orange-50 dark:hover:bg-orange-500/10 transition-colors disabled:opacity-40"
                        >
                            <span className="font-medium text-slate-600 dark:text-slate-300">Nouvelle séance libre</span>
                        </button>
                        <button
                            onClick={() => setIsUnlinking(false)}
                            disabled={isMutating}
                            className="mt-1 text-xs text-slate-500 hover:text-slate-700 dark:hover:text-slate-300 self-end"
                        >
                            Annuler
                        </button>
                    </div>
                </div>
            )}

            {/* Delete confirm */}
            {showDeleteConfirm && (
                <div className="mb-5 p-4 rounded-2xl bg-red-50 dark:bg-red-950/20 border border-red-200 dark:border-red-500/30 animate-in fade-in duration-200">
                    <div className="flex items-center gap-2 mb-2">
                        <AlertTriangle size={16} className="text-red-500" />
                        <p className="text-sm font-semibold text-red-700 dark:text-red-400">Supprimer cette séance ?</p>
                    </div>
                    <p className="text-xs text-red-600/70 dark:text-red-300/60 mb-3">Cette action est irréversible.</p>
                    <div className="flex gap-2 justify-end">
                        <button onClick={() => setShowDeleteConfirm(false)} className="px-3 py-1.5 text-xs text-slate-500 hover:text-slate-700 dark:hover:text-slate-200 rounded-xl" disabled={isMutating}>Annuler</button>
                        <button
                            onClick={handleDeleteClick}
                            disabled={isMutating}
                            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-red-600 hover:bg-red-500 text-white rounded-xl disabled:opacity-50 transition-colors"
                        >
                            <Trash2 size={12} /> {isMutating ? '...' : 'Supprimer'}
                        </button>
                    </div>
                </div>
            )}

            {/* ═══════════════════════════════════════════════════
                FEEDBACK / PRIMARY ACTIONS
            ═══════════════════════════════════════════════════ */}
            {(isCompleting || isEditing) ? (
                <FeedbackForm
                    workout={workout}
                    profile={profile}
                    onSave={async (feedback) => { await handleStatusUpdate('completed', feedback); }}
                    onCancel={() => { setIsCompleting(false); setIsEditing(false); }}
                />
            ) : (
                <div className="flex flex-col gap-2.5 pt-5 border-t border-slate-200/80 dark:border-slate-800">
                    {isPending && !showDeleteConfirm && (
                        <Button
                            variant="success"
                            onClick={() => setIsCompleting(true)}
                            className="w-full h-12 text-base font-semibold shadow-md shadow-emerald-500/10"
                            disabled={isMutating}
                            icon={CheckCircle}
                        >
                            Marquer comme fait
                        </Button>
                    )}
                    {isPending && !showDeleteConfirm && (
                        <button
                            onClick={() => handleStatusUpdate('missed')}
                            disabled={isMutating}
                            className="w-full h-10 flex items-center justify-center gap-2 text-sm font-medium text-red-500 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-500/10 rounded-xl transition-colors disabled:opacity-40"
                        >
                            <XCircle size={16} /> Marquer comme raté
                        </button>
                    )}
                    {isCompleted && !showDeleteConfirm && (
                        <div className="flex gap-2">
                            <button
                                onClick={() => setIsEditing(true)}
                                disabled={isMutating}
                                className="flex-1 h-10 flex items-center justify-center gap-2 text-sm font-medium text-slate-600 dark:text-slate-300 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors disabled:opacity-40"
                            >
                                <Edit size={14} /> Modifier feedback
                            </button>
                            <button
                                onClick={() => handleStatusUpdate('pending')}
                                disabled={isMutating}
                                className="h-10 px-4 flex items-center justify-center gap-2 text-sm font-medium text-slate-500 hover:text-slate-700 dark:hover:text-slate-200 border border-slate-200 dark:border-slate-700 rounded-xl hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors disabled:opacity-40"
                            >
                                <RefreshCw size={14} />
                            </button>
                        </div>
                    )}
                </div>
            )}
        </div>
    );
};
