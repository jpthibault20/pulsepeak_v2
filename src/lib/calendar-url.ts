/**
 * État du calendrier porté par l'URL : `?month=YYYY-MM&day=YYYY-MM-DD`.
 *
 * Ouvrir une séance quitte `/` et démonte AppClientWrapper. Les deux paramètres
 * doivent donc être reconduits à l'aller (liens vers /seance/[id]) ET au retour
 * (bouton « Agenda », nav globale, séance précédente/suivante) : sans ça,
 * l'utilisateur qui consultait juillet revenait sur le mois courant.
 *
 * Helpers volontairement purs (pas de `useSearchParams`) : ils servent aussi
 * bien côté serveur (/seance/[id]/page.tsx) que côté client (hook useSeanceHref).
 */

/** Provenance d'un lien vers une séance, portée par `?from=`. */
export type SeanceOrigin = 'calendar' | 'plan' | 'stats';

export interface CalendarUrlState {
    month?: string | null;
    day?: string | null;
}

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
const DAY_RE = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;

/** Les paramètres viennent de l'URL : on ne consomme que ce qui est parsable. */
export function isMonthParam(value: string | null | undefined): value is string {
    return !!value && MONTH_RE.test(value);
}

export function isDayParam(value: string | null | undefined): value is string {
    return !!value && DAY_RE.test(value);
}

/** Date → paramètre `month` (`YYYY-MM`), en heure locale comme formatDateKey. */
export function formatMonthKey(date: Date): string {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

export function toSeanceOrigin(value: string | null | undefined): SeanceOrigin {
    return value === 'plan' || value === 'stats' ? value : 'calendar';
}

function appendCalendarState(query: URLSearchParams, state: CalendarUrlState): void {
    if (isMonthParam(state.month)) query.set('month', state.month);
    if (isDayParam(state.day)) query.set('day', state.day);
}

/** Lien vers l'app en conservant l'état calendrier. `view` nul = onglet agenda. */
export function buildAppHref(view: string | null, state: CalendarUrlState): string {
    const query = new URLSearchParams();
    if (view) query.set('view', view);
    appendCalendarState(query, state);
    const qs = query.toString();
    return qs ? `/?${qs}` : '/';
}

/** Query des liens vers une séance : `?from=calendar&month=…&day=…`. */
export function buildSeanceQuery(from: SeanceOrigin, state: CalendarUrlState): string {
    const query = new URLSearchParams({ from });
    appendCalendarState(query, state);
    return `?${query.toString()}`;
}

export function buildSeanceHref(
    workoutId: string,
    from: SeanceOrigin,
    state: CalendarUrlState,
): string {
    return `/seance/${workoutId}${buildSeanceQuery(from, state)}`;
}
