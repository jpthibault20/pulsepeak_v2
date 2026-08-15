import Link from 'next/link';
import { SearchX, ChevronLeft } from 'lucide-react';

/**
 * 404 local à la route — bien plus utile que le 404 générique.
 * Cas réels : séance supprimée depuis un autre onglet, plan régénéré (les ids
 * changent), ou lien partagé entre deux comptes.
 */
export default function SeanceNotFound() {
    return (
        <main className="min-h-dvh flex items-center justify-center px-4">
            <div className="w-full max-w-md text-center">
                <SearchX size={40} className="mx-auto mb-5 text-slate-400 dark:text-slate-600" aria-hidden="true" />

                <h1 className="text-xl font-bold text-slate-900 dark:text-white">
                    Séance introuvable
                </h1>
                <p className="mt-2 text-sm text-slate-600 dark:text-slate-400 leading-relaxed">
                    Elle a peut-être été supprimée, ou le plan a été régénéré depuis que ce lien a
                    été créé.
                </p>

                <Link
                    href="/"
                    className="mt-7 h-11 px-5 inline-flex items-center justify-center gap-2 rounded-xl text-sm font-medium text-slate-700 dark:text-slate-200 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors"
                >
                    <ChevronLeft size={15} aria-hidden="true" />
                    Retour à l&apos;agenda
                </Link>
            </div>
        </main>
    );
}
