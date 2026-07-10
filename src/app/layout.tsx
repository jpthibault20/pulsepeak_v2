import './globals.css';
import type { Metadata, Viewport } from 'next';
import { Inter } from 'next/font/google';
import { ThemeProvider } from '@/components/ThemeProvider';
import { AuthSessionGuard } from '@/components/AuthSessionGuard';

const inter = Inter({ subsets: ['latin'] });

export const metadata: Metadata = {
    title: {
        default: 'PulsePeak',
        template: '%s | PulsePeak',
    },
    description: 'Ton coach cycliste intelligent. Planification personnalisée, analyse de performance et suivi de forme pour progresser.',
    applicationName: 'PulsePeak',
    keywords: ['cyclisme', 'entraînement', 'coach', 'vélo', 'triathlon', 'running', 'performance', 'TSS', 'CTL'],
    authors: [{ name: 'PulsePeak' }],
    creator: 'PulsePeak',
    robots: { index: false, follow: false },
    openGraph: {
        type: 'website',
        locale: 'fr_FR',
        title: 'PulsePeak — Coach cycliste intelligent',
        description: 'Planification personnalisée, analyse de performance et suivi de forme pour progresser.',
        siteName: 'PulsePeak',
    },
    manifest: '/manifest.json',
    appleWebApp: {
        capable: true,
        statusBarStyle: 'default',
        title: 'PulsePeak',
    },
};

export const viewport: Viewport = {
    themeColor: [
        { media: '(prefers-color-scheme: light)', color: '#f8fafc' },
        { media: '(prefers-color-scheme: dark)',  color: '#020617' },
    ],
};

export default function RootLayout({
    children,
}: {
    children: React.ReactNode;
}) {
    return (
        <html lang="fr" suppressHydrationWarning>
            <head>
                {/* Prévient le flash de mauvais thème (FOUC) */}
                <script
                    dangerouslySetInnerHTML={{
                        __html: `(function(){var t=localStorage.getItem('theme')||'dark';document.documentElement.setAttribute('data-theme',t);})();`,
                    }}
                />
            </head>
            <body className={inter.className}>
                <AuthSessionGuard />
                <ThemeProvider>
                    <div className="min-h-screen bg-slate-100 dark:bg-slate-950">
                        {children}
                    </div>
                </ThemeProvider>
            </body>
        </html>
    );
}
