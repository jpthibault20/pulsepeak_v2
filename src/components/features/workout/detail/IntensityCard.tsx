import React from 'react';
import { Gauge } from 'lucide-react';
import type { Profile, Workout } from '@/lib/data/DatabaseTypes';
import type { IntensityLevel } from '@/lib/stats/intensityScale';
import { zoneAccent, zoneLabel } from './lap-analysis';
import {
    getIntensityFactor, getZoneDistribution, SOURCE_LABEL, type IntensityScale,
} from './intensity-profile';

/**
 * Couleurs des bandes de la jauge — mêmes familles que les zones
 * (`zoneAccent`) pour qu'un même effort ait la même couleur partout.
 */
const BAND_COLOR: Record<IntensityLevel, string> = {
    'Récupération': 'bg-sky-300/60 dark:bg-sky-500/25',
    'Endurance': 'bg-sky-400/70 dark:bg-sky-500/45',
    'Tempo': 'bg-emerald-500/70 dark:bg-emerald-500/50',
    'Seuil': 'bg-amber-500/75 dark:bg-amber-500/60',
    'VO2max': 'bg-red-500/75 dark:bg-red-500/60',
};

const SOURCE_HINT: Record<'power' | 'hr' | 'pace', string> = {
    power: 'Calculé sur la puissance (NP / FTP) : le signal le plus fiable, insensible à la chaleur et au sommeil.',
    hr: "Calculé sur la fréquence cardiaque, faute de métrique primaire exploitable. L'échelle de lecture est celle de tes zones FC, pas celle de la puissance.",
    pace: "Calculé sur l'allure rapportée à ton allure seuil (0,88 × VMA).",
};

/** Position (0-100 %) d'une valeur sur la jauge. */
function gaugePosition(value: number, scale: IntensityScale): number {
    const clamped = Math.min(Math.max(value, scale.min), scale.max);
    return ((clamped - scale.min) / (scale.max - scale.min)) * 100;
}

/**
 * Intensité de la séance réalisée : à quel pourcentage du seuil elle a été
 * tenue (IF), et comment le temps s'est réparti entre les zones.
 *
 * Réservée au vélo et à la course : ce sont les deux sports où le profil porte
 * un seuil (FTP, VMA) et des zones exploitables. En natation, le CSS n'est
 * renseigné que par un test récent et les zones n'existent pas — la card
 * afficherait un ratio sans échelle de lecture.
 */
export const IntensityCard: React.FC<{ workout: Workout; profile: Profile }> = ({ workout, profile }) => {
    const sport = workout.sportType;
    if (sport !== 'cycling' && sport !== 'running') return null;

    const intensity = getIntensityFactor(workout, profile);
    const distribution = getZoneDistribution(workout, profile);
    if (!intensity && !distribution) return null;

    return (
        <section
            aria-labelledby="intensity-title"
            className="rounded-2xl bg-white dark:bg-slate-800/60 border border-slate-200/80 dark:border-slate-700/50 overflow-hidden"
        >
            <div className="px-4 py-3 flex items-center justify-between gap-2 border-b border-slate-200/80 dark:border-slate-700/50">
                <h2 id="intensity-title" className="text-[10px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider flex items-center gap-1.5">
                    <Gauge size={11} aria-hidden="true" /> Intensité
                </h2>
                {intensity && (
                    <span
                        title={SOURCE_HINT[intensity.source]}
                        className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-slate-100 dark:bg-slate-700/60 text-slate-600 dark:text-slate-300"
                    >
                        {SOURCE_LABEL[intensity.source]}
                    </span>
                )}
            </div>

            {intensity && (
                <div className="px-4 py-3.5">
                    <div className="flex items-baseline justify-between gap-3 mb-2.5">
                        <div className="flex items-baseline gap-2 min-w-0">
                            <span className="text-2xl font-bold font-mono tabular-nums text-slate-900 dark:text-white leading-none">
                                {intensity.value.toFixed(2)}
                            </span>
                            <span className="text-[10px] font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">IF</span>
                        </div>
                        <span className={`text-sm font-semibold truncate ${intensity.accent}`}>{intensity.label}</span>
                    </div>

                    {/* Jauge : les bandes sont celles de l'échelle de la source, et le
                        repère « seuil » donne l'étalon — sans lui, « 0.87 » ne veut
                        rien dire pour qui ne pratique pas l'IF. Les bornes changent
                        avec la source : un IF cardio ne se lit pas sur la même règle
                        qu'un IF puissance. */}
                    <div className="relative h-3.5" aria-hidden="true">
                        <div className="absolute inset-x-0 top-1/2 -translate-y-1/2 flex h-2 rounded-full overflow-hidden">
                            {intensity.scale.bands.map((band) => (
                                <span
                                    key={band.level}
                                    className={BAND_COLOR[band.level]}
                                    style={{ width: `${((band.to - band.from) / (intensity.scale.max - intensity.scale.min)) * 100}%` }}
                                />
                            ))}
                        </div>
                        <span
                            className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-3.5 h-3.5 rounded-full bg-white dark:bg-slate-100 border-2 border-slate-900 dark:border-slate-900 shadow-sm"
                            style={{ left: `${gaugePosition(intensity.value, intensity.scale)}%` }}
                        />
                    </div>
                    <div className="relative h-4 mt-1.5 text-[9px] font-medium text-slate-400 dark:text-slate-500 tabular-nums">
                        <span className="absolute left-0">{intensity.scale.min.toFixed(2)}</span>
                        <span
                            className="absolute -translate-x-1/2 whitespace-nowrap"
                            style={{ left: `${gaugePosition(intensity.scale.thresholdAt, intensity.scale)}%` }}
                        >
                            seuil {intensity.scale.thresholdAt.toFixed(2)}
                        </span>
                        <span className="absolute right-0">{intensity.scale.max.toFixed(2)}</span>
                    </div>

                    {intensity.detail && (
                        <p className="mt-2 text-[11px] text-slate-500 dark:text-slate-400 font-medium">{intensity.detail}</p>
                    )}
                </div>
            )}

            {distribution && (
                <div className={`px-4 py-3.5 ${intensity ? 'border-t border-slate-200/80 dark:border-slate-700/50' : ''}`}>
                    <div className="flex items-center justify-between gap-2 mb-2.5">
                        <h3 className="text-[10px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                            Temps par zone
                        </h3>
                        <span className="text-[10px] font-medium text-slate-400 dark:text-slate-500">
                            {SOURCE_LABEL[distribution.source]}
                            {distribution.fromLaps && ' · estimé sur les tours'}
                        </span>
                    </div>

                    <div className="flex flex-col gap-1.5">
                        {distribution.bars.map((bar) => (
                            <div key={bar.zone} className="grid grid-cols-[1.5rem_1fr_5.5rem] items-center gap-2">
                                <span className="text-[10px] font-bold text-slate-500 dark:text-slate-400 tabular-nums">
                                    {zoneLabel(bar.zone)}
                                </span>
                                <span className="h-2.5 rounded-full bg-slate-100 dark:bg-slate-700/50 overflow-hidden">
                                    <span
                                        className={`block h-full rounded-full ${zoneAccent(bar.zone)}`}
                                        style={{ width: `${Math.max(bar.pct, bar.pct > 0 ? 2 : 0)}%` }}
                                        aria-hidden="true"
                                    />
                                </span>
                                <span className="text-[11px] font-mono tabular-nums text-right text-slate-600 dark:text-slate-300">
                                    {bar.pct > 0 ? `${bar.minutes} min` : '—'}
                                    <span className="ml-1 text-slate-400 dark:text-slate-500">
                                        {bar.pct > 0 ? `${Math.round(bar.pct)}%` : ''}
                                    </span>
                                </span>
                            </div>
                        ))}
                    </div>
                </div>
            )}
        </section>
    );
};
