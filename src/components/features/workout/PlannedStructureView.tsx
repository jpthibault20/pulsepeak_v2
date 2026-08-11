'use client';

import React, { useState } from 'react';
import {
    Zap, Heart, Gauge, Waves, Dumbbell, Activity, Target, Clock,
    ChevronDown, ChevronUp,
} from 'lucide-react';
import type {
    StructureBlock,
    StructureSimpleBlock,
    StructureRepeatBlock,
    SwimStrokeType,
} from '@/lib/data/type';
import { blockTotalSeconds, isStructureTrustworthy, structureTotalMeters, structureTotalSeconds } from '@/lib/structure/normalize';
import { groupRepeatedBlocks, type DisplayItem } from '@/lib/structure/group';

// =============================================================================
// Intensité relative → couleur
// =============================================================================
// Les zones de l'athlète ne sont pas disponibles ici : on situe chaque bloc par
// rapport au PLUS INTENSE de la séance. C'est suffisant pour que l'œil retrouve
// le corps de séance d'un coup, et ça reste juste quelle que soit la métrique.

function paceToSeconds(pace: string | null): number | null {
    if (!pace) return null;
    const m = pace.match(/^(\d+):([0-5]\d)$/);
    return m ? parseInt(m[1], 10) * 60 + parseInt(m[2], 10) : null;
}

function blockIntensity(b: StructureBlock): number | null {
    if (b.targetPowerWatts != null) return b.targetPowerWatts;
    const pace = paceToSeconds(b.targetPaceMinPerKm) ?? paceToSeconds(b.targetPaceMinPer100m);
    if (pace != null && pace > 0) return 1000 / pace;   // vitesse : croît avec l'effort
    if (b.targetHeartRateBPM != null) return b.targetHeartRateBPM;
    if (b.targetRPE != null) return b.targetRPE;
    return null;
}

type Accent = { bar: string; dot: string };

const ACCENT_CALM: Accent = { bar: 'bg-sky-300 dark:bg-sky-500/50', dot: 'bg-sky-400' };
const ACCENT_STEADY: Accent = { bar: 'bg-emerald-500', dot: 'bg-emerald-500' };
const ACCENT_HARD: Accent = { bar: 'bg-amber-500', dot: 'bg-amber-500' };
const ACCENT_MAX: Accent = { bar: 'bg-red-500', dot: 'bg-red-500' };
const ACCENT_NEUTRAL: Accent = { bar: 'bg-slate-300 dark:bg-slate-700', dot: 'bg-slate-400' };

function accentFor(b: StructureBlock, peak: number | null): Accent {
    // Un échauffement ou un retour au calme reste « calme » quelle que soit sa cible.
    if (b.type === 'Warmup' || b.type === 'Cooldown' || b.type === 'Rest') return ACCENT_CALM;

    const intensity = blockIntensity(b);
    if (intensity == null || peak == null || peak <= 0) return ACCENT_NEUTRAL;

    const ratio = intensity / peak;
    if (ratio < 0.7) return ACCENT_CALM;
    if (ratio < 0.85) return ACCENT_STEADY;
    if (ratio < 0.95) return ACCENT_HARD;
    return ACCENT_MAX;
}

function peakIntensity(structure: StructureBlock[]): number | null {
    let peak: number | null = null;
    for (const b of structure) {
        const v = blockIntensity(b);
        if (v != null && (peak == null || v > peak)) peak = v;
    }
    return peak;
}

// =============================================================================
// Formatage
// =============================================================================

function formatDuration(seconds: number | null | undefined): string {
    if (!seconds || seconds <= 0) return '—';
    if (seconds < 60) return `${seconds}s`;
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return s === 0 ? `${m} min` : `${m}:${String(s).padStart(2, '0')}`;
}

function formatTotalMinutes(totalSeconds: number): string {
    if (totalSeconds <= 0) return '0 min';
    const m = Math.round(totalSeconds / 60);
    const h = Math.floor(m / 60);
    const rm = m % 60;
    if (h === 0) return `${m} min`;
    return rm === 0 ? `${h} h` : `${h} h ${String(rm).padStart(2, '0')}`;
}

const STROKE_LABEL: Record<SwimStrokeType, string> = {
    crawl: 'Crawl',
    dos: 'Dos',
    brasse: 'Brasse',
    papillon: 'Papillon',
    '4_nages': '4 nages',
    mixte: 'Mixte',
};

const BLOCK_LABEL: Record<StructureSimpleBlock['type'], string> = {
    Warmup: 'Échauffement',
    Active: 'Effort',
    Rest: 'Récupération',
    Cooldown: 'Retour au calme',
};

/** Grandeur mise en avant : la distance prime dès qu'elle existe (natation). */
function primaryMetric(opts: {
    durationActifSecondes?: number | null;
    distanceMeters?: number | null;
    repeat?: number | null;
}): string {
    const { durationActifSecondes, distanceMeters, repeat } = opts;
    if (distanceMeters != null && distanceMeters > 0) {
        return repeat && repeat > 1 ? `${repeat}×${distanceMeters} m` : `${distanceMeters} m`;
    }
    return formatDuration(durationActifSecondes);
}

/** Poids d'un bloc dans la timeline : son temps, ou sa distance à défaut. */
function displayWeight(b: StructureBlock): number {
    const seconds = blockTotalSeconds(b);
    if (seconds > 0) return seconds;
    const meters = (b.distanceMeters ?? 0) * (b.type === 'Repeat' ? Math.max(1, b.repeat) : 1);
    return meters > 0 ? meters : 1;
}

// =============================================================================
// Pastilles de cible
// =============================================================================

type TargetPill = { icon?: React.ElementType; label: string };

type TargetSource = {
    targetPowerWatts?: number | null;
    targetPaceMinPerKm?: string | null;
    targetPaceMinPer100m?: string | null;
    targetHeartRateBPM?: number | null;
    targetRPE?: number | null;
    reps?: number | null;
    sets?: number | null;
    loadKg?: number | null;
    strokeType?: SwimStrokeType | null;
    equipment?: string[] | null;
};

function buildTargetPills(src: TargetSource): TargetPill[] {
    const pills: TargetPill[] = [];

    if (src.strokeType) pills.push({ label: STROKE_LABEL[src.strokeType] });
    if (src.equipment) for (const eq of src.equipment) pills.push({ label: eq });

    if (src.targetPowerWatts != null) pills.push({ icon: Zap, label: `${src.targetPowerWatts} W` });
    if (src.targetPaceMinPerKm) pills.push({ icon: Gauge, label: `${src.targetPaceMinPerKm} /km` });
    if (src.targetPaceMinPer100m) pills.push({ icon: Waves, label: `${src.targetPaceMinPer100m} /100m` });
    if (src.targetHeartRateBPM != null) pills.push({ icon: Heart, label: `${src.targetHeartRateBPM} bpm` });
    if (src.targetRPE != null) pills.push({ icon: Activity, label: `RPE ${src.targetRPE}` });
    if (src.reps != null && src.sets != null) {
        const load = src.loadKg != null ? ` @ ${src.loadKg} kg` : '';
        pills.push({ icon: Dumbbell, label: `${src.sets}×${src.reps}${load}` });
    }

    return pills;
}

const PILL_BASE = `
    inline-flex items-center gap-1
    px-2 py-0.5 rounded-md
    text-xs font-medium tabular-nums
    bg-slate-100 dark:bg-slate-800/80
    text-slate-700 dark:text-slate-200
    border border-slate-200/70 dark:border-slate-700/60
`;

const TargetPillsRow: React.FC<{ pills: TargetPill[] }> = ({ pills }) => {
    if (pills.length === 0) return null;
    return (
        <div className="flex flex-wrap items-center gap-1.5">
            {pills.map((p, i) => {
                const Icon = p.icon;
                return (
                    <span key={i} className={PILL_BASE}>
                        {Icon && <Icon size={11} className="text-slate-400 dark:text-slate-500 stroke-[2.25px]" />}
                        {p.label}
                    </span>
                );
            })}
        </div>
    );
};

// =============================================================================
// Timeline proportionnelle
// =============================================================================

const Timeline: React.FC<{ structure: StructureBlock[]; peak: number | null }> = ({ structure, peak }) => {
    const weights = structure.map(displayWeight);
    const total = weights.reduce((a, b) => a + b, 0);
    if (total <= 0) return null;

    return (
        <div className="flex items-stretch gap-px h-2.5 rounded-full overflow-hidden mb-3" aria-hidden>
            {structure.map((b, i) => (
                <div
                    key={i}
                    className={accentFor(b, peak).bar}
                    style={{ width: `${(weights[i] / total) * 100}%` }}
                    title={`${BLOCK_LABEL[b.type === 'Repeat' ? 'Active' : b.type]} — ${formatDuration(blockTotalSeconds(b))}`}
                />
            ))}
        </div>
    );
};

// =============================================================================
// Rendu d'un bloc
// =============================================================================

const BlockRow: React.FC<{
    block: StructureBlock;
    peak: number | null;
    compact?: boolean;
}> = ({ block, peak, compact = false }) => {
    const accent = accentFor(block, peak);
    const label = block.type === 'Repeat' ? 'Série' : BLOCK_LABEL[block.type];

    const pills = buildTargetPills(block);
    const metric = primaryMetric({
        durationActifSecondes: block.durationActifSecondes,
        distanceMeters: block.distanceMeters,
        repeat: block.type === 'Repeat' ? block.repeat : null,
    });

    const repeatBlock = block.type === 'Repeat' ? (block as StructureRepeatBlock) : null;
    const recupPills = repeatBlock
        ? buildTargetPills({
            targetPowerWatts: repeatBlock.targetRecupPowerWatts,
            targetPaceMinPerKm: repeatBlock.targetRecupPaceMinPerKm,
            targetPaceMinPer100m: repeatBlock.targetRecupPaceMinPer100m,
            targetHeartRateBPM: repeatBlock.targetRecupHeartRateBPM,
            targetRPE: repeatBlock.targetRecupRPE,
        })
        : [];
    const hasRecup = !!repeatBlock && ((repeatBlock.durationRecupSecondes ?? 0) > 0 || recupPills.length > 0);

    return (
        <div className={`relative overflow-hidden rounded-lg border border-slate-200/80 dark:border-slate-800 bg-white dark:bg-slate-900/40 ${compact ? 'py-2' : 'py-2.5'}`}>
            <div className={`absolute top-0 left-0 bottom-0 w-[3px] ${accent.bar}`} aria-hidden />
            <div className="pl-4 pr-3">
                <div className="flex items-baseline justify-between gap-3 mb-1">
                    <div className="flex items-baseline gap-2 min-w-0">
                        <span className="text-[10px] font-bold uppercase tracking-[0.08em] text-slate-500 dark:text-slate-400">
                            {label}
                        </span>
                        {repeatBlock && (
                            <span className="inline-flex items-center px-1.5 py-px rounded text-[10px] font-bold tabular-nums bg-amber-100 dark:bg-amber-500/15 text-amber-800 dark:text-amber-300 border border-amber-200/70 dark:border-amber-500/25">
                                ×{repeatBlock.repeat}
                            </span>
                        )}
                    </div>
                    <span className="shrink-0 text-sm font-semibold text-slate-900 dark:text-white tabular-nums">
                        {metric}
                    </span>
                </div>

                {block.description && (
                    <p className="text-sm text-slate-600 dark:text-slate-300 leading-snug mb-1.5">
                        {block.description}
                    </p>
                )}

                <TargetPillsRow pills={pills} />

                {hasRecup && repeatBlock && (
                    <div className="flex items-center gap-2 mt-1.5 pt-1.5 border-t border-slate-200/60 dark:border-slate-800/60">
                        <span className="shrink-0 flex items-center gap-1.5">
                            <span className="w-1.5 h-1.5 rounded-full bg-slate-400" />
                            <span className="text-[10px] font-bold uppercase tracking-[0.08em] text-slate-500 dark:text-slate-400">
                                Récup
                            </span>
                        </span>
                        <span className="shrink-0 text-xs font-semibold text-slate-900 dark:text-white tabular-nums">
                            {formatDuration(repeatBlock.durationRecupSecondes)}
                        </span>
                        <div className="min-w-0">
                            <TargetPillsRow pills={recupPills} />
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
};

/** Motif répété reconstitué à la lecture : « 2× » enveloppant ses blocs. */
const GroupCard: React.FC<{
    blocks: StructureBlock[];
    times: number;
    peak: number | null;
}> = ({ blocks, times, peak }) => {
    const cycleSeconds = blocks.reduce((sum, b) => sum + blockTotalSeconds(b), 0);

    return (
        <div className="rounded-lg border border-amber-200/70 dark:border-amber-500/25 bg-amber-50/40 dark:bg-amber-500/5 p-2">
            <div className="flex items-baseline justify-between gap-3 px-1 mb-1.5">
                <span className="inline-flex items-center px-1.5 py-px rounded text-[10px] font-bold tabular-nums bg-amber-100 dark:bg-amber-500/15 text-amber-800 dark:text-amber-300 border border-amber-200/70 dark:border-amber-500/25">
                    ×{times}
                </span>
                <span className="text-[11px] font-medium text-slate-500 dark:text-slate-400 tabular-nums">
                    {formatDuration(cycleSeconds)} par répétition
                </span>
            </div>
            <div className="space-y-1">
                {blocks.map((b, i) => <BlockRow key={i} block={b} peak={peak} compact />)}
            </div>
        </div>
    );
};

// =============================================================================
// Composant principal
// =============================================================================

export const PlannedStructureView: React.FC<{
    description?: string | null;
    structure?: StructureBlock[] | null;
    durationMinutes?: number | null;
}> = ({ description, structure, durationMinutes }) => {
    const [isTextOpen, setIsTextOpen] = useState(false);

    const trimmedDescription = description?.trim() || null;
    // Les séances générées avant l'inversion du pipeline peuvent porter des
    // durées calculées et non prescrites : on préfère alors le texte seul.
    const showStructure = isStructureTrustworthy(structure, durationMinutes);
    const blocks = showStructure ? structure! : [];

    if (!showStructure && !trimmedDescription) return null;

    const items: DisplayItem[] = showStructure ? groupRepeatedBlocks(blocks) : [];
    const peak = peakIntensity(blocks);
    const totalSeconds = structureTotalSeconds(blocks);
    const totalMeters = structureTotalMeters(blocks);

    return (
        <div className="mb-5 p-4 rounded-2xl bg-white dark:bg-slate-800/40 border border-slate-200/80 dark:border-slate-700/50">
            <div className="flex items-center justify-between mb-3 gap-3 flex-wrap">
                <h3 className="text-sm font-bold text-slate-900 dark:text-white flex items-center gap-2">
                    <Target size={15} className="text-slate-400" />
                    Programme
                </h3>
                {(totalMeters > 0 || totalSeconds > 0) && (
                    <div className="flex items-center gap-2 text-xs font-semibold text-slate-500 dark:text-slate-400 tabular-nums">
                        {totalMeters > 0 && (
                            <span className="inline-flex items-center gap-1">
                                <Waves size={12} />
                                {totalMeters} m
                            </span>
                        )}
                        {totalMeters > 0 && totalSeconds > 0 && (
                            <span className="text-slate-300 dark:text-slate-600">·</span>
                        )}
                        {totalSeconds > 0 && (
                            <span className="inline-flex items-center gap-1">
                                <Clock size={12} />
                                {formatTotalMinutes(totalSeconds)}
                            </span>
                        )}
                    </div>
                )}
            </div>

            {showStructure ? (
                <>
                    <Timeline structure={blocks} peak={peak} />
                    <div className="space-y-1.5">
                        {items.map((item, i) =>
                            item.kind === 'group'
                                ? <GroupCard key={i} blocks={item.blocks} times={item.times} peak={peak} />
                                : <BlockRow key={i} block={item.block} peak={peak} />
                        )}
                    </div>

                    {/* Le texte dit la même chose que la structure — il ne sert plus que
                        de repli lisible, et de garde-fou pour les séances anciennes dont
                        la prose portait des détails que la structure ne savait pas capter. */}
                    {trimmedDescription && (
                        <div className="mt-3 pt-3 border-t border-slate-200/70 dark:border-slate-700/40">
                            <button
                                type="button"
                                onClick={() => setIsTextOpen(v => !v)}
                                className="flex items-center justify-between gap-2 w-full text-left hover:opacity-80 transition-opacity"
                                aria-expanded={isTextOpen}
                            >
                                <span className="text-xs font-semibold text-slate-500 dark:text-slate-400">
                                    Consignes en texte
                                </span>
                                {isTextOpen
                                    ? <ChevronUp size={14} className="text-slate-400 dark:text-slate-500 shrink-0" />
                                    : <ChevronDown size={14} className="text-slate-400 dark:text-slate-500 shrink-0" />
                                }
                            </button>
                            {isTextOpen && (
                                <p className="mt-2 text-sm text-slate-600 dark:text-slate-300 whitespace-pre-line leading-relaxed">
                                    {trimmedDescription}
                                </p>
                            )}
                        </div>
                    )}
                </>
            ) : (
                <div className="text-sm text-slate-600 dark:text-slate-300 whitespace-pre-line leading-relaxed">
                    {trimmedDescription}
                </div>
            )}
        </div>
    );
};
