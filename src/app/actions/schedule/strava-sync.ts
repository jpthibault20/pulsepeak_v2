/******************************************************************************
 * @file    strava-sync.ts
 * @brief   Synchronisation des activités Strava → workouts PulsePeak.
 *
 *          Flux :
 *          0. Résolution du token Strava UNE seule fois (réutilisé partout).
 *          1. Choix de la fenêtre :
 *               - rapide  (cas normal) : activités depuis `strava.lastSyncAt`.
 *               - complète (1ʳᵉ sync, > 7j sans sync, ou forceFull) : année.
 *          2. Liste paginée des activités sur la fenêtre choisie.
 *          3. Dedup sur stravaId déjà importé.
 *          4. Limitation plan gratuit (FREE_STRAVA_LIMIT = 5 activités).
 *          5. Fetch détaillé EN PARALLÈLE avec retry exponentiel.
 *          6. Matching best-effort sur (date + sport) avec une séance planifiée,
 *             sinon création d'une "Sortie Libre" rattachée à la semaine active.
 *          7. Passage en "missed" des séances pending antérieures à aujourd'hui.
 *          8. Sauvegarde PARTIELLE (seules les séances modifiées) + recalcul CTL/ATL.
 *          9. Mise à jour du curseur lastSyncAt + write-back Strava DÉFÉRÉ.
 ******************************************************************************/

'use server';

import { randomUUID } from 'crypto';
import { after } from 'next/server';
import { addDays } from 'date-fns';
import { parseLocalDate } from '@/lib/utils';
import {
    getBlock,
    getProfile,
    getWeek,
    getWorkout,
    saveWeek,
    saveWorkoutsBatch,
} from '@/lib/data/crud';
import { setStravaLastSync } from '@/lib/profile-db';
import type { SportType } from '@/lib/data/type';
import { Workout } from '@/lib/data/DatabaseTypes';
import {
    getStravaActivitiesAllPages,
    getStravaActivityById,
    getValidAccessToken,
} from '@/lib/strava-service';
import { mapStravaSport, tagStravaActivity } from '@/lib/strava-mapper';
import { recalculateFitnessMetrics } from './fitness-metrics';

// Au-delà de ce délai sans synchro, on force une sync complète (année) pour
// rattraper d'éventuels trous (activités ajoutées rétroactivement, sync ratée).
const FULL_RESYNC_MAX_AGE_SEC = 7 * 24 * 3600;
// Marge de recouvrement appliquée au curseur en sync rapide, pour ne rien rater
// à la frontière (le dedup sur stravaId neutralise les doublons).
const FAST_SYNC_OVERLAP_SEC = 24 * 3600;

export async function syncStravaActivities(forceFull = false) {
    console.log("⚡ Début Sync Strava...");

    // Helper : retry avec backoff exponentiel
    async function fetchWithRetry<T>(
        fn: () => Promise<T | null>,
        id: number,
        maxRetries = 2
    ): Promise<T | null> {
        for (let attempt = 0; attempt <= maxRetries; attempt++) {
            try {
                const result = await fn();
                if (result !== null) return result;
            } catch {
                // fall through to retry
            }
            if (attempt < maxRetries) {
                await new Promise(r => setTimeout(r, 1000 * (attempt + 1)));
                console.log(`   🔁 Retry ${attempt + 1}/${maxRetries} pour l'activité ${id}...`);
            }
        }
        console.warn(`   ⚠️ Activité ${id} non récupérée après ${maxRetries} retry.`);
        return null;
    }

    try {
        // 1. Charger les données actuelles
        const [profile, existingWorkouts, existingWeeks, existingBlocks] = await Promise.all([
            getProfile(),
            getWorkout(),
            getWeek(),
            getBlock(),
        ]);

        const workouts: Workout[] = existingWorkouts ?? [];

        // ── Déterminer les droits Strava ──────────────────────────────────────
        const FREE_STRAVA_LIMIT = 5;
        const isFreePlan =
            (profile?.plan ?? 'free') === 'free' &&
            profile?.role !== 'admin';

        // 2. Compter les activités Strava existantes (pour la limite free)
        const stravaWorkouts = workouts.filter(w =>
            w.status === 'completed' &&
            w.completedData?.source?.type === 'strava'
        );

        // ── Résoudre le token UNE seule fois (réutilisé pour tous les appels) ──
        const accessToken = await getValidAccessToken(profile ?? undefined);

        // 3. Choix de la fenêtre de synchro.
        //    - Rapide (défaut) : depuis lastSyncAt → 1-2 pages légères, peu de détails.
        //    - Complète : 1ʳᵉ sync, > 7j sans sync, ou forceFull → toute l'année (rattrape les trous).
        //    Le dedup (étape 4) évite de re-fetcher les détails des activités déjà connues.
        const nowSec = Math.floor(Date.now() / 1000);
        const currentYear = new Date().getFullYear();
        const startOfYear = Math.floor(new Date(`${currentYear}-01-01T00:00:00Z`).getTime() / 1000);

        const lastSyncAt = profile?.strava?.lastSyncAt;
        const isFirstSync = !lastSyncAt;
        const isStale = !lastSyncAt || (nowSec - lastSyncAt) > FULL_RESYNC_MAX_AGE_SEC;
        const doFullSync = forceFull || isFirstSync || isStale;

        // Avance le curseur lastSyncAt → les prochaines syncs partent d'ici (chemin rapide).
        const commitCursor = async () => {
            if (!profile?.strava) return;
            try {
                await setStravaLastSync(nowSec);
            } catch (e) {
                console.warn("⚠️ Échec mise à jour du curseur lastSyncAt:", e);
            }
        };

        const afterTs = doFullSync
            ? startOfYear
            : Math.max(startOfYear, lastSyncAt! - FAST_SYNC_OVERLAP_SEC);

        console.log(
            doFullSync
                ? `📅 Sync COMPLÈTE ${currentYear} (${forceFull ? 'forcée' : isFirstSync ? '1ʳᵉ sync' : '> 7j sans sync'})...`
                : `⚡ Sync RAPIDE depuis ${new Date(afterTs * 1000).toISOString().split('T')[0]}...`
        );
        const activitiesSummary: { id: number; start_date: string; [key: string]: unknown }[] =
            await getStravaActivitiesAllPages(afterTs, accessToken);
        console.log(`📊 ${activitiesSummary.length} activité(s) trouvée(s) sur la fenêtre.`);

        if (!activitiesSummary || activitiesSummary.length === 0) {
            console.log("✅ Aucune nouvelle activité à synchroniser.");
            await commitCursor();
            return { success: true, count: 0 };
        }

        // 4. Filtrer les doublons avant tout fetch
        const newSummaries = activitiesSummary.filter((summary: { id: number }) =>
            !workouts.some(w =>
                w.completedData?.source?.type === 'strava' &&
                w.completedData.source.stravaId === summary.id
            )
        );

        if (newSummaries.length === 0) {
            console.log("✅ Toutes les activités sont déjà à jour.");
            await commitCursor();
            return { success: true, count: 0 };
        }

        // ── Appliquer la limite plan free ─────────────────────────────────────
        let summariesToProcess = newSummaries;
        if (isFreePlan) {
            const slotsRemaining = Math.max(0, FREE_STRAVA_LIMIT - stravaWorkouts.length);
            if (slotsRemaining === 0) {
                console.log(`🔒 Plan gratuit : limite de ${FREE_STRAVA_LIMIT} activités Strava atteinte. Passez à l'offre Développeur pour tout synchroniser.`);
                return { success: true, count: 0, limitReached: true };
            }
            summariesToProcess = [...newSummaries]
                .sort((a, b) => new Date(b.start_date).getTime() - new Date(a.start_date).getTime())
                .slice(0, slotsRemaining);
            console.log(`🔒 Plan gratuit : import limité à ${slotsRemaining} activité(s) (${stravaWorkouts.length}/${FREE_STRAVA_LIMIT} déjà importées).`);
        }

        console.log(`📥 ${summariesToProcess.length} nouvelles activités à récupérer (sur ${activitiesSummary.length}).`);

        // 5. Récupérer tous les détails en PARALLÈLE avec retry (token & profil réutilisés)
        const detailResults = await Promise.allSettled(
            summariesToProcess.map((summary: { id: number }) =>
                fetchWithRetry(() => getStravaActivityById(summary.id, accessToken, profile ?? undefined), summary.id)
            )
        );

        let newItemsCount = 0;
        const updatedWeeks = existingWeeks ? [...existingWeeks] : [];
        // Séances réellement modifiées (match / création / missed) → sauvegarde partielle.
        const changedById = new Map<string, Workout>();
        // Write-back Strava à effectuer APRÈS la réponse (déféré, hors chemin critique).
        const tagJobs: { activityId: number; description: string | null; tss: number | null }[] = [];
        const writeBackEnabled = profile?.stravaWriteBack !== false;

        // 6. Traiter chaque résultat
        for (let i = 0; i < summariesToProcess.length; i++) {
            const summary = summariesToProcess[i];
            const result = detailResults[i];

            if (result.status === 'rejected' || !result.value) {
                console.warn(`   ⏭  Skip: impossible de récupérer l'activité ${summary.id}.`);
                continue;
            }

            const { raw: detail, completedData } = result.value;
            const activityDate = summary.start_date.split('T')[0];
            const stravaSport = mapStravaSport(String(summary.type ?? detail.type ?? ''));

            // Write-back de la description Strava → différé (étape 9).
            if (writeBackEnabled) {
                tagJobs.push({
                    activityId: detail.id,
                    description: detail.description ?? null,
                    tss: completedData.calculatedTSS ?? null,
                });
            }

            // 🧠 MATCHING : séance planifiée existante pour cette date ET le même sport ?
            const matchingIndex = workouts.findIndex(w =>
                w.date === activityDate &&
                w.status !== 'completed' &&
                w.sportType === stravaSport
            );

            if (matchingIndex !== -1) {
                console.log(`   🤝 Match le ${activityDate} (${stravaSport}) -> mise à jour du plan.`);
                workouts[matchingIndex].status = 'completed';
                workouts[matchingIndex].completedData = completedData;
                changedById.set(workouts[matchingIndex].id, workouts[matchingIndex]);
            } else {
                console.log(`   ➕ Activité libre ajoutée : ${activityDate} (${stravaSport})`);

                const sportType: SportType = stravaSport !== 'other' ? stravaSport
                    : completedData.metrics.swimming ? 'swimming'
                    : completedData.metrics.running ? 'running'
                    : completedData.metrics.cycling ? 'cycling'
                    : 'other';

                // Trouver la semaine du bloc actif correspondant à cette date
                let activeWeekID = '';
                const newWorkoutId = randomUUID();
                if (existingBlocks && existingWeeks) {
                    const activityDateObj = parseLocalDate(activityDate);

                    const activeBlock = existingBlocks.find(block => {
                        const blockStart = parseLocalDate(block.startDate);
                        const blockEnd = addDays(blockStart, block.weekCount * 7);
                        return activityDateObj >= blockStart && activityDateObj < blockEnd;
                    });

                    if (activeBlock) {
                        const blockStart = parseLocalDate(activeBlock.startDate);
                        const blockWeeks = existingWeeks.filter(w => activeBlock.weeksId?.includes(w.id));
                        const activeWeek = blockWeeks.find(week => {
                            const weekStart = addDays(blockStart, (week.weekNumber - 1) * 7);
                            const weekEnd = addDays(weekStart, 6);
                            return activityDateObj >= weekStart && activityDateObj <= weekEnd;
                        });

                        if (activeWeek) {
                            activeWeekID = activeWeek.id;
                            const weekIdx = updatedWeeks.findIndex(w => w.id === activeWeek.id);
                            if (weekIdx !== -1) {
                                if (!updatedWeeks[weekIdx].workoutsId.includes(newWorkoutId)) {
                                    updatedWeeks[weekIdx] = {
                                        ...updatedWeeks[weekIdx],
                                        workoutsId: [...updatedWeeks[weekIdx].workoutsId, newWorkoutId],
                                    };
                                }
                            }
                        }
                    }
                }

                const newWorkout: Workout = {
                    id: newWorkoutId,
                    userId: profile?.id ?? '',
                    weekId: activeWeekID,
                    date: activityDate,
                    sportType,
                    title: detail.name,
                    // Type réellement effectué (classifié à l'import), fallback "Sortie Libre".
                    workoutType: completedData.detectedType ?? 'Sortie Libre',
                    mode: 'Outdoor',
                    status: 'completed',
                    plannedData: {
                        durationMinutes: 0,
                        targetPowerWatts: null,
                        targetPaceMinPerKm: null,
                        targetPaceMinPer100m: null,
                        targetHeartRateBPM: null,
                        distanceKm: null,
                        distanceMeters: null,
                        plannedTSS: null,
                        description: null,
                        structure: [],
                    },
                    completedData,
                };
                workouts.push(newWorkout);
                changedById.set(newWorkout.id, newWorkout);
            }
            newItemsCount++;
        }

        // 6b. Marquer les séances planifiées passées (avant aujourd'hui, fuseau Europe/Paris) non réalisées comme "missed"
        const todayParis = new Date(new Date().toLocaleString('en-US', { timeZone: 'Europe/Paris' }));
        const todayStr = `${todayParis.getFullYear()}-${String(todayParis.getMonth() + 1).padStart(2, '0')}-${String(todayParis.getDate()).padStart(2, '0')}`;
        for (const w of workouts) {
            if (w.status === 'pending' && !w.completedData && w.date < todayStr) {
                w.status = 'missed';
                changedById.set(w.id, w);
                newItemsCount++;
            }
        }

        // 7. Sauvegarder UNIQUEMENT les séances modifiées (upsert groupé, 1 aller-retour).
        //    On n'écrit plus tout l'historique : le coût ne dépend plus de sa taille.
        if (changedById.size > 0) {
            await saveWorkoutsBatch([...changedById.values()]);
            if (existingWeeks && updatedWeeks.some((w, i) => w !== existingWeeks[i])) {
                await saveWeek(updatedWeeks);
            }
            console.log(`💾 ${changedById.size} séance(s) modifiée(s) sauvegardée(s).`);
            await recalculateFitnessMetrics();
        }

        // 8. Avancer le curseur lastSyncAt (prochaine sync = chemin rapide).
        await commitCursor();

        // 9. Write-back des descriptions Strava → DÉFÉRÉ après la réponse (next/server `after`).
        //    N'impacte plus le temps de synchro perçu par l'utilisateur.
        if (tagJobs.length > 0) {
            after(async () => {
                await Promise.allSettled(
                    tagJobs.map(job =>
                        tagStravaActivity(accessToken, job.activityId, job.description, { tss: job.tss })
                    )
                );
                console.log(`🏷️  ${tagJobs.length} description(s) Strava taguée(s) (différé).`);
            });
        }

        return { success: true, count: newItemsCount };

    } catch (error) {
        console.error("❌ Erreur Sync Strava:", error);
        return { success: false, error };
    }
}
