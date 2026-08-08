import type { NextConfig } from "next";

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { version } = require("./package.json");

const nextConfig: NextConfig = {
    // Racine de workspace figée sur le dossier du projet. Sans ça, Turbopack
    // remonte l'arborescence à la recherche d'un lockfile et peut choisir un
    // dossier parent (ex. le profil utilisateur s'il contient un
    // package-lock.json égaré) — il indexe alors tout ce dossier, ce qui fait
    // exploser .next/dev/cache/turbopack et rend le dev inutilisable.
    turbopack: {
        root: __dirname,
    },
    env: {
        NEXT_PUBLIC_APP_VERSION: version,
    },
    async headers() {
        return [
            {
                source: '/(.*)',
                headers: [
                    { key: 'X-Content-Type-Options',  value: 'nosniff' },
                    { key: 'X-Frame-Options',          value: 'DENY' },
                    { key: 'Referrer-Policy',          value: 'strict-origin-when-cross-origin' },
                    { key: 'Permissions-Policy',       value: 'camera=(), microphone=(), geolocation=()' },
                ],
            },
        ];
    },
};

export default nextConfig;
