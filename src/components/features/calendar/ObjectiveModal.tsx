'use client';

import React, { useState } from 'react';
import { Trophy, Calendar, MapPin, Mountain, FileText, Trash2, AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modale';
import type { Objective } from '@/lib/data/DatabaseTypes';
type ObjectiveSport = Objective['sport'];

interface ObjectiveModalProps {
    isOpen: boolean;
    onClose: () => void;
    onSave: (obj: Objective) => Promise<void>;
    /** Optionnel : active le bouton "Supprimer" en mode édition. */
    onDelete?: (id: string) => Promise<void>;
    initialDate?: string;
    initial?: Objective | null;
    isSaving?: boolean;
}

const SPORT_OPTIONS: { value: ObjectiveSport; label: string }[] = [
    { value: 'triathlon',  label: 'Triathlon' },
    { value: 'cycling',   label: 'Vélo / Cyclosportive' },
    { value: 'running',   label: 'Course à pied' },
    { value: 'swimming',  label: 'Natation' },
    { value: 'duathlon',  label: 'Duathlon' },
];

export function ObjectiveModal({ isOpen, onClose, onSave, onDelete, initialDate, initial, isSaving = false }: ObjectiveModalProps) {
    const [name, setName] = useState(initial?.name ?? '');
    const [date, setDate] = useState(initial?.date ?? initialDate ?? '');
    const [sport, setSport] = useState<ObjectiveSport>(initial?.sport ?? 'triathlon');
    const [distanceKm, setDistanceKm] = useState(initial?.distanceKm?.toString() ?? '');
    const [elevationGainM, setElevationGainM] = useState(initial?.elevationGainM?.toString() ?? '');
    const [priority, setPriority] = useState<Objective['priority']>(initial?.priority ?? 'secondaire');
    const [comment, setComment] = useState(initial?.comment ?? '');
    const [confirmDelete, setConfirmDelete] = useState(false);
    const [isDeleting, setIsDeleting] = useState(false);

    // Synchronise le formulaire à l'ouverture (ou quand on passe d'un objectif à un autre
    // sans fermer la modale). Pattern React "adjusting state during rendering" — évite
    // un useEffect qui causerait un setState en cascade.
    // cf. https://react.dev/learn/you-might-not-need-an-effect#adjusting-some-state-when-a-prop-changes
    const syncKey = `${isOpen ? '1' : '0'}|${initial?.id ?? ''}|${initialDate ?? ''}`;
    const [lastSyncKey, setLastSyncKey] = useState(syncKey);
    if (lastSyncKey !== syncKey) {
        setLastSyncKey(syncKey);
        setConfirmDelete(false);
        if (isOpen) {
            if (initial) {
                setName(initial.name);
                setDate(initial.date);
                setSport(initial.sport);
                setDistanceKm(initial.distanceKm?.toString() ?? '');
                setElevationGainM(initial.elevationGainM?.toString() ?? '');
                setPriority(initial.priority);
                setComment(initial.comment ?? '');
            } else {
                setName('');
                setDate(initialDate ?? '');
                setSport('triathlon');
                setDistanceKm('');
                setElevationGainM('');
                setPriority('secondaire');
                setComment('');
            }
        }
    }

    const canSave = name.trim().length >= 2 && date.length === 10;

    const handleSave = async () => {
        if (!canSave) return;
        const now = new Date().toISOString();
        const obj: Objective = {
            id:             initial?.id ?? crypto.randomUUID(),
            userId:         initial?.userId ?? '',
            createdAt:      initial?.createdAt ?? now,
            updatedAt:      now,
            name:           name.trim(),
            date,
            sport,
            distanceKm:     distanceKm     ? parseFloat(distanceKm)     : undefined,
            elevationGainM: elevationGainM ? parseFloat(elevationGainM) : undefined,
            priority,
            status:         initial?.status ?? 'upcoming',
            comment:        comment.trim() || undefined,
        };
        await onSave(obj);
        onClose();
    };

    const handleDelete = async () => {
        if (!onDelete || !initial) return;
        setIsDeleting(true);
        try {
            await onDelete(initial.id);
            onClose();
        } finally {
            setIsDeleting(false);
            setConfirmDelete(false);
        }
    };

    const canDelete = !!onDelete && !!initial;
    const isBusy = isSaving || isDeleting;

    return (
        <Modal
            isOpen={isOpen}
            onClose={onClose}
            title={initial ? 'Modifier l\'objectif' : 'Ajouter un objectif'}
        >
            <div className="space-y-5">
                {/* Priorité */}
                <div>
                    <label className="block text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wide mb-2">Priorité</label>
                    <div className="grid grid-cols-2 gap-2">
                        {([['principale', 'Principal', 'text-rose-600 dark:text-rose-400', 'bg-rose-600', 'border-rose-500'], ['secondaire', 'Secondaire', 'text-amber-600 dark:text-amber-400', 'bg-amber-600', 'border-amber-500']] as const).map(([val, label, textColor, bgColor, borderColor]) => (
                            <button
                                key={val}
                                onClick={() => setPriority(val)}
                                className={`py-2.5 px-3 rounded-lg text-sm font-medium border transition-all ${
                                    priority === val
                                        ? `${bgColor} ${borderColor} text-white shadow-lg`
                                        : `bg-slate-100 dark:bg-slate-800 border-slate-300 dark:border-slate-700 ${textColor}`
                                }`}
                            >
                                {priority === val ? label : <span className={textColor}>{label}</span>}
                            </button>
                        ))}
                    </div>
                </div>

                {/* Nom */}
                <div>
                    <label className="flex items-center gap-2 text-sm font-medium text-slate-600 dark:text-slate-300 mb-1.5">
                        <Trophy size={13} className="text-slate-500 dark:text-slate-400" />
                        Nom de la course / événement
                    </label>
                    <input
                        value={name}
                        onChange={e => setName(e.target.value)}
                        placeholder="Ex: Ironman 70.3 Nice, Granfondo Alpes..."
                        className="w-full h-11 bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-700 text-slate-900 dark:text-white rounded-lg px-3 text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none"
                    />
                </div>

                {/* Date de l'événement */}
                <div>
                    <label className="flex items-center gap-2 text-sm font-medium text-slate-600 dark:text-slate-300 mb-1.5">
                        <Calendar size={13} className="text-slate-500 dark:text-slate-400" />
                        Date de l&apos;événement
                    </label>
                    <input
                        type="date"
                        style={{ colorScheme: 'dark' }}
                        value={date}
                        onChange={e => setDate(e.target.value)}
                        className="w-full h-11 bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-700 text-slate-900 dark:text-white rounded-lg px-3 focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none"
                    />
                </div>

                {/* Sport */}
                <div>
                    <label className="block text-sm font-medium text-slate-600 dark:text-slate-300 mb-1.5">Discipline</label>
                    <div className="grid grid-cols-2 gap-2">
                        {SPORT_OPTIONS.map(s => (
                            <button
                                key={s.value}
                                onClick={() => setSport(s.value)}
                                className={`py-2 px-3 rounded-lg text-xs font-medium border transition-all text-left ${
                                    sport === s.value
                                        ? 'bg-blue-600 border-blue-500 text-white'
                                        : 'bg-slate-100 dark:bg-slate-800 border-slate-300 dark:border-slate-700 text-slate-500 dark:text-slate-400 hover:border-slate-400 dark:hover:border-slate-600'
                                }`}
                            >
                                {s.label}
                            </button>
                        ))}
                    </div>
                </div>

                {/* Distance + Dénivelé */}
                <div className="grid grid-cols-2 gap-3">
                    <div>
                        <label className="flex items-center gap-1.5 text-sm font-medium text-slate-600 dark:text-slate-300 mb-1.5">
                            <MapPin size={13} className="text-slate-500 dark:text-slate-400" />
                            Distance (km)
                        </label>
                        <input
                            type="number"
                            min="0"
                            step="0.1"
                            value={distanceKm}
                            onChange={e => setDistanceKm(e.target.value)}
                            placeholder="Optionnel"
                            className="w-full h-11 bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-700 text-slate-900 dark:text-white rounded-lg px-3 text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none"
                        />
                    </div>
                    <div>
                        <label className="flex items-center gap-1.5 text-sm font-medium text-slate-600 dark:text-slate-300 mb-1.5">
                            <Mountain size={13} className="text-slate-500 dark:text-slate-400" />
                            Dénivelé (m)
                        </label>
                        <input
                            type="number"
                            min="0"
                            step="1"
                            value={elevationGainM}
                            onChange={e => setElevationGainM(e.target.value)}
                            placeholder="Optionnel"
                            className="w-full h-11 bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-700 text-slate-900 dark:text-white rounded-lg px-3 text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none"
                        />
                    </div>
                </div>

                {/* Commentaire */}
                <div>
                    <label className="flex items-center gap-2 text-sm font-medium text-slate-600 dark:text-slate-300 mb-1.5">
                        <FileText size={13} className="text-slate-500 dark:text-slate-400" />
                        Notes / commentaire <span className="text-slate-500 dark:text-slate-600 font-normal">(optionnel)</span>
                    </label>
                    <textarea
                        value={comment}
                        onChange={e => setComment(e.target.value)}
                        placeholder="Ex: Parcours vallonné, première participation..."
                        rows={2}
                        className="w-full bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-700 text-slate-900 dark:text-white rounded-lg px-3 py-2.5 text-sm resize-none focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none"
                    />
                </div>

                {/* Confirmation de suppression */}
                {canDelete && confirmDelete && (
                    <div className="flex items-start gap-2.5 p-3 rounded-lg bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/30">
                        <AlertTriangle size={15} className="text-red-600 dark:text-red-400 shrink-0 mt-0.5" />
                        <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium text-red-700 dark:text-red-300">Supprimer cet objectif ?</p>
                            <p className="text-xs text-red-600/80 dark:text-red-400/80 mt-0.5">
                                Cette action est définitive. Le plan déjà généré n&apos;est pas supprimé.
                            </p>
                            <div className="flex gap-2 mt-2.5">
                                <Button variant="danger" size="sm" onClick={handleDelete} isLoading={isDeleting} disabled={isBusy}>
                                    Supprimer
                                </Button>
                                <Button variant="ghost" size="sm" onClick={() => setConfirmDelete(false)} disabled={isBusy}>
                                    Annuler
                                </Button>
                            </div>
                        </div>
                    </div>
                )}

                {/* Footer */}
                <div className="flex gap-3 pt-2 border-t border-slate-200 dark:border-slate-800">
                    {canDelete && !confirmDelete && (
                        <Button
                            variant="danger"
                            size="icon"
                            className="h-11 w-11 shrink-0"
                            aria-label="Supprimer l'objectif"
                            title="Supprimer l'objectif"
                            onClick={() => setConfirmDelete(true)}
                            disabled={isBusy}
                        >
                            <Trash2 size={16} />
                        </Button>
                    )}
                    <Button variant="outline" className="flex-1 h-11" onClick={onClose} disabled={isBusy}>
                        Annuler
                    </Button>
                    <Button
                        variant="primary"
                        className="flex-1 h-11 font-semibold"
                        icon={Trophy}
                        onClick={handleSave}
                        disabled={!canSave || isBusy}
                    >
                        {isSaving ? (
                            <span className="flex items-center gap-2">
                                <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                                Enregistrement...
                            </span>
                        ) : (initial ? 'Modifier' : 'Ajouter')}
                    </Button>
                </div>
            </div>
        </Modal>
    );
}
