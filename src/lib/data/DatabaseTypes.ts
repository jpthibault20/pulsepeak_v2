import { CoachType, AvailabilitySlot, CompletedData, CyclingTest, DeviationMetrics, PlannedData, SportType, StravaConfig, Zones } from "./type";


export interface Profile {
    // Identifiants
    id: string;
    createdAt: string;
    updatedAt: string;
    lastLoginAt: string | null;

    // Informations générales
    lastName: string;
    firstName: string;
    email: string;
    birthDate: string | null;
    weight?: number;
    height?: number;
    experience: 'Débutant' | 'Intermédiaire' | 'Avancé' | null;
    currentCTL: number;        // CTL au démarrage du plan (ex: 50)
    currentATL: number;        // fatigue court terme (7 jours)
    activeSports: {
        swimming: boolean;
        cycling: boolean;
        running: boolean;
    };
    weeklyAvailability: {
        [key: string]: AvailabilitySlot;

    };

    heartRate?: {
        max: number | null;       // FC Maximum (obligatoire pour le calcul simple)
        resting?: number | null;  // FC au Repos (optionnel, utile pour formule de Karvonen)
        zones?: Zones;            // Zones de FC (optionnel)
    };

    cycling?: {
        Test?: CyclingTest
        comments?: string;
    }

    running?: {
        Test?: {
            recentRaceTimeSec?: string;
            recentRaceDistanceMeters?: string;
            vma?: number;
            zones?: Zones;
        }
        comments?: string;
    }

    swimming?: {
        Test?: {
            recentRaceTimeSec?: number;
            recentRaceDistanceMeters?: number;
            poolLengthMeters?: number;
            totalStrokes?: number;
        }
        comments?: string;
    }

    coachType: CoachType;

    role: 'user' | 'admin';
    plan?: 'free' | 'dev' | 'pro';

    strava?: StravaConfig;
    stravaWriteBack?: boolean;

    goal: string;
    objectiveDate: string | null;
    weaknesses: string;

    aiPlanCallsCount?: number;
    aiPlanCallsResetDate?: string;
    aiWorkoutCallsCount?: number;
    aiWorkoutCallsResetDate?: string;

    tokenPerMonth?: number;
    tokenPerMonthResetDate?: string;

    stripeCustomerId?: string;
    stripeSubscriptionId?: string;
    stripePriceId?: string;
    billingStatus?: 'active' | 'past_due' | 'canceled' | 'incomplete';
    currentPeriodEnd?: string | null;
    cancelAtPeriodEnd?: boolean;
    billingInterval?: 'month' | 'year';
    trialUsedAt?: string | null;
    trialEndsAt?: string | null;

    theme?: 'dark' | 'light';

    workouts: Workout[]; //Not used for the moment, use in te future for relations
}

export interface Objective {
    id: string;
    userId: string;
    createdAt: string;
    updatedAt: string;
    name: string;
    date: string;                                          // YYYY-MM-DD
    sport: 'cycling' | 'running' | 'swimming' | 'triathlon' | 'duathlon';
    distanceKm?: number;
    elevationGainM?: number;
    priority: 'principale' | 'secondaire';
    status: 'upcoming' | 'completed' | 'missed' | 'passed';
    comment?: string;
}

export interface Schedule {
    dbVersion: string;
    workouts: Workout[];
    summary: string | null;
    lastGenerated: string | null;
}

export interface Plan {
    id: string;
    userId: string;
    blocksId: string[];
    objectivesId: string[];     // IDs des objectifs liés à ce plan
    name: string;
    goalDate: string;
    startDate: string;
    macroStrategyDescription: string;
    status: 'active' | 'archived';
}

export interface Block {
  id: string; // J'ai harmonisé ID -> id (standard JS)
  planId: string;
  userId: string;
  orderIndex: number; // 1, 2, 3...
  type: string; // "Base", "Build", "Peak", "Race"
  theme: string; // Généré par IA : "Développement PMA longue"
  weekCount: number; // Combien de semaines dans ce bloc (souvent 4, parfois moins)
  startDate: string; // Utile pour savoir quand le bloc commence
  weeksId: string[]; // IDs des semaines (créés plus tard)
  startCTL: number;          // CTL visée en début de bloc
  targetCTL: number;         // CTL visée en fin de bloc
  avgWeeklyTSS: number;      // TSS hebdo moyen du bloc (calculé)
}

export interface Week {
    id: string;
    userId: string;
    workoutsId: string[];
    blockId: string;
    weekNumber: number;
    type: 'Load' | 'Recovery' | 'Taper'; // Charge ou Assimilation
    targetTSS: number; // ex: 500
    actualTSS: number; // Somme calculée des séances complétées
    // Feedback global de la semaine (pour l'IA de la semaine suivante)
    userFeedback?: string; // "J'étais KO cette semaine"}
}

export interface Workout {
    id: string;
    userId: string;
    weekId: string;
    date: string; // "YYYY-MM-DD"
    sportType: SportType;
    title: string;
    workoutType: string;
    mode: 'Outdoor' | 'Indoor';
    status: 'pending' | 'completed' | 'missed';

    plannedData: PlannedData | null;
    completedData: CompletedData | null;

    aiDeviationCache?: DeviationMetrics | null; // Déviation mise en cache
}
