'use client';

import React, { useEffect, useRef } from 'react';
import {
    Clock, Zap, CheckCircle, XCircle, CalendarDays, MapPin, Gauge,
} from 'lucide-react';
import type { Workout } from '@/lib/data/DatabaseTypes';
import { Badge } from '@/components/ui/Badge';
import { formatDate } from '@/lib/utils';
import { SPORT_CONFIG, fmtDuration } from './shared';

/**
 * Identité de la séance : sport, type, statut, titre, date, et — pour une
 * séance non réalisée — les cibles chiffrées du plan.
 *
 * Le <h1> porte tabIndex={-1} et prend le focus au changement de séance :
 * l'App Router ne déplace pas le focus de façon fiable, et sans ça un
 * utilisateur clavier reste positionné dans le calendrier après navigation.
 */
export const WorkoutHero: React.FC<{ workout: Workout }> = ({ workout }) => {
    const titleRef = useRef<HTMLHeadingElement>(null);

    useEffect(() => {
        titleRef.current?.focus({ preventScroll: true });
    }, [workout.id]);

    const sportConfig = SPORT_CONFIG[workout.sportType] ?? SPORT_CONFIG.other;
    const SportIcon = sportConfig.icon;
    const isCompleted = workout.status === 'completed';
    const isMissed = workout.status === 'missed';
    const isPending = !isCompleted && !isMissed;
    const isStravaSource = workout.completedData?.source?.type === 'strava';
    const planned = workout.plannedData;

    return (
        <div className={`relative p-5 rounded-2xl bg-white dark:bg-slate-900/60 border border-slate-200/80 dark:border-slate-800 shadow-sm overflow-hidden ${isMissed ? 'grayscale-[0.35]' : ''}`}>
            <div className={`absolute inset-0 bg-gradient-to-br ${sportConfig.gradient} pointer-events-none`} aria-hidden="true" />

            <div className="relative">
                {/* Badges */}
                <div className="flex flex-wrap items-center gap-2 mb-3">
                    <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold ${sportConfig.color} ${sportConfig.bgLight}`}>
                        <SportIcon size={13} aria-hidden="true" />
                        {sportConfig.label}
                    </span>
                    {workout.workoutType && <Badge type={workout.workoutType} />}
                    {workout.mode && (
                        <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400 border border-slate-200/60 dark:border-slate-700">
                            {workout.mode}
                        </span>
                    )}
                    {isCompleted && (
                        <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-emerald-100 dark:bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 animate-in zoom-in-50 duration-300 motion-reduce:animate-none">
                            <CheckCircle size={10} aria-hidden="true" /> Fait
                        </span>
                    )}
                    {isMissed && (
                        <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-red-100 dark:bg-red-500/10 text-red-600 dark:text-red-400">
                            <XCircle size={10} aria-hidden="true" /> Raté
                        </span>
                    )}
                </div>

                <h1
                    ref={titleRef}
                    tabIndex={-1}
                    className={`text-xl md:text-2xl font-bold leading-tight mb-1.5 outline-none text-balance ${isMissed ? 'text-slate-500 dark:text-slate-500' : 'text-slate-900 dark:text-white'}`}
                >
                    {workout.title}
                </h1>

                <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                    <p className="text-sm text-slate-500 dark:text-slate-400 flex items-center gap-1.5">
                        <CalendarDays size={14} aria-hidden="true" />
                        {formatDate(workout.date)}
                    </p>
                    {isStravaSource && workout.completedData?.source?.stravaUrl && (
                        <a
                            href={workout.completedData.source.stravaUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1 text-xs font-medium text-orange-600 hover:text-orange-700 dark:text-orange-400 dark:hover:text-orange-300 transition-colors"
                        >
                            Voir sur Strava
                        </a>
                    )}
                </div>

                {/* Cibles du plan — conservées sur une séance ratée, en « non tenu » */}
                {(isPending || isMissed) && planned && (
                    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 mt-4 pt-3 border-t border-slate-200/60 dark:border-slate-700/40">
                        {planned.durationMinutes && (
                            <div className="flex items-center gap-1.5 text-sm">
                                <Clock size={14} className="text-slate-500 dark:text-slate-400" aria-hidden="true" />
                                <span className="font-bold tabular-nums text-slate-900 dark:text-white">{fmtDuration(planned.durationMinutes)}</span>
                            </div>
                        )}
                        {planned.plannedTSS != null && planned.plannedTSS > 0 && (
                            <div className="flex items-center gap-1.5 text-sm">
                                <Zap size={14} className="text-amber-500" aria-hidden="true" />
                                <span className="font-bold tabular-nums text-slate-900 dark:text-white">{planned.plannedTSS} <span className="font-normal text-slate-500 dark:text-slate-400 text-xs">TSS</span></span>
                            </div>
                        )}
                        {planned.distanceKm != null && planned.distanceKm > 0 && (
                            <div className="flex items-center gap-1.5 text-sm">
                                <MapPin size={14} className="text-slate-500 dark:text-slate-400" aria-hidden="true" />
                                <span className="font-bold tabular-nums text-slate-900 dark:text-white">{planned.distanceKm} <span className="font-normal text-slate-500 dark:text-slate-400 text-xs">km</span></span>
                            </div>
                        )}
                        {planned.targetPowerWatts != null && (
                            <div className="flex items-center gap-1.5 text-sm">
                                <Gauge size={14} className="text-purple-500" aria-hidden="true" />
                                <span className="font-bold tabular-nums text-slate-900 dark:text-white">{planned.targetPowerWatts} <span className="font-normal text-slate-500 dark:text-slate-400 text-xs">W cible</span></span>
                            </div>
                        )}
                        {planned.targetPaceMinPerKm != null && (
                            <div className="flex items-center gap-1.5 text-sm">
                                <Gauge size={14} className="text-orange-500" aria-hidden="true" />
                                <span className="font-bold tabular-nums text-slate-900 dark:text-white">{planned.targetPaceMinPerKm} <span className="font-normal text-slate-500 dark:text-slate-400 text-xs">/km cible</span></span>
                            </div>
                        )}
                        {isMissed && (
                            <span className="text-xs text-slate-500 dark:text-slate-500 italic">(prévu, non tenu)</span>
                        )}
                    </div>
                )}
            </div>
        </div>
    );
};
