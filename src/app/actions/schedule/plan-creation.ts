/******************************************************************************
 * @file    plan-creation.ts
 * @brief   Server Actions de création d'un plan d'entraînement complet
 *          (plan + blocs IA + semaines + séances de la 1ère semaine).
 *
 *          Deux entrées publiques :
 *          - CreateAdvancedPlan  : plan à durée libre, sans objectif cible
 *          - CreatePlanToObjective : plan calé sur un objectif principal,
 *                                    avec taper automatique autour des courses
 *
 *          Toute la génération IA des blocs (CreateBlocks / CreateBlocksToObjective),
 *          la fabrique des semaines (CreateWeeks) et l'application du taper
 *          (applyTaperToWeeks) sont des helpers privés de ce fichier.
 ******************************************************************************/

'use server';

import { randomUUID } from 'crypto';
import {
    addDays,
    addWeeks,
    differenceInWeeks,
    endOfISOWeek,
    format,
    startOfISOWeek,
} from 'date-fns';
import { revalidatePath } from 'next/cache';

import { parseLocalDate } from '@/lib/utils';
import { atomicIncrementTokenCount, getBlock, getObjectives, getPlan, getProfile, getWeek, getWorkout, saveBlocks, savePlan, saveWeek, saveWorkout } from '@/lib/data/crud';
import { ReturnCode } from '@/lib/data/type';
import type { AvailabilitySlot } from '@/lib/data/type';
import { Block, Objective, Plan, Profile, Week, Workout } from '@/lib/data/DatabaseTypes';
import { callGeminiAPI } from '@/lib/ai/coach-api';

import {
    CTL_LEVEL_MULTIPLIER,
    CTL_PROGRESSION,
    RECOVERY_TSS_RATIO,
    RECOVERY_WEEK_THRESHOLD,
    TAPER_CTL_DROP_PERCENT,
} from '../constants';
import { buildTaperPlan, computeBlockSkeletons, computeWeeklyTSS } from '../helpers';
import { checkAndIncrementAICallLimit } from './_internals/rate-limit';
import { analyzeAthleteContext, computeAvgCompletion, getCompletedBlocksHistory, getTrainingHistorySummary } from './_internals/ai-context';
import { CreateWorkoutForWeek } from './_internals/workout-generator';
import { prepareArchive } from './_internals/plan-archive';


/******************************************************************************
 * @access Public
 * @function CreateAdvancedPlan
 * @brief Crée un plan d'entraînement complet avec blocs et semaines générés
 *        par IA, basé sur la CTL actuelle de l'athlète.
 * @input
 * - blockFocus     : Nom / focus du bloc d'entraînement
 * - customTheme    : Thème personnalisé (optionnel, remplace blockFocus si fourni)
 * - startDate      : Date de début du plan (format YYYY-MM-DD)
 * - numWeeks       : Nombre de semaines du plan (> 0)
 * - userID         : Identifiant de l'utilisateur (min. 3 caractères)
 * @output
 * - { state: RC_OK }                        en cas de succès
 * - { state: RC_Error, error: string }      en cas d'erreur de validation
 ******************************************************************************/
export async function CreateAdvancedPlan(
    blockFocus: string,
    customTheme: string | null,
    startDate: string,
    numWeeks: number,
    userID: string,
    weeklyAvailability?: { [key: string]: AvailabilitySlot }
) {
    // Validation
    if (numWeeks <= 0)      return { state: ReturnCode.RC_Error, error: "Nombre de semaines invalide" };
    if (userID.length < 3)  return { state: ReturnCode.RC_Error, error: "ID utilisateur invalide" };

    try { await checkAndIncrementAICallLimit('plan'); }
    catch (e) { return { state: ReturnCode.RC_Error, error: (e as Error).message }; }

    const [plan, profile, existingBlocks, existingWeeks, existingWorkouts] = await Promise.all([
        getPlan(),
        getProfile(),
        getBlock(),
        getWeek(),
        getWorkout(),
    ]);

    // Archive le plan actif existant + applique le cap de rétention.
    // À ce stade, le nouveau plan n'est pas encore créé : prepareArchive
    // retourne les listes filtrées auxquelles on ajoutera les nouvelles données.
    const archive = prepareArchive(
        plan ?? [],
        existingBlocks ?? [],
        existingWeeks ?? [],
        existingWorkouts ?? [],
        startDate,
    );

    // Création du plan
    const newPlan = CreatePlan(blockFocus, customTheme, startDate, numWeeks, userID);

    // Création des blocs
    const newBlocks = await CreateBlocks(newPlan, profile);
    newPlan.blocksId = newBlocks.map(b => b.id);

    // Création des semaines + injection des IDs dans les blocs
    const newWeeks: Week[] = [];
    const updatedBlocks = await Promise.all(
        newBlocks.map(async (block) => {
            const weeks = await CreateWeeks(newPlan, block, profile);
            newWeeks.push(...weeks);
            return { ...block, weeksId: weeks.map(w => w.id) };
        })
    );

    // On génère les séances uniquement pour la première semaine.
    // Les semaines suivantes seront générées le dimanche précédant chaque semaine.
    const firstWeek = newWeeks[0];
    const firstBlock = updatedBlocks.find(b => b.id === firstWeek.blockId) ?? updatedBlocks[0];
    // Première semaine d'un nouveau plan : calculer la complétion + chercher les courses à proximité
    const [existingAllWorkouts, existingAllWeeks, existingObjectives] = await Promise.all([
        getWorkout(), getWeek(), getObjectives(),
    ]);
    const realCompletion = computeAvgCompletion(existingAllWorkouts ?? [], existingAllWeeks ?? [], updatedBlocks, firstWeek.id);
    const firstWeekStart = parseLocalDate(firstBlock.startDate);
    const firstWeekEnd = addDays(firstWeekStart, 13); // cette semaine + semaine suivante
    const todayStr = format(new Date(), 'yyyy-MM-dd');
    const firstWeekObjectives = existingObjectives.filter(o =>
        o.status === 'upcoming' && o.date >= todayStr
        && parseLocalDate(o.date) >= firstWeekStart && parseLocalDate(o.date) <= firstWeekEnd
    );
    const firstWeekWorkouts = await CreateWorkoutForWeek(profile, newPlan, firstBlock, firstWeek, null, realCompletion, weeklyAvailability ?? profile.weeklyAvailability, firstWeekObjectives);

    const newWorkouts: Workout[] = [...firstWeekWorkouts];
    const updatedWeeks = newWeeks.map((week) =>
        week.id === firstWeek.id
            ? { ...week, workoutsId: firstWeekWorkouts.map(w => w.id) }
            : week
    );

    // Sauvegarde : respecter l'ordre des FK (plan → blocks → weeks → workouts).
    // Les listes `*ToKeep` viennent de prepareArchive : plans actifs basculés
    // en 'archived', cap appliqué, workouts futurs des plans purgés nettoyés.
    try {
        await savePlan([...archive.plansToKeep, newPlan]);
        await saveBlocks([...archive.blocksToKeep, ...updatedBlocks]);
        await saveWeek([...archive.weeksToKeep, ...updatedWeeks]);
        await saveWorkout([...archive.workoutsToKeep, ...newWorkouts], startDate);
    } catch (err) {
        console.error('[CreateAdvancedPlan] Erreur lors de la sauvegarde:', err);
        return { state: ReturnCode.RC_Error, error: 'Erreur lors de la sauvegarde du plan.' };
    }

    return { state: ReturnCode.RC_OK };
}


/******************************************************************************
 * @access Public
 * @function CreatePlanToObjective
 * @brief Génère un plan complet depuis aujourd'hui jusqu'au premier objectif
 *        principal à venir. Remplace intégralement le plan actif existant.
 *        Les objectifs secondaires génèrent une semaine de taper autour d'eux.
 * @input
 * - userID : Identifiant de l'utilisateur
 * @output
 * - { state: RC_OK }               en cas de succès
 * - { state: RC_Error, error }     en cas d'erreur
 ******************************************************************************/
export async function CreatePlanToObjective(userID: string, planStartDate: string, weeklyAvailability?: { [key: string]: AvailabilitySlot }) {
    if (userID.length < 3) return { state: ReturnCode.RC_Error, error: 'ID utilisateur invalide' };

    try { await checkAndIncrementAICallLimit('plan'); }
    catch (e) { return { state: ReturnCode.RC_Error, error: (e as Error).message }; }

    const todayStr = format(new Date(), 'yyyy-MM-dd');

    const [profile, objectives, existingPlans, existingBlocks, existingWeeks, existingWorkouts] = await Promise.all([
        getProfile(),
        getObjectives(),
        getPlan(),
        getBlock(),
        getWeek(),
        getWorkout(),
    ]);

    // Premier objectif principal à venir
    const primaryObjective = objectives
        .filter(o => o.priority === 'principale' && o.status === 'upcoming' && o.date >= todayStr)
        .sort((a, b) => a.date.localeCompare(b.date))[0];

    if (!primaryObjective) {
        return { state: ReturnCode.RC_Error, error: "Aucun objectif principal à venir. Ajoutez-en un dans votre profil." };
    }

    const startDate = planStartDate >= todayStr ? planStartDate : todayStr;

    const totalWeeks = differenceInWeeks(parseLocalDate(primaryObjective.date), parseLocalDate(startDate));
    if (totalWeeks < 1) {
        return { state: ReturnCode.RC_Error, error: "L'objectif est trop proche (moins d'une semaine)." };
    }

    // Objectifs secondaires compris dans la plage du plan
    const secondaryObjectives = objectives.filter(
        o => o.priority === 'secondaire' && o.status === 'upcoming' && o.date >= startDate && o.date <= primaryObjective.date
    );

    // Créer le plan
    const allObjectiveIds = [primaryObjective, ...secondaryObjectives].map(o => o.id);
    const newPlan: Plan = {
        id: randomUUID(),
        userId: userID,
        blocksId: [],
        objectivesId: allObjectiveIds,
        name: primaryObjective.name,
        startDate,
        goalDate: primaryObjective.date,
        macroStrategyDescription: [
            `Préparation pour ${primaryObjective.name}`,
            primaryObjective.sport,
            primaryObjective.distanceKm ? `${primaryObjective.distanceKm} km` : '',
            primaryObjective.elevationGainM ? `${primaryObjective.elevationGainM} m D+` : '',
        ].filter(Boolean).join(' · '),
        status: 'active',
    };

    // Créer les blocs (IA, avec contexte objectifs secondaires)
    const newBlocks = await CreateBlocksToObjective(newPlan, profile, primaryObjective, secondaryObjectives);
    newPlan.blocksId = newBlocks.map(b => b.id);

    // Créer les semaines
    const newWeeks: Week[] = [];
    const updatedBlocks = await Promise.all(
        newBlocks.map(async (block) => {
            const weeks = await CreateWeeks(newPlan, block, profile);
            newWeeks.push(...weeks);
            return { ...block, weeksId: weeks.map(w => w.id) };
        })
    );

    // Appliquer le taper par J-x (principal J-7 + secondaires J-4)
    const finalWeeks = applyTaperToWeeks(newWeeks, updatedBlocks, [primaryObjective, ...secondaryObjectives]);

    // Générer séances pour la première semaine uniquement
    const firstWeek = finalWeeks[0];
    const firstBlock = updatedBlocks.find(b => b.id === firstWeek.blockId) ?? updatedBlocks[0];

    // Trouver les objectifs de cette semaine et la suivante
    const firstWeekStart = parseLocalDate(firstBlock.startDate);
    const firstWeekEnd = addDays(firstWeekStart, 13); // cette semaine + semaine suivante
    const relevantObjectives = [...secondaryObjectives, primaryObjective].filter(o => {
        const objDate = parseLocalDate(o.date);
        return objDate >= firstWeekStart && objDate <= firstWeekEnd;
    });

    const realCompletion2 = computeAvgCompletion(existingWorkouts ?? [], existingWeeks ?? [], updatedBlocks, firstWeek.id);
    const firstWeekWorkouts = await CreateWorkoutForWeek(profile, newPlan, firstBlock, firstWeek, null, realCompletion2, weeklyAvailability ?? profile.weeklyAvailability, relevantObjectives);

    const newWorkouts: Workout[] = [...firstWeekWorkouts];
    const weeksWithWorkouts = finalWeeks.map(w =>
        w.id === firstWeek.id ? { ...w, workoutsId: firstWeekWorkouts.map(wk => wk.id) } : w
    );

    // Archive le plan actif existant + applique le cap de rétention.
    const archive = prepareArchive(
        existingPlans ?? [],
        existingBlocks ?? [],
        existingWeeks ?? [],
        existingWorkouts ?? [],
        startDate,
    );

    // Sauvegarde — le plan actif précédent est conservé en 'archived', les
    // anciens archivés au-delà du cap sont purgés en cascade via savePlan.
    try {
        await savePlan([...archive.plansToKeep, newPlan]);
        await saveBlocks([...archive.blocksToKeep, ...updatedBlocks]);
        await saveWeek([...archive.weeksToKeep, ...weeksWithWorkouts]);
        await saveWorkout([...archive.workoutsToKeep, ...newWorkouts], startDate);
    } catch (err) {
        console.error('[CreatePlanToObjective] Erreur sauvegarde:', err);
        return { state: ReturnCode.RC_Error, error: 'Erreur lors de la sauvegarde du plan.' };
    }

    revalidatePath('/');
    return { state: ReturnCode.RC_OK };
}


// ═════════════════════════════════════════════════════════════════════════════
// Helpers privés
// ═════════════════════════════════════════════════════════════════════════════

/******************************************************************************
 * @access Private
 * @function CreatePlan
 * @brief Instancie un objet Plan à partir des paramètres utilisateur.
 *        Calcule automatiquement la date de fin depuis startDate + numWeeks.
 * @input
 * - blockFocus  : Nom du plan / focus d'entraînement
 * - customTheme : Thème personnalisé (optionnel, fallback sur blockFocus)
 * - startDate   : Date de début (format YYYY-MM-DD)
 * - numWeeks    : Nombre de semaines du plan
 * - userID      : Identifiant de l'utilisateur
 * @output
 * - Plan : objet plan prêt à être sauvegardé (blocksID vide)
 ******************************************************************************/
function CreatePlan(
    blockFocus: string,
    customTheme: string | null,
    startDate: string,
    numWeeks: number,
    userID: string
): Plan {
    const goalDate = new Date(startDate);
    goalDate.setDate(goalDate.getDate() + numWeeks * 7);

    return {
        id: randomUUID(),
        userId: userID,
        blocksId: [],
        name: blockFocus,
        startDate,
        objectivesId: [],
        goalDate: format(goalDate, 'yyyy-MM-dd'),
        macroStrategyDescription: customTheme ?? blockFocus,
        status: "active",
    };
}


/******************************************************************************
 * @access Private
 * @function CreateBlocks
 * @brief Génère les blocs de méso-cycles d'un plan via IA.
 *        Découpe le plan en tranches de 4 semaines, soumet le contexte
 *        athlète à l'IA pour définir type et thème de chaque bloc,
 *        puis calcule la progression CTL bloc par bloc.
 * @input
 * - plan    : Plan parent contenant les dates et la stratégie macro
 * - profile : Profil athlète (niveau, CTL actuelle, disciplines...)
 * @output
 * - Block[] : tableau de blocs ordonnés, avec CTL, TSS et thème renseignés
 *             (weeksId vide, sera rempli par CreateWeeks)
 ******************************************************************************/
async function CreateBlocks(plan: Plan, profile: Profile): Promise<Block[]> {
    const start = startOfISOWeek(parseLocalDate(plan.startDate));
    const goal  = endOfISOWeek(parseLocalDate(plan.goalDate));
    const totalWeeks = differenceInWeeks(goal, start) + 1;

    if (totalWeeks < 1) throw new Error("Le plan est trop court !");

    const blockSkeletons = computeBlockSkeletons(totalWeeks);

    // Récupérer tout le contexte pour informer l'IA
    const [existingWorkouts, allBlocks, allObjectives] = await Promise.all([
        getWorkout(),
        getBlock(),
        getObjectives(),
    ]);
    const historySummary = getTrainingHistorySummary(existingWorkouts ?? []);
    const blocksHistory = await getCompletedBlocksHistory();
    const athleteContext = await analyzeAthleteContext(
        profile,
        existingWorkouts ?? [],
        allBlocks ?? [],
        allObjectives ?? [],
    );

    const levelMultiplier = CTL_LEVEL_MULTIPLIER[profile.experience ?? 'Intermédiaire'] ?? 1.0;

    const aiPrompt = `
Tu es un coach de ${profile.activeSports.cycling ? 'cyclisme' : ''}${profile.activeSports.running ? ', course à pied' : ''}${profile.activeSports.swimming ? ', natation' : ''} certifié avec 15 ans d'expérience en périodisation (Friel, Issurin, Coggan).

## CONTEXTE ATHLÈTE
- Objectif : ${plan.macroStrategyDescription}
- Date de fin : ${plan.goalDate}
- Niveau : ${profile.experience ?? "Intermédiaire"}
- Disciplines : ${profile.activeSports.cycling ? 'cyclisme' : ''}${profile.activeSports.running ? ', course à pied' : ''}${profile.activeSports.swimming ? ', natation' : ''}

${athleteContext}

## HISTORIQUE DE PÉRIODISATION (BLOCS PASSÉS)
${blocksHistory}

## HISTORIQUE D'ENTRAÎNEMENT (12 DERNIÈRES SEMAINES)
${historySummary}

## STRUCTURE TEMPORELLE
${blockSkeletons.length} blocs de méso-cycles :
${blockSkeletons.map(b =>
    `- Bloc ${b.index} : ${b.duration} semaines${b.isLast ? " (DERNIER → inclut la semaine de course)" : ""}`
).join('\n')}

## PHILOSOPHIE — L'HISTORIQUE PRIME SUR LE TEMPLATE
Tu ne dois JAMAIS suivre aveuglément la progression classique Base→Build→Peak→Taper.
Ton rôle est d'analyser l'état RÉEL de l'athlète et de prescrire les blocs dont il a BESOIN.

Exemples de décisions attendues :
- Athlète en pleine saison (CTL 60+) avec base déjà faite → commencer par Build PMA, Build Seuil, ou Peak
- Athlète qui sort d'un bloc PMA → enchaîner avec Seuil ou Spécificité (alternance Issurin)
- Athlète avec CTL faible après coupure → Base nécessaire
- Bloc unique (1 seul bloc) → l'athlète a déjà une base, aller au spécifique (PMA, seuil, etc.)
- Plan court (≤4 semaines) → pas de Base, aller directement au travail ciblé

Les effets résiduels guident aussi :
- Base aérobie persiste 25-35j → pas besoin si faite récemment
- VO2max/PMA persiste 12-18j → à retravailler régulièrement
- Seuil persiste 15-25j

## PROFIL NIVEAU
${profile.experience === 'Débutant' ? `
⚠️ ATHLÈTE DÉBUTANT :
- Si CTL < 30, commence par un bloc Base (fondamentaux aérobies)
- Progression très graduelle (<5% de charge par semaine)
- Même débutant : si CTL ≥ 40 et historique montre une base récente, peut passer à Build` : profile.experience === 'Avancé' ? `
🏆 ATHLÈTE AVANCÉ :
- Blocs Peak, Build et Taper autorisés dès le début si la forme est là
- Périodisation polarisée recommandée (alterner volume et intensité)
- Peut supporter des blocs courts et intenses (PMA, anaérobie)` : `
📈 ATHLÈTE INTERMÉDIAIRE :
- Progression équilibrée entre volume et intensité
- Commence par Build si CTL ≥ 40 ou historique montre une base récente
- Base uniquement si CTL < 40 ET aucune base récente`}

## RÈGLES OBLIGATOIRES
1. L'historique et l'état actuel déterminent le premier bloc, PAS un template.
2. Jamais 2 blocs du même type consécutivement (alternance des stimuli).
3. Thèmes PRÉCIS et SPÉCIFIQUES. Exemples : "Développement PMA", "Travail seuil anaérobie", "Force sous-max côtes", "Sweet Spot progression", "VO2max intervalles courts", "Spécificité endurance longue", etc.
4. Si 1 seul bloc : PAS de Base sauf si CTL < 30.

## FORMAT DE RÉPONSE (JSON uniquement)
Chaque objet contient exactement :
- "index" (number) : numéro du bloc
- "type" (string) : l'un de ["Base", "Build", "Peak", "Taper"]
- "theme" (string) : focus spécifique en 3 à 6 mots

## LANGUE
Le champ "theme" doit être rédigé en FRANÇAIS UNIQUEMENT. Termes techniques (PMA, FTP, TSS, VO2max) autorisés.
`;

    const { data: rawAiResponse, tokensUsed: tokensWeeks } = await callGeminiAPI({
        contents: [{ parts: [{ text: aiPrompt }] }],
        generationConfig: {
            temperature: 0.7,
            maxOutputTokens: 2048,
            responseMimeType: "application/json",
        },
    });
    await atomicIncrementTokenCount(tokensWeeks);

    if (!Array.isArray(rawAiResponse)) {
        throw new Error('Réponse IA invalide : tableau attendu.');
    }
    const aiResponse = rawAiResponse as { index: number; type: string; theme: string }[];

    // Construction des blocs avec CTL dynamique
    let currentStartDate = start;
    let previousTargetCTL = profile.currentCTL;

    return blockSkeletons.map((skeleton) => {
        const aiInfo = aiResponse.find(b => b.index === skeleton.index);
        const blockType = aiInfo?.type ?? 'Build';

        // Calcul CTL dynamique : Taper en % au lieu de fixe, progression ajustée au niveau
        let progression: number;
        if (blockType === 'Taper') {
            progression = -Math.round(previousTargetCTL * TAPER_CTL_DROP_PERCENT);
        } else {
            progression = Math.round((CTL_PROGRESSION[blockType] ?? 8) * levelMultiplier);
        }

        const startCTL   = previousTargetCTL;
        const targetCTL  = startCTL + progression;
        const avgWeeklyTSS = Math.round(((startCTL + targetCTL) / 2) * 7);

        const block: Block = {
            id: randomUUID(),
            planId: plan.id,
            userId: plan.userId,
            orderIndex: skeleton.index,
            type:  blockType,
            theme: aiInfo?.theme ?? "Préparation",
            weekCount: skeleton.duration,
            startDate: format(currentStartDate, 'yyyy-MM-dd'),
            weeksId: [],
            startCTL,
            targetCTL,
            avgWeeklyTSS,
        };

        previousTargetCTL = targetCTL;
        currentStartDate  = addWeeks(currentStartDate, skeleton.duration);

        return block;
    });
}


/******************************************************************************
 * @access Private
 * @function CreateBlocksToObjective
 * @brief Variante de CreateBlocks enrichie du contexte objectif principal
 *        et des objectifs secondaires pour que l'IA structure le plan
 *        en conséquence.
 ******************************************************************************/
async function CreateBlocksToObjective(
    plan: Plan,
    profile: Profile,
    primaryObj: Objective,
    secondaryObjs: Objective[]
): Promise<Block[]> {
    const start = startOfISOWeek(parseLocalDate(plan.startDate));
    const goal  = endOfISOWeek(parseLocalDate(plan.goalDate));
    const totalWeeks = differenceInWeeks(goal, start) + 1;

    if (totalWeeks < 1) throw new Error('Le plan est trop court !');

    const blockSkeletons = computeBlockSkeletons(totalWeeks);

    // Récupérer tout le contexte pour informer l'IA
    const [existingWorkouts, allBlocks, allObjectives] = await Promise.all([
        getWorkout(),
        getBlock(),
        getObjectives(),
    ]);
    const historySummary = getTrainingHistorySummary(existingWorkouts ?? []);
    const blocksHistory = await getCompletedBlocksHistory();
    const athleteContext = await analyzeAthleteContext(
        profile,
        existingWorkouts ?? [],
        allBlocks ?? [],
        allObjectives ?? [],
    );

    const secondaryContext = secondaryObjs.length > 0
        ? `\n## OBJECTIFS SECONDAIRES (courses intermédiaires)\n` +
          secondaryObjs.map(o => `- ${o.name} le ${o.date} (${o.sport}${o.distanceKm ? ', ' + o.distanceKm + ' km' : ''})`).join('\n') +
          `\n→ Prévoir une semaine de relâche (Taper) autour de chaque objectif secondaire.`
        : '';

    const levelMultiplier = CTL_LEVEL_MULTIPLIER[profile.experience ?? 'Intermédiaire'] ?? 1.0;

    const aiPrompt = `
Tu es un coach de ${profile.activeSports.cycling ? 'cyclisme' : ''}${profile.activeSports.running ? ', course à pied' : ''}${profile.activeSports.swimming ? ', natation' : ''} certifié avec 15 ans d'expérience en périodisation (Friel, Issurin, Coggan).

## OBJECTIF PRINCIPAL
- Course : ${primaryObj.name}
- Date : ${primaryObj.date}
- Sport : ${primaryObj.sport}
${primaryObj.distanceKm ? `- Distance : ${primaryObj.distanceKm} km` : ''}
${primaryObj.elevationGainM ? `- Dénivelé : ${primaryObj.elevationGainM} m D+` : ''}
${secondaryContext}

## CONTEXTE ATHLÈTE
- Niveau : ${profile.experience ?? 'Intermédiaire'}
- Disciplines : ${profile.activeSports.cycling ? 'cyclisme' : ''}${profile.activeSports.running ? ', course à pied' : ''}${profile.activeSports.swimming ? ', natation' : ''}

${athleteContext}

## HISTORIQUE DE PÉRIODISATION (BLOCS PASSÉS)
${blocksHistory}

## HISTORIQUE D'ENTRAÎNEMENT (12 DERNIÈRES SEMAINES)
${historySummary}

## STRUCTURE TEMPORELLE
${blockSkeletons.length} blocs de méso-cycles :
${blockSkeletons.map(b => `- Bloc ${b.index} : ${b.duration} semaines${b.isLast ? ' (DERNIER → semaine de course incluse)' : ''}`).join('\n')}

## PHILOSOPHIE — L'HISTORIQUE PRIME SUR LE TEMPLATE
Tu ne dois JAMAIS suivre aveuglément la progression classique Base→Build→Peak→Taper.
Ton rôle est d'analyser l'état RÉEL de l'athlète et de prescrire les blocs dont il a BESOIN.

Exemples de décisions attendues :
- Athlète en pleine saison (CTL 60+) avec base déjà faite → commencer par Build PMA, Build Seuil, ou Peak
- Athlète qui a fait beaucoup d'intensité récemment → un bloc Build volume/endurance pour rééquilibrer
- Athlète avec CTL faible après une coupure → Base nécessaire
- Athlète 4 semaines avant la course avec bonne forme → Peak puis Taper
- Plan court (≤4 semaines) → pas de Base, aller directement au spécifique

Les effets résiduels (Issurin) guident aussi :
- Base aérobie persiste 25-35j → pas besoin de la retravailler si faite dans le dernier mois
- VO2max/PMA persiste 12-18j → à retravailler régulièrement
- Seuil persiste 15-25j

## RÈGLES OBLIGATOIRES
1. Le dernier bloc DOIT être de type "Taper" (affûtage pré-course).
2. Jamais 2 blocs du même type consécutivement (alternance des stimuli — Issurin).
3. Thèmes SPÉCIFIQUES et VARIÉS selon les besoins identifiés. Exemples de thèmes : "Développement PMA", "Travail au seuil", "Force sous-max", "Spécificité course", "Sweet Spot", "Endurance musculaire", "VO2max intervalles courts", etc.
4. Prendre en compte les objectifs secondaires pour la périodisation.

## FORMAT DE RÉPONSE (JSON uniquement)
Retourner un tableau JSON. Chaque objet contient exactement :
- "index" (number) : numéro du bloc
- "type" (string) : l'un de ["Base", "Build", "Peak", "Taper"]
- "theme" (string) : focus spécifique en 3 à 6 mots (PAS juste "Build" ou "Préparation" — sois PRÉCIS sur le contenu : PMA, seuil, force, endurance musculaire, spécificité, etc.)

## LANGUE
Le champ "theme" doit être rédigé en FRANÇAIS UNIQUEMENT. Termes techniques (PMA, FTP, TSS, VO2max) autorisés.
`;

    const { data: rawBlocks, tokensUsed: tokensBlocks } = await callGeminiAPI({
        contents: [{ parts: [{ text: aiPrompt }] }],
        generationConfig: { temperature: 0.7, maxOutputTokens: 2048, responseMimeType: 'application/json' },
    });
    await atomicIncrementTokenCount(tokensBlocks);
    if (!Array.isArray(rawBlocks)) throw new Error('Réponse IA invalide : tableau attendu.');
    const aiResponse = rawBlocks as { index: number; type: string; theme: string }[];

    let currentStartDate = start;
    let previousTargetCTL = profile.currentCTL;

    return blockSkeletons.map((skeleton) => {
        const aiInfo = aiResponse.find(b => b.index === skeleton.index);
        const blockType = aiInfo?.type ?? 'Build';

        // Calcul CTL dynamique : Taper en % au lieu de fixe, progression ajustée au niveau
        let progression: number;
        if (blockType === 'Taper') {
            progression = -Math.round(previousTargetCTL * TAPER_CTL_DROP_PERCENT);
        } else {
            progression = Math.round((CTL_PROGRESSION[blockType] ?? 8) * levelMultiplier);
        }

        const startCTL     = previousTargetCTL;
        const targetCTL    = startCTL + progression;
        const avgWeeklyTSS = Math.round(((startCTL + targetCTL) / 2) * 7);

        const block: Block = {
            id: randomUUID(),
            planId: plan.id,
            userId: plan.userId,
            orderIndex: skeleton.index,
            type:  blockType,
            theme: aiInfo?.theme ?? 'Préparation',
            weekCount: skeleton.duration,
            startDate: format(currentStartDate, 'yyyy-MM-dd'),
            weeksId: [],
            startCTL,
            targetCTL,
            avgWeeklyTSS,
        };

        previousTargetCTL = targetCTL;
        currentStartDate  = addWeeks(currentStartDate, skeleton.duration);
        return block;
    });
}


/******************************************************************************
 * @access Private
 * @function CreateWeeks
 * @brief Génère les semaines d'entraînement d'un bloc avec une progression
 *        linéaire du TSS entre startCTL et targetCTL du bloc.
 *        Si le bloc contient plus de 3 semaines, la dernière est
 *        automatiquement une semaine de récupération à 50% du TSS de départ.
 * @input
 * - plan    : Plan parent (référence)
 * - block   : Bloc parent contenant startCTL, targetCTL, weekCount et theme
 * - profile : Profil athlète (ID utilisateur, niveau...)
 * @output
 * - Week[]  : tableau de semaines ordonnées avec TSS cible, type (Load /
 *             Recovery) et thème hérité du bloc (workoutsId vide)
 ******************************************************************************/
async function CreateWeeks(plan: Plan, block: Block, profile: Profile): Promise<Week[]> {
    const hasRecoveryWeek  = block.weekCount > RECOVERY_WEEK_THRESHOLD;
    const startWeeklyTSS   = computeWeeklyTSS(block.startCTL);
    const targetWeeklyTSS  = computeWeeklyTSS(block.targetCTL);
    const loadWeeksCount   = hasRecoveryWeek ? block.weekCount - 1 : block.weekCount;
    const progressionPerWeek = loadWeeksCount > 1
        ? (targetWeeklyTSS - startWeeklyTSS) / (loadWeeksCount - 1)
        : 0;

    return Array.from({ length: block.weekCount }, (_, i) => {
        const weekNumber     = i + 1;
        const isRecoveryWeek = hasRecoveryWeek && weekNumber === block.weekCount;

        const targetTSS = isRecoveryWeek
            ? Math.round(startWeeklyTSS * RECOVERY_TSS_RATIO)
            : Math.round(startWeeklyTSS + progressionPerWeek * (weekNumber - 1));

        return {
            id: randomUUID(),
            userId: profile.id,
            workoutsId: [],
            blockId: block.id,
            weekNumber,
            type: isRecoveryWeek ? 'Recovery' : 'Load',
            targetTSS,
            actualTSS: 0,
            userFeedback: "",
        } satisfies Week;
    });
}


/******************************************************************************
 * @access Private
 * @function applyTaperToWeeks
 * @brief Marque comme Taper toute semaine qui contient au moins un jour dans
 *        la fenêtre d'affûtage d'un objectif (principal : J-7, secondaire : J-4).
 *        Ajuste `targetTSS` en remplaçant le TSS des jours tapés par une
 *        fraction (ratio) du TSS journalier moyen de la semaine.
 *
 *        Les règles détaillées par J-x sont dans `constants.ts`
 *        (`TAPER_RULES_PRINCIPAL` / `TAPER_RULES_SECONDARY`).
 ******************************************************************************/
function applyTaperToWeeks(
    weeks: Week[],
    blocks: Block[],
    objectives: Objective[],
): Week[] {
    if (objectives.length === 0) return weeks;

    const blockMap = new Map(blocks.map(b => [b.id, b]));

    return weeks.map(week => {
        const block = blockMap.get(week.blockId);
        if (!block) return week;

        const weekStart = addDays(parseLocalDate(block.startDate), (week.weekNumber - 1) * 7);
        const taperPlan = buildTaperPlan(weekStart, objectives);
        if (taperPlan.size === 0) return week;

        // Recompose le TSS cible : jours normaux gardent leur quote-part,
        // jours tapés reçoivent `dailyAvg × rule.tssRatio`.
        const dailyAvg = week.targetTSS / 7;
        let newTSS = 0;
        for (let d = 0; d <= 6; d++) {
            const info = taperPlan.get(d);
            newTSS += info ? dailyAvg * info.rule.tssRatio : dailyAvg;
        }

        return {
            ...week,
            type: 'Taper' as const,
            targetTSS: Math.round(newTSS),
        };
    });
}
