import { Profile } from "../data/DatabaseTypes";
import { PlannedData, SportType, StructureBlock, StructureSimpleBlock, StructureRepeatBlock, SwimStrokeType } from "../data/type";
import { callGeminiAPI } from "./coach-api";

const SWIM_STROKES: readonly SwimStrokeType[] = ['crawl', 'dos', 'brasse', 'papillon', '4_nages', 'mixte'];

function fmtPace(sec: number): string {
    const m = Math.floor(sec / 60);
    const s = Math.round(sec % 60);
    return `${m}:${String(s).padStart(2, '0')}`;
}

function buildZonesContext(profile: Profile, sportType: SportType): string {
    const parts: string[] = [];

    if (sportType === 'cycling' && profile.cycling?.Test?.zones) {
        const z = profile.cycling.Test.zones;
        parts.push(`ZONES PUISSANCE (W):
- Z1 Récup: <${z.z1.max}
- Z2 Endurance: ${z.z2.min}-${z.z2.max}
- Z3 Tempo: ${z.z3.min}-${z.z3.max}
- Z4 Seuil: ${z.z4.min}-${z.z4.max}
- Z5 VO2max: ${z.z5.min}-${z.z5.max}${z.z6 ? `\n- Z6 Anaérobie: ${z.z6.min}-${z.z6.max}` : ''}${z.z7 ? `\n- Z7 Neuromusculaire: >${z.z7.min}` : ''}`);
    }

    if (sportType === 'running' && profile.running?.Test?.zones) {
        const z = profile.running.Test.zones;
        parts.push(`ZONES ALLURE (min/km):
- Z1 Récup: ${fmtPace(z.z1.min)}-${fmtPace(z.z1.max)}
- Z2 Endurance: ${fmtPace(z.z2.min)}-${fmtPace(z.z2.max)}
- Z3 Tempo: ${fmtPace(z.z3.min)}-${fmtPace(z.z3.max)}
- Z4 Seuil: ${fmtPace(z.z4.min)}-${fmtPace(z.z4.max)}
- Z5 VO2max: ${fmtPace(z.z5.min)}-${fmtPace(z.z5.max)}`);
    }

    if (profile.heartRate?.zones) {
        const z = profile.heartRate.zones;
        parts.push(`ZONES FC (bpm):
- Z1: <${z.z1.max}
- Z2: ${z.z2.min}-${z.z2.max}
- Z3: ${z.z3.min}-${z.z3.max}
- Z4: ${z.z4.min}-${z.z4.max}
- Z5: ${z.z5.min}-${z.z5.max}`);
    } else if (profile.heartRate?.max) {
        parts.push(`FC Max: ${profile.heartRate.max} bpm`);
    }

    return parts.length > 0 ? parts.join('\n\n') : "Aucune zone définie pour l'athlète — utilise des valeurs cohérentes avec le niveau.";
}

// ─── Schéma de réponse Gemini ─────────────────────────────────────────────────
// Top-level = cibles dominantes de la séance + structure détaillée par bloc.
const blockItemSchema = {
    type: "OBJECT",
    properties: {
        type: { type: "STRING", enum: ["Warmup", "Active", "Rest", "Cooldown", "Repeat"] },
        repeat: { type: "NUMBER", nullable: true },

        durationActifSecondes: { type: "NUMBER", nullable: true },
        targetPowerWatts: { type: "NUMBER", nullable: true },
        targetPaceMinPerKm: { type: "STRING", nullable: true },
        targetPaceMinPer100m: { type: "STRING", nullable: true },
        targetHeartRateBPM: { type: "NUMBER", nullable: true },
        targetRPE: { type: "NUMBER", nullable: true },

        distanceMeters: { type: "NUMBER", nullable: true },
        strokeType: { type: "STRING", nullable: true, enum: ["crawl", "dos", "brasse", "papillon", "4_nages", "mixte"] },
        equipment: { type: "ARRAY", nullable: true, items: { type: "STRING" } },

        durationRecupSecondes: { type: "NUMBER", nullable: true },
        targetRecupPowerWatts: { type: "NUMBER", nullable: true },
        targetRecupPaceMinPerKm: { type: "STRING", nullable: true },
        targetRecupPaceMinPer100m: { type: "STRING", nullable: true },
        targetRecupHeartRateBPM: { type: "NUMBER", nullable: true },
        targetRecupRPE: { type: "NUMBER", nullable: true },

        distanceKm: { type: "NUMBER", nullable: true },
        plannedTSS: { type: "NUMBER", nullable: true },
        reps: { type: "NUMBER", nullable: true },
        sets: { type: "NUMBER", nullable: true },
        loadKg: { type: "NUMBER", nullable: true },

        description: { type: "STRING" },
    },
    required: ["type", "description"],
};

const responseSchema = {
    type: "OBJECT",
    properties: {
        targetPowerWatts: { type: "NUMBER", nullable: true },
        targetPaceMinPerKm: { type: "STRING", nullable: true },
        targetPaceMinPer100m: { type: "STRING", nullable: true },
        targetHeartRateBPM: { type: "NUMBER", nullable: true },
        distanceKm: { type: "NUMBER", nullable: true },
        distanceMeters: { type: "NUMBER", nullable: true },
        structure: { type: "ARRAY", items: blockItemSchema },
    },
    required: ["structure"],
};

type RawBlock = {
    type?: string;
    repeat?: number | null;

    durationActifSecondes?: number | null;
    targetPowerWatts?: number | null;
    targetPaceMinPerKm?: string | null;
    targetPaceMinPer100m?: string | null;
    targetHeartRateBPM?: number | null;
    targetRPE?: number | null;

    distanceMeters?: number | null;
    strokeType?: string | null;
    equipment?: string[] | null;

    durationRecupSecondes?: number | null;
    targetRecupPowerWatts?: number | null;
    targetRecupPaceMinPerKm?: string | null;
    targetRecupPaceMinPer100m?: string | null;
    targetRecupHeartRateBPM?: number | null;
    targetRecupRPE?: number | null;

    distanceKm?: number | null;
    plannedTSS?: number | null;
    reps?: number | null;
    sets?: number | null;
    loadKg?: number | null;

    description?: string;
};

type RawResponse = {
    targetPowerWatts?: number | null;
    targetPaceMinPerKm?: string | null;
    targetPaceMinPer100m?: string | null;
    targetHeartRateBPM?: number | null;
    distanceKm?: number | null;
    distanceMeters?: number | null;
    structure?: RawBlock[];
};

function safeStrokeType(s: string | null | undefined): SwimStrokeType | null {
    if (!s) return null;
    return (SWIM_STROKES as readonly string[]).includes(s) ? (s as SwimStrokeType) : null;
}

function safeEquipment(arr: string[] | null | undefined): string[] | null {
    if (!Array.isArray(arr) || arr.length === 0) return null;
    const cleaned = arr.map(s => String(s).trim()).filter(Boolean);
    return cleaned.length > 0 ? cleaned : null;
}

function normalizeRepeat(b: RawBlock): StructureRepeatBlock {
    return {
        type: 'Repeat',
        repeat: Math.max(1, Math.round(b.repeat ?? 1)),

        durationActifSecondes: b.durationActifSecondes ?? null,
        targetPowerWatts: b.targetPowerWatts ?? null,
        targetPaceMinPerKm: b.targetPaceMinPerKm ?? null,
        targetPaceMinPer100m: b.targetPaceMinPer100m ?? null,
        targetHeartRateBPM: b.targetHeartRateBPM ?? null,
        targetRPE: b.targetRPE ?? null,

        distanceMeters: b.distanceMeters ?? null,
        strokeType: safeStrokeType(b.strokeType),
        equipment: safeEquipment(b.equipment),

        durationRecupSecondes: b.durationRecupSecondes ?? null,
        targetRecupPowerWatts: b.targetRecupPowerWatts ?? null,
        targetRecupPaceMinPerKm: b.targetRecupPaceMinPerKm ?? null,
        targetRecupPaceMinPer100m: b.targetRecupPaceMinPer100m ?? null,
        targetRecupHeartRateBPM: b.targetRecupHeartRateBPM ?? null,
        targetRecupRPE: b.targetRecupRPE ?? null,

        description: b.description ?? '',
    };
}

function normalizeSimple(b: RawBlock): StructureSimpleBlock {
    const t = b.type;
    const safeType: StructureSimpleBlock['type'] =
        t === 'Warmup' || t === 'Active' || t === 'Rest' || t === 'Cooldown' ? t : 'Active';
    return {
        type: safeType,
        durationActifSecondes: b.durationActifSecondes ?? null,
        targetPowerWatts: b.targetPowerWatts ?? null,
        targetPaceMinPerKm: b.targetPaceMinPerKm ?? null,
        targetPaceMinPer100m: b.targetPaceMinPer100m ?? null,
        targetHeartRateBPM: b.targetHeartRateBPM ?? null,
        targetRPE: b.targetRPE ?? null,
        distanceKm: b.distanceKm ?? null,
        plannedTSS: b.plannedTSS ?? null,
        distanceMeters: b.distanceMeters ?? null,
        strokeType: safeStrokeType(b.strokeType),
        equipment: safeEquipment(b.equipment),
        reps: b.reps ?? null,
        sets: b.sets ?? null,
        loadKg: b.loadKg ?? null,
        description: b.description ?? '',
    };
}

function normalizeBlock(b: RawBlock): StructureBlock {
    return b.type === 'Repeat' ? normalizeRepeat(b) : normalizeSimple(b);
}

function paceToSeconds(pace: string | null): number | null {
    if (!pace) return null;
    const m = pace.match(/^(\d+):(\d{2})$/);
    if (!m) return null;
    return parseInt(m[1], 10) * 60 + parseInt(m[2], 10);
}

/**
 * Détecte un Repeat où l'IA a inversé les phases active/récup.
 * Heuristique : la phase active doit toujours être la plus intense. Si le signal principal
 * du sport contredit ça, on considère le bloc comme inversé. La natation est ignorée
 * (pas de paire active/récup en intensité — la récup est juste une pause au bord).
 */
function isRepeatInverted(b: StructureRepeatBlock, sport: SportType): boolean {
    if (sport === 'swimming') return false;

    if (b.targetPowerWatts != null && b.targetRecupPowerWatts != null) {
        return b.targetRecupPowerWatts > b.targetPowerWatts;
    }
    if (sport === 'running' && b.targetPaceMinPerKm && b.targetRecupPaceMinPerKm) {
        const active = paceToSeconds(b.targetPaceMinPerKm);
        const recup = paceToSeconds(b.targetRecupPaceMinPerKm);
        if (active != null && recup != null) return recup < active;
    }
    if (b.targetHeartRateBPM != null && b.targetRecupHeartRateBPM != null) {
        return b.targetRecupHeartRateBPM > b.targetHeartRateBPM;
    }
    if (b.targetRPE != null && b.targetRecupRPE != null) {
        return b.targetRecupRPE > b.targetRPE;
    }
    return false;
}

function swapRepeatPhases(b: StructureRepeatBlock): StructureRepeatBlock {
    return {
        ...b,
        durationActifSecondes: b.durationRecupSecondes,
        targetPowerWatts: b.targetRecupPowerWatts,
        targetPaceMinPerKm: b.targetRecupPaceMinPerKm,
        targetPaceMinPer100m: b.targetRecupPaceMinPer100m,
        targetHeartRateBPM: b.targetRecupHeartRateBPM,
        targetRPE: b.targetRecupRPE,

        durationRecupSecondes: b.durationActifSecondes,
        targetRecupPowerWatts: b.targetPowerWatts,
        targetRecupPaceMinPerKm: b.targetPaceMinPerKm,
        targetRecupPaceMinPer100m: b.targetPaceMinPer100m,
        targetRecupHeartRateBPM: b.targetHeartRateBPM,
        targetRecupRPE: b.targetRPE,
    };
}

function findBlocksMissingActiveDuration(structure: StructureBlock[]): number[] {
    return structure
        .map((b, i) => ({ b, i }))
        .filter(({ b }) => b.durationActifSecondes == null || b.durationActifSecondes <= 0)
        .map(({ i }) => i);
}

/**
 * Fallback de dernier recours : si après retry certaines durées sont toujours manquantes,
 * on infère des valeurs plausibles depuis la durée totale de séance. Les valeurs inférées
 * sont approximatives — le but est de ne jamais afficher "—" à l'utilisateur, pas de
 * reconstituer exactement la prescription. La description texte reste la source de vérité.
 */
function fillMissingDurationsFallback(
    structure: StructureBlock[],
    totalSessionSeconds: number,
): { filled: StructureBlock[]; filledIdx: number[] } {
    const filled = structure.map(b => ({ ...b })) as StructureBlock[];

    let knownTime = 0;
    const unknownIdx: number[] = [];
    for (let i = 0; i < filled.length; i++) {
        const b = filled[i];
        const active = b.durationActifSecondes;
        if (b.type === 'Repeat') {
            const rep = b.repeat || 1;
            if (active != null && active > 0) {
                knownTime += active * rep;
                const recup = b.durationRecupSecondes;
                if (recup != null && recup > 0) knownTime += recup * rep;
            } else {
                unknownIdx.push(i);
            }
        } else {
            if (active != null && active > 0) knownTime += active;
            else unknownIdx.push(i);
        }
    }

    if (unknownIdx.length === 0) return { filled, filledIdx: [] };

    const remaining = Math.max(60, totalSessionSeconds - knownTime);
    const perBlock = remaining / unknownIdx.length;

    for (const i of unknownIdx) {
        const b = filled[i];
        if (b.type === 'Repeat') {
            const rep = b.repeat || 1;
            const cycleTime = perBlock / rep;
            const activePart = Math.max(30, Math.round(cycleTime * 0.5));
            const recupPart = Math.max(30, Math.round(cycleTime * 0.5));
            b.durationActifSecondes = activePart;
            if (b.durationRecupSecondes == null || b.durationRecupSecondes <= 0) {
                b.durationRecupSecondes = recupPart;
            }
        } else {
            b.durationActifSecondes = Math.max(60, Math.round(perBlock));
        }
    }

    return { filled, filledIdx: unknownIdx };
}

// ─── Exemples sport-spécifiques (un seul exemple injecté selon le sport) ─────
// Le prompt est volontairement court : montrer plutôt qu'expliquer.

const EXAMPLE_CYCLING = `EXEMPLE (cyclisme) :
DESCRIPTION : "Échauffement 15 min Z2. Bloc principal : 5x3 min Z4 avec 2 min récup Z1. Retour au calme 10 min Z1."
ZONES : Z1 <130W, Z2 140-180W, Z4 240-280W
JSON :
{
  "targetPowerWatts": 260,
  "targetPaceMinPerKm": null,
  "targetPaceMinPer100m": null,
  "targetHeartRateBPM": null,
  "distanceKm": null,
  "distanceMeters": null,
  "structure": [
    { "type": "Warmup", "durationActifSecondes": 900, "targetPowerWatts": 160, "description": "Échauffement progressif Z2" },
    { "type": "Repeat", "repeat": 5, "durationActifSecondes": 180, "targetPowerWatts": 260, "durationRecupSecondes": 120, "targetRecupPowerWatts": 120, "description": "Bloc seuil 5x3'" },
    { "type": "Cooldown", "durationActifSecondes": 600, "targetPowerWatts": 110, "description": "Retour au calme" }
  ]
}`;

const EXAMPLE_RUNNING = `EXEMPLE (course à pied) :
DESCRIPTION : "Footing 10 min Z2. 6x400m allure 5K (4:00/km) avec 90s récup en trottinant. Retour au calme 5 min."
ZONES : Z2 5:30-6:00, Z1 6:00-6:30
JSON :
{
  "targetPowerWatts": null,
  "targetPaceMinPerKm": "4:00",
  "targetPaceMinPer100m": null,
  "targetHeartRateBPM": null,
  "distanceKm": null,
  "distanceMeters": null,
  "structure": [
    { "type": "Warmup", "durationActifSecondes": 600, "targetPaceMinPerKm": "5:45", "description": "Footing échauffement" },
    { "type": "Repeat", "repeat": 6, "durationActifSecondes": 96, "targetPaceMinPerKm": "4:00", "durationRecupSecondes": 90, "targetRecupPaceMinPerKm": "6:30", "description": "6x400m allure 5K" },
    { "type": "Cooldown", "durationActifSecondes": 300, "targetPaceMinPerKm": "6:00", "description": "Retour au calme" }
  ]
}`;

const EXAMPLE_SWIMMING = `EXEMPLE (natation) :
DESCRIPTION : "Échauffement 400m mixte. 8x50m crawl seuil (1:40/100m) 15'' R. 4x100m Rattrapage avec palmes 20'' R. Retour au calme 200m dos."
JSON :
{
  "targetPowerWatts": null,
  "targetPaceMinPerKm": null,
  "targetPaceMinPer100m": "1:40",
  "targetHeartRateBPM": null,
  "distanceKm": null,
  "distanceMeters": 1200,
  "structure": [
    { "type": "Warmup", "distanceMeters": 400, "strokeType": "mixte", "description": "Échauffement varié" },
    { "type": "Repeat", "repeat": 8, "distanceMeters": 50, "strokeType": "crawl", "targetPaceMinPer100m": "1:40", "durationRecupSecondes": 15, "description": "Série seuil crawl" },
    { "type": "Repeat", "repeat": 4, "distanceMeters": 100, "strokeType": "crawl", "equipment": ["palmes"], "durationRecupSecondes": 20, "description": "Rattrapage avec palmes" },
    { "type": "Cooldown", "distanceMeters": 200, "strokeType": "dos", "description": "Retour au calme dos" }
  ]
}`;

const EXAMPLE_OTHER = `EXEMPLE (renforcement) :
DESCRIPTION : "Échauffement 5 min. 4 séries de 10 squats à 60kg, 1 min récup. 3 séries de 12 fentes par jambe. Étirements 5 min."
JSON :
{
  "targetPowerWatts": null,
  "targetPaceMinPerKm": null,
  "targetPaceMinPer100m": null,
  "targetHeartRateBPM": null,
  "distanceKm": null,
  "distanceMeters": null,
  "structure": [
    { "type": "Warmup", "durationActifSecondes": 300, "description": "Échauffement mobilité" },
    { "type": "Active", "reps": 10, "sets": 4, "loadKg": 60, "targetRPE": 7, "description": "Squats 4x10 @ 60kg" },
    { "type": "Active", "reps": 12, "sets": 3, "targetRPE": 6, "description": "Fentes 3x12 par jambe" },
    { "type": "Cooldown", "durationActifSecondes": 300, "description": "Étirements" }
  ]
}`;

function getSportExample(sportType: SportType): string {
    switch (sportType) {
        case 'cycling': return EXAMPLE_CYCLING;
        case 'running': return EXAMPLE_RUNNING;
        case 'swimming': return EXAMPLE_SWIMMING;
        default: return EXAMPLE_OTHER;
    }
}

function buildSystemPrompt(sportType: SportType): string {
    return `Tu es un assistant secrétaire qui convertit une description textuelle de séance en JSON structuré.
Ton rôle : extraire les cibles dominantes de la séance (top-level) et structurer le détail bloc par bloc. Tu ne crées rien — tu retranscris fidèlement ce qui est décrit.

LANGUE : français. Termes techniques autorisés (FTP, TSS, RPE, Z1-Z7, vocabulaire natation : Rattrapage, Sculls, Manchot, etc.).

CIBLES TOP-LEVEL — la cible "principale" de la séance :
- targetPowerWatts : cyclisme uniquement
- targetPaceMinPerKm : course à pied uniquement (format "M:SS")
- targetPaceMinPer100m : natation uniquement (format "M:SS")
- targetHeartRateBPM : si la séance est explicitement pilotée FC
- distanceKm : volume total vélo / course si mentionné
- distanceMeters : volume total natation si mentionné
Pour une séance d'intervalles, la cible dominante = la cible des intervalles (pas l'échauffement). Pour une endurance continue, la cible = celle du bloc principal. null pour les champs non pertinents au sport.

FIDÉLITÉ AU TEXTE — RÈGLE PRIMORDIALE :
Tu retranscris les durées du texte LITTÉRALEMENT. "10 min" → 600s, "5 min récup" → 300s. JAMAIS arrondir, JAMAIS redistribuer pour faire coller à DURÉE TOTALE. La somme de tes durées PEUT diverger de DURÉE TOTALE — c'est acceptable. Si tes durées tombent PILE sur la durée totale alors qu'elles n'apparaissent pas telles quelles dans le texte, c'est un signe que tu as redistribué : recommence en lisant les durées explicites.

ANTI-PATTERN (à NE JAMAIS reproduire) :
DESCRIPTION : "15 min Z2. 3x10 min Z3 avec 5 min récup Z2 ENTRE. 5 min retour au calme." (DURÉE TOTALE = 60 min)
✗ MAUVAIS : Repeat(repeat=3, durationActif=400s, durationRecup=400s) — les 400s n'existent NULLE PART dans le texte ; l'IA a divisé 2400s par 6 phases pour atteindre 60 min pile. Trahit la prescription.
✓ BON : Repeat(repeat=2, durationActif=600, durationRecup=300) puis Active(durée=600, cible identique). Total : 15+10+5+10+5+10+5 = 60 min. Les 600/300 viennent directement du texte.

STRUCTURE — types de blocs :
- "Warmup" / "Active" / "Rest" / "Cooldown" : blocs simples à intensité constante.
- "Repeat" : motif (phase active + récup) répété N fois. À utiliser DÈS qu'un motif identique se répète ≥ 2 fois (même implicitement).
- PATTERN "N blocs avec récup ENTRE eux" (= N phases actives, N-1 récup, ex: "3x10 min avec 5 min récup entre") : utilise Repeat(repeat=N-1) PUIS un bloc Active simple identique au final. Ne mets JAMAIS Repeat(repeat=N) en raccourcissant les durées pour absorber la récup "en trop" — voir ANTI-PATTERN ci-dessus.
- Dans un Repeat : la phase ACTIVE est TOUJOURS la plus intense, la phase RÉCUP la moins intense (peu importe leurs durées). Conséquences : targetRecupPowerWatts ≤ targetPowerWatts ; targetRecupPaceMinPerKm ≥ targetPaceMinPerKm (allure plus lente = plus facile) ; targetRecupHeartRateBPM ≤ targetHeartRateBPM.
- Conversion zones : "Z4" → milieu de la plage Z4 fournie. Si une valeur explicite est donnée, utilise-la directement.
- durationActifSecondes : OBLIGATOIRE pour cycling / running (convertis "3 min" → 180, "30s" → 30). Optionnel en natation si la distance suffit.
- Natation : remplis distanceMeters + strokeType + equipment + targetPaceMinPer100m. Stroke par défaut : "crawl". Pour échauffement varié : "mixte". durationRecupSecondes = pause au bord (ex: "15'' R" → 15).
- Remplis UNIQUEMENT les champs pertinents au sport, laisse les autres à null.

${getSportExample(sportType)}

RÉPONDS UNIQUEMENT par l'objet JSON validé par le schéma fourni. Aucun texte autour, aucune explication.`;
}

/**
 * Construit un PlannedData "fallback" en cas d'échec IA — préserve les infos
 * connues en amont (durée, TSS, description) et laisse tout le reste à null.
 */
function buildFallbackPlanned(input: {
    description: string;
    durationMinutes: number;
    plannedTSS: number | null;
    why?: string | null;
}): PlannedData {
    return {
        durationMinutes: input.durationMinutes,
        targetPowerWatts: null,
        targetPaceMinPerKm: null,
        targetPaceMinPer100m: null,
        targetHeartRateBPM: null,
        distanceKm: null,
        distanceMeters: null,
        plannedTSS: input.plannedTSS,
        description: input.description,
        why: input.why ?? null,
        structure: [],
    };
}

/**
 * Prend une description texte de séance et renvoie un PlannedData complet :
 * cibles dominantes top-level + structure détaillée par bloc.
 *
 * Les champs durationMinutes, plannedTSS, description et why proviennent de
 * l'amont et sont passés tels quels — l'IA ne peut pas les modifier (zéro risque
 * de dérive sur la durée de la séance).
 *
 * En cas d'échec (parsing, exception, structure vide), renvoie un PlannedData
 * minimal avec structure=[] et toutes les cibles à null. Ne lève jamais.
 */
export async function structureSessionDescription(params: {
    description: string;
    sportType: SportType;
    durationMinutes: number;
    plannedTSS: number | null;
    why?: string | null;
    profile: Profile;
}): Promise<{ plannedData: PlannedData; tokensUsed: number }> {
    const { description, sportType, durationMinutes, plannedTSS, why, profile } = params;

    if (!description || description.trim().length === 0) {
        return { plannedData: buildFallbackPlanned(params), tokensUsed: 0 };
    }

    const zonesContext = buildZonesContext(profile, sportType);
    const systemPrompt = buildSystemPrompt(sportType);
    const userPrompt = `SPORT : ${sportType}
DURÉE TOTALE : ${durationMinutes} min

${zonesContext}

DESCRIPTION À STRUCTURER :
${description}`;

    try {
        const { data, tokensUsed } = await callGeminiAPI({
            contents: [{ parts: [{ text: userPrompt }] }],
            systemInstruction: { parts: [{ text: systemPrompt }] },
            generationConfig: {
                temperature: 0.2,
                maxOutputTokens: 4096,
                responseMimeType: "application/json",
                responseSchema,
            },
        }, `struct/${sportType}`);

        const parsed = data as RawResponse | null;
        if (!parsed || !Array.isArray(parsed.structure)) {
            return { plannedData: buildFallbackPlanned(params), tokensUsed };
        }

        let structure: StructureBlock[] = parsed.structure.map(normalizeBlock);
        let totalTokens = tokensUsed;

        const applyInversionSwap = (blocks: StructureBlock[]): StructureBlock[] => {
            const out = blocks.slice();
            for (let i = 0; i < out.length; i++) {
                const block = out[i];
                if (block.type === 'Repeat' && isRepeatInverted(block, sportType)) {
                    out[i] = swapRepeatPhases(block);
                }
            }
            return out;
        };

        structure = applyInversionSwap(structure);

        // Retry ciblé pour cycling / running quand des durées actives manquent.
        if (sportType === 'cycling' || sportType === 'running') {
            const missingIdx = findBlocksMissingActiveDuration(structure);
            if (missingIdx.length > 0) {
                const retryUserPrompt = `${userPrompt}

PREMIÈRE STRUCTURE PROPOSÉE (à corriger) :
${JSON.stringify({ structure }, null, 2)}

CORRECTION : les blocs aux indexes [${missingIdx.join(',')}] ont "durationActifSecondes" manquant. Pour ${sportType} ce champ est OBLIGATOIRE. Renvoie l'objet JSON COMPLET avec toutes les durées corrigées.`;

                try {
                    const { data: retryData, tokensUsed: retryTokens } = await callGeminiAPI({
                        contents: [{ parts: [{ text: retryUserPrompt }] }],
                        systemInstruction: { parts: [{ text: systemPrompt }] },
                        generationConfig: {
                            temperature: 0.2,
                            maxOutputTokens: 4096,
                            responseMimeType: "application/json",
                            responseSchema,
                        },
                    }, `struct-retry/${sportType}`);
                    totalTokens += retryTokens;

                    const retryParsed = retryData as RawResponse | null;
                    if (retryParsed && Array.isArray(retryParsed.structure) && retryParsed.structure.length > 0) {
                        const retriedStructure = retryParsed.structure.map(normalizeBlock);
                        const retriedMissing = findBlocksMissingActiveDuration(retriedStructure);
                        if (retriedMissing.length < missingIdx.length) {
                            structure = applyInversionSwap(retriedStructure);
                            // Le retry peut aussi avoir affiné les top-level ; on les reprend.
                            parsed.targetPowerWatts = retryParsed.targetPowerWatts ?? parsed.targetPowerWatts;
                            parsed.targetPaceMinPerKm = retryParsed.targetPaceMinPerKm ?? parsed.targetPaceMinPerKm;
                            parsed.targetPaceMinPer100m = retryParsed.targetPaceMinPer100m ?? parsed.targetPaceMinPer100m;
                            parsed.targetHeartRateBPM = retryParsed.targetHeartRateBPM ?? parsed.targetHeartRateBPM;
                            parsed.distanceKm = retryParsed.distanceKm ?? parsed.distanceKm;
                            parsed.distanceMeters = retryParsed.distanceMeters ?? parsed.distanceMeters;
                        }
                    }
                } catch {
                    // On garde la première structure en cas d'échec du retry.
                }
            }
        }

        if (sportType !== 'swimming') {
            const stillMissing = findBlocksMissingActiveDuration(structure);
            if (stillMissing.length > 0) {
                const { filled } = fillMissingDurationsFallback(structure, durationMinutes * 60);
                structure = filled;
            }
        }

        const plannedData: PlannedData = {
            durationMinutes,
            targetPowerWatts: parsed.targetPowerWatts ?? null,
            targetPaceMinPerKm: parsed.targetPaceMinPerKm ?? null,
            targetPaceMinPer100m: parsed.targetPaceMinPer100m ?? null,
            targetHeartRateBPM: parsed.targetHeartRateBPM ?? null,
            distanceKm: parsed.distanceKm ?? null,
            distanceMeters: parsed.distanceMeters ?? null,
            plannedTSS,
            description,
            why: why ?? null,
            structure,
        };

        return { plannedData, tokensUsed: totalTokens };
    } catch {
        return { plannedData: buildFallbackPlanned(params), tokensUsed: 0 };
    }
}
