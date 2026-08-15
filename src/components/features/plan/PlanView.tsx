'use client';

import React, { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import {
    Calendar, ChevronDown, ChevronUp, Bike, Footprints, Waves, Activity,
    Loader2, AlertCircle, Sparkles, Trophy, TrendingUp, Clock, CheckCircle2,
    MessageSquare, RotateCcw, Flag, X, Settings2, Pencil,
} from 'lucide-react';
import { getPlanOverview, type PlanOverviewData, type PlanOverviewBlock, type PlanOverviewWeek } from '@/app/actions/schedule/plan-overview';
import { generateWeekWorkoutsFromDate } from '@/app/actions/schedule/week-actions';
import { WeekGenerationProgressModal, type WeekGenProgressState } from '@/components/features/calendar/WeekGenerationProgressModal';
import { GenerationModal } from '@/components/features/calendar/GenerationModal';
import { PlanManageModal } from '@/components/features/plan/PlanManageModal';
import { ObjectiveModal } from '@/components/features/calendar/ObjectiveModal';
import { Button } from '@/components/ui/Button';
import type { Objective, Profile } from '@/lib/data/DatabaseTypes';
import type { AvailabilitySlot } from '@/lib/data/type';
import { FeatureGate } from '@/components/features/billing/FeatureGate';
import { parseLocalDate } from '@/lib/utils';
import { useSeanceHref } from '@/hooks/useSeanceHref';

// ─── Constants ───────────────────────────────────────────────────────────────

const BLOCK_TYPE_CONFIG: Record<string, { label: string; color: string; bg: string; border: string }> = {
    Base: { label: 'Base', color: 'text-blue-600 dark:text-blue-400', bg: 'bg-blue-500', border: 'border-blue-500' },
    Build: { label: 'Build', color: 'text-amber-600 dark:text-amber-400', bg: 'bg-amber-500', border: 'border-amber-500' },
    Peak: { label: 'Peak', color: 'text-red-600 dark:text-red-400', bg: 'bg-red-500', border: 'border-red-500' },
    Taper: { label: 'Taper', color: 'text-emerald-600 dark:text-emerald-400', bg: 'bg-emerald-500', border: 'border-emerald-500' },
    General: { label: 'Général', color: 'text-slate-600 dark:text-slate-400', bg: 'bg-slate-500', border: 'border-slate-500' },
};

const WEEK_TYPE_BADGE: Record<string, { label: string; class: string }> = {
    Load: { label: 'Charge', class: 'bg-amber-100 dark:bg-amber-500/20 text-amber-700 dark:text-amber-300 border-amber-200 dark:border-amber-500/30' },
    Recovery: { label: 'Récupération', class: 'bg-emerald-100 dark:bg-emerald-500/20 text-emerald-700 dark:text-emerald-300 border-emerald-200 dark:border-emerald-500/30' },
    Taper: { label: 'Affûtage', class: 'bg-blue-100 dark:bg-blue-500/20 text-blue-700 dark:text-blue-300 border-blue-200 dark:border-blue-500/30' },
};

const SPORT_ICON: Record<string, React.ElementType> = {
    cycling: Bike, running: Footprints, swimming: Waves, other: Activity,
};

const SPORT_COLOR: Record<string, string> = {
    cycling: 'text-purple-500', running: 'text-orange-500', swimming: 'text-sky-500', other: 'text-slate-400',
};

// ─── Main Component ──────────────────────────────────────────────────────────

interface PlanViewProps {
    profile: Profile;
    objectives: Objective[];
    onRefresh: () => void;
    onGenerate: (blockFocus: string, customTheme: string | null, startDate: string, numWeeks: number, availability: { [key: string]: AvailabilitySlot }) => Promise<void>;
    onGenerateToObjective: (planStartDate: string, availability: { [key: string]: AvailabilitySlot }) => Promise<void>;
    onSaveObjective: (obj: Objective) => Promise<void>;
    onDeleteObjective: (id: string) => Promise<void>;
}

export function PlanView({ profile, objectives: userObjectives, onRefresh, onGenerate, onGenerateToObjective, onSaveObjective, onDeleteObjective }: PlanViewProps) {
    const [data, setData] = useState<PlanOverviewData | null>(null);
    const [loading, setLoading] = useState(true);
    const [expandedBlock, setExpandedBlock] = useState<string | null>(null);
    const [regenTarget, setRegenTarget] = useState<{ blockId: string; weekId?: string } | null>(null);
    const [managing, setManaging] = useState(false);
    const [editingObjective, setEditingObjective] = useState<Objective | null>(null);
    const [isSavingObjective, setIsSavingObjective] = useState(false);
    const [weekGenProgress, setWeekGenProgress] = useState<WeekGenProgressState>({
        active: false, minimized: false, done: false, error: null, startedAt: 0, weekLabel: '',
    });

    const load = useCallback(async () => {
        setLoading(true);
        try {
            const result = await getPlanOverview();
            setData(result);
            // Auto-expand current block
            if (result) {
                const current = result.blocks.find(b => b.isCurrent);
                if (current) setExpandedBlock(current.id);
            }
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => { load(); }, [load]);

    const handleSaveObjective = useCallback(async (obj: Objective) => {
        setIsSavingObjective(true);
        try {
            await onSaveObjective(obj);
            await load();
        } finally {
            setIsSavingObjective(false);
        }
        // La fermeture est pilotée par ObjectiveModal (onClose).
    }, [onSaveObjective, load]);

    const handleDeleteObjective = useCallback(async (id: string) => {
        await onDeleteObjective(id);
        await load();
    }, [onDeleteObjective, load]);

    if (loading) {
        return (
            <div className="flex items-center justify-center py-20">
                <Loader2 className="w-6 h-6 animate-spin text-blue-500" />
            </div>
        );
    }

    if (!data) {
        return <EmptyPlan
            profile={profile}
            objectives={userObjectives}
            onGenerate={onGenerate}
            onGenerateToObjective={onGenerateToObjective}
        />;
    }

    const { plan, blocks, objectives: planObjectives, totalCompletion, totalPlannedTSS, totalActualTSS, currentWeekIndex, totalWeeks } = data;
    const primaryObj = planObjectives.find(o => o.priority === 'principale');
    const daysToGoal = primaryObj ? Math.max(0, Math.ceil((parseLocalDate(primaryObj.date).getTime() - Date.now()) / 86400000)) : null;

    return (
        <div className="space-y-5 animate-in fade-in duration-300">

            {/* ── Action bar ────────────────────────────────── */}
            <div className="flex justify-end">
                <Button variant="primary" icon={Settings2} onClick={() => setManaging(true)}>
                    Gérer le plan
                </Button>
            </div>

            {/* ── Header ────────────────────────────────────── */}
            <div className="bg-white dark:bg-slate-900/60 border border-slate-200/80 dark:border-slate-800 rounded-2xl p-5">
                <div className="flex items-start justify-between gap-4 mb-4">
                    <div className="min-w-0">
                        <h1 className="text-lg font-bold text-slate-900 dark:text-white truncate">{plan.name}</h1>
                        <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                            {plan.startDate} → {plan.goalDate}
                        </p>
                    </div>
                    {daysToGoal !== null && (
                        <div className="shrink-0 text-right">
                            <div className="text-2xl font-bold text-slate-900 dark:text-white">{daysToGoal}</div>
                            <div className="text-[10px] text-slate-500 uppercase tracking-wider">jours restants</div>
                        </div>
                    )}
                </div>

                {/* Progress bar */}
                <div className="space-y-1.5">
                    <div className="flex items-center justify-between text-xs">
                        <span className="text-slate-500 dark:text-slate-400">Progression</span>
                        <span className="font-semibold text-slate-700 dark:text-slate-300">
                            S{currentWeekIndex + 1}/{totalWeeks} · {totalCompletion}%
                        </span>
                    </div>
                    <div className="h-2 bg-slate-100 dark:bg-slate-800 rounded-full overflow-hidden">
                        <div
                            className="h-full bg-linear-to-r from-blue-500 to-blue-400 rounded-full transition-all duration-700"
                            style={{ width: `${Math.min(totalCompletion, 100)}%` }}
                        />
                    </div>
                </div>

                {/* Quick stats */}
                <div className="grid grid-cols-3 gap-3 mt-4">
                    <QuickStat icon={TrendingUp} label="TSS réalisé" value={totalActualTSS} sub={`/ ${totalPlannedTSS}`} />
                    <QuickStat icon={CheckCircle2} label="Complétion" value={`${totalCompletion}%`} />
                    <QuickStat icon={Clock} label="CTL actuelle" value={Math.round(profile.currentCTL ?? 0)} />
                </div>
            </div>

            {/* ── Objectives ────────────────────────────────── */}
            {planObjectives.length > 0 && (
                <div className="space-y-2">
                    <h2 className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider px-1">Objectifs</h2>
                    <div className="flex gap-2 overflow-x-auto pb-1 -mx-1 px-1">
                        {planObjectives.map(obj => {
                            const days = Math.max(0, Math.ceil((parseLocalDate(obj.date).getTime() - Date.now()) / 86400000));
                            const isPrimary = obj.priority === 'principale';
                            return (
                                <button
                                    key={obj.id}
                                    type="button"
                                    onClick={() => setEditingObjective(obj)}
                                    title="Modifier ou supprimer cet objectif"
                                    className={`
                                        group shrink-0 flex items-center gap-2.5 px-3 py-2 rounded-xl border text-xs text-left transition-colors
                                        ${isPrimary
                                            ? 'bg-rose-50 dark:bg-rose-500/10 border-rose-200 dark:border-rose-500/30 hover:bg-rose-100 dark:hover:bg-rose-500/20'
                                            : 'bg-slate-50 dark:bg-slate-800/60 border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800'}
                                    `}
                                >
                                    {isPrimary ? <Trophy size={13} className="text-rose-500 shrink-0" /> : <Flag size={13} className="text-slate-400 shrink-0" />}
                                    <div className="min-w-0">
                                        <p className={`font-semibold truncate ${isPrimary ? 'text-rose-700 dark:text-rose-300' : 'text-slate-700 dark:text-slate-300'}`}>{obj.name}</p>
                                        <p className="text-slate-500 dark:text-slate-400">{obj.date} · J-{days}</p>
                                    </div>
                                    <Pencil size={12} className="shrink-0 text-slate-400 dark:text-slate-500 opacity-60 group-hover:opacity-100 transition-opacity" />
                                </button>
                            );
                        })}
                    </div>
                </div>
            )}

            {/* ── Block Timeline ─────────────────────────────── */}
            <div className="space-y-2">
                <h2 className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider px-1">Blocs d&apos;entraînement</h2>

                {/* Timeline connector line (desktop) */}
                <div className="space-y-0">
                    {blocks.map((block, i) => (
                        <BlockCard
                            key={block.id}
                            block={block}
                            isFirst={i === 0}
                            isLast={i === blocks.length - 1}
                            expanded={expandedBlock === block.id}
                            onToggle={() => setExpandedBlock(expandedBlock === block.id ? null : block.id)}
                            onRegenerate={(weekId) => setRegenTarget({ blockId: block.id, weekId })}
                            profile={profile}
                        />
                    ))}
                </div>
            </div>

            {/* ── Macro Strategy ──────────────────────────────── */}
            {plan.macroStrategyDescription && (
                <div className="bg-slate-50 dark:bg-slate-800/40 border border-slate-200/60 dark:border-slate-700/50 rounded-xl p-4">
                    <p className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-2">Stratégie macro</p>
                    <p className="text-sm text-slate-600 dark:text-slate-300 leading-relaxed">{plan.macroStrategyDescription}</p>
                </div>
            )}

            {/* ── Regenerate Sheet ─────────────────────────────── */}
            {regenTarget && (
                <RegenSheet
                    block={blocks.find(b => b.id === regenTarget.blockId)!}
                    weekId={regenTarget.weekId}
                    profile={profile}
                    onClose={() => setRegenTarget(null)}
                    onDone={() => { setRegenTarget(null); load(); onRefresh(); }}
                    onSetProgress={setWeekGenProgress}
                />
            )}

            {/* ── Objective Modal (édition / suppression) ──────── */}
            {editingObjective && (
                <ObjectiveModal
                    isOpen
                    onClose={() => setEditingObjective(null)}
                    onSave={handleSaveObjective}
                    onDelete={handleDeleteObjective}
                    initial={editingObjective}
                    isSaving={isSavingObjective}
                />
            )}

            {/* ── Manage Plan Modal ────────────────────────────── */}
            {managing && (
                <PlanManageModal
                    isOpen={managing}
                    plan={{
                        id: plan.id,
                        name: plan.name,
                        startDate: plan.startDate,
                        goalDate: plan.goalDate ?? '',
                        macroStrategyDescription: plan.macroStrategyDescription ?? '',
                    }}
                    onClose={() => setManaging(false)}
                    onDone={() => { setManaging(false); load(); onRefresh(); }}
                />
            )}

            {/* ── Week Generation Progress Modal ─────────────── */}
            <WeekGenerationProgressModal
                state={weekGenProgress}
                onMinimize={() => setWeekGenProgress(prev => ({ ...prev, minimized: true }))}
                onRestore={() => setWeekGenProgress(prev => ({ ...prev, minimized: false }))}
                onClose={() => {
                    setWeekGenProgress(prev => ({ ...prev, active: false }));
                    if (!weekGenProgress.error) {
                        load();
                        onRefresh();
                    }
                }}
            />
        </div>
    );
}

// ─── Empty State ──────────────────────────────────────────────────────────────

function EmptyPlan({ profile, objectives, onGenerate, onGenerateToObjective }: {
    profile: Profile;
    objectives: Objective[];
    onGenerate: PlanViewProps['onGenerate'];
    onGenerateToObjective: PlanViewProps['onGenerateToObjective'];
}) {
    const [showModal, setShowModal] = useState(false);
    const [isGenerating, setIsGenerating] = useState(false);

    const handleGenerate = async (...args: Parameters<PlanViewProps['onGenerate']>) => {
        setIsGenerating(true);
        try { await onGenerate(...args); }
        finally { setIsGenerating(false); setShowModal(false); }
    };

    const handleGenerateToObjective = async (...args: Parameters<PlanViewProps['onGenerateToObjective']>) => {
        setIsGenerating(true);
        try { await onGenerateToObjective(...args); }
        finally { setIsGenerating(false); setShowModal(false); }
    };

    return (
        <div className="flex flex-col items-center justify-center py-20 text-center">
            <div className="w-14 h-14 rounded-2xl bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 flex items-center justify-center mb-4">
                <Calendar size={24} className="text-slate-400" />
            </div>
            <h2 className="text-lg font-bold text-slate-900 dark:text-white mb-1">Aucun plan actif</h2>
            <p className="text-sm text-slate-500 dark:text-slate-400 max-w-xs mb-5">
                Crée ton premier plan d&apos;entraînement pour suivre ta progression ici.
            </p>
            <button
                onClick={() => setShowModal(true)}
                className="flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-semibold text-white bg-blue-600 hover:bg-blue-500 dark:bg-blue-500 dark:hover:bg-blue-400 transition-colors shadow-sm"
            >
                <Sparkles size={16} />
                Créer un plan
            </button>

            <GenerationModal
                isOpen={showModal}
                onClose={() => setShowModal(false)}
                onGenerate={handleGenerate}
                onGenerateToObjective={handleGenerateToObjective}
                isGenerating={isGenerating}
                objectives={objectives}
                profile={profile}
            />
        </div>
    );
}

// ─── Quick Stat ───────────────────────────────────────────────────────────────

function QuickStat({ icon: Icon, label, value, sub }: { icon: React.ElementType; label: string; value: string | number; sub?: string }) {
    return (
        <div className="bg-slate-50 dark:bg-slate-800/40 rounded-xl px-3 py-2.5 text-center">
            <Icon size={14} className="mx-auto text-slate-400 dark:text-slate-500 mb-1" />
            <div className="text-base font-bold text-slate-900 dark:text-white">
                {value}
                {sub && <span className="text-xs font-normal text-slate-400 ml-0.5">{sub}</span>}
            </div>
            <div className="text-[10px] text-slate-500 dark:text-slate-400 uppercase tracking-wider">{label}</div>
        </div>
    );
}

// ─── Block Card ───────────────────────────────────────────────────────────────

interface BlockCardProps {
    block: PlanOverviewBlock;
    isFirst: boolean;
    isLast: boolean;
    expanded: boolean;
    onToggle: () => void;
    onRegenerate: (weekId?: string) => void;
    profile: Profile;
}

function BlockCard({ block, isFirst, expanded, onToggle, onRegenerate }: BlockCardProps) {
    const config = BLOCK_TYPE_CONFIG[block.type] ?? BLOCK_TYPE_CONFIG.General;
    const completionPct = block.totalCount > 0 ? Math.round((block.completedCount / block.totalCount) * 100) : 0;
    const tssRatio = block.totalPlannedTSS > 0 ? Math.round((block.totalActualTSS / block.totalPlannedTSS) * 100) : 0;

    return (
        <div className={`
            relative
            ${!isFirst ? 'mt-0' : ''}
        `}>
            {/* Timeline connector */}
            {!isFirst && (
                <div className="absolute left-5 top-0 w-0.5 h-0 bg-slate-200 dark:bg-slate-700 hidden md:block" />
            )}

            <div className={`
                bg-white dark:bg-slate-900/60 border rounded-2xl overflow-hidden transition-all
                ${block.isCurrent
                    ? `border-l-4 ${config.border} border-slate-200/80 dark:border-slate-800 shadow-md`
                    : block.isPast
                        ? 'border-slate-200/60 dark:border-slate-800/60 opacity-75'
                        : 'border-slate-200/80 dark:border-slate-800'
                }
                ${!isFirst ? 'mt-2' : ''}
            `}>
                {/* Block header */}
                <button onClick={onToggle} className="w-full flex items-center gap-3 p-4 text-left">
                    {/* Type dot */}
                    <div className={`w-3 h-3 rounded-full shrink-0 ${config.bg} ${block.isCurrent ? 'ring-4 ring-offset-2 ring-offset-white dark:ring-offset-slate-900' : ''}`} />

                    <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                            <span className={`text-[10px] font-bold uppercase tracking-wider ${config.color}`}>{config.label}</span>
                            {block.isCurrent && (
                                <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-blue-100 dark:bg-blue-500/20 text-blue-600 dark:text-blue-300 border border-blue-200 dark:border-blue-500/30">
                                    EN COURS
                                </span>
                            )}
                            <span className="text-[10px] text-slate-400">·</span>
                            <span className="text-[10px] text-slate-500 dark:text-slate-400">{block.weekCount} sem</span>
                        </div>
                        <p className="text-sm font-medium text-slate-900 dark:text-white mt-0.5">{block.theme}</p>
                    </div>

                    {/* Completion ring */}
                    <div className="shrink-0 flex items-center gap-2">
                        <MiniRing pct={completionPct} size={32} />
                        {expanded ? <ChevronUp size={16} className="text-slate-400" /> : <ChevronDown size={16} className="text-slate-400" />}
                    </div>
                </button>

                {/* Block details (expanded) */}
                {expanded && (
                    <div className="border-t border-slate-100 dark:border-slate-800 px-4 pb-4 space-y-3">
                        {/* Block stats bar */}
                        <div className="flex items-center gap-4 pt-3 text-xs text-slate-500 dark:text-slate-400">
                            <span>CTL {block.startCTL} → {block.targetCTL}</span>
                            <span>·</span>
                            <span>TSS {block.totalActualTSS}/{block.totalPlannedTSS} ({tssRatio}%)</span>
                            <span>·</span>
                            <span>{block.completedCount}/{block.totalCount} séances</span>
                        </div>

                        {/* Weeks */}
                        {block.weeks.map(week => (
                            <WeekRow
                                key={week.id}
                                week={week}
                                blockType={block.type}
                                blockStartDate={block.startDate}
                                onRegenerate={() => onRegenerate(week.id)}
                            />
                        ))}

                        {/* Regen block CTA */}
                        <FeatureGate feature="generate-plan" mode="blur">
                            <button
                                onClick={() => onRegenerate()}
                                className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl border border-dashed border-slate-300 dark:border-slate-700 text-slate-500 dark:text-slate-400 text-xs font-medium hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors"
                            >
                                <Sparkles size={13} />
                                Recalculer les semaines à venir
                            </button>
                        </FeatureGate>
                    </div>
                )}
            </div>
        </div>
    );
}

// ─── Week Row ─────────────────────────────────────────────────────────────────

interface WeekRowProps {
    week: PlanOverviewWeek;
    blockType: string;
    blockStartDate: string;
    onRegenerate: () => void;
}

function WeekRow({ week, blockType, onRegenerate }: WeekRowProps) {
    const seanceHref = useSeanceHref('plan');
    const effectiveType = (week.type === 'Load' && blockType === 'Taper') ? 'Taper' : week.type;
    const badge = WEEK_TYPE_BADGE[effectiveType] ?? WEEK_TYPE_BADGE.Load;
    const todayStr = new Date().toISOString().slice(0, 10);
    const weekEnd = new Date(week.startDate);
    weekEnd.setDate(weekEnd.getDate() + 6);
    const weekEndStr = weekEnd.toISOString().slice(0, 10);
    const isCurrent = todayStr >= week.startDate && todayStr <= weekEndStr;
    const isPast = todayStr > weekEndStr;
    const tssRatio = week.targetTSS > 0 ? Math.min(100, Math.round((week.actualTSS / week.targetTSS) * 100)) : 0;

    return (
        <div className={`
            rounded-xl border p-3
            ${isCurrent
                ? 'bg-blue-50/50 dark:bg-blue-500/5 border-blue-200/60 dark:border-blue-500/20'
                : isPast
                    ? 'bg-slate-50/50 dark:bg-slate-800/20 border-slate-200/40 dark:border-slate-800/40'
                    : 'bg-white dark:bg-slate-900/30 border-slate-200/60 dark:border-slate-800/60'
            }
        `}>
            {/* Week header */}
            <div className="flex items-center justify-between gap-2 mb-2">
                <div className="flex items-center gap-2">
                    <span className="text-xs font-bold text-slate-700 dark:text-slate-300">S{week.weekNumber}</span>
                    <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full border ${badge.class}`}>{badge.label}</span>
                    {isCurrent && <span className="w-1.5 h-1.5 rounded-full bg-blue-500 animate-pulse" />}
                </div>
                <div className="flex items-center gap-2 text-[10px] text-slate-500">
                    <span>{week.actualTSS}/{week.targetTSS} TSS</span>
                    <span>·</span>
                    <span>{week.completedCount}/{week.totalCount}</span>
                </div>
            </div>

            {/* TSS progress bar */}
            <div className="h-1.5 bg-slate-100 dark:bg-slate-800 rounded-full overflow-hidden mb-2">
                <div
                    className={`h-full rounded-full transition-all duration-500 ${tssRatio >= 90 ? 'bg-emerald-500' : tssRatio >= 50 ? 'bg-blue-500' : 'bg-amber-500'
                        }`}
                    style={{ width: `${tssRatio}%` }}
                />
            </div>

            {/* Workouts mini list */}
            {week.workouts.length > 0 && (
                <div className="flex flex-wrap gap-1">
                    {week.workouts.map(w => {
                        const SportIcon = SPORT_ICON[w.sportType] ?? Activity;
                        const sportColor = SPORT_COLOR[w.sportType] ?? 'text-slate-400';
                        return (
                            <Link
                                key={w.id}
                                href={seanceHref(w.id)}
                                className={`
                                    flex items-center gap-1 px-2 py-1 rounded-lg text-[10px] font-medium transition-colors
                                    ${w.status === 'completed'
                                        ? 'bg-emerald-50 dark:bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
                                        : w.status === 'missed'
                                            ? 'bg-red-50 dark:bg-red-500/10 text-red-500 dark:text-red-400 line-through'
                                            : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400'
                                    }
                                    hover:ring-1 hover:ring-slate-300 dark:hover:ring-slate-600
                                `}
                                title={w.title}
                            >
                                <SportIcon size={10} className={sportColor} />
                                <span className="max-w-20 truncate">{w.title}</span>
                            </Link>
                        );
                    })}
                </div>
            )}

            {/* Regen week button for future/current weeks */}
            {!isPast && week.totalCount > 0 && (
                <button
                    onClick={onRegenerate}
                    className="mt-2 flex items-center gap-1.5 text-[10px] text-slate-400 hover:text-blue-500 transition-colors"
                >
                    <RotateCcw size={10} />
                    Régénérer cette semaine
                </button>
            )}
        </div>
    );
}

// ─── Mini Ring ────────────────────────────────────────────────────────────────

function MiniRing({ pct, size = 32 }: { pct: number; size?: number }) {
    const r = (size - 4) / 2;
    const circ = 2 * Math.PI * r;
    const color = pct >= 80 ? '#22c55e' : pct >= 50 ? '#3b82f6' : '#f59e0b';

    return (
        <div className="relative" style={{ width: size, height: size }}>
            <svg width={size} height={size}>
                <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="currentColor" strokeWidth="2.5" className="text-slate-100 dark:text-slate-800" />
                <circle
                    cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color} strokeWidth="2.5"
                    strokeDasharray={`${circ * pct / 100} ${circ * (1 - pct / 100)}`}
                    strokeLinecap="round" transform={`rotate(-90 ${size / 2} ${size / 2})`}
                    className="transition-all duration-700"
                />
            </svg>
            <span className="absolute inset-0 flex items-center justify-center text-[8px] font-bold text-slate-600 dark:text-slate-300">
                {pct}
            </span>
        </div>
    );
}

// ─── Regen Sheet ──────────────────────────────────────────────────────────────

interface RegenSheetProps {
    block: PlanOverviewBlock;
    weekId?: string;
    profile: Profile;
    onClose: () => void;
    onDone: () => void;
    onSetProgress: React.Dispatch<React.SetStateAction<WeekGenProgressState>>;
}

function RegenSheet({ block, weekId, profile, onClose, onSetProgress }: RegenSheetProps) {
    const [comment, setComment] = useState('');
    const [isGenerating, setIsGenerating] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const targetWeeks = weekId
        ? block.weeks.filter(w => w.id === weekId)
        : block.weeks.filter(w => {
            const todayStr = new Date().toISOString().slice(0, 10);
            const weekEnd = new Date(w.startDate);
            weekEnd.setDate(weekEnd.getDate() + 6);
            return todayStr <= weekEnd.toISOString().slice(0, 10);
        });

    const defaultAvailability = profile.weeklyAvailability ?? {};

    const handleGenerate = async () => {
        const weekLabel = targetWeeks.length === 1
            ? `Semaine du ${new Date(targetWeeks[0].startDate + 'T00:00:00').toLocaleDateString('fr-FR', { day: 'numeric', month: 'long' })}`
            : `${targetWeeks.length} semaines à régénérer`;

        setIsGenerating(true);
        setError(null);
        onClose();
        onSetProgress({
            active: true, minimized: false, done: false, error: null,
            startedAt: Date.now(), weekLabel,
        });

        try {
            for (const week of targetWeeks) {
                await generateWeekWorkoutsFromDate(week.startDate, comment || null, defaultAvailability);
            }
            onSetProgress(prev => ({ ...prev, done: true }));
        } catch (e) {
            const msg = e instanceof Error ? e.message : 'Erreur lors de la génération.';
            onSetProgress(prev => ({ ...prev, done: true, error: msg }));
        } finally {
            setIsGenerating(false);
        }
    };

    return (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center">
            {/* Backdrop */}
            <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />

            {/* Sheet */}
            <div className="relative bg-white dark:bg-slate-900 w-full sm:max-w-lg sm:rounded-2xl rounded-t-2xl border border-slate-200 dark:border-slate-800 shadow-2xl max-h-[85vh] overflow-y-auto">
                {/* Header */}
                <div className="sticky top-0 bg-white dark:bg-slate-900 border-b border-slate-100 dark:border-slate-800 px-5 py-4 flex items-center justify-between z-10">
                    <div>
                        <h3 className="text-sm font-bold text-slate-900 dark:text-white">
                            {weekId ? 'Régénérer une semaine' : 'Recalculer le bloc'}
                        </h3>
                        <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                            {block.type} — {block.theme}
                        </p>
                    </div>
                    <button onClick={onClose} className="p-2 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg transition-colors">
                        <X size={16} className="text-slate-400" />
                    </button>
                </div>

                <div className="p-5 space-y-4">
                    {/* Target weeks summary */}
                    <div className="bg-slate-50 dark:bg-slate-800/40 rounded-xl p-3">
                        <p className="text-xs font-semibold text-slate-500 dark:text-slate-400 mb-2">
                            {targetWeeks.length} semaine{targetWeeks.length > 1 ? 's' : ''} à régénérer
                        </p>
                        <div className="flex flex-wrap gap-1.5">
                            {targetWeeks.map(w => {
                                const badge = WEEK_TYPE_BADGE[w.type] ?? WEEK_TYPE_BADGE.Load;
                                return (
                                    <span key={w.id} className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${badge.class}`}>
                                        S{w.weekNumber} · {w.type} · {w.targetTSS} TSS
                                    </span>
                                );
                            })}
                        </div>
                    </div>

                    {/* Comment */}
                    <div>
                        <label className="flex items-center gap-1.5 text-xs font-semibold text-slate-600 dark:text-slate-300 mb-2">
                            <MessageSquare size={12} />
                            Instructions pour l&apos;IA
                        </label>
                        <textarea
                            value={comment}
                            onChange={e => setComment(e.target.value)}
                            placeholder="Ex: Je me suis blessé au genou, je veux travailler mon point faible en côte, j'ai plus de temps cette semaine..."
                            className="w-full px-3 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-sm text-slate-900 dark:text-white placeholder:text-slate-400 resize-none focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500"
                            rows={3}
                        />
                    </div>

                    {error && (
                        <div className="flex items-start gap-2 bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/20 rounded-xl p-3 text-xs text-red-600 dark:text-red-300">
                            <AlertCircle size={14} className="shrink-0 mt-0.5" />
                            {error}
                        </div>
                    )}

                    {/* Generate button */}
                    <button
                        onClick={handleGenerate}
                        disabled={isGenerating}
                        className="w-full flex items-center justify-center gap-2 py-3 rounded-xl bg-blue-600 hover:bg-blue-500 disabled:bg-blue-400 text-white font-semibold text-sm transition-colors shadow-lg shadow-blue-900/20"
                    >
                        {isGenerating ? (
                            <>
                                <Loader2 size={16} className="animate-spin" />
                                Génération en cours...
                            </>
                        ) : (
                            <>
                                <Sparkles size={14} />
                                Régénérer avec l&apos;IA
                            </>
                        )}
                    </button>
                </div>
            </div>
        </div>
    );
}
