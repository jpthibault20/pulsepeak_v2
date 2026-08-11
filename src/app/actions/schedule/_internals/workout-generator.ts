/******************************************************************************
 * @file    _internals/workout-generator.ts
 * @brief   Génération IA des séances d'une semaine complète.
 *          Point chaud du moteur de planification : construit le prompt
 *          Gemini (profil, zones, disponibilités, taper, continuité avec la
 *          semaine précédente), appelle l'IA — UNE seule fois — puis assemble
 *          chaque séance à partir de la structure renvoyée : dépliage,
 *          ajustement au créneau, dérivation de la durée et des cibles, rendu
 *          du texte. Tout le post-traitement est du calcul pur (lib/structure).
 *
 *          Exporté en interne car utilisé par deux call-sites distincts :
 *          plan-creation.ts (première semaine d'un plan) et week-actions.ts
 *          (régénération d'une semaine précise).
 * @access  Module privé — ne pas importer depuis un composant client.
 ******************************************************************************/

import { randomUUID } from 'crypto';
import { addDays, format } from 'date-fns';
import { parseLocalDate } from '@/lib/utils';
import { atomicIncrementTokenCount, getBlock, getWeek, getWorkout } from '@/lib/data/crud';
import { Block, Objective, Plan, Profile, Week, Workout } from '@/lib/data/DatabaseTypes';
import type { AvailabilitySlot, SportType } from '@/lib/data/type';
import { buildWhyInstruction, callGeminiAPI } from '@/lib/ai/coach-api';
import { buildCoachRoleIntro } from '@/lib/ai/coach-persona';
import { COMPACT_STRUCTURE_SCHEMA } from '@/lib/structure/schema';
import { buildPlannedDataFromStructure } from '@/lib/structure/planned-data';
import { buildAllowedSlots, buildTaperPlan, formatActiveSportsFr, formatAvailability, getActiveSports } from '../../helpers';
import { getPreviousWeekSummary } from './ai-context';


/******************************************************************************
 * @access Public (interne au module schedule)
 * @function CreateWorkoutForWeek
 * @brief Génère les séances d'une semaine via IA en tenant compte du profil
 *        athlète (disciplines actives, niveau), du thème du bloc, du TSS
 *        cible et de l'historique de complétion des semaines précédentes.
 * @input
 * - profile     : Profil athlète (ID, niveau, disciplines, CTL...)
 * - plan        : Plan parent (référence)
 * - block       : Bloc parent (theme, type, startCTL, targetCTL...)
 * - week        : Semaine cible (weekNumber, targetTSS, type...)
 * - userComment : Commentaire libre (fatigue, blessure, contraintes...)
 * - avgCompletion     : Historique de complétion des semaines précédentes (ex: [80, 90, 95])
 * @output
 * - Workout[]   : Séances prêtes à être sauvegardées (status: 'pending')
 ******************************************************************************/
export async function CreateWorkoutForWeek(
    profile: Profile,
    plan: Plan,
    block: Block,
    week: Week,
    userComment: string | null,
    avgCompletion: number,
    weeklyAvailability: { [key: string]: AvailabilitySlot },
    weekObjectives?: Objective[],
): Promise<Workout[]>
{
    // [TIMING] Instrumentation temporaire pour calibrer les étapes de la progress bar
    const tStart = performance.now();
    const ms = (from: number) => Math.round(performance.now() - from);

    const tPrep0 = performance.now();
    const weekStartDate = addDays(parseLocalDate(block.startDate), (week.weekNumber - 1) * 7);
    const activeSports = getActiveSports(profile.activeSports);
    const formattedAvailability = formatAvailability(weeklyAvailability);

    // Plan de taper jour par jour : utilisé à la fois dans le prompt (règles J-x)
    // et après l'appel IA (pour whitelister les séances "déblocage obligatoire"
    // même si le jour n'est pas dans les dispos).
    const taperPlan = buildTaperPlan(weekStartDate, weekObjectives ?? []);

    // Récupérer le contexte de la semaine précédente pour la continuité
    const [allWorkouts, allWeeks, allBlocks] = await Promise.all([
        getWorkout(),
        getWeek(),
        getBlock(),
    ]);
    const previousWeekContext = getPreviousWeekSummary(
        allWorkouts ?? [],
        allWeeks ?? [],
        allBlocks ?? [],
        week.id,
    );

    // Zones context pour des descriptions précises
    let zonesContext = "";

    // Zones de puissance vélo
    if (profile.cycling?.Test?.zones) {
        const z = profile.cycling.Test.zones;
        zonesContext += `
## ZONES DE PUISSANCE CYCLISME (priorité n°1 pour les descriptions vélo)
- Z1 (Récupération) : < ${z.z1.max} W
- Z2 (Endurance) : ${z.z2.min}–${z.z2.max} W
- Z3 (Tempo) : ${z.z3.min}–${z.z3.max} W
- Z4 (Seuil/FTP) : ${z.z4.min}–${z.z4.max} W
- Z5 (VO2 Max) : ${z.z5.min}–${z.z5.max} W
- Z6 (Anaérobie) : ${z.z6?.min}–${z.z6?.max} W
- Z7 (Neuromusculaire) : > ${z.z7?.min} W`;
    }

    // Zones cardio (fallback vélo si pas de puissance, et pour la natation)
    if (profile.heartRate?.zones) {
        const z = profile.heartRate.zones;
        zonesContext += `
## ZONES DE FRÉQUENCE CARDIAQUE (pour natation en priorité, fallback vélo/course si pas de watts/allures)
${profile.heartRate.max ? `- FC Max : ${profile.heartRate.max} bpm` : ''}
${profile.heartRate.resting ? `- FC Repos : ${profile.heartRate.resting} bpm` : ''}
- Z1 (Récupération) : < ${z.z1.max} bpm
- Z2 (Endurance) : ${z.z2.min}–${z.z2.max} bpm
- Z3 (Tempo) : ${z.z3.min}–${z.z3.max} bpm
- Z4 (Seuil) : ${z.z4.min}–${z.z4.max} bpm
- Z5 (VO2 Max) : ${z.z5.min}–${z.z5.max} bpm`;
    } else if (profile.heartRate?.max) {
        zonesContext += `
## FRÉQUENCE CARDIAQUE (pour natation en priorité, fallback vélo/course)
- FC Max : ${profile.heartRate.max} bpm${profile.heartRate.resting ? `\n- FC Repos : ${profile.heartRate.resting} bpm` : ''}`;
    }

    // Zones d'allure course à pied (stockées en sec/km, affichées en M:SS/km)
    const fmtPace = (sec: number) => {
        const m = Math.floor(sec / 60);
        const s = Math.round(sec % 60);
        return `${m}:${String(s).padStart(2, '0')}`;
    };

    if (profile.running?.Test?.zones) {
        const z = profile.running.Test.zones;
        zonesContext += `
## ZONES D'ALLURE COURSE À PIED (priorité n°1 pour les descriptions course)
- Z1 (Récupération) : ${fmtPace(z.z1.min)}–${fmtPace(z.z1.max)} /km
- Z2 (Endurance) : ${fmtPace(z.z2.min)}–${fmtPace(z.z2.max)} /km
- Z3 (Tempo) : ${fmtPace(z.z3.min)}–${fmtPace(z.z3.max)} /km
- Z4 (Seuil) : ${fmtPace(z.z4.min)}–${fmtPace(z.z4.max)} /km
- Z5 (VO2 Max) : ${fmtPace(z.z5.min)}–${fmtPace(z.z5.max)} /km`;
    } else if (profile.running?.Test?.vma) {
        zonesContext += `
## DONNÉES COURSE À PIED (priorité n°1 pour les descriptions course)
- VMA : ${profile.running.Test.vma} km/h`;
    }

    // Position dans le bloc pour guider la progression
    const weekPosition = week.weekNumber <= 1
        ? 'DÉBUT DE BLOC — introduire les séances clés, volume modéré'
        : week.weekNumber >= block.weekCount
            ? (week.type === 'Recovery' ? 'SEMAINE DE RÉCUPÉRATION — décharge' : 'FIN DE BLOC — pic de charge ou transition')
            : `MILIEU DE BLOC (S${week.weekNumber}/${block.weekCount}) — progression depuis la semaine précédente`;

   const aiPrompt = `
${buildCoachRoleIntro(profile.coachType)}

Tu génères la semaine ${week.weekNumber} d'un bloc de ${block.weekCount} semaines pour cet athlète, dont les disciplines actives sont : ${activeSports.join(", ")}.

## LANGUE — IMPÉRATIF
**Tous les textes (title, workoutType, description) doivent être rédigés en FRANÇAIS UNIQUEMENT.** Pas d'anglais, pas de mots anglais sauf termes techniques sans équivalent français (FTP, TSS, RPE, VO2max, Z1-Z7).

## PROFIL ATHLÈTE
- Niveau : ${profile.experience ?? "Intermédiaire"}
- CTL actuelle : ${profile.currentCTL}
- Disciplines actives : ${formatActiveSportsFr(profile.activeSports) || 'non définies'}
${zonesContext}

## DISPONIBILITÉS ET PROGRAMME DE LA SEMAINE — PRIORITÉ ABSOLUE
${formattedAvailability || "Non spécifiées"}

### RÈGLES DE RESPECT DU PROGRAMME (NON NÉGOCIABLE) :
- Si l'athlète a défini un SPORT et une DURÉE pour un jour (ex: "vélo 1.5h"), tu DOIS :
  · Utiliser EXACTEMENT ce sport pour ce jour (pas un autre)
  · La durée indiquée est un MAXIMUM ABSOLU — tu peux proposer MOINS (ex: 1h au lieu de 1.5h si la fatigue ou la logique d'entraînement le justifie), mais JAMAIS PLUS
  · Tu ne peux PAS ajouter un sport que l'athlète n'a pas listé ce jour-là (ex: si seul "vélo 1.5h" est prévu, pas de course ni natation ce jour)
  · Seul le TYPE de séance (Endurance, Interval, Tempo...) et le CONTENU sont à ta discrétion
- Si l'athlète a défini PLUSIEURS sports un même jour (ex: "natation 1h, vélo 0.5h"), il attend UNE séance par sport listé. Chaque séance doit respecter la durée MAX de son créneau. Tu peux réduire la durée d'un ou plusieurs sports si nécessaire.
- Les commentaires entre parenthèses (ex: "sortie club", "chill", "compétition") décrivent le contexte. Adapte le type et l'intensité en conséquence.
- SEULS les jours marqués "IA LIBRE" te donnent carte blanche : tu choisis le sport, la durée et l'intensité. Tu peux aussi décider de laisser un jour de repos complet si c'est pertinent.
- Les jours NON LISTÉS dans les disponibilités sont des jours de REPOS. Ne génère AUCUNE séance pour ces jours.
- LIBERTÉ DE RÉDUIRE : tu as toujours le droit de proposer moins de volume que prévu (durées plus courtes, suppression d'une séance secondaire) si c'est cohérent avec l'état de fatigue, la progression ou une course à venir. L'objectif est la qualité, pas de remplir les créneaux à tout prix.

${previousWeekContext}

## CONTEXTE DE LA SEMAINE
- Thème du bloc : ${block.theme}
- Type de bloc : ${block.type}
- Type de semaine : ${week.type}
- TSS cible total : ${week.targetTSS}
- Semaine n°${week.weekNumber} / ${block.weekCount}
- Position : ${weekPosition}
${userComment ? `- Commentaire athlète : "${userComment}"` : ""}
- Complétion des 4 dernières semaines : ${avgCompletion}%
${avgCompletion < 80 ? `- ⚠️ Complétion faible (${avgCompletion}%) : l'athlète ne termine pas ses semaines. RÉDUIRE l'intensité et le volume. Proposer des séances réalistes et atteignables plutôt qu'ambitieuses.` : ""}
${avgCompletion >= 80 && avgCompletion <= 95 ? `- ✔️ Complétion correcte (${avgCompletion}%) : maintenir la progression normale.` : ""}
${avgCompletion > 95 ? `- ✅ Complétion excellente (${avgCompletion}%) : l'athlète absorbe bien la charge. Peut progresser normalement.` : ""}

## RÈGLES DE PROGRESSION ET CONTINUITÉ (CRUCIAL)
Tu DOIS construire cette semaine en continuité avec la semaine précédente. Chaque semaine n'est pas indépendante — c'est une étape dans une progression.

### Séances clés vs séances secondaires
Chaque semaine contient 2-3 SÉANCES CLÉS qui portent l'adaptation :
1. La séance d'intervalles principale (cible du bloc : PMA, seuil, VO2max, etc.)
2. La sortie longue (endurance fondamentale)
3. Optionnel : une 2ème séance d'intensité
Les autres séances sont SECONDAIRES (endurance facile Z1-Z2, récupération). Si l'athlète doit manquer une séance, ce sont celles-là qu'il saute.

### Progression des séances clés semaine après semaine
${week.type === 'Recovery' ? `
⚠️ SEMAINE DE RÉCUPÉRATION (modèle Friel en 2 phases) :
- Jours 1-3 : Intensité Z1 uniquement. Séances courtes. Peut inclure 1 jour de repos complet.
- Jours 4-6 : Réintroduire 1-2 touches d'intensité COURTES (ex: 4x2min au seuil dans une séance de 45min).
- Volume global : 40-60% du pic de la semaine précédente.
- Maintenir la fréquence (nombre de séances similaire) mais réduire drastiquement la durée.
- PAS de sortie longue. Max 60-75% de la durée de la sortie longue précédente.` : `
PROGRESSION DE CHARGE (semaine de type ${week.type}) :
- Sortie longue : ${week.weekNumber === 1 ? 'établir la durée de base' : 'augmenter de 15-30 min par rapport à la semaine précédente (dans la limite de la dispo du jour)'}.
- Intervalles : progresser via UNE seule variable à la fois :
  · OPTION A : +1 répétition (ex: 4x5min → 5x5min)
  · OPTION B : +1min de durée par intervalle (ex: 4x5min → 4x6min)
  · OPTION C : -1min de repos entre les intervalles
  · NE JAMAIS augmenter intensité + volume + réduire repos en même temps.
- L'intensité (zones/watts) reste dans la MÊME zone que la semaine précédente. C'est le volume de travail qui augmente.
- PLACEMENT DES SÉANCES CLÉS : respecter le programme de l'athlète en priorité. Placer la séance d'intervalles sur un jour où l'athlète a prévu un créneau suffisant (≥1h). Placer la sortie longue sur le créneau le plus long de la semaine. Si un jour est marqué "IA LIBRE", il peut servir à placer une séance clé manquante.
- Alterner SYSTÉMATIQUEMENT : jour dur → jour facile → jour dur (dans les limites du programme défini).`}

${(() => {
    if (!weekObjectives || weekObjectives.length === 0) return '';

    // Principal : fenêtre J-7 / Secondaire : fenêtre J-4.
    // Pour chaque jour (0=Lundi...6=Dimanche) qui tombe dans une fenêtre, on a
    // une règle précise (intensité, volume, déblocage obligatoire, etc.).
    if (taperPlan.size === 0) {
        // Objectifs présents mais tous hors fenêtre J-x : juste mentionner pour l'IA
        const lines: string[] = [];
        lines.push('## 🏁 COURSES À VENIR (hors fenêtre de taper cette semaine — pas d\'affûtage actif)');
        lines.push(weekObjectives.map(o =>
            `- ${o.name} le ${o.date} (${o.sport}, priorité : ${o.priority})`
        ).join('\n'));
        return lines.join('\n');
    }

    const dayNamesFR = ['Lundi','Mardi','Mercredi','Jeudi','Vendredi','Samedi','Dimanche'];

    // Objectifs uniques présents dans la fenêtre (pour les annoncer en tête)
    const objectivesInWindow = new Map<string, { name: string; date: string; sport: string; priority: string }>();
    for (const info of taperPlan.values()) {
        if (!objectivesInWindow.has(info.objectiveName + info.objectiveDate)) {
            objectivesInWindow.set(info.objectiveName + info.objectiveDate, {
                name:     info.objectiveName,
                date:     info.objectiveDate,
                sport:    info.objectiveSport,
                priority: info.priority,
            });
        }
    }

    const hasMandatory = Array.from(taperPlan.values()).some(i => i.rule.mandatory);

    const lines: string[] = [];
    lines.push('## ⚠️ AFFÛTAGE PRÉ-COURSE (J-x) — RÈGLES IMPÉRATIVES, PRIORITÉ ABSOLUE');
    lines.push('');
    lines.push('COURSES DANS LA FENÊTRE DE TAPER :');
    for (const o of objectivesInWindow.values()) {
        lines.push(`- 🏁 ${o.name} le ${o.date} (${o.sport}) — priorité : ${o.priority}`);
    }
    lines.push('');
    lines.push('PRINCIPE GÉNÉRAL DU TAPER (Mujika / Friel / Coggan) :');
    lines.push('- On réduit le VOLUME.');
    lines.push('- On GARDE l\'intensité sur des séances COURTES pour conserver le rythme et le neuromusculaire.');
    lines.push('- On garde la fréquence (nombre de séances) si possible.');
    lines.push('- Aucune sortie longue dans la fenêtre de taper. Aucune séance épuisante.');
    lines.push('');
    lines.push('RÈGLES JOUR PAR JOUR (ces règles ÉCRASENT toute autre logique de progression pour les jours concernés) :');
    for (let d = 0; d <= 6; d++) {
        const info = taperPlan.get(d);
        if (!info) continue;
        const mark = info.rule.mandatory ? ' [OBLIGATOIRE]' : '';
        lines.push(`- **${dayNamesFR[d]} (dayOffset=${d}) — ${info.rule.label}${mark}** — ${info.rule.promptInstruction} Durée max ${info.rule.maxDurationMin} min. Course cible : ${info.objectiveName} (${info.objectiveSport}).`);
    }
    lines.push('');
    if (hasMandatory) {
        lines.push('⚠️ JOUR(S) OBLIGATOIRE(S) : la ou les séances marquées [OBLIGATOIRE] DOIVENT être incluses dans la réponse JSON, MÊME SI le jour n\'apparaît pas dans les disponibilités de l\'athlète ou est marqué "repos". Le sport à utiliser est celui de la course cible indiquée pour ce jour.');
        lines.push('');
    }
    lines.push('Les autres jours de la semaine (ceux hors fenêtre de taper, s\'il y en a) suivent les règles normales de la semaine mais sans ajouter de charge lourde.');

    return lines.join('\n');
})()}

## RÈGLES NIVEAU ATHLÈTE
${profile.experience === 'Débutant' ? `⚠️ DÉBUTANT — Appliquer impérativement :
- Intensité : Z1-Z3 uniquement — peu d'intervalle à haute intensité (pas de Z4-Z5)
- Pas de double journée
- Descriptions simples, langage accessible, sans jargon excessif
- TSS max par séance : 60` : profile.experience === 'Avancé' ? `🏆 AVANCÉ — Autorisations spéciales :
- Double journée autorisée si disponibilité > 3h ce jour
- Intensité Z4-Z5 bienvenue (20% max du volume total)
- Sorties longues pouvant aller jusqu'à la dispo max
- Descriptions très techniques avec valeurs de zones et intervalles précis` : `📈 INTERMÉDIAIRE :
- Max 1 double journée par semaine
- 1-2 séances dures (Z4+) par semaine maximum
- Descriptions techniques mais accessibles`}

## RÈGLES GÉNÉRALES
1. RESPECTER LE PROGRAMME : chaque jour a un sport et une durée définis par l'athlète. Utilise CE sport et cette durée comme MAXIMUM. Tu ne choisis que le contenu (type, intensité, structure). Les jours IA LIBRE sont les seuls où tu as le choix du sport/durée.
2. Répartir les séances UNIQUEMENT sur les disciplines actives : ${activeSports.join(", ")}. Ne jamais proposer un sport que l'athlète n'a pas activé, et ne jamais ajouter un sport sur un jour où il n'est pas prévu (sauf jours IA LIBRE).
3. DURÉE = PLAFOND : la durationMinutes d'une séance ne doit JAMAIS dépasser la durée indiquée dans les disponibilités pour ce sport ce jour-là. Elle peut être inférieure si la logique d'entraînement le justifie.
4. La somme des plannedTSS doit approcher ${week.targetTSS} (±10%). Si tu réduis des séances, le TSS total peut être inférieur — c'est acceptable.
5. Respecter le thème "${block.theme}" dans le choix des types de séances.
6. Ne pas placer 2 séances dures (Interval, Tempo) consécutives. TOUJOURS alterner dur/facile.
7. dayOffset doit correspondre exactement au jour disponible (0=Lundi ... 6=Dimanche).
8. Exactement UNE séance par sport par créneau (si "vélo 1.5h" → 1 séance vélo). Jours non listés = repos, pas de séance. Jours LIBRE = repos possible si pertinent.
9. **"structure" EST la séance** — une liste de blocs, dans l'ordre d'exécution. Il n'y a pas de description en prose : le texte lu par l'athlète est ÉCRIT À PARTIR de ta structure. Ce qui n'est pas dans un bloc n'existe pas.
   - "d" = durée de la phase active en SECONDES. Obligatoire hors natation. Durées rondes : multiple de 60 au-delà de 5 min.
   - "Repeat" = motif répété "n" fois, DEUX phases maximum : l'effort ("d" + sa cible) et la récupération intercalée ("dr" + "wr"/"pr"/"hrr").
   - **Dès que n>1, "dr" est OBLIGATOIRE et strictement positif** : une série sans récupération entre les répétitions n'est pas une série, c'est un bloc continu. Un 4×5 min VO2max sans récup est infaisable. Mets "dr":0 uniquement sur un bloc qui n'est pas une série.
   - Un motif à TROIS phases ou plus (ex : 15 min force puis 5 min vélocité puis 10 min récup) NE RENTRE PAS dans un Repeat : déplie-le en blocs simples successifs. N'écrase jamais une phase et ne raccourcis jamais une durée pour la faire entrer dans un Repeat.
   - Dans un Repeat, la phase active est TOUJOURS la plus intense, la récupération la moins intense.
   - Cibles chiffrées, métrique prioritaire du sport : VÉLO "w" (watts) → sinon "hr" → sinon "rpe" ; COURSE "p" (allure min/km "M:SS") → sinon "hr" → sinon "rpe" ; NATATION "m" (mètres) + "p100" (allure /100m) → sinon "hr".
   - N'écris QUE les champs pertinents. Un champ absent est correct ; un champ à null est du gaspillage.
   - "n" est TOUJOURS renseigné : 1 pour un bloc joué une seule fois, N pour une série. Un bloc "Repeat" avec n=1 n'existe pas — c'est un bloc "Active".
   - "l" = libellé court porteur de la consigne qualitative : cadence, éducatif nommé, sensation recherchée. C'est là que vit tout ce qui n'est pas un nombre.
   **DURÉE — la somme de tes blocs EST la durée de la séance.** Elle doit OCCUPER le créneau prévu ce jour-là, à ±5 % : ni le dépasser, ni le laisser à moitié vide. Une séance de 20 min sur un créneau de 60 min est une erreur, pas une option. Écris une séance complète : échauffement, corps de séance entier avec toutes ses répétitions, retour au calme.

10. **NATATION — RÈGLES SPÉCIFIQUES (IMPÉRATIVES)** :
    a) **Volume en MÈTRES, pas en minutes.** "m" = distance d'UNE répétition (ex: Repeat n=8, m=50). Laisse "d" absent : une séance de natation ne se compte pas en temps.
    b) **Nage obligatoire** pour chaque bloc, dans "nage" : crawl / dos / brasse / papillon / 4_nages / mixte.
    c) **Matériel quand pertinent**, dans "mat" : planche, pull-buoy, palmes, plaquettes, tuba frontal, élastique. Pas de matériel décoratif.
    d) **Récup natation** : "dr" = secondes de repos au bord (ex: dr=10 pour "10'' R"), jamais des minutes ni des mètres.
    e) **ÉDUCATIFS / TECHNIQUE — INTERDIT D'ÊTRE VAGUE** : le nom de l'éducatif va dans "l". "Exercice technique", "travail technique", "drills" seuls sont INTERDITS. Utilise le vocabulaire de la natation :
       · Rattrapage (crawl — main avant attend que l'autre la rejoigne)
       · 6 temps / 3 temps (crawl — respiration tous les N coups)
       · Manchot (1 bras, l'autre le long du corps)
       · Catch-up (équivalent rattrapage en anglais)
       · Zip-up / Fermeture éclair (main remonte le long du corps)
       · Polo crawl (tête hors de l'eau)
       · Profil / Side kick (jambes sur le côté, 1 bras tendu)
       · Superman (2 bras tendus devant, jambes seules)
       · Sculls / Godillage (mouvement horizontal des mains, appuis)
       · Poings fermés (forcer l'appui avant-bras)
       · Jambes avec planche, jambes sans planche (position hydrodynamique)
       · Éducatif dos : rotation épaules, 6 battements 1 bras, etc.
       · Éducatif brasse : 2 coulées 1 bras, brasse jambes planche, etc.
    f) **Structure type natation** : Échauffement 300-600m varié (mixte) → éventuellement bloc technique avec éducatifs NOMMÉS → corps principal (série avec intensité et récups explicites) → Retour au calme 100-300m souple.
    g) **Exemple de structure natation BIEN construite** :
       [{"type":"Warmup","m":400,"nage":"mixte","l":"échauffement varié crawl/dos"},
        {"type":"Repeat","n":4,"m":50,"nage":"crawl","dr":10,"l":"25m poings fermés / 25m normal"},
        {"type":"Repeat","n":6,"m":50,"nage":"crawl","dr":15,"l":"éducatif Rattrapage"},
        {"type":"Repeat","n":6,"m":100,"nage":"crawl","p100":"1:40","dr":20,"l":"série seuil"},
        {"type":"Cooldown","m":200,"nage":"dos","l":"souple"}]
    h) **À éviter** : {"type":"Active","m":400,"l":"exercice technique"} ← éducatif non nommé, pas de récup, pas de nage.

11. **Champ "why" OBLIGATOIRE** — c'est le SEUL endroit où tu expliques le pourquoi de la séance. La structure et ses libellés restent purement factuels.
${buildWhyInstruction(profile.experience)}

## FORMAT DE RÉPONSE
Réponds UNIQUEMENT avec un tableau JSON valide — sans markdown, sans explication.
Chaque objet contient exactement :
- "dayOffset"       (number) : 0=Lundi, 6=Dimanche
- "sportType"       (string) : l'un de ${activeSports.join(", ")}
- "title"           (string) : titre court (ex: "Endurance Z2 vélo")
- "workoutType"     (string) : l'un de ["Endurance", "Tempo", "Interval", "Recovery", "Long", "Strength"]
- "durationMinutes" (number) : durée totale en minutes. Doit être ÉGALE à la somme des durées de tes blocs (elle sert de repli pour la natation et le renforcement, qui ne se comptent pas en temps).
- "plannedTSS"      (number) : TSS prévu pour cette séance
- "structure"       (array)  : les blocs de la séance (voir règle 9)
- "why"             (string) : justification pédagogique de la séance (voir règle 11)

Exemple de structure vélo — noter le motif à trois phases déplié en blocs simples,
et les durées reprises telles quelles sans être ajustées pour tomber sur un total :
[{"type":"Warmup","d":1200,"w":160,"l":"progressif Z1-Z2, cadence libre"},
 {"type":"Active","d":900,"w":224,"l":"force, cadence 50-60 RPM"},
 {"type":"Active","d":300,"w":177,"l":"vélocité, cadence >95 RPM"},
 {"type":"Rest","d":600,"w":177,"l":"récupération entre blocs"},
 {"type":"Active","d":900,"w":224,"l":"force, cadence 50-60 RPM"},
 {"type":"Active","d":300,"w":177,"l":"vélocité, cadence >95 RPM"},
 {"type":"Cooldown","d":900,"w":135,"l":""}]

## JSON :
`.trim();

    // ---- Appel IA -----------------------------------------------------------
    type AIWorkout = {
        dayOffset:       number;
        sportType:       SportType;
        title:           string;
        workoutType:     string;
        durationMinutes: number;
        plannedTSS:      number;
        structure:       unknown;
        why:             string;
    };

    const responseSchema = {
        type: "ARRAY",
        items: {
            type: "OBJECT",
            properties: {
                "dayOffset":       { type: "NUMBER" },
                "sportType":       { type: "STRING", enum: activeSports },
                "title":           { type: "STRING" },
                "workoutType":     { type: "STRING", enum: ["Endurance", "Tempo", "Interval", "Recovery", "Long", "Strength"] },
                "durationMinutes": { type: "NUMBER" },
                "plannedTSS":      { type: "NUMBER" },
                "structure":       COMPACT_STRUCTURE_SCHEMA,
                "why":             { type: "STRING" },
            },
            required: ["dayOffset", "sportType", "title", "workoutType", "durationMinutes", "plannedTSS", "structure", "why"],
        },
    };

    console.log(`[week-gen:AI] a) prep (taper+prevWeek+zones+prompt): ${ms(tPrep0)}ms — prompt ${aiPrompt.length} chars`);

    const tCall10 = performance.now();
    const { data: rawWorkouts, tokensUsed: tokensWorkouts } = await callGeminiAPI({
        contents: [{ parts: [{ text: aiPrompt }] }],
        generationConfig: {
            temperature: 0.7,
            maxOutputTokens: 16384,
            responseMimeType: "application/json",
            responseSchema,
        },
    });
    console.log(`[week-gen:AI] b) Gemini appel principal: ${ms(tCall10)}ms — ${tokensWorkouts} tokens`);
    await atomicIncrementTokenCount(tokensWorkouts);
    if (!Array.isArray(rawWorkouts)) throw new Error('Réponse IA invalide : tableau attendu.');

    // ── Validation post-IA : filtrer les séances hors programme ──
    // La durée n'est plus rabotée ici : elle découle désormais de la structure,
    // et c'est `fitStructureToSlot` qui ramène la SÉANCE dans le créneau (en
    // retirant des répétitions), de sorte que contenu et durée restent d'accord.
    // On ne retient donc à ce stade que le plafond applicable au jour.
    const tFilter0 = performance.now();
    const allowedSlots = buildAllowedSlots(weeklyAvailability, activeSports);
    const aiResponse: Array<{ w: AIWorkout; slotMaxMinutes: number | null }> = [];

    for (const w of rawWorkouts as AIWorkout[]) {
        const taperInfo = taperPlan.get(w.dayOffset);

        // Exception "déblocage obligatoire" : on laisse passer quel que soit le
        // programme de dispo, à condition que le sport corresponde à la course.
        // Pour les courses multi-disciplines (triathlon, duathlon), on accepte
        // n'importe quelle discipline d'endurance comme opener valide.
        if (taperInfo?.rule.mandatory) {
            const objSport = taperInfo.objectiveSport;
            const isMultiDiscipline = objSport === 'triathlon' || objSport === 'duathlon';
            const sportMatches = isMultiDiscipline
                ? (w.sportType === 'cycling' || w.sportType === 'running' || w.sportType === 'swimming')
                : w.sportType === objSport;
            if (sportMatches) {
                aiResponse.push({ w, slotMaxMinutes: taperInfo.rule.maxDurationMin });
                continue;
            }
        }

        const dayRule = allowedSlots.get(w.dayOffset);
        if (!dayRule) continue;
        if (!dayRule.sports.has(w.sportType)) continue;

        const slotMax = dayRule.maxMinutes[w.sportType] ?? null;
        const taperMax = taperInfo?.rule.maxDurationMin ?? null;
        const slotMaxMinutes = slotMax != null && taperMax != null
            ? Math.min(slotMax, taperMax)
            : (slotMax ?? taperMax);

        aiResponse.push({ w, slotMaxMinutes });
    }

    console.log(`[week-gen:AI] c) filtre/validation: ${ms(tFilter0)}ms — ${aiResponse.length}/${rawWorkouts.length} séances retenues`);

    // Assemblage du PlannedData : calcul pur, aucun second appel au modèle.
    // La structure vient directement de l'appel ci-dessus ; il ne reste qu'à la
    // déplier, la réparer si besoin, la ramener dans le créneau, puis en dériver
    // la durée, les cibles dominantes et le texte affiché.
    const tBuild0 = performance.now();
    const structuredWorkouts = aiResponse.map(({ w, slotMaxMinutes }) => {
        const { plannedData, issues, adjustedToSlot } = buildPlannedDataFromStructure({
            rawStructure:            w.structure,
            sportType:               w.sportType,
            slotMinutes:             slotMaxMinutes,
            fallbackDurationMinutes: slotMaxMinutes != null
                ? Math.min(w.durationMinutes, slotMaxMinutes)
                : w.durationMinutes,
            plannedTSS:              w.plannedTSS,
            why:                     w.why?.trim() || null,
        });

        if (issues.length > 0) {
            console.warn(
                `[week-gen:struct] ${w.sportType} J${w.dayOffset} "${w.title}" — ${issues.length} anomalie(s) : `
                + issues.map(i => `${i.code}${i.blockIndex != null ? `#${i.blockIndex}` : ''}`).join(', '),
            );
        }
        if (adjustedToSlot) {
            console.log(`[week-gen:struct] ${w.sportType} J${w.dayOffset} ramenée à ${plannedData.durationMinutes} min (créneau ${slotMaxMinutes} min)`);
        }

        return { w, plannedData };
    });
    console.log(`[week-gen:AI] d) assemblage structure (${aiResponse.length} séances, 0 appel IA): ${ms(tBuild0)}ms`);
    console.log(`[week-gen:AI] ✓ CreateWorkoutForWeek TOTAL: ${ms(tStart)}ms`);

    return structuredWorkouts.map(({ w, plannedData }) => {
        const workoutDate = addDays(weekStartDate, w.dayOffset);
        const wId = randomUUID();
        return {
            id:          wId,
            userId:      profile.id,
            weekId:      week.id,
            date:        format(workoutDate, 'yyyy-MM-dd'),
            sportType:   w.sportType as SportType,
            title:       w.title,
            workoutType: w.workoutType,
            mode:        'Outdoor',
            status:      'pending',
            plannedData,
            completedData: null,
        } satisfies Workout;
    });
}
