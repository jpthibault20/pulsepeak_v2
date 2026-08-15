'use client';

import { useEffect } from 'react';
import Link from 'next/link';
import { AlertTriangle, RefreshCw, ChevronLeft } from 'lucide-react';

export default function SeanceError({
    error,
    reset,
}: {
    error: Error & { digest?: string };
    reset: () => void;
}) {
    useEffect(() => {
        console.error('Erreur page séance:', error);
    }, [error]);

    return (
        <main className="min-h-dvh flex items-center justify-center px-4">
            <div className="w-full max-w-md text-center">
                <AlertTriangle size={40} className="mx-auto mb-5 text-amber-500" aria-hidden="true" />

                <h1 className="text-xl font-bold text-slate-900 dark:text-white">
                    Impossible de charger cette séance
                </h1>
                <p className="mt-2 text-sm text-slate-600 dark:text-slate-400">
                    Vérifie ta connexion et réessaie.
                </p>

                <div className="mt-7 flex flex-col sm:flex-row gap-2 justify-center">
                    <button
                        onClick={reset}
                        className="h-11 px-5 inline-flex items-center justify-center gap-2 rounded-xl text-sm font-medium text-white bg-slate-800 dark:bg-slate-200 dark:text-slate-900 hover:bg-slate-700 dark:hover:bg-slate-300 transition-colors"
                    >
                        <RefreshCw size={15} aria-hidden="true" />
                        Réessayer
                    </button>
                    <Link
                        href="/"
                        className="h-11 px-5 inline-flex items-center justify-center gap-2 rounded-xl text-sm font-medium text-slate-700 dark:text-slate-200 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors"
                    >
                        <ChevronLeft size={15} aria-hidden="true" />
                        Retour à l&apos;agenda
                    </Link>
                </div>
            </div>
        </main>
    );
}
