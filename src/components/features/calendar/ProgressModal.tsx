'use client';

import React, { useEffect, useRef, useState } from 'react';
import { Check, Loader2, Minus, ChevronUp } from 'lucide-react';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ProgressStage {
    label: string;
    /** Cible visuelle atteinte à la fin de cette étape (0-100). */
    progressAt: number;
    /**
     * Durée réelle attendue de l'étape en ms (mesurée en prod).
     * Si fourni pour toutes les étapes, la barre progresse linéairement dans
     * chaque tranche en fonction de son poids réel — bien plus fidèle qu'un
     * ease-out temporel. Fallback : `ProgressModalConfig.durationMs`.
     */
    expectedMs?: number;
}

export interface ProgressState {
    active: boolean;
    minimized: boolean;
    done: boolean;
    error: string | null;
    startedAt: number;
}

export interface ProgressModalConfig {
    icon: React.ReactNode;
    label: string;
    titleLoading: string;
    titleDone: string;
    titleError: string;
    subtitleLoading: string;
    subtitleDone: string;
    miniLabelLoading: string;
    miniLabelDone: string;
    stages: ProgressStage[];
    /** Fallback si les étapes n'ont pas de `expectedMs` (mode legacy ease-out). */
    durationMs: number;
}

interface ProgressModalProps {
    state: ProgressState;
    config: ProgressModalConfig;
    onMinimize: () => void;
    onRestore: () => void;
    onClose: () => void;
}

// ─── Progress animation hook ──────────────────────────────────────────────────

/** Plafond absolu — 100% reste réservé à `state.done`. */
const MAX_AUTO = 98;

/**
 * Calcule la progression à partir des durées réelles attendues par étape.
 * - Dans les temps : interpolation linéaire à travers les tranches
 *   (chaque étape occupe `progressAt` proportionnellement à son `expectedMs`).
 * - Au-delà du total attendu : creep asymptotique vers `MAX_AUTO` — la barre
 *   ne se fige jamais, elle rampe de plus en plus lentement.
 */
function computeStagedProgress(elapsed: number, stages: ProgressStage[]): number {
    const totalMs = stages.reduce((s, x) => s + (x.expectedMs ?? 0), 0);
    if (totalMs <= 0 || stages.length === 0) return 0;

    if (elapsed <= totalMs) {
        let acc = 0;
        let prevProgress = 0;
        for (const stage of stages) {
            const stageMs = stage.expectedMs ?? 0;
            const stageEnd = acc + stageMs;
            if (elapsed <= stageEnd) {
                const t = stageMs > 0 ? (elapsed - acc) / stageMs : 1;
                return prevProgress + t * (stage.progressAt - prevProgress);
            }
            acc = stageEnd;
            prevProgress = stage.progressAt;
        }
        return prevProgress;
    }

    // Overshoot : creep exponentiel. tau = totalMs/2 → ~86% du gap absorbé
    // après une durée équivalente au total prévu.
    const lastProgress = stages[stages.length - 1].progressAt;
    const overshoot = elapsed - totalMs;
    const tau = totalMs / 2;
    const t = 1 - Math.exp(-overshoot / tau);
    return lastProgress + t * (MAX_AUTO - lastProgress);
}

function computeEasedProgress(elapsed: number, durationMs: number): number {
    const linear = Math.min(elapsed / durationMs, 1);
    const eased = 1 - Math.pow(1 - linear, 2.2);
    return Math.min(eased * MAX_AUTO, MAX_AUTO);
}

function useAnimatedProgress(
    active: boolean,
    done: boolean,
    startedAt: number,
    stages: ProgressStage[],
    durationMs: number,
) {
    const [progress, setProgress] = useState(() => done ? 100 : 0);
    const [prevActive, setPrevActive] = useState(active);
    const [prevDone, setPrevDone] = useState(done);
    const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

    // Latest values pour le closure de l'interval — évite de reset l'interval
    // à chaque re-render (config est un objet littéral chez l'appelant).
    const stagesRef = useRef(stages);
    const durationRef = useRef(durationMs);
    useEffect(() => {
        stagesRef.current = stages;
        durationRef.current = durationMs;
    });

    // Reset à 0 quand active passe de true à false
    if (prevActive && !active) {
        setProgress(0);
        setPrevActive(active);
    } else if (prevActive !== active) {
        setPrevActive(active);
    }

    // Saute à 100 dès que done passe à true
    if (!prevDone && done) {
        setProgress(100);
        setPrevDone(done);
    } else if (prevDone !== done) {
        setPrevDone(done);
    }

    useEffect(() => {
        if (!active || done) {
            if (intervalRef.current) clearInterval(intervalRef.current);
            return;
        }
        if (intervalRef.current) clearInterval(intervalRef.current);

        intervalRef.current = setInterval(() => {
            const elapsed = Date.now() - startedAt;
            const currentStages = stagesRef.current;
            const hasWeights = currentStages.length > 0
                && currentStages.every(s => typeof s.expectedMs === 'number' && (s.expectedMs ?? 0) > 0);
            const next = hasWeights
                ? computeStagedProgress(elapsed, currentStages)
                : computeEasedProgress(elapsed, durationRef.current);
            setProgress(Math.min(next, MAX_AUTO));
            // Pas de clearInterval sur "durée dépassée" : le creep asymptotique
            // continue de faire avancer la barre jusqu'à `done=true`.
        }, 100);

        return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
    }, [active, done, startedAt]);

    return progress;
}

// ─── Component ────────────────────────────────────────────────────────────────

export function ProgressModal({ state, config, onMinimize, onRestore, onClose }: ProgressModalProps) {
    const progress = useAnimatedProgress(state.active, state.done, state.startedAt, config.stages, config.durationMs);

    // `progressAt` = fin de l'étape (là où la barre arrive quand l'étape se termine).
    // L'étape active est la PREMIÈRE dont progressAt n'est pas encore atteint.
    // Dès que progress franchit un progressAt, on bascule instantanément à la suivante.
    let activeIdx: number;
    if (state.done) {
        activeIdx = config.stages.length - 1;
    } else {
        const idx = config.stages.findIndex(s => progress < s.progressAt);
        activeIdx = idx === -1 ? config.stages.length - 1 : idx;
    }

    // Auto-close after done
    useEffect(() => {
        if (state.done && !state.error) {
            const t = setTimeout(onClose, 1200);
            return () => clearTimeout(t);
        }
    }, [state.done, state.error, onClose]);

    // ── Mini banner ──
    if (state.minimized && state.active) {
        return (
            <button
                onClick={onRestore}
                className="fixed top-20 right-3 z-50 flex items-center gap-2.5 px-3.5 py-2 bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-full shadow-lg text-sm font-medium text-slate-900 dark:text-white animate-in slide-in-from-top-2 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
            >
                {state.done ? (
                    <Check size={14} className="text-emerald-600 dark:text-emerald-400" />
                ) : (
                    <Loader2 size={14} className="animate-spin text-blue-600 dark:text-blue-400" />
                )}
                <span>{state.done ? config.miniLabelDone : config.miniLabelLoading}</span>
                <span className="text-blue-600 dark:text-blue-400 font-bold tabular-nums">
                    {Math.round(progress)}%
                </span>
                <ChevronUp size={14} className="text-slate-500" />
            </button>
        );
    }

    if (!state.active) return null;

    return (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in duration-200">
            <div
                className="w-full max-w-md bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700/80 rounded-2xl shadow-2xl shadow-slate-300/50 dark:shadow-black/50 overflow-hidden animate-in slide-in-from-bottom-4 sm:zoom-in-95 duration-200"
                onClick={e => e.stopPropagation()}
            >
                {/* ── Header ── */}
                <div className="relative px-5 pt-5 pb-4 bg-linear-to-br from-blue-50 dark:from-blue-950/60 to-white dark:to-slate-900 border-b border-slate-200 dark:border-slate-800">
                    <div className="flex items-start justify-between gap-3">
                        <div className="flex items-center gap-3">
                            <div className="w-10 h-10 rounded-xl bg-blue-100 dark:bg-blue-600/20 border border-blue-200 dark:border-blue-500/30 flex items-center justify-center shrink-0">
                                {config.icon}
                            </div>
                            <div>
                                <h3 className="text-base font-bold text-slate-900 dark:text-white leading-tight">
                                    {state.error ? config.titleError : state.done ? config.titleDone : config.titleLoading}
                                </h3>
                                <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                                    {state.error ? state.error : state.done ? config.subtitleDone : config.subtitleLoading}
                                </p>
                            </div>
                        </div>
                        {!state.done && !state.error && (
                            <button
                                onClick={onMinimize}
                                title="Réduire"
                                className="p-1.5 text-slate-500 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg transition-colors shrink-0"
                            >
                                <Minus size={16} />
                            </button>
                        )}
                    </div>

                    {/* Label pill */}
                    {config.label && (
                        <div className="flex items-center gap-2 mt-4">
                            <span className="text-sm font-medium text-slate-900 dark:text-white">
                                {config.label}
                            </span>
                        </div>
                    )}
                </div>

                {/* ── Progress bar ── */}
                <div className="px-5 pt-5 pb-2">
                    <div className="flex items-center justify-between mb-2">
                        <span className="text-xs text-slate-500 dark:text-slate-400">
                            {state.error ? 'Interrompu' : state.done ? 'Terminé' : config.stages[activeIdx]?.label ?? '…'}
                        </span>
                        <span className="text-sm font-bold text-slate-900 dark:text-white tabular-nums">
                            {Math.round(progress)}%
                        </span>
                    </div>
                    <div className="h-2 bg-slate-100 dark:bg-slate-800 rounded-full overflow-hidden">
                        <div
                            className={`h-full rounded-full transition-[width] duration-200 ${state.error
                                    ? 'bg-red-500'
                                    : state.done
                                        ? 'bg-emerald-500'
                                        : 'bg-linear-to-r from-blue-600 to-blue-400'
                                }`}
                            style={{ width: `${progress}%` }}
                        />
                    </div>
                </div>

                {/* ── Stages list ── */}
                <div className="px-5 pt-3 pb-5 space-y-2.5">
                    {config.stages.map((stage, i) => {
                        // Transition nette : dès que activeIdx avance, les précédentes
                        // deviennent done (check) et la nouvelle prend le spinner.
                        const isDone   = state.done || i < activeIdx;
                        const isActive = !state.done && !state.error && i === activeIdx;
                        const isPending = !isDone && !isActive;

                        return (
                            <div key={i} className="flex items-center gap-3">
                                <div className={`
                                    w-5 h-5 rounded-full flex items-center justify-center shrink-0
                                    ${isDone ? 'bg-emerald-50 dark:bg-emerald-500/20 border border-emerald-200 dark:border-emerald-500/40' : ''}
                                    ${isActive ? 'bg-blue-50 dark:bg-blue-500/20 border border-blue-200 dark:border-blue-500/40' : ''}
                                    ${isPending ? 'bg-slate-100 dark:bg-slate-800 border border-slate-300 dark:border-slate-700' : ''}
                                `}>
                                    {isDone && <Check size={11} className="text-emerald-600 dark:text-emerald-400" />}
                                    {isActive && <Loader2 size={11} className="text-blue-600 dark:text-blue-400 animate-spin" />}
                                </div>
                                <span className={`text-sm ${isDone ? 'text-slate-500 dark:text-slate-400 line-through decoration-slate-400 dark:decoration-slate-600' :
                                        isActive ? 'text-slate-900 dark:text-white font-medium' :
                                            'text-slate-500 dark:text-slate-600'
                                    }`}>
                                    {stage.label}
                                </span>
                            </div>
                        );
                    })}
                </div>
            </div>
        </div>
    );
}
