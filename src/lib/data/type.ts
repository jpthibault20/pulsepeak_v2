export type CoachType = 'cycling' | 'running' | 'swimming' | 'triathlon';

export enum ReturnCode {
  RC_OK,
  RC_Warning,
  RC_Error,
  RC_Undefined
}

export interface AvailabilitySlot {
  swimming: number;
  cycling: number;
  running: number;
  comment: string;
  aiChoice: boolean;
}
export interface PlannedData {
  durationMinutes: number;
  targetPowerWatts: number | null;       // cible dominante vélo
  targetPaceMinPerKm: string | null;     // cible dominante course ("M:SS")
  targetPaceMinPer100m: string | null;   // cible dominante natation ("M:SS")
  targetHeartRateBPM: number | null;     // cible FC tous sports
  distanceKm: number | null;             // volume total vélo / course
  distanceMeters: number | null;         // volume total natation
  plannedTSS: number | null;
  description: string | null;
  structure?: StructureBlock[];
}

/**
 * Types de nage (natation).
 */
export type SwimStrokeType =
  | 'crawl'       // freestyle
  | 'dos'         // backstroke
  | 'brasse'      // breaststroke
  | 'papillon'    // butterfly
  | '4_nages'     // IM
  | 'mixte';      // mélange (échauffement varié, etc.)

/**
 * Bloc "simple" (non répétable). Utilisé au top-level et à l'intérieur d'un Repeat.
 */
export interface StructureSimpleBlock {
  type: 'Warmup' | 'Active' | 'Rest' | 'Cooldown';
  durationActifSecondes: number | null;

  // Cibles multi-sports (toutes nullable — l'IA remplit celles pertinentes au sport)
  targetPowerWatts: number | null;        // cyclisme
  targetPaceMinPerKm: string | null;      // course à pied ("5:30")
  targetPaceMinPer100m: string | null;    // natation ("1:45")
  targetHeartRateBPM: number | null;      // tous sports
  targetRPE: number | null;               // 1-10, tous sports

  distanceKm: number | null;              // vélo / course (distance en km)
  plannedTSS: number | null;

  // Natation (nullable hors natation)
  distanceMeters: number | null;          // distance par répétition (ex: 50, 100, 200)
  strokeType: SwimStrokeType | null;      // nage principale du bloc
  equipment: string[] | null;             // matériel (ex: ['planche'], ['pull-buoy', 'palmes'])

  // Renforcement musculaire (nullable pour les sports d'endurance)
  reps: number | null;
  sets: number | null;
  loadKg: number | null;

  description: string;
}

/**
 * Bloc "répétition" : une phase active + une phase de récupération, exécutées N fois.
 * Exemple : 2x(15min Z3, 5min Z2) →
 *   { type: 'Repeat', repeat: 2,
 *     durationActifSecondes: 900, targetPowerWatts: 220,     // actif
 *     durationRecupSecondes: 300, targetRecupPowerWatts: 150 // récup
 *   }
 * Pour des patterns plus complexes (>2 phases par rep), développe en blocs simples individuels sans utiliser Repeat.
 */
export interface StructureRepeatBlock {
  type: 'Repeat';
  repeat: number;

  // Phase ACTIVE (travail)
  durationActifSecondes: number | null;
  targetPowerWatts: number | null;
  targetPaceMinPerKm: string | null;
  targetPaceMinPer100m: string | null;
  targetHeartRateBPM: number | null;
  targetRPE: number | null;

  // Natation — phase active (nullable hors natation)
  distanceMeters: number | null;          // distance par répétition (ex: 50, 100)
  strokeType: SwimStrokeType | null;
  equipment: string[] | null;

  // Phase RÉCUPÉRATION (entre deux répétitions)
  durationRecupSecondes: number | null;
  targetRecupPowerWatts: number | null;
  targetRecupPaceMinPerKm: string | null;
  targetRecupPaceMinPer100m: string | null;
  targetRecupHeartRateBPM: number | null;
  targetRecupRPE: number | null;

  description: string;
}

/**
 * Item au top-level de PlannedData.structure : soit un bloc simple, soit un bloc de répétition.
 * Pas de récursion : un Repeat ne peut pas contenir un autre Repeat.
 */
export type StructureBlock = StructureSimpleBlock | StructureRepeatBlock;

export interface CompletedData {
  // --- Données Globales ---
  actualDurationMinutes: number;
  distanceKm: number;
  perceivedEffort: number | null; // RPE 1-10
  notes: string;
  source: {
    type: 'manual' | 'strava';
    stravaId?: number | string | null;   // ID unique de l'activité Strava
    stravaUrl?: string;           // Lien direct
    fullJson?: boolean;           // Flag si on a stocké tout le JSON (rarement utile)
  };
  map?: {
    polyline: string | null; // La trace GPS compressée
  };
  heartRate?: {
    avgBPM: number | null;
    maxBPM: number | null;
    zoneDistribution?: number[]; // % du temps passé en Z1, Z2... (Top pour l'analyse)
  };
  caloriesBurned?: number | null;
  laps: CompletedLap[];
  metrics: {
    cycling: CyclingMetrics | null;
    running: RunningMetrics | null;
    swimming: SwimmingMetrics | null;
  };

  // TSS canonique de la séance complétée — calculé une fois à l'écriture
  // (import Strava ou saisie manuelle) via computeWorkoutTSS.
  calculatedTSS?: number;
  // Source primaire utilisée pour calculer calculatedTSS.
  // Cascade : cycling → power > hr > default ; running/swimming → pace > hr > default.
  tssSource?: TssSource;
  intensityFactor?: number; // IF utilisé pour le calcul (NP/FTP, NGP/seuil, etc.)
  variabilityIndex?: number; // VI (NP / Avg Power) - utile pour voir si la séance était stable

  // Stimulus réel classifié de la séance (Endurance, Seuil, VO2max, Intervalles…).
  // Calculé à l'import via classifySessionType (pur calcul, sans IA).
  detectedType?: string;
  // Répartition du temps par zone (% Z1, Z2…) et la métrique de référence utilisée.
  zoneDistribution?: number[];
  zoneDistributionSource?: 'power' | 'hr' | 'pace';

  // Métriques de déviation planifié vs réalisé
  deviation?: DeviationMetrics;
}

// ______________________________________________________
// --- Deviation Metrics (analyse planifié vs réalisé) ---
// ______________________________________________________
export type DeviationSignal = 'fatigue' | 'superform' | 'normal';
export type DeviationSeverity = 'info' | 'alert' | 'critical';

export interface DeviationMetrics {
  signal: DeviationSignal;
  severity: DeviationSeverity;
  score: number;                     // -100 (sous-perf max) à +100 (sur-perf max)
  convergingSignals: number;         // Nombre de signaux convergents (min 2 pour alerter)

  // Écarts individuels (en %)
  durationDelta: number | null;      // (réalisé - planifié) / planifié * 100
  tssDelta: number | null;
  powerDelta: number | null;         // NP ou avg vs target
  hrDelta: number | null;            // FC à même puissance vs baseline

  // Métriques avancées
  fadeRate: number | null;            // % de baisse entre 1er et dernier intervalle
  aerobicDecoupling: number | null;  // Drift FC/Puissance en 2e moitié (%)
  cardiacCost: number | null;        // bpm par watt (efficience cardiaque)

  // Résumé pour l'UI
  headline: string;                  // Phrase courte ex: "Fatigue détectée — 2 signaux convergents"
  details: string[];                 // Liste de constats détaillés
  adaptationReason: string;          // Raison de l'adaptation proposée
}







// ______________________________________________________
// --- Sous Types ---
// ______________________________________________________
export interface CompletedLap {
  index: number;         // 1, 2, 3...
  name: string;          // "Lap 1"
  durationSeconds: number;
  distanceMeters: number;
  avgPower?: number | null;
  maxPower?: number | null;        // Pic de puissance du lap (calculé depuis le stream) — révèle les intervalles que la moyenne masque
  normalizedPower?: number | null; // Très utile sur des efforts longs
  avgHeartRate?: number | null;
  maxHeartRate?: number | null;
  avgCadence?: number | null;
  avgSpeedKmh?: number | null;
}

export interface CyclingMetrics {
  tss: number | null;               // Training Stress Score (Fatigue)
  avgPowerWatts: number | null;
  maxPowerWatts: number | null;
  normalizedPowerWatts: number | null; // NOUVEAU: Indispensable pour la charge réelle
  intensityFactor: number | null;      // NOUVEAU: IF (NP / FTP)
  avgCadenceRPM: number | null;
  maxCadenceRPM: number | null;
  elevationGainMeters: number | null;
  avgSpeedKmH: number | null;
  maxSpeedKmH: number | null;
}

export interface RunningMetrics {
  // rTSS — uniquement renseigné quand calculé via la métrique primaire (allure).
  // Si calculatedTSS provient de la FC ou du défaut, ce champ reste null.
  tss: number | null;
  intensityFactor: number | null; // NGP / allure seuil
  avgPaceMinPerKm: string | null; // Format "5:30"
  bestPaceMinPerKm: string | null;
  elevationGainMeters: number | null;
  avgCadenceSPM: number | null;   // Steps Per Minute (Cadence)
  maxCadenceSPM: number | null;
  avgSpeedKmH: number | null;
  maxSpeedKmH: number | null;
  strideLength?: number | null;   // NOUVEAU: Longueur de foulée (souvent dispo sur Strava)
}
export interface SwimmingMetrics {
  // sTSS — uniquement renseigné quand calculé via la métrique primaire (allure).
  // Si calculatedTSS provient de la FC ou du défaut, ce champ reste null.
  tss: number | null;
  intensityFactor: number | null; // pace_normalisée / CSS (cubé pour le sTSS)
  avgPace100m: string | null;
  bestPace100m: string | null;
  strokeType: string | null; // "Freestyle", "Mixed"...
  avgStrokeRate: number | null;
  avgSwolf: number | null;   // Score d'efficacité
  poolLengthMeters: number | null;
  totalStrokes: number | null;
}

/**
 * Source primaire du TSS calculé pour une séance.
 * - 'power'   : NP × FTP (vélo, ou Stryd run — non implémenté actuellement)
 * - 'pace'    : rTSS (course) ou sTSS (natation)
 * - 'hr'      : hrTSS via Karvonen
 * - 'default' : estimation forfaitaire selon le sport (dernier recours)
 */
export type TssSource = 'power' | 'pace' | 'hr' | 'default';

export interface CyclingTest {
  ftp?: number;
  p5min?: number;
  p8min?: number;
  p15min?: number;
  p20min?: number;
  zones?: Zones;
  seasonData?: SeasonData;
  sourceTests?: string[];
}

export interface Zones {
  z1: Zone; // Récupération active
  z2: Zone; // Endurance
  z3: Zone; // Tempo
  z4: Zone; // Seuil (FTP)
  z5: Zone; // VO2max
  z6?: Zone; // Capacité Anaérobie
  z7?: Zone; // Neuromusculaire
}

export interface Zone {
  min: number;
  max: number;
}

export type SportType = 'cycling' | 'running' | 'swimming' | 'other';

export interface StravaConfig {
  athleteId: number;
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  /**
   * Timestamp (epoch secondes) de la dernière synchro réussie.
   * Sert de curseur pour la sync incrémentale rapide (param `after` Strava).
   * Absent → première synchro : on balaie toute l'année.
   */
  lastSyncAt?: number;
}

export interface CompletedDataFeedback {
  rpe: number;
  actualDuration: number;
  distance: number;
  notes: string;
  sportType: SportType;
  avgHeartRate?: number;
  calories?: number;
  elevation?: number;
  avgPower?: number;
  maxPower?: number;
  normalizedPower?: number;
  tss?: number;
  intensityFactor?: number;
  avgPace?: string;
  avgCadence?: number;
  maxCadence?: number;
  avgSpeed?: number;
  maxSpeed?: number;
  strokeType?: string;
  avgStrokeRate?: number;
  avgSwolf?: number;
  poolLengthMeters?: number;
  totalStrokes?: number;
}

export interface PowerTests {
  p5min: number;
  p8min: number;
  p15min: number;
  p20min: number;
}

export interface SeasonData {
  calculatedAt?: string;       // ISO 8601
  wPrime?: number;             // W' en joules
  criticalPower?: number;      // CP (FTP) en watts
  method?: 'Critical Power Regression' | 'Single Test Estimation';
  sourceTests?: string[];      // Ex: ['5min', '20min']
}