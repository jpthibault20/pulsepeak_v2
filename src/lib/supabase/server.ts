import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';

export const createClient = async () => {
    const cookieStore = await cookies();

    return createServerClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
        {
            cookies: {
                getAll() {
                    return cookieStore.getAll();
                },
                setAll(cookiesToSet) {
                    try {
                        cookiesToSet.forEach(({ name, value, options }) =>
                            cookieStore.set(name, value, {
                                ...options,
                                secure: process.env.NODE_ENV === 'production',
                                sameSite: 'lax',
                                // 400 jours (max autorisé) — sauf suppression (valeur vide = signOut)
                                maxAge: value ? 400 * 24 * 60 * 60 : 0,
                            })
                        );
                    } catch {
                        // Ignoré dans les Server Components (lecture seule)
                    }
                },
            },
        }
    );
};
