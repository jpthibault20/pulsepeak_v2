'use client';

import React, { useMemo, useState } from 'react';
import { Activity, ChevronDown, ChevronUp } from 'lucide-react';
import type { SportType, CompletedLap } from '@/lib/data/type';
import type { Profile } from '@/lib/data/DatabaseTypes';
import { fmtDurationSec } from './shared';
import {
    analyzeLaps, segmentLaps, isAutoSplit, zoneAccent, zoneLabel, fmtPace,
    type AnalyzedLap, type LapSegment,
} from './lap-analysis';

interface Props {
    laps: CompletedLap[];
    sport: SportType;
    profile: Profile;
    /** Le vélo en extérieur n'a pas de vitesse exploitable (vent, pente). */
    mode: 'Indoor' | 'Outdoor' | null;
}

export const LapsSection: React.FC<Props> = ({ laps, sport, profile, mode }) => {
    const [expanded, setExpanded] = useState(false);

    const { segments, autoSplit } = useMemo(() => {
        const analyzed = analyzeLaps(laps ?? [], sport, profile);
        const auto = isAutoSplit(laps ?? []);
        return {
            autoSplit: auto,
            // Sur des splits automatiques il n'y a pas de structure à lire :
            // on rend la liste brute plutôt que d'inventer des séries.
            segments: auto
                ? [{ kind: 'list' as const, laps: analyzed }]
                : segmentLaps(analyzed),
        };
    }, [laps, sport, profile]);

    if (!laps || laps.length === 0) return null;

    // Nombre de tours masqués tant que la section est repliée : les séries sont
    // fermées, les listes ne montrent que leurs 3 premiers tours.
    const hiddenCount = laps.length - segments.reduce((n, s) => {
        if (s.kind === 'series') return n;
        if (s.kind === 'list') return n + Math.min(3, s.laps.length);
        return n + s.laps.length;
    }, 0);

    return (
        <section aria-labelledby="laps-title">
            <h2 id="laps-title" className="text-sm font-bold text-slate-900 dark:text-white flex items-center gap-2 mb-3">
                <Activity size={15} className="text-slate-500 dark:text-slate-400" aria-hidden="true" />
                {autoSplit ? 'Splits' : 'Tours'}
                <span className="text-xs font-normal text-slate-500 dark:text-slate-400">({laps.length})</span>
            </h2>

            <div className="flex flex-col gap-2">
                {segments.map((seg, i) => (
                    <SegmentBlock
                        key={i}
                        segment={seg}
                        sport={sport}
                        mode={mode}
                        forceOpen={expanded}
                    />
                ))}
            </div>

            {/* Le dépliage se commande depuis le bas, à l'endroit exact où le
                contenu s'arrête — pas depuis un coin de l'en-tête. */}
            {(hiddenCount > 0 || expanded) && (
                <button
                    onClick={() => setExpanded(!expanded)}
                    aria-expanded={expanded}
                    className="w-full mt-2 min-h-11 flex items-center justify-center gap-1 text-xs font-medium text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 transition-colors"
                >
                    {expanded ? 'Réduire' : `+ ${hiddenCount} de plus`}
                    {expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                </button>
            )}
        </section>
    );
};

// ─── Segment ──────────────────────────────────────────────────────────────────

const SegmentBlock: React.FC<{
    segment: LapSegment;
    sport: SportType;
    mode: 'Indoor' | 'Outdoor' | null;
    forceOpen: boolean;
}> = ({ segment, sport, mode, forceOpen }) => {
    const [open, setOpen] = useState(false);
    const isOpen = forceOpen || open;

    // Échauffement / retour au calme : une ligne muette, jamais dépliée par défaut.
    if (segment.kind === 'warmup' || segment.kind === 'cooldown') {
        const it = segment.laps[0];
        return (
            <div className="flex items-center gap-3 px-3.5 py-2 rounded-xl bg-slate-50 dark:bg-slate-800/30 border border-slate-200/60 dark:border-slate-700/40">
                <span className="text-xs font-medium text-slate-500 dark:text-slate-400 shrink-0">
                    {segment.kind === 'warmup' ? 'Échauffement' : 'Retour au calme'}
                </span>
                <span className="flex-1 flex flex-wrap items-center gap-x-3 gap-y-1 justify-end text-xs text-slate-500 dark:text-slate-400">
                    <span className="font-mono tabular-nums">{fmtDurationSec(it.lap.durationSeconds)}</span>
                    <PrimaryMetric item={it} sport={sport} mode={mode} muted />
                    {zoneLabel(it.zone) && <span>{zoneLabel(it.zone)}</span>}
                </span>
            </div>
        );
    }

    if (segment.kind === 'series') {
        return (
            <div className="rounded-xl border border-slate-200/80 dark:border-slate-700/50 overflow-hidden">
                <button
                    onClick={() => setOpen(!open)}
                    aria-expanded={isOpen}
                    className="w-full px-3.5 py-2.5 min-h-11 flex items-center justify-between gap-3 bg-white dark:bg-slate-800/60 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors text-left"
                >
                    <span className="flex items-center gap-2 min-w-0">
                        <span className={`w-1 h-8 rounded-full shrink-0 ${zoneAccent(segment.zone ?? null)}`} aria-hidden="true" />
                        <span className="min-w-0">
                            <span className="block text-sm font-bold text-slate-900 dark:text-white tabular-nums">
                                {segment.repCount} × {fmtDurationSec(segment.repDurationSec ?? 0)}
                                {zoneLabel(segment.zone ?? null) && (
                                    <span className="ml-1.5 font-medium text-slate-500 dark:text-slate-400">
                                        @ {zoneLabel(segment.zone ?? null)}
                                    </span>
                                )}
                            </span>
                            <span className="block text-[11px] text-slate-500 dark:text-slate-400">
                                {segment.laps.filter(l => l.role === 'recovery').length > 0
                                    ? `${segment.laps.filter(l => l.role === 'recovery').length} récupération(s)`
                                    : 'sans récupération enregistrée'}
                            </span>
                        </span>
                    </span>
                    <span className="shrink-0 text-slate-400">
                        {isOpen ? <ChevronUp size={15} /> : <ChevronDown size={15} />}
                    </span>
                </button>

                {isOpen && (
                    <div className="border-t border-slate-200/80 dark:border-slate-700/50 divide-y divide-slate-200/60 dark:divide-slate-700/40">
                        {segment.laps.map((it, i) => (
                            <LapRow key={it.lap.index ?? i} item={it} sport={sport} mode={mode} />
                        ))}
                    </div>
                )}
            </div>
        );
    }

    // Liste simple (splits auto, séance continue, ou trop peu de répétitions)
    return (
        <div className="rounded-xl border border-slate-200/80 dark:border-slate-700/50 overflow-hidden divide-y divide-slate-200/60 dark:divide-slate-700/40">
            {(forceOpen ? segment.laps : segment.laps.slice(0, 3)).map((it, i) => (
                <LapRow key={it.lap.index ?? i} item={it} sport={sport} mode={mode} />
            ))}
        </div>
    );
};

// ─── Ligne de tour ────────────────────────────────────────────────────────────

const LapRow: React.FC<{
    item: AnalyzedLap;
    sport: SportType;
    mode: 'Indoor' | 'Outdoor' | null;
}> = ({ item, sport, mode }) => {
    const { lap, role, zone } = item;

    // Récupération : demi-hauteur, gris, et uniquement l'info utile — la
    // puissance moyenne d'une récup inclut les zéros de roue libre, elle ne veut
    // rien dire.
    if (role === 'recovery') {
        return (
            <div className="flex items-center gap-3 px-3.5 py-1.5 bg-slate-50/60 dark:bg-slate-900/20">
                <span className="w-1 h-4 rounded-full shrink-0 bg-slate-200 dark:bg-slate-700" aria-hidden="true" />
                <span className="text-[11px] text-slate-500 dark:text-slate-500 shrink-0">récup</span>
                <span className="flex-1 flex items-center justify-end gap-3 text-[11px] text-slate-500 dark:text-slate-500">
                    <span className="font-mono tabular-nums">{fmtDurationSec(lap.durationSeconds)}</span>
                    {lap.avgHeartRate != null && <span className="tabular-nums">FC {lap.avgHeartRate}</span>}
                </span>
            </div>
        );
    }

    const isWork = role === 'work';

    return (
        <div className={`flex items-center gap-3 px-3.5 ${isWork ? 'py-2.5' : 'py-2'} bg-white dark:bg-slate-800/40`}>
            <span className={`w-1 ${isWork ? 'h-7' : 'h-5'} rounded-full shrink-0 ${zoneAccent(zone)}`} aria-hidden="true" />

            <span className={`shrink-0 tabular-nums ${isWork ? 'text-xs font-semibold text-slate-700 dark:text-slate-200' : 'text-[11px] text-slate-500 dark:text-slate-400'}`}>
                {lap.index}
            </span>

            <span className="flex-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 min-w-0">
                <span className={`font-mono tabular-nums ${isWork ? 'text-sm font-bold text-slate-900 dark:text-white' : 'text-xs text-slate-600 dark:text-slate-300'}`}>
                    {fmtDurationSec(lap.durationSeconds)}
                </span>

                <PrimaryMetric item={item} sport={sport} mode={mode} />

                {/* La FC sous 90 s est faussée par le délai cardiaque : on montre le pic. */}
                {lap.durationSeconds >= 90 && lap.avgHeartRate != null && (
                    <span className="text-xs text-rose-600 dark:text-rose-400 tabular-nums">{lap.avgHeartRate} bpm</span>
                )}
                {lap.durationSeconds < 90 && lap.maxHeartRate != null && (
                    <span className="text-xs text-rose-600/80 dark:text-rose-400/80 tabular-nums">
                        max {lap.maxHeartRate} bpm
                    </span>
                )}

                {/* Cadence vélo : seulement hors de la plage neutre 60-100 rpm,
                    où elle traduit une intention (force basse cadence, vélocité). */}
                {sport === 'cycling' && lap.avgCadence != null && (lap.avgCadence < 60 || lap.avgCadence > 100) && (
                    <span className="text-xs text-slate-500 dark:text-slate-400 tabular-nums">{lap.avgCadence} rpm</span>
                )}
            </span>

            {zoneLabel(zone) && (
                <span className={`shrink-0 text-[10px] font-semibold tabular-nums ${isWork ? 'text-slate-600 dark:text-slate-300' : 'text-slate-500 dark:text-slate-500'}`}>
                    {zoneLabel(zone)}
                </span>
            )}
        </div>
    );
};

/**
 * La métrique principale, propre à chaque sport.
 * - course : allure min/km — un coureur ne pense jamais en km/h
 * - natation : allure /100 m
 * - vélo : puissance ; la vitesse n'est gardée qu'en intérieur, dehors elle
 *   mesure le vent et la pente, pas l'athlète
 */
const PrimaryMetric: React.FC<{
    item: AnalyzedLap;
    sport: SportType;
    mode: 'Indoor' | 'Outdoor' | null;
    muted?: boolean;
}> = ({ item, sport, mode, muted }) => {
    const { lap, paceSecPerKm, paceSecPer100m } = item;
    const cls = muted
        ? 'text-xs text-slate-500 dark:text-slate-400 tabular-nums'
        : 'text-xs font-medium text-slate-700 dark:text-slate-200 tabular-nums';

    if (sport === 'running' && paceSecPerKm) {
        return (
            <>
                <span className={cls}>{fmtPace(paceSecPerKm)} /km</span>
                {lap.distanceMeters > 0 && (
                    <span className="text-xs text-slate-500 dark:text-slate-400 tabular-nums">
                        {(lap.distanceMeters / 1000).toFixed(2)} km
                    </span>
                )}
            </>
        );
    }

    if (sport === 'swimming' && paceSecPer100m) {
        return (
            <>
                <span className={cls}>{fmtPace(paceSecPer100m)} /100m</span>
                {lap.distanceMeters > 0 && (
                    <span className="text-xs text-slate-500 dark:text-slate-400 tabular-nums">
                        {Math.round(lap.distanceMeters)} m
                    </span>
                )}
            </>
        );
    }

    if (sport === 'cycling') {
        return (
            <>
                {lap.avgPower != null && (
                    <span className={muted ? cls : 'text-xs font-semibold text-purple-600 dark:text-purple-400 tabular-nums'}>
                        {lap.avgPower} W
                    </span>
                )}
                {mode === 'Indoor' && lap.avgSpeedKmh != null && (
                    <span className="text-xs text-slate-500 dark:text-slate-400 tabular-nums">
                        {lap.avgSpeedKmh.toFixed(1)} km/h
                    </span>
                )}
            </>
        );
    }

    // Sport « autre » : la distance reste la seule information fiable.
    return lap.distanceMeters > 0 ? (
        <span className={cls}>{(lap.distanceMeters / 1000).toFixed(2)} km</span>
    ) : null;
};
