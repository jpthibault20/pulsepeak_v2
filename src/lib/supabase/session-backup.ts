// Filet de sécurité pour la session sur iOS en PWA installée.
//
// WebKit (bug #272325, iOS 17+, toujours ouvert) perd ou désynchronise
// aléatoirement le jar de cookies des web apps installées quand l'app est
// tuée. localStorage, lui, survit de façon fiable au kill. On sauvegarde donc
// en continu les cookies d'auth Supabase (sb-*) dans localStorage, et on les
// restaure au démarrage si iOS les a perdus (cf. AuthSessionGuard).
//
// Module client uniquement (document / localStorage).

const BACKUP_KEY   = 'pulsepeak-session-backup';
const RESTORE_FLAG = 'pulsepeak-session-restore-attempted';
const COOKIE_MAX_AGE = 400 * 24 * 60 * 60; // 400 jours (max autorisé)

interface SessionBackup {
    savedAt: number;
    cookies: { name: string; value: string }[];
}

function readAuthCookies(): { name: string; value: string }[] {
    return document.cookie
        .split('; ')
        .filter(Boolean)
        .map(pair => {
            const idx = pair.indexOf('=');
            return { name: pair.slice(0, idx), value: pair.slice(idx + 1) };
        })
        .filter(({ name, value }) => name.startsWith('sb-') && value.length > 0);
}

function writeCookies(cookies: { name: string; value: string }[]): void {
    const secure = window.location.protocol === 'https:' ? '; Secure' : '';
    cookies.forEach(({ name, value }) => {
        document.cookie =
            `${name}=${value}; Path=/; Max-Age=${COOKIE_MAX_AGE}; SameSite=Lax${secure}`;
    });
}

/** Sauvegarde les cookies d'auth courants dans localStorage. */
export function backupSession(): void {
    try {
        const cookies = readAuthCookies();
        if (cookies.length === 0) return;
        const backup: SessionBackup = { savedAt: Date.now(), cookies };
        localStorage.setItem(BACKUP_KEY, JSON.stringify(backup));
        // Session vue valide côté serveur : réarmer la restauration.
        sessionStorage.removeItem(RESTORE_FLAG);
    } catch {
        // Stockage indisponible (mode privé strict…) : le filet est best-effort.
    }
}

/** À appeler AVANT la déconnexion pour ne pas ressusciter la session. */
export function clearSessionBackup(): void {
    try {
        localStorage.removeItem(BACKUP_KEY);
        sessionStorage.removeItem(RESTORE_FLAG);
    } catch {
        // Ignoré : sans stockage il n'y a rien à effacer.
    }
}

/**
 * Tente de restaurer la session : réécrit les cookies sb-* depuis les cookies
 * encore visibles (cas de désynchronisation du jar) ou depuis la sauvegarde
 * localStorage (cas de perte totale). Retourne true si une restauration a eu
 * lieu — l'appelant doit alors déclencher une navigation complète pour que le
 * serveur (proxy) voie les cookies et les ré-émette en Set-Cookie.
 * Une seule tentative par session de page pour éviter toute boucle.
 */
export function restoreSession(): boolean {
    try {
        if (sessionStorage.getItem(RESTORE_FLAG)) return false;

        const live = readAuthCookies();
        const raw = localStorage.getItem(BACKUP_KEY);
        const backup = raw ? (JSON.parse(raw) as SessionBackup) : null;
        const source = live.length > 0 ? live : (backup?.cookies ?? []);
        if (source.length === 0) return false;

        sessionStorage.setItem(RESTORE_FLAG, '1');
        writeCookies(source);
        return true;
    } catch {
        return false;
    }
}
