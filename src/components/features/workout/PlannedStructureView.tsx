'use client';

import React, { useEffect, useRef, useState } from 'react';
import {
    Zap, Heart, Gauge, Waves, Dumbbell, Activity, Target, Clock,
    ChevronDown, ChevronUp, LayoutList, AlignLeft,
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
// Intensité relative → palier
// =============================================================================
// Les zones de l'athlète ne sont pas disponibles ici : on situe chaque bloc par
// rapport au PLUS INTENSE de la séance. C'est suffisant pour que l'œil retrouve
// le corps de séance d'un coup, et ça reste juste quelle que soit la métrique.

type Tier = 'neutral' | 'calm' | 'steady' | 'hard' | 'max';

const TIER_RANK: Record<Tier, number> = { neutral: 0, calm: 1, steady: 2, hard: 3, max: 4 };
const TIER_LABEL: Record<Tier, string> = { neutral: 'Neutre', calm: 'Calme', steady: 'Soutenu', hard: 'Dur', max: 'Maximal' };

const ACCENT: Record<Tier, { bar: string; dot: string }> = {
    neutral: { bar: 'bg-slate-300 dark:bg-slate-700', dot: 'bg-slate-400 dark:bg-slate-500' },
    calm: { bar: 'bg-sky-300 dark:bg-sky-500/50', dot: 'bg-sky-400 dark:bg-sky-500' },
    steady: { bar: 'bg-emerald-500 dark:bg-emerald-400', dot: 'bg-emerald-500 dark:bg-emerald-400' },
    hard: { bar: 'bg-amber-500 dark:bg-amber-400', dot: 'bg-amber-500 dark:bg-amber-400' },
    max: { bar: 'bg-red-500 dark:bg-red-400', dot: 'bg-red-500 dark:bg-red-400' },
};

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

function accentTierFor(b: StructureBlock, peak: number | null): Tier {
    // Un échauffement ou un retour au calme reste « calme » quelle que soit sa cible.
    if (b.type === 'Warmup' || b.type === 'Cooldown' || b.type === 'Rest') return 'calm';

    const intensity = blockIntensity(b);
    if (intensity == null || peak == null || peak <= 0) return 'neutral';

    const ratio = intensity / peak;
    if (ratio < 0.8) return 'calm';
    if (ratio < 0.9) return 'steady';
    if (ratio < 0.97) return 'hard';
    return 'max';
}

/** Palier d'un groupe de blocs : celui du sous-bloc le plus intense. */
function groupTier(blocks: StructureBlock[], peak: number | null): Tier {
    let best: Tier = 'neutral';
    for (const b of blocks) {
        const t = accentTierFor(b, peak);
        if (TIER_RANK[t] > TIER_RANK[best]) best = t;
    }
    return best;
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
// Habillage des cartes par palier — le poids visuel suit l'effort réel.
// =============================================================================

const MUTED_CHROME = {
    container: 'bg-slate-50/70 dark:bg-slate-900/20 border-slate-200/60 dark:border-slate-800/60',
    metric: 'text-sm font-medium text-slate-700 dark:text-slate-200',
    label: 'text-slate-500 dark:text-slate-400',
};

const CARD_CHROME: Record<Tier, { container: string; metric: string; label: string }> = {
    neutral: MUTED_CHROME,
    calm: MUTED_CHROME,
    steady: {
        container: 'bg-white dark:bg-slate-900/40 border-slate-200/80 dark:border-slate-800',
        metric: 'text-sm font-semibold text-slate-900 dark:text-white',
        label: 'text-slate-600 dark:text-slate-300',
    },
    hard: {
        container: 'bg-amber-50/60 dark:bg-amber-500/10 border-amber-200/70 dark:border-amber-500/25',
        metric: 'text-base font-semibold text-amber-900 dark:text-amber-100',
        label: 'text-amber-700 dark:text-amber-300',
    },
    max: {
        container: 'bg-red-50/60 dark:bg-red-500/10 border-red-200/70 dark:border-red-500/25',
        metric: 'text-base font-bold text-red-900 dark:text-red-100',
        label: 'text-red-700 dark:text-red-300',
    },
};

const GROUP_CHROME: Record<Tier, { bg: string; border: string }> = {
    neutral: { bg: 'bg-slate-50/60 dark:bg-slate-900/20', border: 'border-slate-200/60 dark:border-slate-700/50' },
    calm: { bg: 'bg-sky-50/40 dark:bg-sky-500/5', border: 'border-sky-200/60 dark:border-sky-500/20' },
    steady: { bg: 'bg-emerald-50/40 dark:bg-emerald-500/5', border: 'border-emerald-200/60 dark:border-emerald-500/20' },
    hard: { bg: 'bg-amber-50/50 dark:bg-amber-500/5', border: 'border-amber-200/70 dark:border-amber-500/25' },
    max: { bg: 'bg-red-50/50 dark:bg-red-500/5', border: 'border-red-200/70 dark:border-red-500/25' },
};

/** Petites barres de niveau : redondance non colorimétrique de l'intensité. */
const IntensityBars: React.FC<{ tier: Tier }> = ({ tier }) => {
    const filled = TIER_RANK[tier];
    const heights = [4, 6, 8, 10];
    return (
        <span className="inline-flex items-end gap-[1.5px]" role="img" aria-label={`Intensité : ${TIER_LABEL[tier]}`}>
            {heights.map((h, i) => (
                <span
                    key={i}
                    className={`w-[2.5px] rounded-full ${i < filled ? ACCENT[tier].dot : 'bg-slate-200 dark:bg-slate-700'}`}
                    style={{ height: h }}
                />
            ))}
        </span>
    );
};

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

function itemWeight(item: DisplayItem): number {
    if (item.kind === 'single') return displayWeight(item.block);
    return item.blocks.reduce((sum, b) => sum + displayWeight(b), 0) * item.times;
}

function itemTier(item: DisplayItem, peak: number | null): Tier {
    return item.kind === 'single' ? accentTierFor(item.block, peak) : groupTier(item.blocks, peak);
}

// =============================================================================
// Pastilles de cible
// =============================================================================

type TargetPill = { icon?: React.ElementType; label: string; primary?: boolean };

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

/** La première cible trouvée dans l'ordre power → allure → FC → RPE porte l'effort du bloc : c'est elle qu'on met en avant. */
function buildTargetPills(src: TargetSource): TargetPill[] {
    const pills: TargetPill[] = [];
    let primaryAssigned = false;
    const claimPrimary = () => {
        if (primaryAssigned) return false;
        primaryAssigned = true;
        return true;
    };

    if (src.strokeType) pills.push({ label: STROKE_LABEL[src.strokeType] });
    if (src.equipment) for (const eq of src.equipment) pills.push({ label: eq });

    if (src.targetPowerWatts != null) pills.push({ icon: Zap, label: `${src.targetPowerWatts} W`, primary: claimPrimary() });
    if (src.targetPaceMinPerKm) pills.push({ icon: Gauge, label: `${src.targetPaceMinPerKm} /km`, primary: claimPrimary() });
    if (src.targetPaceMinPer100m) pills.push({ icon: Waves, label: `${src.targetPaceMinPer100m} /100m`, primary: claimPrimary() });
    if (src.targetHeartRateBPM != null) pills.push({ icon: Heart, label: `${src.targetHeartRateBPM} bpm`, primary: claimPrimary() });
    if (src.targetRPE != null) pills.push({ icon: Activity, label: `RPE ${src.targetRPE}`, primary: claimPrimary() });
    if (src.reps != null && src.sets != null) {
        const load = src.loadKg != null ? ` @ ${src.loadKg} kg` : '';
        pills.push({ icon: Dumbbell, label: `${src.sets}×${src.reps}${load}` });
    }

    return pills;
}

const PILL_LAYOUT = 'inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-xs tabular-nums border';
const PILL_COLOR_NEUTRAL = 'font-medium bg-slate-100 dark:bg-slate-800/80 text-slate-700 dark:text-slate-200 border-slate-200/70 dark:border-slate-700/60';

const TIER_PILL_COLOR: Record<Tier, string> = {
    neutral: PILL_COLOR_NEUTRAL,
    calm: 'font-semibold bg-sky-100 dark:bg-sky-500/15 text-sky-800 dark:text-sky-300 border-sky-200/70 dark:border-sky-500/25',
    steady: 'font-semibold bg-emerald-100 dark:bg-emerald-500/15 text-emerald-800 dark:text-emerald-300 border-emerald-200/70 dark:border-emerald-500/25',
    hard: 'font-semibold bg-amber-100 dark:bg-amber-500/15 text-amber-800 dark:text-amber-300 border-amber-200/70 dark:border-amber-500/25',
    max: 'font-semibold bg-red-100 dark:bg-red-500/15 text-red-800 dark:text-red-300 border-red-200/70 dark:border-red-500/25',
};

/** `mutedOnly` force le style neutre même sur une pastille marquée primaire (cas de la récup, toujours secondaire). */
const TargetPillsRow: React.FC<{ pills: TargetPill[]; tier?: Tier; mutedOnly?: boolean }> = ({ pills, tier = 'neutral', mutedOnly = false }) => {
    if (pills.length === 0) return null;
    return (
        <div className="flex flex-wrap items-center gap-1.5">
            {pills.map((p, i) => {
                const Icon = p.icon;
                const isPrimary = !!p.primary && !mutedOnly;
                return (
                    <span key={i} className={`${PILL_LAYOUT} ${isPrimary ? TIER_PILL_COLOR[tier] : PILL_COLOR_NEUTRAL}`}>
                        {Icon && <Icon size={11} className={isPrimary ? '' : 'text-slate-400 dark:text-slate-500 stroke-[2.25px]'} />}
                        {p.label}
                    </span>
                );
            })}
        </div>
    );
};

// =============================================================================
// Timeline proportionnelle — un segment par item affiché (motifs groupés
// compris), tapotable pour retrouver la carte correspondante dans la liste.
// =============================================================================

const Timeline: React.FC<{ items: DisplayItem[]; peak: number | null; onSelect: (index: number) => void }> = ({ items, peak, onSelect }) => {
    const weights = items.map(itemWeight);
    const total = weights.reduce((a, b) => a + b, 0);
    if (total <= 0) return null;

    return (
        <div className="flex items-stretch gap-px h-3 rounded-full overflow-hidden mb-2">
            {items.map((item, i) => {
                const tier = itemTier(item, peak);
                const pct = (weights[i] / total) * 100;
                const repeatCount = item.kind === 'group'
                    ? item.times
                    : (item.block.type === 'Repeat' ? item.block.repeat : 0);
                const isRepeat = repeatCount > 1;
                const durationLabel = formatDuration(weights[i]);
                const blockLabel = item.kind === 'group'
                    ? 'Série répétée'
                    : (item.block.type === 'Repeat' ? 'Série' : BLOCK_LABEL[item.block.type]);

                return (
                    <button
                        key={i}
                        type="button"
                        onClick={() => onSelect(i)}
                        className={`relative h-full ${ACCENT[tier].bar} focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-400 focus-visible:ring-offset-1`}
                        style={{ width: `${pct}%` }}
                        aria-label={`${blockLabel}${isRepeat ? ` ×${repeatCount}` : ''} — ${durationLabel}. Toucher pour voir le détail.`}
                    >
                        {isRepeat && (
                            <span
                                className="absolute inset-0 opacity-35 mix-blend-overlay"
                                style={{ backgroundImage: 'repeating-linear-gradient(135deg, rgba(255,255,255,0.9) 0 3px, transparent 3px 7px)' }}
                                aria-hidden
                            />
                        )}
                        {isRepeat && pct >= 6 && (
                            <span className="absolute inset-0 flex items-center justify-center text-[9px] font-bold text-white drop-shadow-sm" aria-hidden>
                                ×{repeatCount}
                            </span>
                        )}
                    </button>
                );
            })}
        </div>
    );
};

/** Légende de la timeline — l'intensité n'est plus signalée par la seule couleur. */
const Legend: React.FC<{ peak: number | null }> = ({ peak }) => {
    if (peak == null) return null;
    const tiers: Tier[] = ['calm', 'steady', 'hard', 'max'];
    return (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mb-3">
            {tiers.map(t => (
                <span key={t} className="inline-flex items-center gap-1 text-[10px] font-medium text-slate-500 dark:text-slate-400">
                    <span className={`w-1.5 h-1.5 rounded-full ${ACCENT[t].dot}`} />
                    {TIER_LABEL[t]}
                </span>
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
    const tier = accentTierFor(block, peak);
    const chrome = CARD_CHROME[tier];
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
        <div className={`relative overflow-hidden rounded-lg border ${chrome.container} ${compact ? 'py-2' : 'py-2.5'}`}>
            <div className={`absolute top-0 left-0 bottom-0 w-[3px] ${ACCENT[tier].bar}`} aria-hidden />
            <div className="pl-4 pr-3">
                <div className="flex items-baseline justify-between gap-3 mb-1">
                    <div className="flex items-center gap-2 min-w-0">
                        <IntensityBars tier={tier} />
                        <span className={`text-[10px] font-bold uppercase tracking-[0.08em] ${chrome.label}`}>
                            {label}
                        </span>
                        {repeatBlock && (
                            <span className="inline-flex items-center px-1.5 py-px rounded text-[10px] font-bold tabular-nums bg-amber-100 dark:bg-amber-500/15 text-amber-800 dark:text-amber-300 border border-amber-200/70 dark:border-amber-500/25">
                                ×{repeatBlock.repeat}
                            </span>
                        )}
                    </div>
                    <span className={`shrink-0 tabular-nums ${chrome.metric}`}>
                        {metric}
                    </span>
                </div>

                {block.description && (
                    <p className="text-sm text-slate-600 dark:text-slate-300 leading-snug mb-1.5">
                        {block.description}
                    </p>
                )}

                <TargetPillsRow pills={pills} tier={tier} />

                {hasRecup && repeatBlock && (
                    <div className="flex items-center gap-2 mt-1.5 pl-2.5 border-l-2 border-dashed border-slate-300/70 dark:border-slate-700/60">
                        <span className="shrink-0 text-[9px] font-bold uppercase tracking-[0.08em] text-slate-400 dark:text-slate-500">
                            Récup
                        </span>
                        <span className="shrink-0 text-xs font-medium text-slate-500 dark:text-slate-400 tabular-nums">
                            {formatDuration(repeatBlock.durationRecupSecondes)}
                        </span>
                        <div className="min-w-0">
                            <TargetPillsRow pills={recupPills} mutedOnly />
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
};

/**
 * Motif répété reconstitué à la lecture : « 2× » enveloppant ses blocs, teinté
 * selon sa propre intensité (l'ambre reste réservé au badge « ×N », pas au
 * fond — un motif calme répété doit rester visuellement calme).
 *
 * Un motif à plus de 3 blocs se replie par défaut derrière un résumé : sinon
 * une série « Force / Vélocité / Récup » ×3 imposerait neuf cartes à l'œil
 * pour une information que trois lignes suffisent à donner.
 */
const GroupCard: React.FC<{
    blocks: StructureBlock[];
    times: number;
    peak: number | null;
}> = ({ blocks, times, peak }) => {
    const tier = groupTier(blocks, peak);
    const chrome = GROUP_CHROME[tier];
    const cycleSeconds = blocks.reduce((sum, b) => sum + blockTotalSeconds(b), 0);
    const dense = blocks.length > 3;
    const [isOpen, setIsOpen] = useState(!dense);

    const mainBlock = blocks.find(b => b.type === 'Active' || b.type === 'Repeat') ?? blocks[0];
    const summaryPills = buildTargetPills(mainBlock).filter(p => p.primary);
    const labelSummary = blocks.map(b => b.type === 'Repeat' ? 'Série' : BLOCK_LABEL[b.type]).join(' + ');

    return (
        <div className={`rounded-lg border ${chrome.border} ${chrome.bg} p-2`}>
            <button
                type="button"
                onClick={() => dense && setIsOpen(v => !v)}
                className={`flex items-center justify-between gap-3 w-full px-1 mb-1.5 text-left ${dense ? '' : 'cursor-default'}`}
                aria-expanded={isOpen}
            >
                <span className="flex items-center gap-2 min-w-0">
                    <span className="shrink-0 inline-flex items-center px-1.5 py-px rounded text-[10px] font-bold tabular-nums bg-amber-100 dark:bg-amber-500/15 text-amber-800 dark:text-amber-300 border border-amber-200/70 dark:border-amber-500/25">
                        ×{times}
                    </span>
                    {dense && !isOpen && (
                        <span className="text-xs text-slate-600 dark:text-slate-300 truncate">{labelSummary}</span>
                    )}
                </span>
                <span className="shrink-0 flex items-center gap-1.5 text-[11px] font-medium text-slate-500 dark:text-slate-400 tabular-nums">
                    {formatDuration(cycleSeconds)} / cycle
                    {dense && (isOpen ? <ChevronUp size={12} /> : <ChevronDown size={12} />)}
                </span>
            </button>

            {isOpen ? (
                <div className="space-y-1">
                    {blocks.map((b, i) => <BlockRow key={i} block={b} peak={peak} compact />)}
                </div>
            ) : (
                summaryPills.length > 0 && (
                    <div className="px-1"><TargetPillsRow pills={summaryPills} tier={tier} /></div>
                )
            )}
        </div>
    );
};

/** Bascule visuel / texte — un seul et même contenu, deux lectures. */
const ViewToggle: React.FC<{ mode: 'visual' | 'text'; onChange: (mode: 'visual' | 'text') => void }> = ({ mode, onChange }) => {
    const OPTIONS: { key: 'visual' | 'text'; label: string; icon: React.ElementType }[] = [
        { key: 'visual', label: 'Visuel', icon: LayoutList },
        { key: 'text', label: 'Texte', icon: AlignLeft },
    ];
    return (
        <div className="inline-flex items-center gap-0.5 p-0.5 rounded-lg bg-slate-100 dark:bg-slate-800/60 border border-slate-200/70 dark:border-slate-700/60">
            {OPTIONS.map(({ key, label, icon: Icon }) => (
                <button
                    key={key}
                    type="button"
                    onClick={() => onChange(key)}
                    aria-pressed={mode === key}
                    className={`inline-flex items-center gap-1 px-2 py-1 rounded-md text-xs font-medium transition-colors ${
                        mode === key
                            ? 'bg-white dark:bg-slate-700 text-slate-900 dark:text-white shadow-sm'
                            : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200'
                    }`}
                >
                    <Icon size={12} />
                    {label}
                </button>
            ))}
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
    const [viewMode, setViewMode] = useState<'visual' | 'text'>('visual');
    const [highlightedIndex, setHighlightedIndex] = useState<number | null>(null);
    const itemRefs = useRef<Array<HTMLDivElement | null>>([]);
    const highlightTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);

    useEffect(() => () => {
        if (highlightTimeout.current) clearTimeout(highlightTimeout.current);
    }, []);

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

    const handleSelect = (index: number) => {
        itemRefs.current[index]?.scrollIntoView({ behavior: 'smooth', block: 'center' });
        setHighlightedIndex(index);
        if (highlightTimeout.current) clearTimeout(highlightTimeout.current);
        highlightTimeout.current = setTimeout(() => setHighlightedIndex(null), 1600);
    };

    return (
        <div className="mb-5 p-4 rounded-2xl bg-white dark:bg-slate-800/40 border border-slate-200/80 dark:border-slate-700/50">
            <div className="flex items-center justify-between mb-3 gap-3 flex-wrap">
                <h3 className="text-sm font-bold text-slate-900 dark:text-white flex items-center gap-2">
                    <Target size={15} className="text-slate-400" />
                    Programme
                </h3>
                <div className="flex items-center gap-3 flex-wrap">
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
                    {showStructure && trimmedDescription && (
                        <ViewToggle mode={viewMode} onChange={setViewMode} />
                    )}
                </div>
            </div>

            {showStructure && viewMode === 'visual' ? (
                <>
                    <Timeline items={items} peak={peak} onSelect={handleSelect} />
                    <Legend peak={peak} />
                    <div className="space-y-1.5">
                        {items.map((item, i) => (
                            <div
                                key={i}
                                ref={(el) => { itemRefs.current[i] = el; }}
                                className={`rounded-lg transition-shadow duration-300 ${
                                    highlightedIndex === i
                                        ? 'ring-2 ring-sky-400 dark:ring-sky-500 ring-offset-2 ring-offset-white dark:ring-offset-slate-800/40'
                                        : ''
                                }`}
                            >
                                {item.kind === 'group'
                                    ? <GroupCard blocks={item.blocks} times={item.times} peak={peak} />
                                    : <BlockRow block={item.block} peak={peak} />}
                            </div>
                        ))}
                    </div>
                </>
            ) : (
                <div className="text-sm text-slate-600 dark:text-slate-300 whitespace-pre-line leading-relaxed">
                    {trimmedDescription}
                </div>
            )}
        </div>
    );
};
