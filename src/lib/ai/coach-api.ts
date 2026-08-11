import { Profile } from "../data/DatabaseTypes";
import { SportType } from "../data/type";
import { Workout } from "../data/DatabaseTypes";
import { COMPACT_STRUCTURE_SCHEMA } from "../structure/schema";
import { buildPlannedDataFromStructure } from "../structure/planned-data";
import { buildCoachRoleIntro } from "./coach-persona";

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
- Volume en MÈTRES : "m" = distance d'UNE répétition (Repeat n=8, m=50 pour un 8x50m). Laisse "d" absent, une séance de natation ne se compte pas en temps.
- Chaque bloc précise la NAGE dans "nage" (crawl/dos/brasse/papillon/4_nages/mixte), la cible dans "p100" (allure /100m, format "M:SS") sinon "hr", et la RÉCUP au bord dans "dr" en secondes.
- Travail technique : NOMME l'éducatif dans "l" (Rattrapage, 6 temps, Manchot, Catch-up, Sculls, Poings fermés, Jambes avec planche). INTERDIT : "éducatifs variés", "travail technique", "prise d'eau" sans préciser lequel.
- Matériel dans "mat" : planche/pull-buoy/palmes/plaquettes/tuba quand pertinent.
- Enchaînement attendu : échauffement varié 300-600m → bloc technique avec éducatifs nommés → corps principal (séries avec intensité + récup) → retour au calme 100-300m.

EXEMPLE pour une séance technique (~2400m) :
[{"type":"Warmup","m":600,"nage":"mixte","l":"crawl souple respi 3 temps"},
 {"type":"Repeat","n":8,"m":50,"nage":"crawl","mat":["palmes"],"dr":20,"l":"éducatif Rattrapage puis 6 temps"},
 {"type":"Repeat","n":6,"m":100,"nage":"crawl","p100":"1:40","dr":20,"l":"corps principal Z3"},
 {"type":"Cooldown","m":200,"nage":"dos","l":"souple"}]`;
    }
    if (sportType === 'cycling') {
        return `CYCLISME — RÈGLES :
- Cibles en WATTS ("w", depuis les zones fournies) en priorité, fallback "hr", dernier recours "rpe".
- Enchaînement : échauffement progressif → corps avec intervalles → récups → retour au calme.
- Chaque bloc porte sa durée "d" en SECONDES. Une série est un Repeat : n, d + w pour l'effort, dr + wr pour la récup.`;
    }
    if (sportType === 'running') {
        return `COURSE À PIED — RÈGLES :
- Cibles en ALLURE ("p", format "M:SS" au km) en priorité, fallback "hr", dernier recours "rpe".
- Enchaînement : échauffement → corps avec intervalles → récups → retour au calme.
- Chaque bloc porte sa durée "d" en SECONDES. Une série est un Repeat : n, d + p pour l'effort, dr + pr pour la récup en trot.`;
    }
    return `Enchaînement : échauffement, corps de séance, retour au calme. Cibles en "rpe" ou "hr". Renforcement : "sets", "reps", "kg".`;
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
    userInstruction?: string,
    /**
     * Durée explicitement demandée par l'utilisateur. Quand elle est fournie,
     * elle prime sur la disponibilité du créneau et devient la cible que la
     * structure doit atteindre — au lieu d'être plaquée sur la séance APRÈS
     * génération, ce qui désaccordait la durée affichée et le contenu réel.
     */
    targetDurationMinutes?: number,
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

    const targetDuration = targetDurationMinutes != null && targetDurationMinutes > 0
        ? Math.round(targetDurationMinutes)
        : availability;

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
- **"structure" EST la séance** : une liste de blocs dans l'ordre d'exécution. Il n'y a pas de description en prose — le texte lu par l'athlète est écrit à partir de ta structure. Ce qui n'est pas dans un bloc n'existe pas.
- Types de blocs : "Warmup", "Active", "Rest", "Cooldown", "Repeat". Un "Repeat" porte DEUX phases au maximum (effort + récup intercalée). Un motif à trois phases ou plus se déplie en blocs simples successifs — ne raccourcis JAMAIS une durée pour la faire entrer dans un Repeat.
- **Dès que n>1, "dr" est OBLIGATOIRE et strictement positif** : une série sans récupération entre les répétitions n'est pas une série, c'est un bloc continu. Un 4×5 min VO2max sans récup est infaisable. "dr":0 uniquement sur un bloc qui n'est pas une série.
- Dans un Repeat, la phase active est toujours la plus intense, la récupération la moins intense.
- "d" et "dr" en SECONDES, en valeurs rondes (multiple de 60 au-delà de 5 min).
- "l" = libellé court portant la consigne qualitative (cadence, éducatif nommé, sensation). Tout ce qui n'est pas un nombre vit là.
- N'écris que les champs pertinents au sport ; un champ absent vaut mieux qu'un champ nul.
- ${buildWhyInstruction(profile.experience)}
- Pas de "N/A", "au choix", "varié" non précisé. Tout explicite.
- **DURÉE : la somme de tes blocs EST la durée de la séance, et elle doit valoir ${targetDuration} min à ±5 %.** Ni au-dessus, ni à moitié : une séance de 20 min quand on t'en demande ${targetDuration} est une erreur. Écris la séance ENTIÈRE — échauffement, corps de séance avec toutes ses répétitions, retour au calme. Reporte la même valeur dans "duration". Seule exception : si la demande ci-dessous te demande explicitement d'alléger ou de raccourcir la séance, suis-la.
- Adapte au niveau athlète (${profile.experience ?? 'Intermédiaire'}) et au focus.

FORMAT DE SORTIE : JSON uniquement, validé par le schéma. Pas de texte avant/après.`;

    const userPrompt = `DATE: ${date}
SPORT: ${sportType.toUpperCase()}
DURÉE CIBLE: ${targetDuration} min (somme des blocs, ±5%)
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
                    "structure": COMPACT_STRUCTURE_SCHEMA,
                    "why": { "type": "STRING", "description": "UNE phrase : pourquoi cette séance et ce qu'elle travaille, adaptée au niveau de l'athlète. Jamais N/A, jamais vide." }
                },
                "required": ["title", "type", "duration", "mode", "structure", "why"]
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

    const w = (resultData as { workout: { title: string; type: string; duration: number; tss?: number; mode: 'Outdoor' | 'Indoor'; structure?: unknown; why?: string } }).workout;

    const why = sanitizeDescription(w.why);

    // Assemblage local : la structure vient de l'appel ci-dessus, la durée, les
    // cibles dominantes et le texte affiché s'en déduisent. Aucun second appel.
    const { plannedData, issues } = buildPlannedDataFromStructure({
        rawStructure:            w.structure,
        sportType,
        slotMinutes:             targetDuration,
        fallbackDurationMinutes: targetDuration,
        plannedTSS:              w.tss ?? null,
        why,
    });

    if (issues.length > 0) {
        console.warn(
            `[single-gen:struct] ${sportType} ${date} "${w.title}" — `
            + issues.map(i => `${i.code}${i.blockIndex != null ? `#${i.blockIndex}` : ''}`).join(', '),
        );
    }

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
        tokensUsed,
    };
}

