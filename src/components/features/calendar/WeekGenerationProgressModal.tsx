'use client';

import React from 'react';
import { Zap } from 'lucide-react';
import { ProgressModal, type ProgressState, type ProgressModalConfig } from './ProgressModal';

// ─── Types (rétrocompatibles) ────────────────────────────────────────────────

export interface WeekGenProgressState extends ProgressState {
    weekLabel: string;
}

interface WeekGenerationProgressModalProps {
    state:      WeekGenProgressState;
    onMinimize: () => void;
    onRestore:  () => void;
    onClose:    () => void;
}

// ─── Component ────────────────────────────────────────────────────────────────

export function WeekGenerationProgressModal({
    state,
    onMinimize,
    onRestore,
    onClose,
}: WeekGenerationProgressModalProps) {
    // Poids calibrés sur mesures prod (2026-07) — total attendu ~25s.
    // Voir logs [week-gen] dans week-actions.ts / workout-generator.ts.
    // Si le total réel dévie, la barre continue de ramper (asymptote) au lieu
    // de bloquer — pas besoin de recalibrer au ms près.
    const config: ProgressModalConfig = {
        icon:             <Zap size={18} className="text-blue-600 dark:text-blue-400" />,
        label:            state.weekLabel,
        titleLoading:     'Génération en cours…',
        titleDone:        'Semaine générée !',
        titleError:       'Erreur de génération',
        subtitleLoading:  'Veuillez patienter ~25 secondes',
        subtitleDone:     'Vos séances sont prêtes',
        miniLabelLoading: 'Génération…',
        miniLabelDone:    'Semaine prête !',
        durationMs:       25_000, // fallback si expectedMs absents (mode legacy)
        stages: [
            { label: 'Analyse de votre profil',        progressAt:  6, expectedMs:  1400 },
            { label: 'Préparation du plan',            progressAt:  8, expectedMs:   600 },
            { label: 'Composition des séances',        progressAt: 25, expectedMs:  4400 },
            { label: 'Détail de chaque séance',        progressAt: 92, expectedMs: 17800 },
            { label: 'Sauvegarde',                     progressAt: 95, expectedMs:   400 },
        ],
    };

    return (
        <ProgressModal
            state={state}
            config={config}
            onMinimize={onMinimize}
            onRestore={onRestore}
            onClose={onClose}
        />
    );
}
