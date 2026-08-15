/******************************************************************************
 * @file    constants.ts
 * @brief   Constantes globales pour la génération des plans d'entraînement.
 *          Basé sur les méthodologies de Friel, Coggan/Allen, Issurin, Seiler.
 ******************************************************************************/


// ---- CTL Progression -------------------------------------------------------

/**
 * Progression de la CTL (Chronic Training Load) en points par bloc (4 semaines).
 * Valeurs calibrées selon la science du coaching (Friel: 3-7 CTL/sem recommandé).
 *
 * Base  : Consolidation aérobie, progression modérée (~2 CTL/sem)
 * Build : Bloc de charge principal, progression soutenue (~3-4 CTL/sem)
 * Peak  : Intensité maximale, volume réduit, CTL se maintient (~1.5 CTL/sem)
 * Taper : Géré dynamiquement (% de CTL), pas en constante fixe
 */
export const CTL_PROGRESSION: Record<string, number> = {
    Base:   8,
    Build:  14,
    Peak:   6,
    Taper:  0,  // Placeholder — le Taper est calculé dynamiquement
};

/**
 * Multiplicateurs de progression CTL par niveau d'athlète.
 * Permet d'ajuster le ramp rate selon la capacité de récupération.
 * Sources : Coggan/Allen, TrainingPeaks ramp rate guidelines.
 *
 * Débutant : ramp conservateur (risque de blessure élevé)
 * Intermédiaire : ramp standard
 * Avancé : peut supporter un ramp plus agressif
 */
export const CTL_LEVEL_MULTIPLIER: Record<string, number> = {
    'Débutant':      0.7,
    'Intermédiaire': 1.0,
    'Avancé':        1.2,
};

/**
 * Pourcentage de drop CTL pour le Taper (affûtage pré-course).
 * La science recommande 5-10% de drop (Mujika & Padilla, 2003).
 * On utilise 8% comme valeur médiane.
 */
export const TAPER_CTL_DROP_PERCENT = 0.08;


// ---- Semaine de récupération -----------------------------------------------

/**
 * Nombre de semaines minimum dans un bloc pour déclencher
 * une semaine de récupération automatique en fin de bloc.
 * Ex : 4 semaines → 3 Load + 1 Recovery
 */
export const RECOVERY_WEEK_THRESHOLD = 3;

/**
 * Ratio appliqué au TSS de la semaine de POINTE du bloc pour calculer
 * le TSS de la semaine de récupération.
 * Consensus coaching : 40-60% de réduction (Friel, CTS, TrainerRoad).
 * On applique 50% du TSS de départ du bloc → vraie récupération.
 */
export const RECOVERY_TSS_RATIO = 0.5;


// ---- Effets résiduels (Issurin, 2008) --------------------------------------

/**
 * Durée en jours pendant laquelle les adaptations d'un type d'entraînement
 * persistent après l'arrêt du stimulus. Utilisé pour déterminer si un athlète
 * a encore les bénéfices d'un bloc passé ou s'il faut le retravailler.
 */
export const RESIDUAL_EFFECTS_DAYS: Record<string, number> = {
    'Endurance':  30,  // Base aérobie : 25-35 jours
    'Tempo':      20,  // Seuil anaérobie : 15-25 jours
    'Interval':   15,  // VO2max / PMA : 12-18 jours
    'Sprint':     8,   // Anaérobie / neuromusculaire : 5-12 jours
    'Strength':   20,  // Force : 15-25 jours
};


// ---- Taper par J-x (affûtage pré-course basé sur la distance à l'objectif) --

/**
 * Durée de la fenêtre de taper (en jours avant la course) selon la priorité.
 * Principe Mujika/Friel : garder l'intensité, réduire le volume.
 * - Principale : J-7 à J-1 (7 jours d'affûtage)
 * - Secondaire : J-4 à J-1 (4 jours d'affûtage, "mini-taper")
 */
export const TAPER_WINDOW_DAYS: Record<'principale' | 'secondaire', number> = {
    principale: 7,
    secondaire: 4,
};

/**
 * Règle appliquée à UN jour dans la fenêtre de taper.
 */
export type TaperDayRule = {
    label:             string;   // étiquette courte (ex: "J-5 · Intensité courte")
    tssRatio:          number;   // 0..1 — ratio du TSS qu'une journée moyenne de la semaine aurait
    maxDurationMin:    number;   // durée max acceptable pour ce jour
    mandatory:         boolean;  // true = séance forcée même si le jour n'est pas dans les dispos
    promptInstruction: string;   // consigne textuelle injectée dans le prompt IA pour ce jour
};

/**
 * Règles J-x pour un objectif PRINCIPAL (fenêtre 7 jours).
 * Basé sur : Mujika (taper volume -40 à -60%, intensité maintenue), Friel (openers veille),
 * Coggan (TSB positif le jour J). J-1 = déblocage OBLIGATOIRE, J-2 = récup.
 */
export const TAPER_RULES_PRINCIPAL: Record<number, TaperDayRule> = {
    7: {
        label:             'J-7 · Dernière sortie longue écourtée',
        tssRatio:          0.70,
        maxDurationMin:    150,
        mandatory:         false,
        promptInstruction: "Dernière sortie longue avant la course : la RACCOURCIR de 30 à 40 % par rapport à la sortie longue de la semaine précédente. Intensité Z2 majoritaire. Pas d'intervalles durs.",
    },
    6: {
        label:             'J-6 · Endurance courte',
        tssRatio:          0.55,
        maxDurationMin:    75,
        mandatory:         false,
        promptInstruction: "Endurance courte Z2 uniquement, 60-75 min max. Aucune intensité au-dessus de Z2.",
    },
    5: {
        label:             'J-5 · Intensité courte (rappel)',
        tssRatio:          0.65,
        maxDurationMin:    75,
        mandatory:         false,
        promptInstruction: "Une séance d'intensité COURTE pour garder les sensations et la stimulation neuromusculaire. Ex : 4×4' VO2max / 5×3' seuil / 6×2' Z5. Durée totale 45-75 min max, échauffement court. Pas de volume inutile autour.",
    },
    4: {
        label:             'J-4 · Endurance très courte',
        tssRatio:          0.45,
        maxDurationMin:    60,
        mandatory:         false,
        promptInstruction: "Endurance très courte Z1-Z2 (45-60 min max). Aucune intensité.",
    },
    3: {
        label:             'J-3 · Tempo court',
        tssRatio:          0.50,
        maxDurationMin:    50,
        mandatory:         false,
        promptInstruction: "Tempo court, 30-45 min avec 2×5' en Z3 intégrés pour maintenir le rythme. Pas plus.",
    },
    2: {
        label:             'J-2 · Récupération',
        tssRatio:          0.30,
        maxDurationMin:    45,
        mandatory:         false,
        promptInstruction: "RÉCUPÉRATION active Z1-Z2 très léger, 30-45 min max. Aucune intensité. Repos complet accepté si l'athlète se sent fatigué — précise-le dans la description.",
    },
    1: {
        label:             'J-1 · DÉBLOCAGE OBLIGATOIRE (veille de course)',
        tssRatio:          0.25,
        maxDurationMin:    30,
        mandatory:         true,
        promptInstruction: "DÉBLOCAGE / OPENERS OBLIGATOIRES, 20-30 min. Structure impérative : 10-15' Z1 easy + 3×1' Z4 à allure course (récup 1' Z1) + 5-10' retour au calme. Sport = celui de la course. Cette séance EST à planifier même si l'athlète ne l'a pas indiqué dans ses dispos.",
    },
    0: {
        label:             'J-0 · Jour de course',
        tssRatio:          0,
        maxDurationMin:    0,
        mandatory:         false,
        promptInstruction: "JOUR DE COURSE. Aucune séance à planifier — la course EST l'entraînement du jour.",
    },
};

/**
 * Règles J-x pour un objectif SECONDAIRE (fenêtre 4 jours).
 * Mini-taper : on ne sacrifie pas le bloc d'entraînement en cours.
 */
// ---- Abonnement Stripe -------------------------------------------------------

/**
 * Date de fin de l'offre de lancement (tarif réduit 5€/mois).
 * Après cette date, seuls les tarifs Pro normaux (9€/mois, 90€/an) sont proposés
 * aux nouveaux abonnés. Les abonnés déjà sur le tarif de lancement le conservent
 * (le prix Stripe souscrit ne change pas tant qu'ils restent abonnés).
 */
export const LAUNCH_OFFER_END_DATE = '2026-12-31';

/**
 * Nombre de générations de plan IA autorisées par mois pour le plan gratuit.
 */
export const FREE_PLAN_MONTHLY_AI_GENERATIONS = 1;


export const TAPER_RULES_SECONDARY: Record<number, TaperDayRule> = {
    4: {
        label:             'J-4 · Intensité courte (rappel)',
        tssRatio:          0.60,
        maxDurationMin:    60,
        mandatory:         false,
        promptInstruction: "Dernier rappel d'intensité avant la course secondaire : séance COURTE. Ex : 3×4' seuil ou 5×2' Z4. Durée 45-60 min max.",
    },
    3: {
        label:             'J-3 · Endurance courte',
        tssRatio:          0.50,
        maxDurationMin:    60,
        mandatory:         false,
        promptInstruction: "Endurance courte Z2, 45-60 min. Aucune intensité au-dessus de Z2.",
    },
    2: {
        label:             'J-2 · Récupération',
        tssRatio:          0.25,
        maxDurationMin:    30,
        mandatory:         false,
        promptInstruction: "RÉCUPÉRATION active Z1, 20-30 min max. Aucune intensité. Repos complet accepté si fatigué.",
    },
    1: {
        label:             'J-1 · DÉBLOCAGE OBLIGATOIRE (veille de course)',
        tssRatio:          0.20,
        maxDurationMin:    25,
        mandatory:         true,
        promptInstruction: "DÉBLOCAGE / OPENERS OBLIGATOIRES, 15-20 min. Structure impérative : 8-10' Z1 easy + 3×30\" Z4 à allure course (récup 1' Z1) + 5' retour au calme. Sport = celui de la course. Cette séance EST à planifier même si l'athlète ne l'a pas indiqué dans ses dispos.",
    },
    0: {
        label:             'J-0 · Jour de course',
        tssRatio:          0,
        maxDurationMin:    0,
        mandatory:         false,
        promptInstruction: "JOUR DE COURSE. Aucune séance à planifier — la course EST l'entraînement du jour.",
    },
};
