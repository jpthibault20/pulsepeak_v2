import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';

export async function updateSession(request: NextRequest) {
    let supabaseResponse = NextResponse.next({ request });
    let authCookiesRefreshed = false;

    const supabase = createServerClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
        {
            cookies: {
                getAll() {
                    return request.cookies.getAll();
                },
                setAll(cookiesToSet) {
                    authCookiesRefreshed = true;
                    cookiesToSet.forEach(({ name, value }) =>
                        request.cookies.set(name, value),
                    );
                    supabaseResponse = NextResponse.next({ request });
                    cookiesToSet.forEach(({ name, value, options }) =>
                        supabaseResponse.cookies.set(name, value, {
                            ...options,
                            secure: process.env.NODE_ENV === 'production',
                            sameSite: 'lax',
                            // 400 jours (max autorisé) — sauf suppression (valeur vide = signOut)
                            maxAge: value ? 400 * 24 * 60 * 60 : 0,
                        }),
                    );
                },
            },
        },
    );

    // Ne pas ajouter de logique entre createServerClient et auth.getUser().
    // Un simple oubli peut causer des déconnexions aléatoires.
    const { data: { user } } = await supabase.auth.getUser();

    // Rediriger vers /auth si non connecté (sauf pages publiques)
    if (
        !user &&
        !request.nextUrl.pathname.startsWith('/auth') &&
        !request.nextUrl.pathname.startsWith('/api/strava')
    ) {
        const url = request.nextUrl.clone();
        url.pathname = '/auth';
        return NextResponse.redirect(url);
    }

    // Keepalive : ré-émettre les cookies sb-* existants via Set-Cookie à chaque
    // requête authentifiée. Expiration glissante de 400 jours, et un cookie
    // ré-écrit par le serveur échappe au plafond de 7 jours que Safari/iOS (ITP)
    // applique aux cookies posés par document.cookie.
    if (user && !authCookiesRefreshed) {
        request.cookies
            .getAll()
            .filter(({ name }) => name.startsWith('sb-'))
            .forEach(({ name, value }) =>
                supabaseResponse.cookies.set(name, value, {
                    path: '/',
                    secure: process.env.NODE_ENV === 'production',
                    sameSite: 'lax',
                    maxAge: 400 * 24 * 60 * 60,
                }),
            );
    }

    return supabaseResponse;
}
