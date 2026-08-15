import React from 'react';
import type { MetricTile } from './shared';

/**
 * Grille des métriques réalisées.
 * 2 colonnes sur mobile — en 3 colonnes les valeurs longues (« 2:07:14 »)
 * étaient tronquées sur les petits écrans.
 */
export const MetricsGrid: React.FC<{ tiles: MetricTile[] }> = ({ tiles }) => {
    if (tiles.length === 0) return null;

    return (
        <section aria-labelledby="metrics-title">
            <h2 id="metrics-title" className="sr-only">Métriques réalisées</h2>
            <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-4 gap-2.5">
                {tiles.map((tile, i) => {
                    const TileIcon = tile.icon;
                    return (
                        <div
                            key={i}
                            className="flex flex-col gap-1.5 p-3 rounded-xl bg-white dark:bg-slate-800/60 border border-slate-200/80 dark:border-slate-700/50"
                        >
                            <div className="flex items-center gap-1.5">
                                <TileIcon size={11} className={tile.accent || 'text-slate-500 dark:text-slate-500'} aria-hidden="true" />
                                <span className="text-[10px] font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">{tile.label}</span>
                            </div>
                            <div className="flex items-baseline gap-1">
                                <span className="text-lg font-bold font-mono tabular-nums text-slate-900 dark:text-white leading-none">{tile.value}</span>
                                {tile.sub && <span className="text-[10px] text-slate-500 dark:text-slate-500 font-medium">{tile.sub}</span>}
                            </div>
                        </div>
                    );
                })}
            </div>
        </section>
    );
};
