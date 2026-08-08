'use client';

import React, { useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { Nav, type View } from '@/components/layout/nav';
import { SubscriptionProvider, type Plan } from '@/lib/subscription/context';
import { useTheme } from '@/components/ThemeProvider';
import type { Profile } from '@/lib/data/DatabaseTypes';

/**
 * Coquille cliente de /seance/[id].
 *
 * La page vit hors d'AppClientWrapper : elle doit donc fournir elle-même le
 * contexte d'abonnement (dont dépend la Nav) et appliquer le thème du profil.
 * La navigation globale renvoie vers `/` en portant l'onglet dans l'URL, ce qui
 * évite d'atterrir systématiquement sur l'agenda.
 */
export default function SeanceShell({
    profile,
    children,
}: {
    profile: Profile;
    children: React.ReactNode;
}) {
    const router = useRouter();
    const { setThemeFromProfile } = useTheme();
    const themeAppliedRef = useRef(false);

    useEffect(() => {
        if (!themeAppliedRef.current && profile.theme) {
            setThemeFromProfile(profile.theme);
            themeAppliedRef.current = true;
        }
    }, [profile.theme, setThemeFromProfile]);

    const handleViewChange = (view: View) => {
        router.push(view === 'dashboard' ? '/' : `/?vue=${view}`);
    };

    return (
        <SubscriptionProvider subscription={{ role: profile.role, plan: (profile.plan ?? 'free') as Plan }}>
            <div className="flex flex-col min-h-dvh">
                <Nav
                    onViewChange={handleViewChange}
                    currentView="seance"
                    appName="PulsePeak"
                    variant="detail"
                />
                {/* pb-40 en mobile : dégage la barre d'action fixe + la safe-area */}
                <main className="flex-1 w-full max-w-6xl mx-auto px-3 sm:px-6 lg:px-8 py-4 sm:py-6 pb-40 lg:pb-12">
                    {children}
                </main>
            </div>
        </SubscriptionProvider>
    );
}
