import { createBrowserClient } from '@supabase/ssr';

export const createClient = () =>
    createBrowserClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
        {
            auth: {
                // Le proxy (src/proxy.ts) est l'unique responsable du refresh :
                // un refresh côté navigateur réécrit les cookies via document.cookie,
                // que Safari/iOS plafonne à 7 jours (ITP), et entre en course avec
                // le refresh serveur à la réouverture de la PWA (rotation du token
                // → « Invalid Refresh Token: Already Used » → déconnexion).
                autoRefreshToken: false,
            },
        }
    );
