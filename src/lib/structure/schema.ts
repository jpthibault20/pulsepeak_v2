/**
 * Schéma COMPACT de structure de séance — le format que l'IA renvoie directement
 * dans l'appel de génération, et qui remplace la description en prose.
 *
 * Pourquoi un format compact plutôt que le type domaine `StructureBlock` :
 * un bloc domaine porte une vingtaine de champs, tous nullables. Demandé tel quel
 * à Gemini, chaque bloc coûte une vingtaine de `"targetPaceMinPer100m": null` en
 * sortie — soit, sur une semaine de 6 séances à 4 blocs, plusieurs milliers de
 * tokens de remplissage. Le format compact ne nomme que ce qui est rempli.
 *
 * L'expansion vers `StructureBlock` se fait ici, en TypeScript pur : le type
 * domaine, la colonne jsonb et l'UI restent inchangés.
 */

import type {
    StructureBlock,
    StructureRepeatBlock,
    StructureSimpleBlock,
    SwimStrokeType,
} from '@/lib/data/type';

export const SWIM_STROKES: readonly SwimStrokeType[] = [
    'crawl', 'dos', 'brasse', 'papillon', '4_nages', 'mixte',
];

/** Bloc tel que l'IA le renvoie. Tout est optionnel sauf le type et le libellé. */
export interface CompactBlock {
    type?: string;
    /** Repeat : nombre de répétitions */
    n?: number | null;
    /** Durée de la phase active, en secondes */
    d?: number | null;
    /** Repeat : durée de la récupération entre deux répétitions, en secondes */
    dr?: number | null;
    /** Natation : distance d'UNE répétition, en mètres */
    m?: number | null;

    /** Vélo : watts (actif / récup) */
    w?: number | null;
    wr?: number | null;
    /** Course : allure "M:SS" au km (actif / récup) */
    p?: string | null;
    pr?: string | null;
    /** Natation : allure "M:SS" aux 100 m */
    p100?: string | null;
    /** FC bpm (actif / récup) */
    hr?: number | null;
    hrr?: number | null;
    /** RPE 1-10 */
    rpe?: number | null;

    /** Natation : nage et matériel */
    nage?: string | null;
    mat?: string[] | null;

    /** Renforcement */
    reps?: number | null;
    sets?: number | null;
    kg?: number | null;

    /** Libellé court du bloc */
    l?: string | null;
}

/**
 * Schéma Gemini (`responseSchema`) d'un bloc compact.
 *
 * Les `description` sont payées une seule fois, en entrée, à la construction du
 * prompt — c'est le bon endroit où dépenser : elles évitent d'expliquer le format
 * en prose dans le prompt lui-même.
 */
export const COMPACT_BLOCK_SCHEMA = {
    type: "OBJECT",
    properties: {
        type: {
            type: "STRING",
            enum: ["Warmup", "Active", "Rest", "Cooldown", "Repeat"],
            description: "Warmup=échauffement, Active=effort, Rest=récupération isolée, Cooldown=retour au calme, Repeat=motif (actif+récup) répété n fois",
        },
        n: { type: "NUMBER", description: "Nombre de répétitions du motif. TOUJOURS renseigné : 1 pour un bloc joué une seule fois, N pour un Repeat" },
        d: { type: "NUMBER", description: "Durée de la phase ACTIVE en SECONDES. TOUJOURS renseigné : 0 seulement si le bloc se compte en mètres (natation)" },
        dr: { type: "NUMBER", description: "Durée de la récupération INTERCALÉE entre deux répétitions, en secondes. TOUJOURS renseigné : obligatoire dès que n>1, 0 si le bloc n'est pas une série" },
        m: { type: "NUMBER", description: "Natation : distance d'UNE répétition en mètres (ex: 50, 100, 400)" },

        w: { type: "NUMBER", description: "Vélo : puissance cible de la phase active, en watts" },
        wr: { type: "NUMBER", description: "Vélo : puissance de la phase de récupération, en watts" },
        p: { type: "STRING", description: "Course : allure cible au km, format \"M:SS\" (ex: \"4:30\")" },
        pr: { type: "STRING", description: "Course : allure de la récupération au km, format \"M:SS\"" },
        p100: { type: "STRING", description: "Natation : allure cible aux 100 m, format \"M:SS\"" },
        hr: { type: "NUMBER", description: "Fréquence cardiaque cible en bpm" },
        hrr: { type: "NUMBER", description: "Fréquence cardiaque de la récupération en bpm" },
        rpe: { type: "NUMBER", description: "Effort perçu cible, 1 à 10" },

        nage: {
            type: "STRING",
            enum: ["crawl", "dos", "brasse", "papillon", "4_nages", "mixte"],
            description: "Natation : nage principale du bloc",
        },
        mat: {
            type: "ARRAY",
            items: { type: "STRING" },
            description: "Natation : matériel (planche, pull-buoy, palmes, plaquettes, tuba)",
        },

        reps: { type: "NUMBER", description: "Renforcement : répétitions par série" },
        sets: { type: "NUMBER", description: "Renforcement : nombre de séries" },
        kg: { type: "NUMBER", description: "Renforcement : charge en kg" },

        l: {
            type: "STRING",
            description: "Libellé court et concret du bloc (ex: \"force 50-60 RPM\", \"éducatif Rattrapage\"). C'est ici que vit la consigne qualitative.",
        },
    },
    // `n`, `d` et `dr` sont exigés pour fermer la porte aux omissions
    // silencieuses. Le modèle remplit ce qu'on lui impose et saute le reste :
    // sans `n`, une série devenait « 1× (1 min à 350 W) » ; sans `dr`, un
    // 4×5 min VO2max s'affichait sans la moindre récupération entre les
    // répétitions — une séance infaisable.
    required: ["type", "n", "d", "dr", "l"],
} as const;

export const COMPACT_STRUCTURE_SCHEMA = {
    type: "ARRAY",
    items: COMPACT_BLOCK_SCHEMA,
} as const;

// ─── Expansion vers le type domaine ───────────────────────────────────────────

function num(v: number | null | undefined): number | null {
    return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

/** Une durée n'est retenue que strictement positive : 0 seconde n'est pas une durée. */
function positive(v: number | null | undefined): number | null {
    const n = num(v);
    return n != null && n > 0 ? n : null;
}

function str(v: string | null | undefined): string | null {
    if (typeof v !== 'string') return null;
    const t = v.trim();
    return t.length > 0 ? t : null;
}

function safeStroke(v: string | null | undefined): SwimStrokeType | null {
    const s = str(v);
    if (!s) return null;
    return (SWIM_STROKES as readonly string[]).includes(s) ? (s as SwimStrokeType) : null;
}

function safeEquipment(v: string[] | null | undefined): string[] | null {
    if (!Array.isArray(v)) return null;
    const cleaned = v.map(e => String(e).trim()).filter(Boolean);
    return cleaned.length > 0 ? cleaned : null;
}

function expandRepeat(b: CompactBlock): StructureRepeatBlock {
    return {
        type: 'Repeat',
        repeat: Math.max(1, Math.round(num(b.n) ?? 1)),

        durationActifSecondes: positive(b.d),
        targetPowerWatts: num(b.w),
        targetPaceMinPerKm: str(b.p),
        targetPaceMinPer100m: str(b.p100),
        targetHeartRateBPM: num(b.hr),
        targetRPE: num(b.rpe),

        distanceMeters: positive(b.m),
        strokeType: safeStroke(b.nage),
        equipment: safeEquipment(b.mat),

        durationRecupSecondes: positive(b.dr),
        targetRecupPowerWatts: num(b.wr),
        targetRecupPaceMinPerKm: str(b.pr),
        targetRecupPaceMinPer100m: null,
        targetRecupHeartRateBPM: num(b.hrr),
        targetRecupRPE: null,

        description: str(b.l) ?? '',
    };
}

function expandSimple(b: CompactBlock): StructureSimpleBlock {
    const t = b.type;
    const type: StructureSimpleBlock['type'] =
        t === 'Warmup' || t === 'Rest' || t === 'Cooldown' ? t : 'Active';

    return {
        type,
        durationActifSecondes: positive(b.d),
        targetPowerWatts: num(b.w),
        targetPaceMinPerKm: str(b.p),
        targetPaceMinPer100m: str(b.p100),
        targetHeartRateBPM: num(b.hr),
        targetRPE: num(b.rpe),

        distanceKm: null,
        plannedTSS: null,

        distanceMeters: positive(b.m),
        strokeType: safeStroke(b.nage),
        equipment: safeEquipment(b.mat),

        reps: num(b.reps),
        sets: num(b.sets),
        loadKg: num(b.kg),

        description: str(b.l) ?? '',
    };
}

export function expandCompactBlock(b: CompactBlock): StructureBlock {
    return b.type === 'Repeat' ? expandRepeat(b) : expandSimple(b);
}

/**
 * Un « Repeat » joué une seule fois n'est pas une série : c'est un effort, suivi
 * le cas échéant d'une récupération. On le rend donc sous sa vraie forme, plutôt
 * que d'afficher « 1× (…) » — qui trahissait surtout une omission du modèle.
 */
function degradeSingleRepeat(b: CompactBlock): CompactBlock[] {
    const work: CompactBlock = { ...b, type: 'Active', n: 1, dr: null };
    const recupSeconds = positive(b.dr);
    if (recupSeconds == null) return [work];

    return [
        work,
        {
            type: 'Rest',
            d: recupSeconds,
            w: b.wr,
            p: b.pr,
            hr: b.hrr,
            l: 'récupération',
        },
    ];
}

/**
 * Convertit la réponse brute de l'IA en structure domaine.
 *
 * Les blocs « non exécutables » — ni durée, ni distance, ni répétitions de
 * renforcement — sont écartés : ils ne portent aucune prescription et ne feraient
 * qu'afficher un tiret. On préfère une structure plus courte à une structure
 * trouée, et on ne comble JAMAIS un trou par une durée inventée.
 */
export function expandCompactStructure(raw: unknown): StructureBlock[] {
    if (!Array.isArray(raw)) return [];
    return raw
        .flatMap((b): CompactBlock[] => {
            const block = (b ?? {}) as CompactBlock;
            const repeats = Math.round(num(block.n) ?? 1);
            return block.type === 'Repeat' && repeats <= 1
                ? degradeSingleRepeat(block)
                : [block];
        })
        .map(expandCompactBlock)
        .filter(isSchedulable);
}

/** Un bloc porte une prescription exécutable s'il a une durée, une distance ou des séries. */
export function isSchedulable(b: StructureBlock): boolean {
    if (b.durationActifSecondes != null) return true;
    if (b.distanceMeters != null) return true;
    if (b.type !== 'Repeat' && b.reps != null && b.sets != null) return true;
    return false;
}
