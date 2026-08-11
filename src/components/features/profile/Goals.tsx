'use client';

import React, { useState } from 'react';
import { Card } from '@/components/ui';
import {
    Trophy, Target, Plus, Trash2, Edit2,
    Calendar, MapPin, Mountain, ChevronDown, ChevronUp,
} from 'lucide-react';
import { Dispatch, SetStateAction } from 'react';
import { SectionHeader } from './SessionHeader';
import { Objective, Profile } from '@/lib/data/DatabaseTypes';
import { ObjectiveModal } from '@/components/features/calendar/ObjectiveModal';
import { parseLocalDate } from '@/lib/utils';

interface GoalsProps {
    formData: Profile;
    setFormData: Dispatch<SetStateAction<Profile>>;
    objectives: Objective[];
    onSaveObjective?: (obj: Objective) => Promise<void>;
    onDeleteObjective?: (id: string) => Promise<void>;
}

const SPORT_LABELS: Record<string, string> = {
    cycling: 'Vélo',
    running: 'Course',
    swimming: 'Natation',
    triathlon: 'Triathlon',
    duathlon: 'Duathlon',
};

const STATUS_LABELS: Record<Objective['status'], { label: string; color: string }> = {
    upcoming: { label: 'À venir', color: 'text-blue-600 dark:text-blue-400 bg-blue-100 dark:bg-blue-500/10 border-blue-200 dark:border-blue-500/30' },
    completed: { label: 'Terminé', color: 'text-emerald-600 dark:text-emerald-400 bg-emerald-100 dark:bg-emerald-500/10 border-emerald-200 dark:border-emerald-500/30' },
    missed: { label: 'Manqué', color: 'text-slate-500 dark:text-slate-400 bg-slate-200 dark:bg-slate-700/50 border-slate-300 dark:border-slate-600/30' },
    passed: { label: 'Passé', color: 'text-amber-600 dark:text-amber-400 bg-amber-100 dark:bg-amber-500/10 border-amber-200 dark:border-amber-500/30' },
};

export const Goals: React.FC<GoalsProps> = ({ objectives, onSaveObjective, onDeleteObjective }) => {
    const [showObjectiveModal, setShowObjectiveModal] = useState(false);
    const [editingObjective, setEditingObjective] = useState<Objective | null>(null);
    const [isSavingObj, setIsSavingObj] = useState(false);
    const [deletingId, setDeletingId] = useState<string | null>(null);
    const [showPast, setShowPast] = useState(false);

    const today = new Date().toISOString().split('T')[0];
    const visibleObjectives = objectives.filter(o => o.status !== 'passed');
    const upcomingObjs = visibleObjectives.filter(o => o.date >= today).sort((a, b) => a.date.localeCompare(b.date));
    const pastObjs = visibleObjectives.filter(o => o.date < today).sort((a, b) => b.date.localeCompare(a.date));

    const handleOpenAdd = () => {
        setEditingObjective(null);
        setShowObjectiveModal(true);
    };

    const handleOpenEdit = (obj: Objective) => {
        setEditingObjective(obj);
        setShowObjectiveModal(true);
    };

    const handleSaveObjective = async (obj: Objective) => {
        if (!onSaveObjective) return;
        setIsSavingObj(true);
        try {
            await onSaveObjective(obj);
        } finally {
            setIsSavingObj(false);
            setShowObjectiveModal(false);
        }
    };

    const handleDelete = async (id: string) => {
        if (!onDeleteObjective) return;
        setDeletingId(id);
        try {
            await onDeleteObjective(id);
        } finally {
            setDeletingId(null);
        }
    };

    return (
        <div className="space-y-6">
            {/* ── Mes Objectifs ── */}
            <Card className="p-6 bg-slate-50 dark:bg-slate-900/50 border-slate-200 dark:border-slate-800 border-t-4 border-t-rose-500">
                <div className="flex items-center justify-between mb-5">
                    <SectionHeader icon={Trophy} title="Mes Objectifs" color="text-rose-600 dark:text-rose-400" />
                    <button
                        onClick={handleOpenAdd}
                        className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-rose-100 dark:bg-rose-600/20 border border-rose-200 dark:border-rose-500/30 text-rose-600 dark:text-rose-400 hover:bg-rose-200 dark:hover:bg-rose-600/30 transition-all text-sm font-medium"
                    >
                        <Plus size={14} />
                        Ajouter
                    </button>
                </div>

                {/* Objectifs à venir */}
                {upcomingObjs.length === 0 && pastObjs.length === 0 ? (
                    <div className="text-center py-10">
                        <Trophy size={32} className="text-slate-300 dark:text-slate-700 mx-auto mb-3" />
                        <p className="text-slate-500 text-sm font-medium">Aucun objectif enregistré</p>
                        <p className="text-slate-500 dark:text-slate-600 text-xs mt-1">Ajoutez vos courses et événements pour que l&apos;IA puisse construire un plan adapté.</p>
                        <button
                            onClick={handleOpenAdd}
                            className="mt-4 inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-rose-600 hover:bg-rose-500 text-white text-sm font-medium transition-colors"
                        >
                            <Plus size={14} />
                            Ajouter mon premier objectif
                        </button>
                    </div>
                ) : (
                    <div className="space-y-4">
                        {/* À venir */}
                        {upcomingObjs.length > 0 && (
                            <div className="space-y-2">
                                <p className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wide">À venir ({upcomingObjs.length})</p>
                                {upcomingObjs.map(obj => (
                                    <ObjectiveCard
                                        key={obj.id}
                                        obj={obj}
                                        onEdit={() => handleOpenEdit(obj)}
                                        onDelete={() => handleDelete(obj.id)}
                                        isDeleting={deletingId === obj.id}
                                    />
                                ))}
                            </div>
                        )}

                        {/* Passés (collapsible) */}
                        {pastObjs.length > 0 && (
                            <div>
                                <button
                                    onClick={() => setShowPast(v => !v)}
                                    className="flex items-center gap-2 text-xs font-semibold text-slate-500 uppercase tracking-wide hover:text-slate-600 dark:hover:text-slate-300 transition-colors"
                                >
                                    {showPast ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
                                    Passés ({pastObjs.length})
                                </button>
                                {showPast && (
                                    <div className="mt-2 space-y-2">
                                        {pastObjs.map(obj => (
                                            <ObjectiveCard
                                                key={obj.id}
                                                obj={obj}
                                                onEdit={() => handleOpenEdit(obj)}
                                                onDelete={() => handleDelete(obj.id)}
                                                isDeleting={deletingId === obj.id}
                                                isPast
                                            />
                                        ))}
                                    </div>
                                )}
                            </div>
                        )}
                    </div>
                )}
            </Card>

            <ObjectiveModal
                isOpen={showObjectiveModal}
                onClose={() => setShowObjectiveModal(false)}
                onSave={handleSaveObjective}
                onDelete={onDeleteObjective ? handleDelete : undefined}
                initial={editingObjective}
                isSaving={isSavingObj}
            />
        </div>
    );
};

// ─── Sub-component: ObjectiveCard ─────────────────────────────────────────────

interface ObjectiveCardProps {
    obj: Objective;
    onEdit: () => void;
    onDelete: () => void;
    isDeleting: boolean;
    isPast?: boolean;
}

function ObjectiveCard({ obj, onEdit, onDelete, isDeleting, isPast }: ObjectiveCardProps) {
    const statusInfo = STATUS_LABELS[obj.status] ?? STATUS_LABELS.upcoming;
    const isPrimary = obj.priority === 'principale';

    return (
        <div className={`flex items-start gap-3 p-3.5 rounded-xl border transition-all ${isPrimary
                ? 'bg-rose-50 dark:bg-rose-950/30 border-rose-200 dark:border-rose-500/30'
                : 'bg-slate-100 dark:bg-slate-800/50 border-slate-200 dark:border-slate-700/50'
            } ${isPast ? 'opacity-60' : ''}`}>
            {/* Icon */}
            <div className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 ${isPrimary ? 'bg-rose-100 dark:bg-rose-600/20 border border-rose-200 dark:border-rose-500/30' : 'bg-slate-200 dark:bg-slate-700/50 border border-slate-300 dark:border-slate-600/30'
                }`}>
                {isPrimary
                    ? <Trophy size={15} className="text-rose-600 dark:text-rose-400" />
                    : <Target size={15} className="text-amber-600 dark:text-amber-400" />
                }
            </div>

            {/* Content */}
            <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-slate-900 dark:text-white text-sm font-semibold truncate">{obj.name}</span>
                    <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full border ${isPrimary ? 'text-rose-600 dark:text-rose-400 bg-rose-100 dark:bg-rose-500/10 border-rose-200 dark:border-rose-500/30' : 'text-amber-600 dark:text-amber-400 bg-amber-100 dark:bg-amber-500/10 border-amber-200 dark:border-amber-500/30'
                        }`}>
                        {isPrimary ? 'Principal' : 'Secondaire'}
                    </span>
                    <span className={`text-[10px] px-1.5 py-0.5 rounded-full border ${statusInfo.color}`}>
                        {statusInfo.label}
                    </span>
                </div>
                <p className="text-slate-500 text-xs mt-0.5">{SPORT_LABELS[obj.sport] ?? obj.sport}</p>
                <div className="flex flex-wrap gap-3 mt-1.5">
                    <span className="flex items-center gap-1 text-xs text-slate-500 dark:text-slate-400">
                        <Calendar size={10} />
                        {parseLocalDate(obj.date).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' })}
                    </span>
                    {obj.distanceKm && (
                        <span className="flex items-center gap-1 text-xs text-slate-500 dark:text-slate-400">
                            <MapPin size={10} />
                            {obj.distanceKm} km
                        </span>
                    )}
                    {obj.elevationGainM && (
                        <span className="flex items-center gap-1 text-xs text-slate-500 dark:text-slate-400">
                            <Mountain size={10} />
                            {obj.elevationGainM} m D+
                        </span>
                    )}
                </div>
                {obj.comment && (
                    <p className="text-slate-500 text-xs mt-1 italic line-clamp-1">{obj.comment}</p>
                )}
            </div>

            {/* Actions */}
            <div className="flex gap-1 shrink-0">
                <button
                    onClick={onEdit}
                    className="w-7 h-7 flex items-center justify-center rounded-lg text-slate-500 hover:text-slate-900 dark:hover:text-white hover:bg-slate-200 dark:hover:bg-slate-700 transition-all"
                >
                    <Edit2 size={13} />
                </button>
                <button
                    onClick={onDelete}
                    disabled={isDeleting}
                    className="w-7 h-7 flex items-center justify-center rounded-lg text-slate-500 hover:text-red-600 dark:hover:text-red-400 hover:bg-red-100 dark:hover:bg-red-500/10 transition-all disabled:opacity-40"
                >
                    {isDeleting
                        ? <div className="w-3 h-3 border border-slate-400 border-t-transparent rounded-full animate-spin" />
                        : <Trash2 size={13} />
                    }
                </button>
            </div>
        </div>
    );
}
