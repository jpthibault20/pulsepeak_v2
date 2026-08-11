import { cache } from 'react';
import { notFound, redirect } from 'next/navigation';
import type { Metadata } from 'next';

import { createClient } from '@/lib/supabase/server';
import {
    getProfile,
    getWorkoutById,
    getWorkoutNeighbours,
    getWorkoutsOnDate,
    getSameDayWorkouts,
    getWorkoutPlanContext,
} from '@/lib/data/crud';
import { getWorkoutDeviation } from '@/app/actions/schedule/workout-ai';
import { formatDate } from '@/lib/utils';
import {
    buildAppHref,
    buildSeanceQuery,
    isDayParam,
    isMonthParam,
    toSeanceOrigin,
    type CalendarUrlState,
    type SeanceOrigin,
} from '@/lib/calendar-url';

import SeanceShell from './SeanceShell';
import WorkoutDetailClient from './WorkoutDetailClient';

// React.cache dédoublonne la lecture entre generateMetadata et le rendu :
// sans ça, chaque affichage de page ferait deux fois la même requête.
const loadWorkout = cache(async (id: string) => getWorkoutById(id));

type PageProps = {
    params: Promise<{ id: string }>;
    searchParams: Promise<{ from?: string; month?: string; day?: string }>;
};

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
    const { id } = await params;
    try {
        const workout = await loadWorkout(id);
        if (!workout) return { title: 'Séance introuvable' };
        return { title: `${workout.title} — ${formatDate(workout.date)}` };
    } catch {
        // Non authentifié : le titre n'a aucune importance, la page redirigera.
        return { title: 'Séance' };
    }
}

/** Provenance : d'où l'utilisateur vient, pour un retour correct même en deep-link. */
const BACK_TARGETS: Record<SeanceOrigin, { view: string | null; label: string }> = {
    calendar: { view: null,    label: 'Agenda' },
    plan:     { view: 'plan',  label: 'Plan' },
    stats:    { view: 'stats', label: 'Stats' },
};

export default async function SeancePage({ params, searchParams }: PageProps) {
    const { id } = await params;
    const { from, month, day } = await searchParams;

    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) redirect('/auth');

    const profile = await getProfile();

    // Un deep-link court-circuiterait l'onboarding : AppClientWrapper démarre sur
    // l'écran d'accueil tant que le prénom n'est pas renseigné.
    if (!profile?.firstName) redirect('/');

    const workout = await loadWorkout(id);
    // Séance supprimée, plan régénéré (les ids changent), ou lien partagé entre
    // deux comptes : dans tous les cas 404, jamais 403 — on ne révèle pas l'id.
    if (!workout) notFound();

    const [context, neighbours, workoutsOnDate] = await Promise.all([
        getWorkoutPlanContext(workout.id),
        getWorkoutNeighbours(workout.id),
        getWorkoutsOnDate(workout.date),
    ]);

    // Candidats de réattribution Strava : uniquement si le panneau peut s'ouvrir.
    const canUnlink = workout.status === 'completed' && workout.completedData?.source?.type === 'strava';
    const sameDayWorkouts = canUnlink
        ? await getSameDayWorkouts(workout.date, workout.id, workout.sportType)
        : [];

    // Déviation résolue ICI, pas au montage du composant : le calcul écrit en
    // base (cache) et le faire côté client le rejouait à chaque router.refresh().
    let deviation = null;
    if (workout.status === 'completed' && workout.plannedData && workout.completedData?.perceivedEffort != null) {
        try {
            deviation = await getWorkoutDeviation(workout);
        } catch {
            // Non bloquant : la carte signal est simplement absente.
        }
    }

    // L'état du calendrier arrive par l'URL et doit repartir avec le retour :
    // sans lui, revenir d'une séance de juillet rouvrait l'agenda au mois courant.
    const calendar: CalendarUrlState = {
        month: isMonthParam(month) ? month : null,
        day: isDayParam(day) ? day : null,
    };
    const origin = toSeanceOrigin(from);
    const back = BACK_TARGETS[origin];
    const backHref = buildAppHref(back.view, calendar);
    // Query à recoller sur les liens frères (séance préc./suiv.) : la provenance
    // et le mois consulté doivent survivre à la navigation entre séances.
    const seanceQuery = buildSeanceQuery(origin, calendar);

    const breadcrumbParts = [
        context?.blockTheme || context?.blockType,
        context?.weekNumber != null ? `Semaine ${context.weekNumber}` : null,
        formatDate(workout.date),
    ].filter(Boolean);

    return (
        <SeanceShell profile={profile} calendar={calendar}>
            <WorkoutDetailClient
                workout={workout}
                profile={profile}
                context={context}
                deviation={deviation}
                prev={neighbours.prev}
                next={neighbours.next}
                workoutsOnDate={workoutsOnDate}
                sameDayWorkouts={sameDayWorkouts}
                backHref={backHref}
                backLabel={back.label}
                seanceQuery={seanceQuery}
                breadcrumb={breadcrumbParts.join(' · ')}
            />
        </SeanceShell>
    );
}
