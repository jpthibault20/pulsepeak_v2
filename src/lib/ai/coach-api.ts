import { Profile } from "../data/DatabaseTypes";
import { CoachType, SportType } from "../data/type";
import { Workout } from "../data/DatabaseTypes";
import { structureSessionDescription } from "./structure-session";

// ─── Coach persona ────────────────────────────────────────────────────────────
// Role injecté en tête des prompts IA selon le coach choisi par l'athlète.
// Voir profiles.coachType (cycling | running | swimming | triathlon).

const COACH_PERSONAS: Record<CoachType, string> = {
    cycling: `Tu es un coach expert en CYCLISME (route, contre-la-montre, gravel) avec 15 ans d'expérience auprès d'équipes World Tour. Méthodologie Coggan / Friel / Seiler : périodisation polarisée, FTP/VO2max, gestion de la cadence et du pacing. Tes prescriptions vélo sont toujours chiffrées en watts ou en zones de puissance. Tu privilégies les séances vélo et utilises course/natation comme cross-training si l'athlète l'a activé.`,
    running: `Tu es un coach expert en COURSE À PIED (route, trail, piste) avec 15 ans d'expérience auprès de marathoniens et de trailers élites. Méthodologie Daniels / Fitzgerald : VMA, allures seuil, économie de course, gestion de l'allure et du dénivelé. Tes prescriptions sont toujours chiffrées en allure (min/km) ou en zones d'allure. Tu privilégies les séances course et utilises vélo/natation comme renforcement si l'athlète l'a activé.`,
    swimming: `Tu es un coach expert en NATATION (piscine, eau libre) avec 15 ans d'expérience auprès de nageurs élites et de triathlètes. Maîtrise CSS, technique (catch, glisse, rotation), éducatifs nommés (Rattrapage, 6 temps, Manchot, Sculls, Poings fermés…). Tes prescriptions sont toujours en mètres + allure /100m + récup au bord en secondes. Tu privilégies les séances natation et utilises vélo/course comme renforcement aérobie si l'athlète l'a activé.`,
    triathlon: `Tu es un coach expert en TRIATHLON (sprint à Ironman) avec 15 ans d'expérience auprès de triathlètes élites. Tu maîtrises la périodisation multisport, la gestion de la fatigue croisée, l'enchaînement des disciplines (brick), le pacing en course longue, l'affûtage pré-course. Tu équilibres natation / vélo / course et adaptes la charge en fonction de l'objectif et du profil de l'athlète.`,
};

export function buildCoachRoleIntro(coach: CoachType | undefined | null): string {
    return COACH_PERSONAS[coach ?? 'triathlon'] ?? COACH_PERSONAS.triathlon;
}

// Lecture de la clé API depuis les variables d'environnement du serveur
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const API_URL = "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent";
const MAX_RETRIES = 2;

// Fonction utilitaire pour le backoff exponentiel
function delay(ms: number) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// Fonction utilitaire pour générer des IDs uniques
function generateWorkoutId(date: string, sport: SportType): string {
    const randomSuffix = Math.random().toString(36).substring(2, 8);
    return `${sport}_${date.replace(/-/g, '')}_${randomSuffix}`;
}

// Détecte les placeholders "vides" courants renvoyés par l'IA ("N/A", "—", "None", etc.)
function isPlaceholderDescription(s: string | null | undefined): boolean {
    if (!s) return true;
    const t = s.trim();
    if (t.length === 0) return true;
    return /^(n\.?\s*\/?\s*a\.?|—+|-+|none|null|aucun|vide)$/i.test(t);
}

// Nettoie une description IA : rejette "N/A" et co, sinon retourne le trim.
function sanitizeDescription(s: string | null | undefined): string | null {
    if (isPlaceholderDescription(s)) return null;
    return s!.trim();
}

// Détecte une réponse où Gemini a émis "\n" au lieu d'échapper les accents :
// "séance" ressort en "s\n\nance", "récup" en "r\n\ncup". Le JSON reste valide
// (les \n sont correctement échappés) donc JSON.parse ne voit rien — sans ce
// garde-fou le texte mutilé part en base, et l'accent est irrécupérable.
//
// Deux signaux, exigés ensemble — chacun seul produit des faux positifs :
//
//  1. un "\n\n" entre deux minuscules (chaque accent perdu en génère exactement
//     deux). Seul, il flaguerait un vrai saut de ligne du type "4x400m\nrécup".
//  2. une densité d'accents effondrée : le mode de panne les détruit tous. Du
//     français sain tourne autour de 1 pour 30 caractères ; on ne déclenche
//     qu'en dessous de 1 pour 100.
//
// Le test se fait chaîne par chaîne sur l'objet parsé, jamais sur la réponse
// entière : la corruption est souvent partielle (titre intact, description
// mutilée) et les accents des champs sains masqueraient l'effondrement de
// densité du champ atteint.
const MANGLED_ACCENT = /[a-zà-öø-ÿ]\n\n[a-zà-öø-ÿ]/;
const ACCENTED_CHAR = /[à-öø-ÿÀ-ÖØ-Þ]/g;

// Parcourt récursivement les chaînes d'une valeur JSON parsée.
function* walkStrings(value: unknown): Generator<string> {
    if (typeof value === 'string') yield value;
    else if (Array.isArray(value)) for (const v of value) yield* walkStrings(v);
    else if (value && typeof value === 'object') for (const v of Object.values(value)) yield* walkStrings(v);
}

function assertNoMangledAccents(parsed: unknown, tag: string): void {
    for (const s of walkStrings(parsed)) {
        const m = s.match(MANGLED_ACCENT);
        if (!m) continue;

        const accents = (s.match(ACCENTED_CHAR) || []).length;
        if (accents >= s.length / 100) continue; // accents intacts → vrais sauts de ligne

        throw new Error(
            `AI response corrupted [${tag}] : accents remplacés par des sauts de ligne ` +
            `(${accents} accent(s) sur ${s.length} car., "${s.slice(0, 80)}…")`
        );
    }
}

// ─── Champ "why" (pourquoi cette séance) ──────────────────────────────────────
// Réponse au point de frustration des débutants : ils enchaînent des sorties Z2
// sans comprendre que c'est cohérent avec leur niveau. Le vocabulaire est calé
// sur profile.experience — un débutant n'a pas à décoder "capillarisation".

const WHY_LEVEL_TONE: Record<string, string> = {
    'Débutant': `Zéro jargon. Pas de "Z2", "seuil", "VO2max", "TSS" sans traduction immédiate en sensation ("allure où tu peux tenir une conversation"). Explique le bénéfice en mots du quotidien.`,
    'Intermédiaire': `Vocabulaire d'entraînement courant autorisé (zones, seuil, endurance fondamentale) sans jargon poussé. Relie la séance à sa place dans la semaine ou le bloc.`,
    'Avancé': `Vocabulaire technique assumé (filière, capillarisation, économie de course, PMA). Va droit au but sur l'adaptation physiologique visée.`,
};

/**
 * Instruction de prompt pour le champ "why" — justification pédagogique de la
 * séance affichée à l'athlète. Injectée dans les 3 chemins de génération
 * (plan complet, semaine, séance seule) pour garantir un ton homogène.
 */
export function buildWhyInstruction(experience: Profile['experience']): string {
    const tone = WHY_LEVEL_TONE[experience ?? 'Intermédiaire'] ?? WHY_LEVEL_TONE['Intermédiaire'];
    return `"why" = pourquoi CETTE séance maintenant. UNE seule phrase (100-180 caractères), adressée au sportif au tutoiement.
- Contenu : la raison d'être de la séance dans sa progression ET/OU ce qu'elle développe. Jamais le déroulé — ça, c'est "description".
- NIVEAU ${experience ?? 'Intermédiaire'} : ${tone}
- Rassure quand une séance paraît "trop facile" : si l'intensité est basse, dis explicitement pourquoi c'est le bon choix à son niveau.
- Interdit : répéter le titre, lister les intervalles, "cette séance est importante" sans dire pourquoi, "N/A", vide.
- Exemple attendu : "Du volume à allure facile pour construire ton moteur aérobie : c'est ce qui te permettra d'encaisser les séances plus dures plus tard."`;
}

/**
 * Génère un plan d'entraînement complet via l'API Gemini.
 */
// On définit l'interface de ce que l'IA va nous renvoyer (Flat Structure)
interface RawAIWorkout {
    date: string;
    sport: 'cycling' | 'running' | 'swimming';
    title: string;
    type: string;
    duration: number; // en minutes
    tss: number;
    mode: 'Outdoor' | 'Indoor';
    target_power: number | null;      // Spécifique vélo
    target_pace: string | null;       // Spécifique course/natation (ex: "5:30/km")
    target_hr: number | null;         // Universel
    description: string;              // Description unique (fusionnée)
    why: string;                      // Justification pédagogique (1 phrase)
}

// Formatage d'une allure stockée en secondes/km vers "M:SS".
function fmtPace(sec: number): string {
    const m = Math.floor(sec / 60);
    const s = Math.round(sec % 60);
    return `${m}:${String(s).padStart(2, '0')}`;
}

// Contexte zones athlète adapté au sport cible (pour le prompt du single-workout).
function buildSportZonesContext(profile: Profile, sportType: SportType): string {
    const parts: string[] = [];

    if (sportType === 'cycling' && profile.cycling?.Test?.zones) {
        const z = profile.cycling.Test.zones;
        const ftp = profile.cycling.Test.ftp;
        if (ftp) parts.push(`FTP: ${ftp} W`);
        parts.push(`ZONES PUISSANCE (W): Z1<${z.z1.max} · Z2:${z.z2.min}-${z.z2.max} · Z3:${z.z3.min}-${z.z3.max} · Z4:${z.z4.min}-${z.z4.max} · Z5:${z.z5.min}-${z.z5.max}${z.z6 ? ` · Z6:${z.z6.min}-${z.z6.max}` : ''}${z.z7 ? ` · Z7:>${z.z7.min}` : ''}`);
    }

    if (sportType === 'running' && profile.running?.Test?.zones) {
        const z = profile.running.Test.zones;
        parts.push(`ZONES ALLURE (min/km): Z1:${fmtPace(z.z1.min)}-${fmtPace(z.z1.max)} · Z2:${fmtPace(z.z2.min)}-${fmtPace(z.z2.max)} · Z3:${fmtPace(z.z3.min)}-${fmtPace(z.z3.max)} · Z4:${fmtPace(z.z4.min)}-${fmtPace(z.z4.max)} · Z5:${fmtPace(z.z5.min)}-${fmtPace(z.z5.max)}`);
    } else if (sportType === 'running' && profile.running?.Test?.vma) {
        parts.push(`VMA: ${profile.running.Test.vma} km/h`);
    }

    if (profile.heartRate?.zones) {
        const z = profile.heartRate.zones;
        parts.push(`ZONES FC (bpm): Z1<${z.z1.max} · Z2:${z.z2.min}-${z.z2.max} · Z3:${z.z3.min}-${z.z3.max} · Z4:${z.z4.min}-${z.z4.max} · Z5:${z.z5.min}-${z.z5.max}`);
    } else if (profile.heartRate?.max) {
        parts.push(`FC Max: ${profile.heartRate.max} bpm`);
    }

    return parts.length > 0 ? parts.join('\n') : "Aucune zone définie — utilise des valeurs cohérentes avec le niveau ou le RPE.";
}

// Règles spécifiques au sport (injection dans le system prompt).
function getSportRules(sportType: SportType): string {
    if (sportType === 'swimming') {
        return `NATATION — RÈGLES OBLIGATOIRES :
- Volume en MÈTRES, jamais en minutes. Toujours indiquer le TOTAL de la séance (ex: 2400m) et la distance de CHAQUE section.
- Chaque série doit préciser : nombre × distance (ex: "8x50m"), la NAGE (crawl/dos/brasse/papillon/4 nages/mixte), l'ALLURE CIBLE ou zone (ex: "allure Z3" ou "1'40''/100m"), et la RÉCUP au bord en secondes (ex: "15'' R").
- Travail technique : NOMME précisément les éducatifs (Rattrapage, 6 temps, Manchot, Catch-up, Sculls, Poings fermés, Jambes avec planche). INTERDIT : "éducatifs variés", "travail technique", "prise d'eau", sans spécifier l'éducatif précis.
- Matériel : préciser planche/pull-buoy/palmes/plaquettes/tuba quand pertinent.
- Structure attendue : échauffement varié 300-600m → bloc technique avec éducatifs nommés → corps principal (séries avec intensité + récup) → retour au calme 100-300m.

EXEMPLE DE DESCRIPTION ATTENDUE pour une séance technique 60 min (~2400m total) :
"Échauffement 600m : 300m crawl souple en respi 3 temps + 6x50m 4 nages (25m éducatif / 25m nage complète), 15'' R. Bloc technique 8x50m crawl avec palmes (2x Rattrapage + 2x 6 temps + 2x Poings fermés + 2x crawl complet glisse maximale), 20'' R. Corps principal 6x100m crawl à allure Z3 (1'40''/100m), 20'' R. Retour au calme 200m dos souple."

Ton de la description : technique, directe, sans remplissage littéraire. Cibles : allure /100m en priorité, fallback FC, dernier recours RPE.`;
    }
    if (sportType === 'cycling') {
        return `CYCLISME — RÈGLES :
- Cibles en WATTS en priorité (depuis les zones fournies), fallback FC, dernier recours RPE.
- Structure : échauffement progressif, corps avec intervalles (durée + watts/zone explicites), récups entre intervalles, retour au calme.
- Format séries : "NxD min Z? (XXX-YYY W), R:Xmin Z?".
- Toujours spécifier la durée de chaque section (ex: "Échauffement 15 min") et les valeurs exactes des cibles.`;
    }
    if (sportType === 'running') {
        return `COURSE À PIED — RÈGLES :
- Cibles en ALLURE (min/km) en priorité, fallback FC, dernier recours RPE.
- Structure : échauffement, corps avec intervalles, récups, retour au calme.
- Format séries : "NxD min à X:XX/km, R:Xmin trot".
- Toujours spécifier la durée de chaque section et les allures exactes.`;
    }
    return `Structure : échauffement, corps de séance, retour au calme. Cibles en RPE ou FC.`;
}

// Résultat d'un appel Gemini avec les tokens consommés
export interface GeminiResult<T = unknown> {
    data: T;
    tokensUsed: number;
}

// Timeout par défaut : coupe une tentative qui mouline (Gemini peut halluciner
// pendant plusieurs minutes avant de s'arrêter tout seul). Valeur par tentative,
// donc avec MAX_RETRIES=2 le worst-case devient 2*TIMEOUT.
const DEFAULT_GEMINI_TIMEOUT_MS = 60_000;

// Fonction générique pour appeler l'API
export async function callGeminiAPI(
    payload: unknown,
    tag: string = 'gemini',
    timeoutMs: number = DEFAULT_GEMINI_TIMEOUT_MS,
): Promise<GeminiResult> {
    if (!GEMINI_API_KEY) throw new Error("GEMINI_API_KEY is not set.");

    // Désactive le mode "thinking" de Gemini 2.5 Flash → 2-3x plus rapide
    const p = payload as Record<string, unknown>;
    const enhancedPayload = {
        ...p,
        generationConfig: {
            ...((p.generationConfig as Record<string, unknown>) ?? {}),
            thinkingConfig: { thinkingBudget: 0 },
        },
    };

    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
        const controller = new AbortController();
        const timeoutHandle = setTimeout(() => controller.abort(), timeoutMs);
        try {
            const response = await fetch(`${API_URL}?key=${GEMINI_API_KEY}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(enhancedPayload),
                signal: controller.signal,
            });

            if (!response.ok) {
                const errorBody = await response.text();
                throw new Error(`HTTP error! status: ${response.status}. ${errorBody.substring(0, 200)}`);
            }

            const data = await response.json();

            const rawText = data.candidates?.[0]?.content?.parts?.[0]?.text;
            const finishReason: string | undefined = data.candidates?.[0]?.finishReason;
            const tokensUsed: number = data.usageMetadata?.totalTokenCount ?? 0;

            if (!rawText) throw new Error(`AI response empty [${tag}] (finishReason=${finishReason ?? 'unknown'}).`);

            // Nettoyage du markdown éventuel
            let cleanText: string = rawText
                .trim()
                .replace(/^```json\s*/i, '')
                .replace(/^```\s*/i, '')
                .replace(/\s*```$/i, '');

            // Contre-mesure : Gemini peut produire des runs de \n ou \t dans les strings
            // (boucle de répétition) qui cassent le JSON. On collapse >=3 occurrences en une seule.
            cleanText = cleanText.replace(/(\\n){3,}/g, '\\n');
            cleanText = cleanText.replace(/(\\t){3,}/g, '\\t');
            // Tabs littéraux (caractère 0x09) interdits dans une string JSON par la spec —
            // si Gemini en émet, le parse échoue. On les remplace par un espace.
            cleanText = cleanText.replace(/\t/g, ' ');

            let parsed: unknown;
            try {
                parsed = JSON.parse(cleanText);
            } catch (parseError) {
                // Diagnostic : on remonte le finishReason et la queue du texte
                // pour distinguer une troncature (MAX_TOKENS) d'un vrai JSON cassé.
                const tail = cleanText.slice(-120).replace(/\s+/g, ' ');
                throw new Error(
                    `JSON parsing failed [${tag}] (finishReason=${finishReason ?? 'unknown'}, len=${cleanText.length}, tail="…${tail}"): ${parseError}`
                );
            }

            // Hors du try : ce rejet ne doit pas être maquillé en erreur de parsing.
            // Relance via la boucle de retry — l'accent perdu est irrécupérable,
            // seule une regénération sauve la séance.
            assertNoMangledAccents(parsed, tag);

            return { data: parsed, tokensUsed };

        } catch (error) {
            if (attempt < MAX_RETRIES - 1) {
                const backoff = Math.pow(2, attempt) * 1000;
                await delay(backoff);
            } else {
                throw error;
            }
        } finally {
            clearTimeout(timeoutHandle);
        }
    }
    throw new Error("callGeminiAPI: all retries exhausted");
}

/**
 * Génère un plan d'entraînement (Compatible Multisport & Multi-séance)
 */
export async function generatePlanFromAI(
    profile: Profile,
    history: string,
    blockFocus: string,
    customTheme: string | null,
    startDateInput: string | null,
    numWeeks?: number
): Promise<{ synthesis: string, workouts: Omit<Workout, 'userId' | 'weekId'>[] }> {
    if (!GEMINI_API_KEY) {
        console.error("ERREUR CRITIQUE: GEMINI_API_KEY est NULL.");
        throw new Error("GEMINI_API_KEY is not set.");
    }

    // --- 1. Calcul de la durée du bloc ---
    let startD = new Date();
    if (startDateInput) {
        startD = new Date(startDateInput);
    } else {
        startD.setDate(startD.getDate() + 1);
    }

    let numDays = 28; // Défaut 4 semaines
    if (blockFocus === 'Semaine de Tests (FTP, VO2max)') numDays = 7;
    else if (blockFocus === 'Personnalisé' && numWeeks) numDays = numWeeks * 7;

    
    // --- 2. Construction du Prompt ---
    
    // On récupère les contraintes de dispo
    let dateConstraints = "";
    
    // Pour l'instant on regarde la dispo globale, mais on prépare le terrain
    if (profile.weeklyAvailability) {
        for (let i = 0; i < numDays; i++) {
            const d = new Date(startD);
            d.setDate(d.getDate() + i);
            const dayIndex = d.getDay(); 
            // Attention: getDay() renvoie 0=Dimanche, 1=Lundi. 
            // Ton mapping daysMap est 0=Lundi. Il faut aligner ça. 
            // JS standard: 0=Sun, 1=Mon...6=Sat.
            // Si ton objet profile utilise "Lundi",... il faut convertir.
            // Supposons ici une conversion simple pour matcher tes clés:
            const standardDays = ["Dimanche", "Lundi", "Mardi", "Mercredi", "Jeudi", "Vendredi", "Samedi"];
            const dayName = standardDays[dayIndex]; // Clé exacte dans profile.weeklyAvailability
            
            const slot = profile.weeklyAvailability[dayName];
            const dateStr = d.toISOString().split('T')[0];

            const cyclingMin = slot?.cycling ?? 0;
            const runningMin = slot?.running ?? 0;
            const swimmingMin = slot?.swimming ?? 0;

            if (cyclingMin === 0 && runningMin === 0 && swimmingMin === 0) {
                dateConstraints += `- ${dateStr} (${dayName}): REPOS OBLIGATOIRE (0 min dispo).\n`;
            } else {
                const parts: string[] = [];
                if (cyclingMin > 0) parts.push(`vélo ${cyclingMin}min`);
                if (runningMin > 0) parts.push(`course ${runningMin}min`);
                if (swimmingMin > 0) parts.push(`natation ${swimmingMin}min`);
                dateConstraints += `- ${dateStr} (${dayName}): ${parts.join(', ')}.\n`;
            }
        }
    }

    const startDateString = startD.toISOString().split('T')[0];
    const finalFocus = blockFocus === 'Personnalisé' ? customTheme : blockFocus;

    // Contexte Zones
    // Contexte Zones
    let zonesContext = "ZONES: Utilise les % FTP/VMA standard car les zones exactes ne sont pas définies.";
    
    if (profile.cycling?.Test?.zones) {
        const z = profile.cycling.Test.zones;
        zonesContext = `
        ZONES CYCLISME ATHLÈTE (Watts) - À RESPECTER IMPÉRATIVEMENT :
        - Z1 (Récupération): < ${z.z1.max} W
        - Z2 (Endurance): ${z.z2.min} - ${z.z2.max} W
        - Z3 (Tempo): ${z.z3.min} - ${z.z3.max} W
        - Z4 (Seuil/FTP): ${z.z4.min} - ${z.z4.max} W
        - Z5 (VO2 Max): ${z.z5.min} - ${z.z5.max} W
        - Z6 (Anaérobie): ${z?.z6?.min} - ${z?.z6?.max} W
        - Z7 (Neuromusculaire): > ${z?.z7?.min} W
        `;
    }


    // Prompt système — coach personnalisé selon profile.coachType
const systemPrompt = `
RÔLE : ${buildCoachRoleIntro(profile.coachType)}

MISSION : Générer un calendrier d'entraînement JSON strict pour ton athlète, en respectant son profil, ses zones de puissance/FC et ses contraintes de temps.

RÈGLES D'OR :
1. **Physiologie avant tout** : Chaque séance doit avoir un but physiologique clair (Endurance, Seuil, VO2max, Récupération, Neuromusculaire).
2. **Respect des Zones** : Utilise les valeurs de watts/fréquence cardiaque fournies dans le prompt. Ne les invente pas.
3. **Gestion de la Charge** : Alterne les jours difficiles et faciles. Si le volume est élevé, l'intensité baisse, et vice-versa.
4. **Multisport Intelligent** : Pour le triathlon, gère la fatigue croisée (ex: pas de VMA course à pied le lendemain d'un gros seuil vélo si l'athlète est fatigué).
5. **Réalisme** :
   - Si "Indoor" : Séances structurées, courtes, intenses (intervalles).
   - Si "Outdoor" : Plus de volume, gestion du terrain, descriptions axées sur le pilotage ou la route.
6. **Contraintes Horaire** : NE JAMAIS programmer une séance plus longue que la disponibilité indiquée pour ce jour-là.
7. **Jours de Repos** : Si nécessaire, n'hésite pas à laisser des jours vides (pas de JSON généré pour ce jour) pour la récupération.
8. **Description OBLIGATOIRE** : chaque séance DOIT contenir une description unique, structurée (échauffement, corps, retour au calme avec valeurs de zones/watts/allures). JAMAIS de "N/A", jamais vide. Style télégraphique : consignes factuelles (durées, cibles chiffrées, récups). Pas d'intro pédagogique, pas de justification, pas de conclusion. Longueur 150-400 caractères (jusqu'à 600 pour natation technique). Cohérence durée : la somme des durées des blocs doit ≈ durée totale (±5%).
9. **Champ "why" OBLIGATOIRE** — c'est le SEUL endroit où tu expliques le pourquoi de la séance. La "description" reste purement factuelle.
${buildWhyInstruction(profile.experience)}
FORMAT DE RÉPONSE :
- Tu dois répondre UNIQUEMENT avec le JSON validé par le schéma fourni.
- Aucune phrase d'introduction ou de conclusion.
- LANGUE : français UNIQUEMENT pour tous les textes (title, type, description, why, synthesis). Pas d'anglais sauf termes techniques sans équivalent (FTP, TSS, RPE, VO2max).
`;

    const userPrompt = `
    PROFIL ATHLÈTE:
    - Sport pratiqué: ${profile.activeSports.cycling ? 'Cyclisme' : ''}${profile.activeSports.running ? ', Course à pied' : ''}${profile.activeSports.swimming ? ', Natation' : ''}
    - Niveau: ${profile.experience}
    - FTP (Vélo): ${profile.cycling?.Test?.ftp}W
    - Poids: ${profile.weight || '?'}kg
    ${zonesContext}

    HISTORIQUE RÉCENT:
    ${history}

    COMMANDE:
    - Date de début du plan: ${startDateString}
    - Durée totale: ${numDays} jours
    - Objectif du bloc: "${finalFocus}"

    RÈGLES DE GÉNÉRATION:
    1. **Multisport**: Pour l'instant, concentre-toi sur le CYCLISME (sauf instruction contraire explicite dans l'objectif), mais tu as le droit de proposer du Running ou Swimming si pertinent pour la récupération ou le cross-training.
    2. **Plusieurs séances**: Tu peux mettre 2 séances le même jour (ex: Matin et Soir) si le volume horaire le permet.
    3. **Jours de Repos**: Si un jour est "Repos", NE GÉNÈRE PAS d'objet dans le tableau JSON pour ce jour-là. (Le tableau ne doit contenir que les séances actives).
    4. **Contraintes**: Respecte scrupuleusement les disponibilités ci-dessous.
    
    DISPONIBILITÉS & CONTRAINTES DATE:
    ${dateConstraints}

    FORMAT JSON ATTENDU:
    Renvoie un objet avec une 'synthesis' (résumé texte) et un tableau 'workouts'.
    Chaque workout doit avoir:
    - sport: "cycling", "running" ou "swimming"
    - target_power: (null si running/swimming)
    - target_pace: (null si cycling, ex: "5:00/km")
    `;

    // --- 3. Définition du Schéma JSON pour Gemini ---
    const responseSchema = {
        type: "OBJECT",
        properties: {
            "synthesis": { "type": "STRING" },
            "workouts": {
                "type": "ARRAY",
                "items": {
                    "type": "OBJECT",
                    "properties": {
                        "date": { "type": "STRING", "description": "YYYY-MM-DD" },
                        "sport": { "type": "STRING", "enum": ["cycling", "running", "swimming"] },
                        "title": { "type": "STRING" },
                        "type": { "type": "STRING", "description": "Ex: Endurance, Intervals, Threshold, Recovery" },
                        "duration": { "type": "NUMBER", "description": "Durée en minutes" },
                        "tss": { "type": "NUMBER", "nullable": true },
                        "mode": { "type": "STRING", "enum": ["Outdoor", "Indoor"] },
                        
                        // Métriques cibles planifiées
                        "target_power": { "type": "NUMBER", "nullable": true, "description": "Watts cibles (moyenne ou intervalle clé)" },
                        "target_pace": { "type": "STRING", "nullable": true, "description": "Allure cible (Min/km ou min/100m)" },
                        "target_hr": { "type": "NUMBER", "nullable": true, "description": "BPM cible moyen" },

                        "description": { "type": "STRING", "description": "Description technique complète (échauffement, corps, retour au calme, structure d'intervalles). Jamais N/A, jamais vide." },
                        "why": { "type": "STRING", "description": "UNE phrase : pourquoi cette séance et ce qu'elle travaille, adaptée au niveau de l'athlète. Jamais N/A, jamais vide." }
                    },
                    "required": ["date", "sport", "title", "type", "duration", "mode", "description", "why"]
                }
            }
        },
        "required": ["synthesis", "workouts"]
    };

    const payload = {
        contents: [{ parts: [{ text: userPrompt }] }],
        systemInstruction: { parts: [{ text: systemPrompt }] },
        generationConfig: { responseMimeType: "application/json", responseSchema: responseSchema },
    };

    // Appel API
    const { data: rawResponse } = await callGeminiAPI(payload);
    const typedResponse = rawResponse as { synthesis: string, workouts: RawAIWorkout[] };

    // --- 4. Transformation et Nettoyage des données ---

    const structuredWorkouts: Omit<Workout, 'userId' | 'weekId'>[] = typedResponse.workouts
        // Sécurité 1: On filtre les objets invalides ou les jours de repos explicites si l'IA s'est trompée
        .filter(w => w.duration > 0 && w.title.toLowerCase() !== "repos")
        .map((w) => {
            // Génération ID unique : Type + Date + RandomString (pour gérer le multi-séance le même jour)
            // ex: cycling_2023-10-10_abc12
            const uniqueSuffix = Math.random().toString(36).substring(2, 7);
            const id = `${w.sport}_${w.date.replace(/-/g, '')}_${uniqueSuffix}`;

            return {
                id: id,
                date: w.date,
                sportType: w.sport, // 'cycling' | 'running' | 'swimming'
                title: w.title,
                workoutType: w.type,
                mode: w.mode,
                status: 'pending',
                
                // On peuple la nouvelle structure PlannedData
                plannedData: {
                    durationMinutes: w.duration,
                    plannedTSS: w.tss || null,
                    distanceKm: null, // L'IA ne le devine pas forcément bien, on laisse null
                    distanceMeters: null,

                    // Mapping des cibles selon le sport
                    targetPowerWatts: w.sport === 'cycling' ? w.target_power : null,
                    targetPaceMinPerKm: w.sport === 'running' ? w.target_pace : null,
                    targetPaceMinPer100m: w.sport === 'swimming' ? w.target_pace : null,
                    targetHeartRateBPM: w.target_hr || null,

                    description: sanitizeDescription(w.description),
                    why: sanitizeDescription(w.why),
                },

                // Pas de données réalisées pour le futur
                completedData: null
            };
        });

    return {
        synthesis: typedResponse.synthesis,
        workouts: structuredWorkouts
    };
}


/**
 * Génère une SEULE séance (création ou remplacement) pour un sport donné.
 * Le prompt et les zones s'adaptent au sportType passé en paramètre.
 */
export async function generateSingleWorkoutFromAI(
    profile: Profile,
    history: unknown,
    date: string,
    sportType: SportType,
    surroundingWorkouts: Record<string, string>,
    oldWorkout?: Workout,
    currentBlockFocus: string = "General Fitness",
    userInstruction?: string
): Promise<{ workout: Omit<Workout, 'userId' | 'weekId'>; tokensUsed: number }> {

    // Extraction des dispos
    const d = new Date(date);
    const dayName = ["Dimanche", "Lundi", "Mardi", "Mercredi", "Jeudi", "Vendredi", "Samedi"][d.getDay()];
    const slot = profile.weeklyAvailability[dayName];
    let availability: number = 60;
    if (slot && typeof slot === 'object') {
        const perSport = slot[sportType as keyof typeof slot] as number | undefined;
        if (typeof perSport === 'number' && perSport > 0) availability = perSport;
    } else if (typeof slot === 'number') {
        availability = slot;
    }

    const zonesContext = buildSportZonesContext(profile, sportType);
    const sportRules = getSportRules(sportType);

    const scheduleContextStr = Object.entries(surroundingWorkouts)
        .map(([d, desc]) => `- ${d}: ${desc}`)
        .join('\n') || '(aucun contexte)';

    let oldWorkoutContext = "Nouveau créneau.";
    if (oldWorkout) {
        oldWorkoutContext = `REMPLACE: ${oldWorkout.title} (${oldWorkout.workoutType}, ${oldWorkout.plannedData?.durationMinutes ?? 0}min)`;
    }

    const userDirective = userInstruction ? `DEMANDE UTILISATEUR: "${userInstruction}"` : "Propose une séance pertinente.";

    const systemPrompt = `${buildCoachRoleIntro(profile.coachType)}

Pour cette séance précise tu dois prescrire un entraînement de ${sportType === 'cycling' ? 'cyclisme' : sportType === 'running' ? 'course à pied' : sportType === 'swimming' ? 'natation' : 'sport'}, en gardant ta vision globale de coach pour assurer la cohérence avec le reste de la semaine. Tu génères UNE séance structurée au format JSON.

LANGUE : français. Termes techniques autorisés (FTP, TSS, RPE, VO2max).

${sportRules}

RÈGLES :
- "description" = consignes d'exécution factuelles : durées, distances, cibles chiffrées (watts/allure/FC), récups, répétitions. Style télégraphique. Pas d'intro pédagogique, pas de justification du pourquoi, pas de conclusion.
- ${buildWhyInstruction(profile.experience)}
- Cohérence durée : la somme des durées des blocs doit ≈ durée totale demandée (±5%).
- Pas de "N/A", "au choix", "varié" non précisé. Tout explicite.
- Longueur : 150-400 caractères (jusqu'à 600 pour natation technique).
- Adapte au niveau athlète (${profile.experience ?? 'Intermédiaire'}) et au focus. Respecte la durée max.

FORMAT DE SORTIE : JSON uniquement, validé par le schéma. Pas de texte avant/après.`;

    const userPrompt = `DATE: ${date}
SPORT: ${sportType.toUpperCase()}
DISPO MAX: ${availability} min
FOCUS DU BLOC: ${currentBlockFocus}
NIVEAU: ${profile.experience ?? 'Intermédiaire'}

ZONES ATHLÈTE:
${zonesContext}

${oldWorkoutContext}

${userDirective}

CONTEXTE SEMAINE:
${scheduleContextStr}

Génère UN objet JSON pour la séance.`;

    const responseSchema = {
        type: "OBJECT",
        properties: {
            "workout": {
                "type": "OBJECT",
                "properties": {
                    "title": { "type": "STRING" },
                    "type": { "type": "STRING" }, // -> workoutType
                    "duration": { "type": "NUMBER" }, // -> plannedData.durationMinutes
                    "tss": { "type": "NUMBER" }, // -> plannedData.plannedTSS
                    "mode": { "type": "STRING", "enum": ["Outdoor", "Indoor"] },
                    "description": { "type": "STRING", "description": "Description technique unique. Jamais N/A, jamais vide." },
                    "why": { "type": "STRING", "description": "UNE phrase : pourquoi cette séance et ce qu'elle travaille, adaptée au niveau de l'athlète. Jamais N/A, jamais vide." }
                },
                "required": ["title", "type", "duration", "mode", "description", "why"]
            }
        },
        "required": ["workout"]
    };

    const payload = {
        contents: [{ parts: [{ text: userPrompt }] }],
        systemInstruction: { parts: [{ text: systemPrompt }] },
        generationConfig: {
            responseMimeType: "application/json",
            responseSchema: responseSchema,
            // Compromis : assez bas pour limiter les boucles de répétition
            // observées (flots de \n), assez haut pour produire du contenu
            // détaillé plutôt qu'une version "safe" minimaliste.
            temperature: 0.5,
            // Cap dur contre les runaways. 4096 laisse de la marge pour
            // séance longue + workoutType custom.
            maxOutputTokens: 4096,
            // Filet de sécurité : coupe sur 5 vrais \n d'affilée (signe de runaway).
            // Les boucles de \\n / \\t escaped sont nettoyées en aval par cleanText.
            stopSequences: ["\n\n\n\n\n"],
        },
    };

    const { data: resultData, tokensUsed } = await callGeminiAPI(payload, `single/${sportType}/gen`);

    const w = (resultData as { workout: { title: string; type: string; duration: number; tss?: number; mode: 'Outdoor' | 'Indoor'; description: string; why?: string } }).workout;

    const rawDesc = w.description ?? '';
    const description = sanitizeDescription(rawDesc);
    const why = sanitizeDescription(w.why);

    // Second appel IA : structuration → PlannedData complet (cibles top-level + structure).
    // Si pas de description, on construit un PlannedData minimal sans appel IA.
    const { plannedData, tokensUsed: structureTokens } = description
        ? await structureSessionDescription({
            description,
            sportType,
            durationMinutes: w.duration,
            plannedTSS: w.tss ?? null,
            why,
            profile,
        })
        : {
            plannedData: {
                durationMinutes: w.duration,
                targetPowerWatts: null,
                targetPaceMinPerKm: null,
                targetPaceMinPer100m: null,
                targetHeartRateBPM: null,
                distanceKm: null,
                distanceMeters: null,
                plannedTSS: w.tss ?? null,
                description,
                why,
                structure: [],
            },
            tokensUsed: 0,
        };

    return {
        workout: {
            id: oldWorkout?.id || generateWorkoutId(date, sportType),
            date: date,
            sportType,
            title: w.title,
            workoutType: w.type,
            mode: w.mode,
            status: 'pending' as const,
            plannedData,
            completedData: null,
        },
        tokensUsed: tokensUsed + structureTokens,
    };
}

