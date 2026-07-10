'use server';

import { db } from '@/lib/db';
import { profiles } from '@/lib/db/schema';
import { createClient } from '@/lib/supabase/server';
import { and, eq, isNull, lt, or } from 'drizzle-orm';

export interface AuthResult {
    error?:                  string;
    needsEmailConfirmation?: boolean;
}

async function insertProfile(
    userId:    string,
    firstName: string,
    lastName:  string,
    email:     string,
): Promise<void> {
    await db
        .insert(profiles)
        .values({
            id:            userId,
            createdAt:     new Date(),
            updatedAt:     new Date(),
            firstName,
            lastName,
            email,
            currentCTL:    0,
            currentATL:    0,
            coachType:     'triathlon',
            plan:          'free',
            goal:          '',
            weaknesses:    '',
        })
        .onConflictDoNothing();
}

/**
 * Connexion côté serveur : les cookies de session sont posés via les headers
 * Set-Cookie de la réponse (et non document.cookie), ce qui garantit leur
 * persistance sur iOS en mode app installée (PWA standalone).
 */
export async function login(email: string, password: string): Promise<AuthResult> {
    const supabase = await createClient();
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });

    if (error) {
        if (error.message.toLowerCase().includes('email not confirmed')) {
            return {
                error: 'Votre adresse email n\'a pas encore été vérifiée.',
                needsEmailConfirmation: true,
            };
        }
        return {
            error: error.message === 'Invalid login credentials'
                ? 'Email ou mot de passe incorrect.'
                : error.message,
        };
    }

    // Cas où Supabase laisse se connecter sans confirmation d'email
    if (data.user && !data.user.email_confirmed_at) {
        await supabase.auth.signOut();
        return {
            error: 'Votre adresse email n\'a pas encore été vérifiée.',
            needsEmailConfirmation: true,
        };
    }

    return {};
}

/**
 * Inscription côté serveur. Si Supabase ouvre une session immédiate
 * (confirmation email désactivée), le profil est créé dans la foulée
 * et les cookies de session sont posés via Set-Cookie.
 */
export async function register(
    firstName: string,
    lastName:  string,
    email:     string,
    password:  string,
): Promise<AuthResult> {
    const supabase = await createClient();
    const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: {
            data: { first_name: firstName, last_name: lastName },
        },
    });

    if (error) {
        return { error: error.message };
    }

    if (data.session && data.user) {
        await insertProfile(data.user.id, firstName, lastName, email);
        return {};
    }

    // Confirmation email requise avant la première connexion
    return { needsEmailConfirmation: true };
}

/**
 * Déconnexion côté serveur : supprime les cookies de session via Set-Cookie.
 */
export async function logout(): Promise<void> {
    const supabase = await createClient();
    await supabase.auth.signOut();
}

/**
 * Crée le profil initial d'un nouvel utilisateur.
 * Utilise onConflictDoNothing pour ne jamais écraser un profil existant.
 * Vérifie que le userId fourni correspond à l'utilisateur authentifié.
 */
export async function createInitialProfile(
    userId:    string,
    firstName: string,
    lastName:  string,
    email:     string,
): Promise<void> {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user || user.id !== userId) {
        throw new Error('Non autorisé');
    }

    await insertProfile(user.id, firstName, lastName, email);
}

/**
 * Marque la dernière connexion de l'utilisateur courant.
 * Mise à jour au plus une fois par heure pour éviter le spam d'updates.
 */
export async function touchLastLogin(): Promise<void> {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    const now = new Date();
    const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);

    await db.update(profiles)
        .set({ lastLoginAt: now })
        .where(and(
            eq(profiles.id, user.id),
            or(isNull(profiles.lastLoginAt), lt(profiles.lastLoginAt, oneHourAgo)),
        ));
}
