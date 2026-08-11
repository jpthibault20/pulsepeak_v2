import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

export default defineConfig({
    resolve: {
        // Même alias que `paths` dans tsconfig.json
        alias: {
            '@': fileURLToPath(new URL('./src', import.meta.url)),
        },
    },
    test: {
        // Les tests unitaires ne touchent que des fonctions pures : pas de DOM.
        environment: 'node',
        include: ['src/**/*.test.ts'],
        // Fuseau figé : plusieurs calculs (PMC, dates de plan) passent par des
        // Date locales. Sans ce pin, la suite dépendrait de la machine.
        env: { TZ: 'Europe/Paris' },
    },
});
