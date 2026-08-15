'use client';

import React, { useState, useMemo, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import {
    Activity, Clock, MapPin, TrendingUp, TrendingDown,
    Bike, Footprints, Waves, Target, CalendarDays, Minus,
    ChevronRight, AlertTriangle, Info,
} from 'lucide-react';
import {
    ComposedChart, Area, Line, Bar, XAxis, YAxis,
    CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine,
    BarChart,
} from 'recharts';
import type { Workout, Objective } from '@/lib/data/DatabaseTypes';
import { Card } from '@/components/ui/Card';
import { Profile, Schedule } from '@/lib/data/DatabaseTypes';
import {
    computePMC, computeWeeklyTSS, getTSBStatus, aggregateZones, getWorkoutTSS
} from '@/lib/stats/computePMC';
import { useTheme } from '@/components/ThemeProvider';
import { FeatureGate } from '@/components/features/billing/FeatureGate';

// ─── TYPES ───────────────────────────────────────────────────────────────────

interface StatsViewProps {
    scheduleData: Schedule;
    profile: Profile;
    objectives?: Objective[];
}

type PeriodId = '7d' | '30d' | '90d' | 'season' | 'custom';
type SportFilter = 'all' | 'cycling' | 'running' | 'swimming';

// ─── CONSTANTS ───────────────────────────────────────────────────────────────

const SPORT_COLORS: Record<SportFilter, string> = {
    all: '#8b5cf6',
    cycling: '#a855f7',
    running: '#10b981',
    swimming: '#06b6d4',
};

const ZONE_COLORS = ['#64748b', '#3b82f6', '#22c55e', '#f59e0b', '#ef4444'];
const ZONE_LABELS = ['Z1', 'Z2', 'Z3', 'Z4', 'Z5'];

// ─── HELPERS ─────────────────────────────────────────────────────────────────

/** Format a Date as YYYY-MM-DD in local timezone (avoids UTC shift from toISOString) */
function toLocalDateStr(d: Date): string {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
}

function formatDuration(mins: number): string {
    if (!mins || mins <= 0) return '0h';
    const h = Math.floor(mins / 60);
    const m = Math.round(mins % 60);
    return h > 0 ? `${h}h${m > 0 ? String(m).padStart(2, '0') : ''}` : `${m}min`;
}

function daysUntil(dateStr: string): number {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const target = new Date(dateStr);
    target.setHours(0, 0, 0, 0);
    return Math.ceil((target.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
}

function formatShortDate(dateStr: string): string {
    return new Date(dateStr).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });
}

// ─── INFO TOOLTIP ────────────────────────────────────────────────────────────

function InfoTooltip({ title, content }: { title: string; content: string }) {
    const [open, setOpen] = useState(false);
    const [pos, setPos] = useState({ top: 0, left: 0 });
    const btnRef = useRef<HTMLButtonElement>(null);

    const computePos = () => {
        if (!btnRef.current) return;
        const rect = btnRef.current.getBoundingClientRect();
        const tooltipW = 224; // w-56
        const tooltipH = 160; // approx max height
        const gap = 6;
        // Horizontal: align right edge of tooltip with right edge of button, clamp to viewport
        const left = Math.min(
            rect.right - tooltipW,
            window.innerWidth - tooltipW - 8
        );
        // Vertical: prefer above, fallback below if not enough room
        const top = rect.top > tooltipH + gap
            ? rect.top - tooltipH - gap
            : rect.bottom + gap;
        setPos({ top, left: Math.max(8, left) });
    };

    const handleOpen = (val: boolean) => {
        if (val) computePos();
        setOpen(val);
    };

    // Close on scroll so tooltip doesn't float away from its button
    useEffect(() => {
        if (!open) return;
        const close = () => setOpen(false);
        window.addEventListener('scroll', close, { passive: true });
        return () => window.removeEventListener('scroll', close);
    }, [open]);

    const tooltip = open ? createPortal(
        <div
            className="fixed z-9999 w-56 bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded-xl p-3 shadow-2xl pointer-events-none"
            style={{ top: pos.top, left: pos.left }}
        >
            <p className="text-xs font-semibold text-slate-900 dark:text-white mb-1.5">{title}</p>
            <p className="text-[11px] text-slate-500 dark:text-slate-400 leading-relaxed whitespace-pre-line">{content}</p>
        </div>,
        document.body
    ) : null;

    return (
        <div
            className="relative inline-flex shrink-0"
            onMouseEnter={() => handleOpen(true)}
            onMouseLeave={() => handleOpen(false)}
        >
            <button
                ref={btnRef}
                onClick={e => { e.stopPropagation(); handleOpen(!open); }}
                className="flex items-center justify-center w-5 h-5 rounded-full text-slate-500 hover:text-blue-400 transition-colors"
                aria-label="Aide"
            >
                <Info size={12} />
            </button>
            {tooltip}
        </div>
    );
}

// ─── SUB-COMPONENTS ───────────────────────────────────────────────────────────

// Coach recommendation based on TSB, ramp rate, and next objective
function getCoachAdvice(tsb: number, rampRate: number, daysToObj: number | null, priority: string | null = null): { text: string; icon: string } {
    if (rampRate > 1.5) return { text: 'Ta fatigue monte trop vite. Allège les 2-3 prochains jours pour éviter la blessure.', icon: '🛑' };

    if (daysToObj !== null && daysToObj > 0 && priority === 'secondaire') {
        // ── Objectif SECONDAIRE : mini-taper, on ne casse pas le plan ──
        if (daysToObj <= 3) {
            if (tsb >= 0) return { text: `J-${daysToObj} obj. secondaire — Tu es frais, parfait. Rappel léger et tu es prêt.`, icon: '✅' };
            if (tsb >= -10) return { text: `J-${daysToObj} obj. secondaire — Allège un peu, pas besoin de couper complètement.`, icon: '👍' };
            return { text: `J-${daysToObj} obj. secondaire — Tu es fatigué. Journée facile, tu ne viseras pas le pic de forme.`, icon: '⚠️' };
        }
        if (daysToObj <= 7) {
            if (tsb >= -5) return { text: `J-${daysToObj} obj. secondaire — Continue normalement, allège juste la veille et l'avant-veille.`, icon: '✅' };
            if (tsb >= -15) return { text: `J-${daysToObj} obj. secondaire — Réduis un peu le volume sans couper l'intensité.`, icon: '👍' };
            return { text: `J-${daysToObj} obj. secondaire — Fatigue élevée. Allège cette semaine pour être correct le jour J.`, icon: '⚠️' };
        }
        if (tsb >= -10) return { text: `J-${daysToObj} obj. secondaire — Pas de changement de plan. Continue ta préparation normalement.`, icon: '✅' };
        if (tsb >= -25) return { text: `J-${daysToObj} obj. secondaire — Charge normale, le plan prévoit un allègement avant l'objectif.`, icon: '👀' };
        return { text: `J-${daysToObj} obj. secondaire — Fatigue importante. Prévois une récup pour être en forme.`, icon: '😴' };
    }

    if (daysToObj !== null && daysToObj > 0) {
        // ── Objectif PRINCIPAL : full taper et peaking ──
        if (daysToObj <= 7) {
            if (tsb >= 10) return { text: `J-${daysToObj} — Tu es frais et affûté. Séances très courtes de rappel, tu es prêt.`, icon: '✅' };
            if (tsb >= 0) return { text: `J-${daysToObj} — Forme correcte. Plus que du très léger et des rappels courts.`, icon: '👍' };
            if (tsb >= -10) return { text: `J-${daysToObj} — Encore chargé. Coupe le volume, garde juste 1-2 rappels courts.`, icon: '⚠️' };
            return { text: `J-${daysToObj} — Fatigue élevée, c'est serré. Repos complet sauf activation légère la veille.`, icon: '🔴' };
        }
        if (daysToObj <= 14) {
            if (tsb >= 5) return { text: `J-${daysToObj} — Bonne trajectoire de taper. Réduis le volume, maintiens des rappels d'intensité tous les 2-3 jours.`, icon: '✅' };
            if (tsb >= -5) return { text: `J-${daysToObj} — Le taper fait son effet. Continue de baisser le volume, la fraîcheur monte.`, icon: '👍' };
            if (tsb >= -15) return { text: `J-${daysToObj} — Encore beaucoup de fatigue. Réduis le volume de 50% minimum.`, icon: '⚠️' };
            return { text: `J-${daysToObj} — Fatigue très élevée pour un taper. Allège immédiatement, priorise le sommeil.`, icon: '🔴' };
        }
        if (daysToObj <= 28) {
            if (tsb >= 0) return { text: `J-${daysToObj} — Tu es frais. Place tes dernières séances intenses, taper dans ${daysToObj - 14} jours.`, icon: '💪' };
            if (tsb >= -15) return { text: `J-${daysToObj} — Bonne charge de pré-taper. Le taper absorbera bientôt cette fatigue.`, icon: '✅' };
            if (tsb >= -25) return { text: `J-${daysToObj} — Charge élevée, normal en pré-taper. Surveille la récupération.`, icon: '👀' };
            return { text: `J-${daysToObj} — Fatigue excessive. Allège cette semaine, tu as le temps de récupérer avant le taper.`, icon: '⚠️' };
        }
        if (tsb >= 5) return { text: `J-${daysToObj} — Tu es frais avec du temps devant toi. Place un gros bloc pour construire ta forme.`, icon: '🚀' };
        if (tsb >= -10) return { text: `J-${daysToObj} — Bonne zone de charge. Continue à construire ta forme régulièrement.`, icon: '✅' };
        if (tsb >= -25) return { text: `J-${daysToObj} — Charge soutenue. Prévois une semaine de récup bientôt.`, icon: '👀' };
        return { text: `J-${daysToObj} — Fatigue accumulée importante. Place une semaine allégée pour repartir.`, icon: '😴' };
    }

    // ── Pas d'objectif : conseils généraux ──
    if (tsb > 15) return { text: 'Tu es très frais. C\'est le moment de placer une grosse séance ou un bloc intense.', icon: '🚀' };
    if (tsb > 5) return { text: 'Bonne fraîcheur. Tu peux pousser aujourd\'hui, les jambes sont là.', icon: '💪' };
    if (tsb > -5) return { text: 'Zone optimale d\'entraînement. Continue sur cette lancée.', icon: '✅' };
    if (tsb > -15) return { text: 'Tu accumules de la fatigue. C\'est normal en charge, mais surveille la récupération.', icon: '👀' };
    return { text: 'Fatigue élevée. Priorise le sommeil et l\'alimentation. Prochaine séance : récup active max.', icon: '😴' };
}

// TSB gauge — visual thermometer
function TSBGauge({ tsb, theme }: { tsb: number; theme: string }) {
    const [showDetails, setShowDetails] = useState(false);

    // Gauge range: -30 to +30, clamped
    const clampedTsb = Math.max(-30, Math.min(30, tsb));
    const pct = ((clampedTsb + 30) / 60) * 100;

    const zones = [
        { end: 16.7, color: '#ef4444', label: 'Surmenage', range: '< −20' },
        { end: 33.3, color: '#f97316', label: 'Chargé', range: '−20 à −10' },
        { end: 50, color: '#eab308', label: 'Fatigué', range: '−10 à 0' },
        { end: 66.7, color: '#86efac', label: 'Équilibré', range: '0 à +10' },
        { end: 100, color: '#22c55e', label: 'Frais', range: '> +10' },
    ];
    const trackBg = theme === 'dark' ? '#1e293b' : '#e2e8f0';
    const cursorColor = zones.find(z => pct <= z.end)?.color ?? '#22c55e';

    return (
        <div className="w-full">
            {/* Gauge track + cursor wrapper — clickable / hoverable */}
            <div
                className="relative h-6 flex items-center cursor-pointer"
                onClick={() => setShowDetails(d => !d)}
                onMouseEnter={() => setShowDetails(true)}
                onMouseLeave={() => setShowDetails(false)}
            >
                {/* Track (colored zones) */}
                <div className="absolute inset-x-0 h-2.5 rounded-full overflow-hidden flex" style={{ background: trackBg }}>
                    {zones.map((z, i) => {
                        const prevEnd = i === 0 ? 0 : zones[i - 1].end;
                        return (
                            <div
                                key={i}
                                className="h-full"
                                style={{
                                    width: `${z.end - prevEnd}%`,
                                    backgroundColor: z.color,
                                    opacity: 0.25,
                                }}
                            />
                        );
                    })}
                </div>
                {/* Cursor */}
                <div
                    className="absolute w-5 h-5 rounded-full shadow-lg transition-all duration-500"
                    style={{
                        left: `${pct}%`,
                        top: '50%',
                        transform: 'translate(-50%, -50%)',
                        backgroundColor: cursorColor,
                        border: `2.5px solid ${theme === 'dark' ? '#0f172a' : '#ffffff'}`,
                        boxShadow: `0 0 0 2px ${cursorColor}40, 0 2px 8px ${cursorColor}60`,
                    }}
                />
            </div>

            {/* Collapsed labels */}
            {!showDetails && (
                <div className="flex justify-between mt-0.5 text-[9px] text-slate-400">
                    <span>Surmenage</span>
                    <span>Chargé</span>
                    <span>Optimal</span>
                    <span>Frais</span>
                </div>
            )}

            {/* Expanded detail — zone labels + TSB ranges */}
            {showDetails && (
                <div className="flex mt-1.5 gap-0.5 animate-in fade-in duration-200">
                    {zones.map((z, i) => {
                        const prevEnd = i === 0 ? 0 : zones[i - 1].end;
                        const isActive = pct > prevEnd && pct <= z.end;
                        return (
                            <div
                                key={i}
                                className="flex flex-col items-center rounded-md py-1 transition-all"
                                style={{
                                    width: `${z.end - prevEnd}%`,
                                    backgroundColor: isActive ? z.color + '20' : 'transparent',
                                    border: isActive ? `1px solid ${z.color}40` : '1px solid transparent',
                                }}
                            >
                                <span className="text-[9px] font-semibold" style={{ color: z.color }}>{z.label}</span>
                                <span className="text-[8px] text-slate-400">{z.range}</span>
                            </div>
                        );
                    })}
                </div>
            )}
        </div>
    );
}

// PMC Snapshot — forme du jour
function PMCSnapshot({ ctl, atl, nextObjective, theme }: {
    ctl: number; atl: number;
    nextObjective?: { name: string; date: string; priority: string } | null;
    theme: string;
}) {
    const tsb = Math.round((ctl - atl) * 10) / 10;
    const status = getTSBStatus(tsb);
    const rampRate = ctl > 0 ? Math.round((atl / ctl) * 100) / 100 : 0;

    const daysToObj = nextObjective ? daysUntil(nextObjective.date) : null;
    const advice = getCoachAdvice(tsb, rampRate, daysToObj, nextObjective?.priority ?? null);

    return (
        <Card className="p-4 md:p-6 border-l-4" style={{ borderLeftColor: status.color }}>
            {/* Row 1 — Status + TSB value */}
            <div className="flex items-start justify-between mb-3">
                <div>
                    <div className="flex items-center gap-1.5">
                        <p className="text-[10px] text-slate-500 dark:text-slate-400 uppercase tracking-widest font-medium">Forme du Jour</p>
                        <InfoTooltip
                            title="Comment ça marche ?"
                            content={"Forme (CTL) : ta condition physique sur 42 jours.\n\nFatigue (ATL) : stress accumulé sur 7 jours.\n\nFraîcheur (TSB) = Forme − Fatigue.\n\nPlus le TSB est positif, plus tu es reposé.\nPlus il est négatif, plus tu es fatigué.\n\nAvant une course, vise TSB entre +5 et +15."}
                        />
                    </div>
                    <div
                        className="inline-flex items-center gap-1.5 mt-1.5 px-3 py-1 rounded-full text-xs font-semibold"
                        style={{ color: status.color, backgroundColor: status.bgColor }}
                    >
                        <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: status.color }} />
                        {status.label}
                    </div>
                </div>
                <div className="text-right">
                    <p className="text-[10px] text-slate-500 dark:text-slate-400 uppercase tracking-wider">Fraîcheur</p>
                    <p className="text-3xl font-black" style={{ color: status.color }}>
                        {tsb > 0 ? '+' : ''}{tsb}
                    </p>
                </div>
            </div>

            {/* Row 2 — TSB Gauge */}
            <div className="mb-3">
                <TSBGauge tsb={tsb} theme={theme} />
            </div>

            {/* Row 3 — Coach advice */}
            <div
                className="flex items-center gap-2.5 px-3 py-2.5 rounded-lg mb-3 text-xs leading-relaxed"
                style={{
                    backgroundColor: status.bgColor,
                    color: theme === 'dark' ? '#e2e8f0' : '#334155',
                }}
            >
                <span className="text-base shrink-0">{advice.icon}</span>
                <p>{advice.text}</p>
            </div>

            {/* Row 4 — Metrics inline */}
            <div className="flex items-center gap-4 text-xs">
                <div className="flex items-center gap-1.5">
                    <span className="w-2 h-2 rounded-full bg-blue-500" />
                    <span className="text-slate-500 dark:text-slate-400">Forme</span>
                    <span className="font-bold text-blue-600 dark:text-blue-400">{Math.round(ctl)}</span>
                </div>
                <div className="flex items-center gap-1.5">
                    <span className="w-2 h-2 rounded-full bg-red-500" />
                    <span className="text-slate-500 dark:text-slate-400">Fatigue</span>
                    <span className="font-bold text-red-400">{Math.round(atl)}</span>
                </div>
                <div className="flex items-center gap-1.5">
                    <span className="text-slate-500 dark:text-slate-400">Ratio</span>
                    <span className={`font-bold ${rampRate > 1.5 ? 'text-red-400' : rampRate > 1.3 ? 'text-amber-400' : 'text-slate-400'}`}>
                        {rampRate.toFixed(2)}
                    </span>
                </div>
            </div>

            {/* Row 5 — Ramp rate alert */}
            {rampRate > 1.5 && (
                <div className="flex items-center gap-2 mt-3 px-3 py-2 bg-red-50 dark:bg-red-950/60 border border-red-200 dark:border-red-900/50 rounded-lg">
                    <AlertTriangle size={14} className="text-red-400 shrink-0" />
                    <p className="text-[11px] text-red-600 dark:text-red-300">
                        Ratio fatigue/forme à {rampRate.toFixed(2)} — au-dessus de 1.5 le risque de blessure augmente.
                    </p>
                </div>
            )}

            {/* Row 6 — Next objective context */}
            {nextObjective && daysToObj !== null && daysToObj > 0 && (
                <div className="flex items-center gap-2 mt-3 px-3 py-2 bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 rounded-lg">
                    <Target size={14} className={nextObjective.priority === 'principale' ? 'text-amber-400 shrink-0' : 'text-violet-400 shrink-0'} />
                    <p className="text-[11px] text-slate-600 dark:text-slate-300">
                        <strong>{nextObjective.name}</strong> dans {daysToObj}j — {
                            nextObjective.priority === 'secondaire'
                                ? (daysToObj <= 3
                                    ? (tsb >= 0 ? 'frais, rappel léger et c\'est bon' : 'allège un peu la veille')
                                    : daysToObj <= 7
                                        ? (tsb >= -5 ? 'continue normalement' : 'réduis un peu le volume')
                                        : 'pas de changement, reste sur le plan')
                                : (daysToObj <= 7
                                    ? (tsb >= 10 ? 'affûtage parfait, garde le cap' : tsb >= 0 ? 'rappels légers et repos' : 'coupe tout, priorité récupération')
                                    : daysToObj <= 14
                                        ? (tsb >= 0 ? 'taper en bonne voie' : tsb >= -10 ? 'réduis le volume maintenant' : 'allège immédiatement')
                                        : daysToObj <= 28
                                            ? (tsb >= -15 ? 'bonne charge pré-taper' : 'attention à la fatigue avant le taper')
                                            : (tsb >= -10 ? 'construction en cours' : 'pense à récupérer bientôt'))
                        }
                    </p>
                </div>
            )}
        </Card>
    );
}

// KPI Card
interface KPICardProps {
    value: string;
    label: string;
    subLabel?: string;
    icon: React.ReactNode;
    accentColor: string;
    trend?: { value: number; label: string };
    info?: string;
}

function KPICard({ value, label, subLabel, icon, accentColor, trend, info }: KPICardProps) {
    const trendUp = trend && trend.value > 0;
    const trendDown = trend && trend.value < 0;
    const trendColor = trendUp ? '#22c55e' : trendDown ? '#f97316' : '#64748b';

    return (
        <div
            className="relative rounded-xl p-4 border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/60"
            style={{ borderLeftWidth: '3px', borderLeftColor: accentColor }}
        >
            {/* Clipped background icon */}
            <div className="absolute inset-0 overflow-hidden rounded-xl pointer-events-none">
                <div className="absolute -right-2 -top-2 opacity-[0.07] w-14 h-14" style={{ color: accentColor }}>
                    {icon}
                </div>
            </div>
            {/* Info button */}
            {info && (
                <div className="absolute top-2 right-2">
                    <InfoTooltip title={label} content={info} />
                </div>
            )}
            <p className="text-2xl md:text-3xl font-black text-slate-900 dark:text-white tracking-tight">{value}</p>
            <p
                className="text-[10px] uppercase tracking-widest mt-0.5 font-medium"
                style={{ color: accentColor }}
            >
                {label}
            </p>
            {subLabel && <p className="text-[10px] text-slate-500 mt-0.5">{subLabel}</p>}
            {trend && (
                <div className="flex items-center gap-1 mt-2" style={{ color: trendColor }}>
                    {trendUp ? <TrendingUp size={11} /> : trendDown ? <TrendingDown size={11} /> : <Minus size={11} />}
                    <span className="text-[10px]">{trend.label}</span>
                </div>
            )}
        </div>
    );
}

// PMC Chart tooltip
function PMCTooltipContent({ active, payload, label }: { active?: boolean; payload?: { value: number; name: string }[]; label?: string }) {
    if (!active || !payload?.length) return null;
    const ctl = payload.find(p => p.name === 'ctl')?.value;
    const atl = payload.find(p => p.name === 'atl')?.value;
    const tsb = payload.find(p => p.name === 'tsb')?.value;
    const tss = payload.find(p => p.name === 'tss')?.value;
    const tsbColor = tsb != null ? getTSBStatus(tsb).color : '#94a3b8';
    return (
        <div className="bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-xl p-3 text-xs shadow-2xl pointer-events-none">
            <p className="text-slate-500 dark:text-slate-400 font-medium mb-2">{label}</p>
            {tss != null && tss > 0 && (
                <div className="flex items-center gap-2 text-slate-600 dark:text-slate-300 mb-1.5">
                    <span className="w-2 h-2 rounded-full bg-slate-600" />
                    TSS {tss}
                </div>
            )}
            {ctl != null && (
                <div className="flex items-center gap-2 text-blue-600 dark:text-blue-400">
                    <span className="w-2 h-2 rounded-full bg-blue-500" />
                    CTL {ctl?.toFixed(1)}
                </div>
            )}
            {atl != null && (
                <div className="flex items-center gap-2 text-red-400">
                    <span className="w-2 h-2 rounded-full bg-red-500" />
                    ATL {atl?.toFixed(1)}
                </div>
            )}
            {tsb != null && (
                <div className="flex items-center gap-2 mt-1" style={{ color: tsbColor }}>
                    <span className="w-2 h-2 rounded-full" style={{ background: tsbColor }} />
                    TSB {tsb > 0 ? '+' : ''}{tsb?.toFixed(1)}
                </div>
            )}
        </div>
    );
}

// Weekly TSS tooltip
function WeeklyTooltipContent({ active, payload, label }: { active?: boolean; payload?: { value: number; name: string; fill: string }[]; label?: string }) {
    if (!active || !payload?.length) return null;
    const planned = payload.find(p => p.name === 'planned');
    const actual = payload.find(p => p.name === 'actual');
    const compliance = planned?.value ? Math.round(((actual?.value ?? 0) / planned.value) * 100) : 0;
    return (
        <div className="bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-xl p-3 text-xs shadow-2xl pointer-events-none">
            <p className="text-slate-500 dark:text-slate-400 font-medium mb-2">{label}</p>
            <div className="flex items-center gap-2 text-slate-500 dark:text-slate-400">
                <span className="w-2 h-2 rounded-full bg-slate-600" />
                Planifié {planned?.value} TSS
            </div>
            <div className="flex items-center gap-2 text-blue-600 dark:text-blue-400 mt-1">
                <span className="w-2 h-2 rounded-full bg-blue-500" />
                Réalisé {actual?.value} TSS
            </div>
            {planned?.value != null && planned.value > 0 && (
                <div className={`mt-1.5 font-semibold ${compliance >= 90 ? 'text-emerald-600 dark:text-emerald-400' : compliance >= 70 ? 'text-amber-600 dark:text-amber-400' : 'text-red-600 dark:text-red-400'}`}>
                    {compliance}% réalisation
                </div>
            )}
        </div>
    );
}

// Compliance gauge SVG
function ComplianceGauge({ value, theme }: { value: number; theme: string }) {
    const r = 48;
    const circ = Math.PI * r;
    const dash = Math.max(0, Math.min(1, value / 100)) * circ;
    const color = value >= 90 ? '#22c55e' : value >= 75 ? '#3b82f6' : value >= 60 ? '#f59e0b' : '#ef4444';
    const label = value >= 90 ? 'Excellent' : value >= 75 ? 'Bien' : value >= 60 ? 'Moyen' : 'À améliorer';
    const trackColor = theme === 'dark' ? '#1e293b' : '#e2e8f0';
    const textColor = theme === 'dark' ? '#ffffff' : '#0f172a';

    return (
        <div className="flex flex-col items-center">
            <svg viewBox="0 0 120 72" className="w-28 h-18">
                <path
                    d="M 12 60 A 48 48 0 0 1 108 60"
                    fill="none"
                    stroke={trackColor}
                    strokeWidth="10"
                    strokeLinecap="round"
                />
                <path
                    d="M 12 60 A 48 48 0 0 1 108 60"
                    fill="none"
                    stroke={color}
                    strokeWidth="10"
                    strokeLinecap="round"
                    strokeDasharray={`${dash} ${circ}`}
                    style={{ transition: 'stroke-dasharray 1s ease' }}
                />
                <text x="60" y="56" textAnchor="middle" fontSize="20" fontWeight="800" fill={textColor}>
                    {value}%
                </text>
            </svg>
            <p className="text-xs font-semibold" style={{ color }}>{label}</p>
            <p className="text-[10px] text-slate-500 mt-0.5">Taux de réalisation</p>
        </div>
    );
}

// Zone Distribution bars
function ZoneDistribution({ zones }: { zones: number[] }) {
    if (zones.every(z => z === 0)) {
        return (
            <p className="text-xs text-slate-500 italic leading-relaxed">
                Aucune donnée FC disponible.<br />
                Synchronise Strava ou renseigne ta FC max dans le profil.
            </p>
        );
    }
    return (
        <div className="space-y-2">
            {[...zones].reverse().map((pct, ri) => {
                const i = zones.length - 1 - ri;
                return (
                    <div key={i} className="flex items-center gap-2">
                        <span className="text-[10px] text-slate-500 w-4 shrink-0 font-medium">{ZONE_LABELS[i]}</span>
                        <div className="flex-1 h-2.5 bg-slate-100 dark:bg-slate-800 rounded-full overflow-hidden">
                            <div
                                className="h-full rounded-full transition-all duration-700"
                                style={{ width: `${pct}%`, backgroundColor: ZONE_COLORS[i] }}
                            />
                        </div>
                        <span className="text-[10px] text-slate-500 dark:text-slate-400 w-7 text-right shrink-0">{pct}%</span>
                    </div>
                );
            })}
        </div>
    );
}

// Sport Tab Button
function SportTabButton({
    label, icon, active, color, onClick,
}: {
    sport: SportFilter; label: string; icon: React.ReactNode; active: boolean; color: string; onClick: () => void;
}) {
    return (
        <button
            onClick={onClick}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all"
            style={active
                ? { backgroundColor: color + '20', color, borderWidth: 1, borderColor: color + '60' }
                : { backgroundColor: 'transparent', color: '#64748b', borderWidth: 1, borderColor: 'transparent' }}
        >
            {icon}
            {label}
        </button>
    );
}

// Objective Card
function ObjectiveCard({ obj }: { obj: Objective }) {
    const days = daysUntil(obj.date);
    const isPast = days < 0;
    const sportColor = SPORT_COLORS[obj.sport as SportFilter] ?? '#8b5cf6';
    const sportIcon = {
        cycling: <Bike size={14} />, running: <Footprints size={14} />,
        swimming: <Waves size={14} />, triathlon: <Activity size={14} />, duathlon: <Activity size={14} />,
    }[obj.sport];

    return (
        <div className="snap-start shrink-0 w-44 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-4 flex flex-col gap-2">
            {isPast ? (
                <p className="text-xs text-slate-500">Passé il y a {Math.abs(days)}j</p>
            ) : (
                <div>
                    <p className="text-3xl font-black text-slate-900 dark:text-white leading-none">{days}</p>
                    <p className="text-[10px] text-slate-500 dark:text-slate-400">jours restants</p>
                </div>
            )}
            <p className="text-sm font-semibold text-slate-900 dark:text-white truncate leading-tight">{obj.name}</p>
            <div className="flex items-center gap-2 flex-wrap">
                <div className="flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-md" style={{ backgroundColor: sportColor + '20', color: sportColor }}>
                    {sportIcon}
                    <span>{obj.sport}</span>
                </div>
                {obj.priority === 'principale' && (
                    <span className="text-[9px] text-amber-600 dark:text-amber-400 uppercase tracking-wider font-bold">A-Race</span>
                )}
            </div>
            {obj.distanceKm && (
                <p className="text-[10px] text-slate-500">{obj.distanceKm} km</p>
            )}
            <p className="text-[10px] text-slate-500 mt-auto">{formatShortDate(obj.date)}</p>
        </div>
    );
}

// ─── MAIN COMPONENT ───────────────────────────────────────────────────────────

export const StatsView: React.FC<StatsViewProps> = ({ scheduleData, profile, objectives = [] }) => {
    const { theme } = useTheme();
    const [period, setPeriod] = useState<PeriodId>('season');
    const [customRange, setCustomRange] = useState(() => {
        const end = new Date();
        end.setDate(end.getDate() + 7);
        const start = new Date();
        start.setDate(start.getDate() - 30);
        return {
            start: toLocalDateStr(start),
            end: toLocalDateStr(end),
        };
    });
    const [sportFilter, setSportFilter] = useState<SportFilter>('all');

    const currentYear = new Date().getFullYear();

    // ── Date range from period ──────────────────────────────────────────────
    const { rangeStart, rangeEnd } = useMemo(() => {
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const todayStr = toLocalDateStr(today);
        const subtract = (days: number) => {
            const d = new Date(today);
            d.setDate(d.getDate() - days);
            return toLocalDateStr(d);
        };
        switch (period) {
            case '7d': return { rangeStart: subtract(7), rangeEnd: todayStr };
            case '30d': return { rangeStart: subtract(30), rangeEnd: todayStr };
            case '90d': return { rangeStart: subtract(90), rangeEnd: todayStr };
            case 'season': return { rangeStart: `${currentYear}-01-01`, rangeEnd: `${currentYear}-12-31` };
            case 'custom': return { rangeStart: customRange.start, rangeEnd: customRange.end };
            default: return { rangeStart: subtract(30), rangeEnd: todayStr };
        }
    }, [period, customRange, currentYear]);

    // ── Filtered workouts ───────────────────────────────────────────────────
    const filteredWorkouts = useMemo((): Workout[] => {
        return scheduleData.workouts.filter(w => {
            const inRange = w.date >= rangeStart && w.date <= rangeEnd;
            const inSport = sportFilter === 'all' || w.sportType === sportFilter;
            return inRange && inSport;
        }).sort((a, b) => a.date.localeCompare(b.date));
    }, [scheduleData.workouts, rangeStart, rangeEnd, sportFilter]);

    // ── All workouts for zone dist (sport filter only) ──────────────────────
    const sportFilteredAll = useMemo(() => {
        if (sportFilter === 'all') return scheduleData.workouts;
        return scheduleData.workouts.filter(w => w.sportType === sportFilter);
    }, [scheduleData.workouts, sportFilter]);

    // ── KPIs ────────────────────────────────────────────────────────────────
    const kpis = useMemo(() => {
        const today = toLocalDateStr(new Date());
        let totalPlannedDur = 0, totalActualDur = 0, totalActualDist = 0;
        let totalPlannedTSS = 0, totalActualTSS = 0;
        let totalRPE = 0, rpeCount = 0;
        let completedCount = 0, plannedCountSoFar = 0, missedCount = 0;

        filteredWorkouts.forEach(w => {
            const isPast = w.date <= today;
            totalPlannedDur += w.plannedData?.durationMinutes ?? 0;
            totalPlannedTSS += w.plannedData?.plannedTSS ?? 0;
            if (isPast) plannedCountSoFar++;
            if (w.status === 'completed' && w.completedData) {
                completedCount++;
                totalActualDur += w.completedData.actualDurationMinutes ?? 0;
                totalActualDist += w.completedData.distanceKm ?? 0;
                const tss = getWorkoutTSS(w);
                totalActualTSS += tss;
                if (w.completedData.perceivedEffort) { totalRPE += w.completedData.perceivedEffort; rpeCount++; }
            } else if (w.status === 'missed') {
                missedCount++;
            }
        });

        return {
            totalActualDur,
            totalPlannedDur,
            totalActualDist,
            totalActualTSS,
            totalPlannedTSS,
            completedCount,
            plannedCountSoFar,
            missedCount,
            complianceRate: plannedCountSoFar > 0 ? Math.round((completedCount / plannedCountSoFar) * 100) : 0,
            avgRpe: rpeCount > 0 ? (totalRPE / rpeCount).toFixed(1) : null,
            intensityFactor: totalActualDur > 0 ? Math.round(totalActualTSS / (totalActualDur / 60)) : 0,
        };
    }, [filteredWorkouts]);

    // ── PMC data — linked to period filter ─────────────────────────────────
    const pmcData = useMemo(() => {
        const raw = computePMC(scheduleData.workouts, 0, 0, 90, rangeStart, rangeEnd);
        // Thin out data when range is large (>60 points) for readability
        if (raw.length > 60) {
            const step = Math.ceil(raw.length / 60);
            return raw.filter((_, i) => i % step === 0 || i === raw.length - 1);
        }
        return raw;
    }, [scheduleData.workouts, rangeStart, rangeEnd]);

    // Current CTL/ATL from PMC (recalculé, pas depuis le profil)
    const currentPMC = pmcData[pmcData.length - 1];
    const currentCTL = currentPMC?.ctl ?? 0;
    const currentATL = currentPMC?.atl ?? 0;

    // PMC stats for the period
    const pmcStats = useMemo(() => {
        if (pmcData.length < 2) return null;
        const first = pmcData[0];
        const last = pmcData[pmcData.length - 1];
        const ctlDelta = last.ctl - first.ctl;
        const minTSB = Math.min(...pmcData.map(p => p.tsb));
        const maxTSB = Math.max(...pmcData.map(p => p.tsb));
        const avgTSS = Math.round(pmcData.reduce((s, p) => s + p.tss, 0) / pmcData.length);
        return { ctlDelta, minTSB, maxTSB, avgTSS };
    }, [pmcData]);

    // TSB gradient offset (split green/red at y=0)
    const tsbGradientOffset = useMemo(() => {
        if (!pmcData.length) return 0.5;
        const maxTsb = Math.max(...pmcData.map(p => p.tsb));
        const minTsb = Math.min(...pmcData.map(p => p.tsb));
        if (maxTsb <= 0) return 0;
        if (minTsb >= 0) return 1;
        return maxTsb / (maxTsb - minTsb);
    }, [pmcData]);

    // Objectives in the current PMC range
    const pmcObjectives = useMemo(() => {
        return objectives.filter(o => o.date >= rangeStart && o.date <= rangeEnd);
    }, [objectives, rangeStart, rangeEnd]);

    // ── Weekly TSS (12 weeks) ────────────────────────────────────────────────
    const weeklyData = useMemo(() => computeWeeklyTSS(scheduleData.workouts, 12), [scheduleData.workouts]);

    // ── Zone distribution ────────────────────────────────────────────────────
    const zones = useMemo(() => {
        const rangeWorkouts = sportFilteredAll.filter(w => w.date >= rangeStart && w.date <= rangeEnd);
        return aggregateZones(rangeWorkouts, profile.heartRate?.zones);
    }, [sportFilteredAll, rangeStart, rangeEnd, profile.heartRate?.zones]);

    // ── Objectives sorted ────────────────────────────────────────────────────
    const upcomingObjectives = useMemo(() =>
        [...objectives]
            .filter(o => o.status !== 'missed')
            .sort((a, b) => a.date.localeCompare(b.date))
            .slice(0, 6),
        [objectives]
    );

    // ── Next upcoming objective (for PMC snapshot context) ───────────────────
    const nextObjective = useMemo(() => {
        const today = toLocalDateStr(new Date());
        return upcomingObjectives.find(o => o.date >= today) ?? null;
    }, [upcomingObjectives]);

    // ── PMC chart tick formatter ─────────────────────────────────────────────
    const formatPMCTick = (val: string) =>
        new Date(val).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });

    const accentColor = SPORT_COLORS[sportFilter];

    const periodButtons: { id: PeriodId; label: string }[] = [
        { id: '7d', label: '7J' },
        { id: '30d', label: '30J' },
        { id: '90d', label: '3M' },
        { id: 'season', label: `${currentYear}` },
        { id: 'custom', label: 'Perso' },
    ];

    return (
        <div className="space-y-4 md:space-y-6 pb-24 md:pb-8">

            {/* ── PERIOD + SPORT SELECTORS ──────────────────────────────── */}
            <div className="flex flex-col gap-2">
                {/* Period pills */}
                <div className="flex items-center gap-1.5 overflow-x-auto scrollbar-none">
                    {periodButtons.map(btn => (
                        <button
                            key={btn.id}
                            onClick={() => setPeriod(btn.id)}
                            className="shrink-0 px-3.5 py-1.5 rounded-full text-xs font-semibold transition-all"
                            style={period === btn.id
                                ? { backgroundColor: accentColor, color: '#fff' }
                                : { backgroundColor: theme === 'dark' ? '#1e293b' : '#f1f5f9', color: '#64748b' }}
                        >
                            {btn.label}
                        </button>
                    ))}
                </div>
                {/* Sport filter pills */}
                <div className="flex items-center gap-1.5 overflow-x-auto scrollbar-none">
                    <SportTabButton sport="all" label="Tous sports" icon={<Activity size={12} />} active={sportFilter === 'all'} color={SPORT_COLORS.all} onClick={() => setSportFilter('all')} />
                    {profile.activeSports.cycling && <SportTabButton sport="cycling" label="Vélo" icon={<Bike size={12} />} active={sportFilter === 'cycling'} color={SPORT_COLORS.cycling} onClick={() => setSportFilter('cycling')} />}
                    {profile.activeSports.running && <SportTabButton sport="running" label="Course" icon={<Footprints size={12} />} active={sportFilter === 'running'} color={SPORT_COLORS.running} onClick={() => setSportFilter('running')} />}
                    {profile.activeSports.swimming && <SportTabButton sport="swimming" label="Natation" icon={<Waves size={12} />} active={sportFilter === 'swimming'} color={SPORT_COLORS.swimming} onClick={() => setSportFilter('swimming')} />}
                </div>
            </div>

            {/* Custom date range */}
            {period === 'custom' && (
                <div className="flex flex-col sm:flex-row gap-2 bg-slate-50 dark:bg-slate-900/50 p-3 rounded-xl border border-slate-200 dark:border-slate-800 animate-in zoom-in-95 duration-200">
                    <div className="flex items-center gap-2 flex-1">
                        <span className="text-[10px] text-slate-500 dark:text-slate-400 uppercase w-5">Du</span>
                        <input
                            type="date"
                            style={{ colorScheme: theme }}
                            value={customRange.start}
                            onChange={e => setCustomRange(p => ({ ...p, start: e.target.value }))}
                            className="flex-1 bg-slate-100 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 text-slate-900 dark:text-white rounded-lg px-3 py-1.5 text-sm outline-none focus:border-blue-500"
                        />
                    </div>
                    <div className="flex items-center gap-2 flex-1">
                        <span className="text-[10px] text-slate-500 dark:text-slate-400 uppercase w-5">Au</span>
                        <input
                            type="date"
                            style={{ colorScheme: theme }}
                            value={customRange.end}
                            onChange={e => setCustomRange(p => ({ ...p, end: e.target.value }))}
                            className="flex-1 bg-slate-100 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 text-slate-900 dark:text-white rounded-lg px-3 py-1.5 text-sm outline-none focus:border-blue-500"
                        />
                    </div>
                </div>
            )}

            {/* ── TOP SECTION: PMC + KPIs ──────────────────────────────── */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <FeatureGate feature="advanced-stats" mode="blur" label="Forme du jour">
                    <PMCSnapshot ctl={currentCTL} atl={currentATL} nextObjective={nextObjective} theme={theme} />
                </FeatureGate>

                {/* KPI Grid */}
                <div className="grid grid-cols-2 gap-3">
                    <KPICard
                        value={formatDuration(kpis.totalActualDur)}
                        label="Volume"
                        subLabel={`/ ${formatDuration(kpis.totalPlannedDur)} planifié`}
                        icon={<Clock />}
                        accentColor="#10b981"
                        trend={kpis.totalPlannedDur > 0 ? {
                            value: kpis.totalActualDur - kpis.totalPlannedDur,
                            label: `${Math.round((kpis.totalActualDur / Math.max(kpis.totalPlannedDur, 1)) * 100)}% plan`,
                        } : undefined}
                        info={"Durée totale des séances réalisées sur la période.\n\nComparé au volume planifié dans ton plan.\n\n>90% → en ligne avec le plan\n<70% → sous-entraînement\n>115% → risque de surcharge"}
                    />
                    <KPICard
                        value={kpis.totalActualDist > 0 ? `${kpis.totalActualDist.toFixed(0)} km` : '—'}
                        label="Distance"
                        icon={<MapPin />}
                        accentColor="#8b5cf6"
                        info={"Distance totale parcourue toutes disciplines confondues.\n\nVarie selon les sports pratiqués : la natation génère peu de km, le vélo beaucoup. Ce chiffre est donc plus pertinent filtré par sport."}
                    />
                    <KPICard
                        value={kpis.totalActualTSS.toFixed(0)}
                        label="Charge TSS"
                        subLabel={`/ ${kpis.totalPlannedTSS} planifié`}
                        icon={<Activity />}
                        accentColor="#3b82f6"
                        trend={kpis.totalPlannedTSS > 0 ? {
                            value: kpis.totalActualTSS - kpis.totalPlannedTSS,
                            label: `${Math.round((kpis.totalActualTSS / Math.max(kpis.totalPlannedTSS, 1)) * 100)}% du plan`,
                        } : undefined}
                        info={"Training Stress Score : mesure la charge réelle de chaque séance en tenant compte de l'intensité.\n\n100 TSS ≈ 1h à effort maximal soutenu (FTP/VMA).\n\nPlus fiable que les heures : 3h de vélo facile ≠ 1h de fractionné."}
                    />
                    <KPICard
                        value={`${kpis.complianceRate}%`}
                        label="Compliance"
                        subLabel={`${kpis.completedCount}/${kpis.plannedCountSoFar} séances`}
                        icon={<Target />}
                        accentColor={kpis.complianceRate >= 90 ? '#22c55e' : kpis.complianceRate >= 70 ? '#f59e0b' : '#ef4444'}
                        trend={kpis.avgRpe ? { value: 0, label: `RPE moy. ${kpis.avgRpe}/10` } : undefined}
                        info={"% des séances passées effectivement réalisées.\n\n>90% → excellent, le plan fonctionne\n75-90% → bien\n<60% → revoir les objectifs ou le volume\n\nUne compliance basse indique un plan trop ambitieux ou un manque de récupération."}
                    />
                </div>
            </div>

            {/* ── PMC CHART ─────────────────────────────────────────────── */}
            <FeatureGate feature="advanced-stats" mode="blur" label="Performance Management Chart">
            <Card className="p-4 md:p-6">
                <div className="flex items-center justify-between mb-2">
                    <div>
                        <div className="flex items-center gap-1.5">
                            <h3 className="text-sm font-semibold text-slate-900 dark:text-white">Performance Management Chart</h3>
                            <InfoTooltip
                                title="Comment lire le PMC ?"
                                content={"CTL (bleu) : forme chronique sur 42j. Monte = tu progresses.\n\nATL (rouge) : fatigue aiguë sur 7j.\n\nTSB (zone verte/rouge) : fraîcheur = CTL − ATL.\n  Vert = frais, Rouge = chargé.\n\nBarres grises : charge TSS journalière.\n\nDrapeaux : tes objectifs / courses.\n\nUtilise les filtres en haut pour zoomer."}
                            />
                        </div>
                    </div>
                    <div className="flex items-center gap-3 text-[10px] text-slate-500 dark:text-slate-400 flex-wrap justify-end">
                        <span className="flex items-center gap-1"><span className="w-3 h-0.5 bg-blue-500 inline-block" />CTL</span>
                        <span className="flex items-center gap-1"><span className="w-3 h-0.5 inline-block" style={{ borderTop: '2px dashed #ef4444', width: 12, height: 0 }} />ATL</span>
                        <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm inline-block" style={{ background: 'linear-gradient(180deg, #22c55e40 0%, #ef444440 100%)' }} />TSB</span>
                        <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm bg-slate-600 inline-block opacity-40" />TSS</span>
                    </div>
                </div>

                {/* PMC mini-stats */}
                {pmcStats && (
                    <div className="flex items-center gap-4 mb-3 text-[10px] text-slate-500 dark:text-slate-400">
                        <span>
                            CTL {pmcStats.ctlDelta >= 0 ? '+' : ''}{pmcStats.ctlDelta.toFixed(1)} sur la période
                        </span>
                        <span>TSB min <strong className="text-red-400">{pmcStats.minTSB}</strong></span>
                        <span>TSB max <strong className="text-emerald-400">{pmcStats.maxTSB}</strong></span>
                        <span>TSS moy/j <strong className="text-slate-300">{pmcStats.avgTSS}</strong></span>
                    </div>
                )}

                {pmcData.length > 0 ? (
                    <ResponsiveContainer width="100%" height={240}>
                        <ComposedChart data={pmcData} margin={{ top: 5, right: 5, bottom: 0, left: -20 }}>
                            <defs>
                                <linearGradient id="tsbGradient" x1="0" y1="0" x2="0" y2="1">
                                    <stop offset="0%" stopColor="#22c55e" stopOpacity={0.25} />
                                    <stop offset={`${tsbGradientOffset * 100}%`} stopColor="#22c55e" stopOpacity={0.08} />
                                    <stop offset={`${tsbGradientOffset * 100}%`} stopColor="#ef4444" stopOpacity={0.08} />
                                    <stop offset="100%" stopColor="#ef4444" stopOpacity={0.25} />
                                </linearGradient>
                                <linearGradient id="tsbStroke" x1="0" y1="0" x2="0" y2="1">
                                    <stop offset={`${tsbGradientOffset * 100}%`} stopColor="#22c55e" />
                                    <stop offset={`${tsbGradientOffset * 100}%`} stopColor="#ef4444" />
                                </linearGradient>
                            </defs>
                            <CartesianGrid strokeDasharray="3 3" stroke={theme === 'dark' ? '#1e293b' : '#e2e8f0'} vertical={false} />
                            <XAxis
                                dataKey="date"
                                tickFormatter={formatPMCTick}
                                tick={{ fontSize: 9, fill: '#475569' }}
                                interval="preserveStartEnd"
                                axisLine={false}
                                tickLine={false}
                            />
                            <YAxis
                                yAxisId="load"
                                tick={{ fontSize: 9, fill: '#475569' }}
                                axisLine={false}
                                tickLine={false}
                                domain={[0, 'auto']}
                            />
                            <YAxis
                                yAxisId="tss"
                                orientation="right"
                                tick={{ fontSize: 9, fill: '#475569' }}
                                axisLine={false}
                                tickLine={false}
                                domain={['auto', 'auto']}
                            />
                            <Tooltip content={<PMCTooltipContent />} />
                            {/* Daily TSS bars */}
                            <Bar dataKey="tss" yAxisId="tss" fill="#334155" opacity={0.3} radius={[2, 2, 0, 0]} />
                            {/* TSB area with green/red gradient */}
                            <Area
                                dataKey="tsb"
                                yAxisId="tss"
                                fill="url(#tsbGradient)"
                                stroke="url(#tsbStroke)"
                                strokeWidth={1.5}
                                activeDot={false}
                            />
                            {/* CTL (fitness) */}
                            <Line dataKey="ctl" yAxisId="load" stroke="#3b82f6" strokeWidth={2.5} dot={false} />
                            {/* ATL (fatigue) */}
                            <Line dataKey="atl" yAxisId="load" stroke="#ef4444" strokeWidth={2} dot={false} strokeDasharray="4 3" />
                            {/* Zero TSB reference line */}
                            <ReferenceLine y={0} yAxisId="tss" stroke={theme === 'dark' ? '#475569' : '#94a3b8'} strokeDasharray="3 3" strokeWidth={1} />
                            {/* Objective markers */}
                            {pmcObjectives.map(obj => (
                                <ReferenceLine
                                    key={obj.id ?? obj.name}
                                    x={obj.date}
                                    yAxisId="load"
                                    stroke={obj.priority === 'principale' ? '#f59e0b' : '#8b5cf6'}
                                    strokeDasharray="4 2"
                                    strokeWidth={1.5}
                                    label={{
                                        value: `🏁 ${obj.name}`,
                                        position: 'top',
                                        fill: obj.priority === 'principale' ? '#f59e0b' : '#8b5cf6',
                                        fontSize: 9,
                                        fontWeight: 600,
                                    }}
                                />
                            ))}
                        </ComposedChart>
                    </ResponsiveContainer>
                ) : (
                    <div className="h-48 flex items-center justify-center">
                        <p className="text-slate-500 text-sm">Pas encore assez de données</p>
                    </div>
                )}
            </Card>
            </FeatureGate>

            {/* ── WEEKLY TSS + COMPLIANCE ──────────────────────────────── */}
            <FeatureGate feature="advanced-stats" mode="blur" label="Charge hebdomadaire">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">

                {/* Weekly TSS Bars */}
                <Card className="md:col-span-2 p-4 md:p-6">
                    <div className="flex items-center gap-1.5 mb-4">
                        <h3 className="text-sm font-semibold text-slate-900 dark:text-white">Charge hebdomadaire (TSS)</h3>
                        <InfoTooltip
                            title="Charge hebdomadaire"
                            content={"Barres foncées : TSS planifié.\nBarres colorées : TSS réalisé.\n\n90-110% du planifié → optimal\n<70% → semaine sous-chargée\n>120% → risque de surcharge\n\nUne semaine légère (récup) tous les 3-4 est normale et nécessaire."}
                        />
                    </div>
                    {weeklyData.some(w => w.planned > 0 || w.actual > 0) ? (
                        <ResponsiveContainer width="100%" height={160}>
                            <BarChart data={weeklyData} barGap={2} margin={{ top: 0, right: 5, bottom: 0, left: -25 }}>
                                <CartesianGrid strokeDasharray="3 3" stroke={theme === 'dark' ? '#1e293b' : '#e2e8f0'} vertical={false} />
                                <XAxis dataKey="weekLabel" tick={{ fontSize: 9, fill: '#475569' }} axisLine={false} tickLine={false} />
                                <YAxis tick={{ fontSize: 9, fill: '#475569' }} axisLine={false} tickLine={false} />
                                <Tooltip content={<WeeklyTooltipContent />} />
                                <Bar dataKey="planned" name="planned" fill={theme === 'dark' ? '#1e293b' : '#e2e8f0'} radius={[3, 3, 0, 0]} />
                                <Bar dataKey="actual" name="actual" fill={accentColor} radius={[3, 3, 0, 0]} opacity={0.9} />
                            </BarChart>
                        </ResponsiveContainer>
                    ) : (
                        <div className="h-40 flex items-center justify-center">
                            <p className="text-slate-500 text-sm">Aucun plan de charge enregistré</p>
                        </div>
                    )}
                    <div className="flex items-center gap-4 mt-2 text-[10px] text-slate-500 dark:text-slate-400">
                        <span className="flex items-center gap-1.5"><span className="w-3 h-2 rounded-sm bg-slate-200 dark:bg-slate-700 inline-block" />Planifié</span>
                        <span className="flex items-center gap-1.5"><span className="w-3 h-2 rounded-sm inline-block" style={{ backgroundColor: accentColor }} />Réalisé</span>
                    </div>
                </Card>

                {/* Compliance Gauge */}
                <Card className="p-4 md:p-6 flex flex-col items-center justify-center gap-4">
                    <div className="flex items-center gap-1.5 self-start">
                        <p className="text-[10px] text-slate-500 uppercase tracking-wider">Réalisation</p>
                        <InfoTooltip
                            title="Taux de réalisation"
                            content={"% des séances planifiées (passées) effectivement réalisées.\n\nRPE moyen : effort perçu de 1 (très facile) à 10 (maximal). >7 régulièrement = fatigue accumulée.\n\nIntensité TSS/h : charge par heure. Utile pour comparer des semaines de volumes différents."}
                        />
                    </div>
                    <ComplianceGauge value={kpis.complianceRate} theme={theme} />
                    <div className="w-full space-y-2">
                        <div className="flex justify-between text-[10px]">
                            <span className="text-slate-500 dark:text-slate-400">Complétées</span>
                            <span className="text-emerald-400 font-semibold">{kpis.completedCount}</span>
                        </div>
                        <div className="flex justify-between text-[10px]">
                            <span className="text-slate-500 dark:text-slate-400">Manquées</span>
                            <span className="text-red-400 font-semibold">{kpis.missedCount}</span>
                        </div>
                        {kpis.avgRpe && (
                            <div className="flex justify-between text-[10px]">
                                <span className="text-slate-500 dark:text-slate-400">RPE moyen</span>
                                <span className="text-slate-900 dark:text-white font-semibold">{kpis.avgRpe}/10</span>
                            </div>
                        )}
                        {kpis.intensityFactor > 0 && (
                            <div className="flex justify-between text-[10px]">
                                <span className="text-slate-500 dark:text-slate-400">Intensité (TSS/h)</span>
                                <span className="text-slate-900 dark:text-white font-semibold">{kpis.intensityFactor}</span>
                            </div>
                        )}
                    </div>
                </Card>
            </div>
            </FeatureGate>

            {/* ── SPORT TABS + ZONES ───────────────────────────────────── */}
            <FeatureGate feature="advanced-stats" mode="blur" label="Distribution des efforts">
            <Card className="p-4 md:p-6">
                <div className="flex items-center gap-1.5 mb-4">
                    <h3 className="text-sm font-semibold text-slate-900 dark:text-white">Distribution des efforts</h3>
                    <InfoTooltip
                        title="Distribution des zones"
                        content={"Temps passé dans chaque zone de fréquence cardiaque.\n\nZ1 (gris) : récupération\nZ2 (bleu) : endurance aérobie ← objectif ~70-80%\nZ3 (vert) : tempo (zone grise, à limiter)\nZ4 (ambre) : seuil\nZ5 (rouge) : VO2max\n\nUn bon plan endurance = beaucoup de Z1-Z2, peu de Z3, un peu de Z4-Z5."}
                    />
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    {/* Zone distribution */}
                    <div>
                        <p className="text-[10px] text-slate-500 uppercase tracking-wider mb-3">Zones FC</p>
                        <ZoneDistribution zones={zones} />
                        <div className="mt-3 grid grid-cols-5 gap-1 text-center">
                            {['Récup.', 'Endur.', 'Tempo', 'Seuil', 'VO2'].map((label, i) => (
                                <div key={i}>
                                    <div className="w-full h-1 rounded-full mb-1" style={{ backgroundColor: ZONE_COLORS[i] }} />
                                    <p className="text-[8px] text-slate-500">{label}</p>
                                </div>
                            ))}
                        </div>
                    </div>

                    {/* Sport-specific stats */}
                    <div>
                        <div className="flex items-center gap-1.5 mb-3">
                            <p className="text-[10px] text-slate-500 uppercase tracking-wider">Métriques</p>
                            <InfoTooltip
                                title="Métriques sport"
                                content={"Données clés de performance pour le sport sélectionné.\n\nVélo : IF > 0.85 = séance intense. NP > AP = effort irrégulier.\n\nCourse : cadence cible >170 spm. Allure comparée à la VMA.\n\nNatation : SWOLF = nb de coups + longueur. Plus il baisse, plus tu es efficace."}
                            />
                        </div>
                        <SportSpecificStats workouts={filteredWorkouts} sport={sportFilter} profile={profile} />
                    </div>
                </div>
            </Card>
            </FeatureGate>

            {/* ── OBJECTIVES TIMELINE ───────────────────────────────────── */}
            {upcomingObjectives.length > 0 && (
                <Card className="p-4 md:p-6">
                    <div className="flex items-center justify-between mb-4">
                        <div className="flex items-center gap-1.5">
                            <CalendarDays size={16} className="text-amber-600 dark:text-amber-400" />
                            <h3 className="text-sm font-semibold text-slate-900 dark:text-white">Objectifs</h3>
                            <InfoTooltip
                                title="Objectifs course"
                                content={"Tes prochaines compétitions classées par date.\n\nA-Race : objectif principal de la saison. Ton plan est construit autour.\n\nLe compte à rebours t'aide à calibrer ta fraîcheur (TSB cible : +5 à +15 le jour J).\n\nGère les secondaires comme des répétitions sans taper dans les réserves."}
                            />
                        </div>
                        <span className="text-[10px] text-slate-500">{upcomingObjectives.length} course{upcomingObjectives.length > 1 ? 's' : ''}</span>
                    </div>
                    <div className="flex gap-3 overflow-x-auto pb-2 snap-x snap-mandatory scrollbar-none">
                        {upcomingObjectives.map(obj => (
                            <ObjectiveCard key={obj.id} obj={obj} />
                        ))}
                    </div>
                </Card>
            )}
        </div>
    );
};

// ── SPORT SPECIFIC STATS ────────────────────────────────────────────────────

function SportSpecificStats({ workouts, sport, profile }: {
    workouts: Workout[];
    sport: SportFilter;
    profile: Profile;
}) {
    const completed = workouts.filter(w => w.status === 'completed' && w.completedData);

    if (completed.length === 0) {
        return <p className="text-xs text-slate-500 italic">Aucune séance complétée sur cette période</p>;
    }

    // Cycling stats
    if (sport === 'cycling') {
        const cyclingDone = completed.filter(w => w.sportType === 'cycling');
        if (cyclingDone.length === 0) return <p className="text-xs text-slate-500 italic">Aucune séance vélo</p>;

        const avgPowers = cyclingDone.map(w => w.completedData?.metrics?.cycling?.avgPowerWatts).filter(Boolean) as number[];
        const npValues = cyclingDone.map(w => w.completedData?.metrics?.cycling?.normalizedPowerWatts).filter(Boolean) as number[];
        const elevations = cyclingDone.map(w => w.completedData?.metrics?.cycling?.elevationGainMeters).filter(Boolean) as number[];
        const ftp = profile.cycling?.Test?.ftp;

        return (
            <div className="space-y-2">
                {ftp && <StatRow label="FTP" value={`${ftp} W`} />}
                {avgPowers.length > 0 && <StatRow label="Puissance moy." value={`${Math.round(avgPowers.reduce((a, b) => a + b) / avgPowers.length)} W`} />}
                {npValues.length > 0 && <StatRow label="Puissance norm." value={`${Math.round(npValues.reduce((a, b) => a + b) / npValues.length)} W`} />}
                {ftp && npValues.length > 0 && <StatRow label="IF moyen" value={`${(npValues.reduce((a, b) => a + b) / npValues.length / ftp).toFixed(2)}`} />}
                {elevations.length > 0 && <StatRow label="Dénivelé total" value={`${Math.round(elevations.reduce((a, b) => a + b))} m`} />}
                <StatRow label="Séances" value={`${cyclingDone.length}`} />
            </div>
        );
    }

    // Running stats
    if (sport === 'running') {
        const runDone = completed.filter(w => w.sportType === 'running');
        if (runDone.length === 0) return <p className="text-xs text-slate-500 italic">Aucune séance course</p>;

        const cadences = runDone.map(w => w.completedData?.metrics?.running?.avgCadenceSPM).filter(Boolean) as number[];
        const elevations = runDone.map(w => w.completedData?.metrics?.running?.elevationGainMeters).filter(Boolean) as number[];
        const paces = runDone.map(w => w.completedData?.metrics?.running?.avgPaceMinPerKm).filter(Boolean) as string[];
        const vma = profile.running?.Test?.vma;

        return (
            <div className="space-y-2">
                {vma && <StatRow label="VMA" value={`${vma} km/h`} />}
                {paces.length > 0 && <StatRow label="Allure moy." value={`${paces[Math.floor(paces.length / 2)]} /km`} />}
                {cadences.length > 0 && <StatRow label="Cadence moy." value={`${Math.round(cadences.reduce((a, b) => a + b) / cadences.length)} spm`} />}
                {elevations.length > 0 && <StatRow label="Dénivelé total" value={`${Math.round(elevations.reduce((a, b) => a + b))} m`} />}
                <StatRow label="Séances" value={`${runDone.length}`} />
            </div>
        );
    }

    // Swimming stats
    if (sport === 'swimming') {
        const swimDone = completed.filter(w => w.sportType === 'swimming');
        if (swimDone.length === 0) return <p className="text-xs text-slate-500 italic">Aucune séance natation</p>;

        const swolfs = swimDone.map(w => w.completedData?.metrics?.swimming?.avgSwolf).filter(Boolean) as number[];
        const paces = swimDone.map(w => w.completedData?.metrics?.swimming?.avgPace100m).filter(Boolean) as string[];

        return (
            <div className="space-y-2">
                {paces.length > 0 && <StatRow label="Allure moy." value={`${paces[Math.floor(paces.length / 2)]} /100m`} />}
                {swolfs.length > 0 && <StatRow label="SWOLF moy." value={`${Math.round(swolfs.reduce((a, b) => a + b) / swolfs.length)}`} />}
                <StatRow label="Séances" value={`${swimDone.length}`} />
            </div>
        );
    }

    // All sports summary
    const bySport = {
        cycling: completed.filter(w => w.sportType === 'cycling').length,
        running: completed.filter(w => w.sportType === 'running').length,
        swimming: completed.filter(w => w.sportType === 'swimming').length,
    };

    return (
        <div className="space-y-2">
            {bySport.cycling > 0 && <StatRow label="Séances vélo" value={`${bySport.cycling}`} color="#a855f7" icon={<Bike size={12} />} />}
            {bySport.running > 0 && <StatRow label="Séances course" value={`${bySport.running}`} color="#10b981" icon={<Footprints size={12} />} />}
            {bySport.swimming > 0 && <StatRow label="Séances natation" value={`${bySport.swimming}`} color="#06b6d4" icon={<Waves size={12} />} />}
            <StatRow label="Total séances" value={`${completed.length}`} />
            <div className="pt-1 flex items-center gap-1.5 text-[10px] text-slate-500 dark:text-slate-400">
                <ChevronRight size={10} />
                Filtrez par sport pour plus de détails
            </div>
        </div>
    );
}

function StatRow({ label, value, color, icon }: { label: string; value: string; color?: string; icon?: React.ReactNode }) {
    return (
        <div className="flex items-center justify-between">
            <div className="flex items-center gap-1.5 text-[11px] text-slate-500 dark:text-slate-400">
                {icon && <span style={{ color }}>{icon}</span>}
                {label}
            </div>
            <span className="text-[11px] font-semibold text-slate-900 dark:text-white">{value}</span>
        </div>
    );
}
