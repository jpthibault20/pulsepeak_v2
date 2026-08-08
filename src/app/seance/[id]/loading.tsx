/**
 * Squelette calqué sur la géométrie réelle de la page (sub-header, héro, rail),
 * et non un spinner centré : un spinner générique fait clignoter la mise en
 * page au moment où le contenu arrive.
 *
 * Grâce au prefetch des <Link> depuis le calendrier, il sera rarement vu.
 */
export default function Loading() {
    return (
        <div className="flex flex-col min-h-dvh">
            <div className="sticky top-0 z-50 h-14 bg-white/95 dark:bg-slate-950/90 backdrop-blur-xl border-b border-slate-200/80 dark:border-white/6" />

            <main className="flex-1 w-full max-w-6xl mx-auto px-3 sm:px-6 lg:px-8 py-4 sm:py-6" aria-busy="true" aria-label="Chargement de la séance">
                {/* Sub-header */}
                <div className="h-12 flex items-center justify-between border-b border-slate-200/80 dark:border-white/6 mb-5">
                    <Bar className="w-32" />
                    <Bar className="w-24" />
                </div>

                <div className="lg:grid lg:grid-cols-[minmax(0,1fr)_20rem] lg:gap-6 lg:items-start animate-pulse motion-reduce:animate-none">
                    <div className="flex flex-col gap-5">
                        {/* Héro */}
                        <div className="p-5 rounded-2xl bg-white dark:bg-slate-900/60 border border-slate-200/80 dark:border-slate-800">
                            <div className="flex gap-2 mb-4">
                                <Bar className="w-20 h-5" />
                                <Bar className="w-16 h-5" />
                            </div>
                            <Bar className="w-3/5 h-7 mb-3" />
                            <Bar className="w-40" />
                            <div className="flex gap-4 mt-4 pt-3 border-t border-slate-200/60 dark:border-slate-700/40">
                                <Bar className="w-16" />
                                <Bar className="w-16" />
                                <Bar className="w-16" />
                            </div>
                        </div>

                        {/* Métriques */}
                        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
                            {Array.from({ length: 6 }).map((_, i) => (
                                <div key={i} className="h-[70px] rounded-xl bg-slate-200/70 dark:bg-slate-800" />
                            ))}
                        </div>
                    </div>

                    {/* Rail */}
                    <div className="mt-5 lg:mt-0 flex flex-col gap-4">
                        <div className="h-32 rounded-2xl bg-slate-200/70 dark:bg-slate-800" />
                        <div className="h-40 rounded-2xl bg-slate-200/70 dark:bg-slate-800" />
                    </div>
                </div>
            </main>
        </div>
    );
}

const Bar: React.FC<{ className?: string }> = ({ className = '' }) => (
    <div className={`h-4 rounded-lg bg-slate-200/70 dark:bg-slate-800 ${className}`} />
);
