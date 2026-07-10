'use client';

import { useEffect } from 'react';
import { usePathname } from 'next/navigation';
import { backupSession, restoreSession } from '@/lib/supabase/session-backup';

/**
 * Monté dans le layout racine — ne rend rien.
 *
 * Filet de sécurité contre la perte de cookies au kill de la PWA sur iOS
 * (bug WebKit #272325) : sauvegarde en continu les cookies de session dans
 * localStorage, et si le serveur nous a renvoyés vers /auth alors qu'une
 * sauvegarde existe, restaure les cookies puis relance une navigation
 * complète — le proxy les ré-émettra en Set-Cookie (keepalive).
 */
export function AuthSessionGuard() {
    const pathname = usePathname();

    useEffect(() => {
        // Renvoyé vers /auth sans session côté serveur : tenter la restauration.
        // (Après une déconnexion volontaire, la sauvegarde a été effacée —
        // restoreSession ne fait alors rien.)
        if (pathname === '/auth') {
            if (restoreSession()) {
                window.location.replace('/');
            }
            return;
        }

        // Pages authentifiées : sauvegarder maintenant, puis à chaque passage
        // en arrière-plan (dernier état avant un éventuel kill de l'app).
        backupSession();
        const onVisibilityChange = () => {
            if (document.visibilityState === 'hidden') backupSession();
        };
        document.addEventListener('visibilitychange', onVisibilityChange);
        window.addEventListener('pagehide', backupSession);
        return () => {
            document.removeEventListener('visibilitychange', onVisibilityChange);
            window.removeEventListener('pagehide', backupSession);
        };
    }, [pathname]);

    return null;
}
