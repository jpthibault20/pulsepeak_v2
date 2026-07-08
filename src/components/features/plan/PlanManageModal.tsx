'use client';

import React, { useState } from 'react';
import {
    Pencil, CalendarClock, Trash2, AlertTriangle, Loader2,
    ChevronLeft, ChevronRight, ArrowRight,
} from 'lucide-react';
import { addDays, format } from 'date-fns';
import { Modal } from '@/components/ui/Modale';
import { Button } from '@/components/ui/Button';
import { deletePlan, updatePlanDetails, shiftPlan } from '@/app/actions/schedule/plan-management';
import { parseLocalDate } from '@/lib/utils';

interface PlanSummary {
    id: string;
    name: string;
    startDate: string;
    goalDate: string;
    macroStrategyDescription: string;
}

interface PlanManageModalProps {
    isOpen: boolean;
    plan: PlanSummary;
    onClose: () => void;
    /** Appelé après une mutation réussie (édition / décalage / suppression). */
    onDone: () => void;
}

/**
 * Modale de gestion du plan actif : édition des infos, décalage temporel
 * (séances à venir uniquement) et suppression définitive.
 */
export const PlanManageModal: React.FC<PlanManageModalProps> = ({ isOpen, plan, onClose, onDone }) => {
    // ── Édition ────────────────────────────────────────────────
    const [name, setName] = useState(plan.name);
    const [goalDate, setGoalDate] = useState(plan.goalDate ?? '');
    const [macro, setMacro] = useState(plan.macroStrategyDescription ?? '');

    // ── Décalage ───────────────────────────────────────────────
    const [offsetDays, setOffsetDays] = useState(7);

    // ── Suppression ────────────────────────────────────────────
    const [confirmDelete, setConfirmDelete] = useState(false);

    // ── État commun ────────────────────────────────────────────
    const [busy, setBusy] = useState<null | 'edit' | 'shift' | 'delete'>(null);
    const [error, setError] = useState<string | null>(null);

    const run = async (kind: 'edit' | 'shift' | 'delete', fn: () => Promise<void>) => {
        setBusy(kind);
        setError(null);
        try {
            await fn();
            onDone();
        } catch (e) {
            console.error('[PlanManageModal]', e);
            setError(e instanceof Error ? e.message : 'Une erreur est survenue.');
            setBusy(null);
        }
    };

    const editDirty =
        name.trim() !== plan.name ||
        (goalDate ?? '') !== (plan.goalDate ?? '') ||
        (macro ?? '') !== (plan.macroStrategyDescription ?? '');

    const previewGoal = plan.goalDate
        ? format(addDays(parseLocalDate(plan.goalDate), offsetDays), 'dd/MM/yyyy')
        : null;

    return (
        <Modal isOpen={isOpen} onClose={onClose} title="Gérer le plan" className="max-w-lg">
            <div className="space-y-6">

                {error && (
                    <div className="bg-rose-50 dark:bg-rose-900/10 border border-rose-200 dark:border-rose-500/20 p-3 rounded-lg flex gap-2.5 items-start text-sm">
                        <AlertTriangle className="text-rose-500 shrink-0 mt-0.5" size={16} />
                        <p className="text-rose-700 dark:text-rose-200/90">{error}</p>
                    </div>
                )}

                {/* ── Section : Modifier les infos ─────────────────────── */}
                <section className="space-y-3">
                    <h3 className="flex items-center gap-2 text-sm font-semibold text-slate-700 dark:text-slate-200">
                        <Pencil size={15} className="text-blue-500" /> Modifier les infos
                    </h3>

                    <div className="space-y-3">
                        <div>
                            <label className="block text-xs font-medium text-slate-500 dark:text-slate-400 mb-1">Nom du plan</label>
                            <input
                                type="text"
                                value={name}
                                onChange={(e) => setName(e.target.value)}
                                className="w-full h-10 px-3 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-sm text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500/40"
                            />
                        </div>
                        <div>
                            <label className="block text-xs font-medium text-slate-500 dark:text-slate-400 mb-1">Date objectif</label>
                            <input
                                type="date"
                                value={goalDate}
                                onChange={(e) => setGoalDate(e.target.value)}
                                className="w-full h-10 px-3 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-sm text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500/40"
                            />
                        </div>
                        <div>
                            <label className="block text-xs font-medium text-slate-500 dark:text-slate-400 mb-1">Stratégie macro</label>
                            <textarea
                                value={macro}
                                onChange={(e) => setMacro(e.target.value)}
                                rows={3}
                                className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-sm text-slate-900 dark:text-white resize-none focus:outline-none focus:ring-2 focus:ring-blue-500/40"
                            />
                        </div>
                    </div>

                    <Button
                        variant="primary"
                        className="w-full h-10"
                        disabled={!editDirty || !name.trim() || busy !== null}
                        isLoading={busy === 'edit'}
                        onClick={() => run('edit', () => updatePlanDetails(plan.id, {
                            name: name.trim(),
                            goalDate: goalDate || null,
                            macroStrategyDescription: macro,
                        }))}
                    >
                        Enregistrer les modifications
                    </Button>
                </section>

                {/* ── Section : Décaler le plan ────────────────────────── */}
                <section className="space-y-3 pt-5 border-t border-slate-200 dark:border-slate-800">
                    <h3 className="flex items-center gap-2 text-sm font-semibold text-slate-700 dark:text-slate-200">
                        <CalendarClock size={15} className="text-amber-500" /> Décaler le plan
                    </h3>
                    <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
                        Déplace les séances <span className="font-medium">à venir</span> du plan. Les séances passées
                        et complétées restent à leur date.
                    </p>

                    <div className="flex items-center justify-center gap-3">
                        <button
                            type="button"
                            onClick={() => setOffsetDays(d => d - 1)}
                            className="w-9 h-9 flex items-center justify-center rounded-lg border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800"
                        >
                            <ChevronLeft size={18} />
                        </button>
                        <div className="text-center min-w-[7rem]">
                            <div className={`text-2xl font-bold tabular-nums ${offsetDays === 0 ? 'text-slate-400' : offsetDays > 0 ? 'text-amber-600 dark:text-amber-400' : 'text-blue-600 dark:text-blue-400'}`}>
                                {offsetDays > 0 ? `+${offsetDays}` : offsetDays}
                            </div>
                            <div className="text-[10px] uppercase tracking-wider text-slate-500">
                                {Math.abs(offsetDays) <= 1 ? 'jour' : 'jours'}
                            </div>
                        </div>
                        <button
                            type="button"
                            onClick={() => setOffsetDays(d => d + 1)}
                            className="w-9 h-9 flex items-center justify-center rounded-lg border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800"
                        >
                            <ChevronRight size={18} />
                        </button>
                    </div>

                    <div className="flex justify-center gap-2">
                        {[-7, -1, 1, 7].map(v => (
                            <button
                                key={v}
                                type="button"
                                onClick={() => setOffsetDays(v)}
                                className="px-2.5 py-1 rounded-md text-xs font-medium border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800"
                            >
                                {v > 0 ? `+${v}` : v} j
                            </button>
                        ))}
                    </div>

                    {previewGoal && offsetDays !== 0 && (
                        <p className="text-xs text-center text-slate-500 dark:text-slate-400 flex items-center justify-center gap-1.5">
                            Date objectif
                            <span className="line-through">{format(parseLocalDate(plan.goalDate), 'dd/MM/yyyy')}</span>
                            <ArrowRight size={12} />
                            <span className="font-semibold text-slate-700 dark:text-slate-200">{previewGoal}</span>
                        </p>
                    )}

                    <Button
                        variant="outline"
                        className="w-full h-10"
                        disabled={offsetDays === 0 || busy !== null}
                        isLoading={busy === 'shift'}
                        onClick={() => run('shift', () => shiftPlan(plan.id, offsetDays))}
                    >
                        Appliquer le décalage
                    </Button>
                </section>

                {/* ── Section : Supprimer ──────────────────────────────── */}
                <section className="space-y-3 pt-5 border-t border-slate-200 dark:border-slate-800">
                    <h3 className="flex items-center gap-2 text-sm font-semibold text-rose-600 dark:text-rose-400">
                        <Trash2 size={15} /> Supprimer le plan
                    </h3>

                    {!confirmDelete ? (
                        <Button
                            variant="outline"
                            className="w-full h-10 border-rose-300 dark:border-rose-500/30 text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-900/10"
                            disabled={busy !== null}
                            onClick={() => setConfirmDelete(true)}
                        >
                            Supprimer ce plan
                        </Button>
                    ) : (
                        <div className="space-y-3">
                            <div className="bg-rose-50 dark:bg-rose-900/10 border border-rose-200 dark:border-rose-500/20 p-3 rounded-lg flex gap-2.5 items-start">
                                <AlertTriangle className="text-rose-500 shrink-0 mt-0.5" size={16} />
                                <p className="text-rose-700 dark:text-rose-200/90 text-sm leading-relaxed">
                                    Cette action supprime définitivement le plan
                                    <span className="font-semibold"> {plan.name}</span> ainsi que tous ses blocs,
                                    semaines et séances planifiées.
                                </p>
                            </div>
                            <div className="flex gap-3">
                                <Button
                                    variant="outline"
                                    className="flex-1 h-10"
                                    disabled={busy !== null}
                                    onClick={() => setConfirmDelete(false)}
                                >
                                    Annuler
                                </Button>
                                <Button
                                    variant="primary"
                                    className="flex-1 h-10 bg-rose-600 hover:bg-rose-500 border-rose-500"
                                    disabled={busy !== null}
                                    isLoading={busy === 'delete'}
                                    onClick={() => run('delete', () => deletePlan(plan.id))}
                                >
                                    Supprimer définitivement
                                </Button>
                            </div>
                        </div>
                    )}
                </section>

                {busy !== null && (
                    <div className="flex items-center justify-center gap-2 text-xs text-slate-400 pt-1">
                        <Loader2 size={13} className="animate-spin" /> Traitement en cours…
                    </div>
                )}
            </div>
        </Modal>
    );
};
