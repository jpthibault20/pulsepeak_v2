'use client';

import { useCallback } from 'react';
import { useSearchParams } from 'next/navigation';
import { buildSeanceHref, type SeanceOrigin } from '@/lib/calendar-url';

/**
 * Construit les liens vers /seance/[id] en reconduisant l'état calendrier
 * (`month`/`day`) lu dans l'URL courante.
 *
 * C'est ce report qui permet au bouton retour de la séance de retomber sur le
 * mois consulté plutôt que sur le mois courant.
 */
export function useSeanceHref(from: SeanceOrigin): (workoutId: string) => string {
    const searchParams = useSearchParams();
    const month = searchParams.get('month');
    const day = searchParams.get('day');

    return useCallback(
        (workoutId: string) => buildSeanceHref(workoutId, from, { month, day }),
        [from, month, day],
    );
}
