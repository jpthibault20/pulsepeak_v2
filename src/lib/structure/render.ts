/**
 * Rendu de la description texte À PARTIR de la structure.
 *
 * Le sens de la conversion est l'inverse de l'ancien pipeline, et c'est tout
 * l'enjeu : le texte n'est plus une source d'information indépendante que l'IA
 * devait ensuite re-parser, c'est une projection de la structure. Les deux ne
 * peuvent donc plus diverger, et la somme des durées affichées est exacte par
 * construction.
 */

import type { StructureBlock, StructureRepeatBlock, StructureSimpleBlock, SwimStrokeType } from '@/lib/data/type';
import { structureTotalMeters } from './normalize';

const STROKE_LABEL: Record<SwimStrokeType, string> = {
    crawl: 'crawl',
    dos: 'dos',
    brasse: 'brasse',
    papillon: 'papillon',
    '4_nages': '4 nages',
    mixte: 'mixte',
};

const HEAD_WORD: Record<StructureSimpleBlock['type'], string> = {
    Warmup: 'Échauffement',
    Active: '',
    Rest: 'Récupération',
    Cooldown: 'Retour au calme',
};

/** « 20 min », « 1 min 30 », « 45 s ». */
export function formatSeconds(seconds: number | null | undefined): string {
    if (seconds == null || seconds <= 0) return '';
    if (seconds < 60) return `${seconds} s`;
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return s === 0 ? `${m} min` : `${m} min ${String(s).padStart(2, '0')}`;
}

type TargetSource = {
    targetPowerWatts?: number | null;
    targetPaceMinPerKm?: string | null;
    targetPaceMinPer100m?: string | null;
    targetHeartRateBPM?: number | null;
    targetRPE?: number | null;
};

/** Cible principale d'un bloc, dans l'ordre de priorité des métriques par sport. */
export function formatTarget(src: TargetSource): string {
    if (src.targetPowerWatts != null) return `${src.targetPowerWatts} W`;
    if (src.targetPaceMinPerKm) return `${src.targetPaceMinPerKm}/km`;
    if (src.targetPaceMinPer100m) return `${src.targetPaceMinPer100m}/100m`;
    if (src.targetHeartRateBPM != null) return `${src.targetHeartRateBPM} bpm`;
    if (src.targetRPE != null) return `RPE ${src.targetRPE}`;
    return '';
}

/**
 * Le libellé est omis quand il ne fait que répéter le mot de tête du bloc
 * (« Échauffement » + libellé « Échauffement progressif » → une seule mention).
 * La comparaison reste accent-sensible : mot de tête et libellé viennent tous
 * deux du français écrit de l'app, une normalisation Unicode serait du zèle.
 */
function labelPart(label: string, head: string): string {
    const trimmed = label.trim();
    if (!trimmed) return '';
    if (head && trimmed.toLowerCase().startsWith(head.toLowerCase())) return '';
    return ` — ${trimmed}`;
}

function equipmentPart(equipment: string[] | null): string {
    return equipment && equipment.length > 0 ? ` avec ${equipment.join(', ')}` : '';
}

function renderSimple(b: StructureSimpleBlock): string {
    const head = HEAD_WORD[b.type];
    const parts: string[] = [];
    if (head) parts.push(head);

    // Renforcement : la prescription est en séries, pas en temps.
    if (b.reps != null && b.sets != null) {
        const load = b.loadKg != null ? ` à ${b.loadKg} kg` : '';
        parts.push(`${b.sets}×${b.reps}${load}`);
    } else if (b.distanceMeters != null) {
        parts.push(`${b.distanceMeters} m`);
        if (b.strokeType) parts.push(STROKE_LABEL[b.strokeType]);
    } else {
        const duration = formatSeconds(b.durationActifSecondes);
        if (duration) parts.push(duration);
    }

    const target = formatTarget(b);
    if (target) parts.push(`à ${target}`);

    return (parts.join(' ') + equipmentPart(b.equipment) + labelPart(b.description, head)).trim();
}

function renderRepeat(b: StructureRepeatBlock): string {
    const reps = Math.max(1, b.repeat);
    const activeTarget = formatTarget(b);
    const recupTarget = formatTarget({
        targetPowerWatts: b.targetRecupPowerWatts,
        targetPaceMinPerKm: b.targetRecupPaceMinPerKm,
        targetPaceMinPer100m: b.targetRecupPaceMinPer100m,
        targetHeartRateBPM: b.targetRecupHeartRateBPM,
        targetRPE: b.targetRecupRPE,
    });

    // Natation : on compte en mètres et la récup est une pause au bord.
    if (b.distanceMeters != null) {
        const stroke = b.strokeType ? ` ${STROKE_LABEL[b.strokeType]}` : '';
        const target = activeTarget ? ` à ${activeTarget}` : '';
        const rest = b.durationRecupSecondes != null ? `, ${b.durationRecupSecondes}'' R` : '';
        const head = `${reps}×${b.distanceMeters} m${stroke}${target}${equipmentPart(b.equipment)}${rest}`;
        return head + labelPart(b.description, '');
    }

    const active = [formatSeconds(b.durationActifSecondes), activeTarget ? `à ${activeTarget}` : '']
        .filter(Boolean).join(' ');
    const recupDuration = formatSeconds(b.durationRecupSecondes);
    const recup = recupDuration
        ? [`${recupDuration} récup`, recupTarget ? `à ${recupTarget}` : ''].filter(Boolean).join(' ')
        : '';

    const body = recup ? `${active} / ${recup}` : active;
    return `${reps}× (${body})` + labelPart(b.description, '');
}

/**
 * Description française factuelle d'une structure, dans le style télégraphique
 * attendu par le reste de l'app (résumé de semaine, contexte du chat, analyse
 * de déviation consomment tous `plannedData.description`).
 */
export function renderStructureToText(structure: StructureBlock[]): string {
    if (!Array.isArray(structure) || structure.length === 0) return '';

    const sentences = structure
        .map(b => (b.type === 'Repeat' ? renderRepeat(b) : renderSimple(b as StructureSimpleBlock)))
        .map(s => s.trim())
        .filter(Boolean);

    if (sentences.length === 0) return '';

    const meters = structureTotalMeters(structure);
    if (meters > 0) sentences.push(`Total ${meters} m`);

    return sentences.join('. ') + '.';
}
