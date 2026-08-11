'use client';

import React, { useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { Nav, type View } from '@/components/layout/nav';
import { SubscriptionProvider, type Plan } from '@/lib/subscription/context';
import { useTheme } from '@/components/ThemeProvider';
import { buildAppHref, type CalendarUrlState } from '@/lib/calendar-url';
import type { Profile } from '@/lib/data/DatabaseTypes';

/**
 * Coquille cliente de /seance/[id].
 *
 * La page vit hors d'AppClientWrapper : elle doit donc fournir elle-même le
 * contexte d'abonnement (dont dépend la Nav) et appliquer le thème du profil.
 * La navigation globale renvoie vers `/` en portant l'onglet dans l'URL — ainsi
 * que le mois/jour consultés — ce qui évite d'atterrir systématiquement sur
 * l'agenda du mois courant.
 */
export default function SeanceShell({
    profile,
    calendar,
    children,
}: {
    profile: Profile;
    calendar: CalendarUrlState;
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
        router.push(buildAppHref(view === 'dashboard' ? null : view, calendar));
    };

    return (
        <SubscriptionProvider subscription={{ role: profile.role, plan: (profile.plan ?? 'free') as Plan }}>
            <div className="flex flex-col min-h-dvh">
                <Nav
                    onViewChange={handleViewChange}
                    // Le logo ramène à l'accueil nu ; c'est le bouton retour du
                    // sub-header qui préserve le mois d'où l'on vient.
                    onLogoClick={() => router.push('/')}
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
