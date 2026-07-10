import { CompletedData, SportType } from "@/lib/data/type";
import { getProfile } from "./data/crud";
import type { Profile } from "./data/DatabaseTypes";
import { computeWorkoutTSS, speedKmhToPaceMinPerKm, speedMsToPace100m } from "./stats/computeTSS";
import { bucketByZones, classifySessionType } from "./stats/classifySession";

// --- DÉFINITION DES TYPES ENTRANTS (STRAVA) ---

interface StravaLapInput {
  lap_index: number;
  name: string;
  moving_time: number;
  distance: number;
  average_watts?: number;
  average_heartrate?: number;
  max_heartrate?: number;
  average_cadence?: number;
  average_speed?: number; // m/s
  start_index: number;
  end_index: number;
}

export interface StravaStream {
  watts?: { data: number[] };
  heartrate?: { data: number[] };
  time?: { data: number[] };
}

// Représente uniquement les champs Strava que nous utilisons ici
interface StravaActivityInput {
  id: number;
  type: string;
  moving_time: number;
  distance: number;
  description?: string | null;
  calories?: number;
  perceived_exertion?: number | null;
  map?: {
    summary_polyline?: string | null;
  };

  laps?: StravaLapInput[];

  // Cardio
  average_heartrate?: number;
  max_heartrate?: number;

  // Puissance / Vélo
  average_watts?: number;
  weighted_average_watts?: number;
  max_watts?: number;

  // Vitesse / Cadence globals
  average_cadence?: number;
  total_elevation_gain: number;
  average_speed: number;
  max_speed: number;
}

// --- LOGIQUE ---

/**
 * Calcule le Normalized Power à partir d'un tableau de watts (1 valeur/seconde).
 * Algorithme : rolling average 30s → puissance 4 → moyenne → racine 4e.
 */
function calculateNP(watts: number[]): number | null {
  if (watts.length < 30) return null;

  // Rolling average 30s
  const rolling: number[] = [];
  let sum = 0;
  for (let i = 0; i < watts.length; i++) {
    sum += watts[i];
    if (i >= 30) sum -= watts[i - 30];
    if (i >= 29) rolling.push(sum / 30);
  }

  if (rolling.length === 0) return null;

  // Moyenne des puissances 4e
  let sum4 = 0;
  for (const v of rolling) sum4 += v * v * v * v;
  return Math.round(Math.pow(sum4 / rolling.length, 0.25));
}

// Fonction utilitaire pour mapper le sport Strava -> Notre Sport
export function mapStravaSport(stravaType: string): SportType {
  switch (stravaType) {
    case 'Run':
    case 'TrailRun':
    case 'VirtualRun': return 'running';
    case 'Swim': return 'swimming';
    case 'Ride':
    case 'VirtualRide':
    case 'GravelRide':
    case 'MountainBikeRide':
    case 'EBikeRide': return 'cycling';
    default: return 'other';
  }
}

// Transforme l'objet API Strava TYPÉ en notre objet CompletedData
export async function mapStravaToCompletedData(activity: StravaActivityInput, streams?: StravaStream | null, profileArg?: Profile): Promise<CompletedData> {
  const powerData = streams?.watts?.data ?? null;
  const sport = mapStravaSport(activity.type);

  // Profil pour les seuils (FTP/FCmax/VMA/CSS) — utilisé après pour computeWorkoutTSS.
  // Réutilise le profil injecté par l'appelant si fourni (évite un aller-retour DB par activité).
  const profile = profileArg ?? await getProfile().catch(err => {
    console.error("Erreur lors de la récupération du profil pour TSS:", err);
    return null;
  });

  // --- STRUCTURE DE BASE ---
  const completed: CompletedData = {
    actualDurationMinutes: Math.floor(activity.moving_time / 60),
    distanceKm: parseFloat((activity.distance / 1000).toFixed(2)),
    perceivedEffort: activity.perceived_exertion ?? null,
    notes: activity.description || "",
    caloriesBurned: activity.calories ?? null,
    source: {
      type: 'strava',
      stravaId: activity.id,
    },
    map: { polyline: activity.map?.summary_polyline || null },
    laps: (activity.laps ?? []).map((lap) => {
      let lapNP: number | null = null;
      let lapMaxPower: number | null = null;
      if (powerData && lap.start_index != null && lap.end_index != null) {
        const lapWatts = powerData.slice(lap.start_index, lap.end_index + 1);
        lapNP = calculateNP(lapWatts);
        if (lapWatts.length > 0) lapMaxPower = Math.round(Math.max(...lapWatts));
      }
      return {
        index: lap.lap_index,
        name: lap.name || `Lap ${lap.lap_index}`,
        durationSeconds: lap.moving_time,
        distanceMeters: Math.round(lap.distance),
        avgPower: lap.average_watts ?? null,
        maxPower: lapMaxPower,
        normalizedPower: lapNP,
        avgHeartRate: lap.average_heartrate ?? null,
        maxHeartRate: lap.max_heartrate ?? null,
        avgCadence: lap.average_cadence ?? null,
        avgSpeedKmh: lap.average_speed ? parseFloat((lap.average_speed * 3.6).toFixed(1)) : null,
      };
    }),
    heartRate: {
      avgBPM: activity.average_heartrate || null,
      maxBPM: activity.max_heartrate || null,
      zoneDistribution: [],
    },
    metrics: { cycling: null, running: null, swimming: null },
  };

  // --- METRICS PAR SPORT (signaux bruts, sans TSS — calculé en cascade ensuite) ---
  if (sport === 'cycling') {
    completed.metrics.cycling = {
      tss: null,                  // Renseigné plus bas si source=power
      avgPowerWatts: activity.average_watts || null,
      normalizedPowerWatts: activity.weighted_average_watts || null,
      maxPowerWatts: activity.max_watts || null,
      intensityFactor: null,
      avgCadenceRPM: activity.average_cadence || null,
      maxCadenceRPM: null,
      elevationGainMeters: activity.total_elevation_gain,
      avgSpeedKmH: activity.average_speed * 3.6,
      maxSpeedKmH: activity.max_speed * 3.6,
    };
  } else if (sport === 'running') {
    completed.metrics.running = {
      tss: null,                  // Renseigné plus bas si source=pace
      intensityFactor: null,
      avgPaceMinPerKm: speedKmhToPaceMinPerKm(activity.average_speed * 3.6),
      bestPaceMinPerKm: null,
      elevationGainMeters: activity.total_elevation_gain,
      avgCadenceSPM: activity.average_cadence ? activity.average_cadence * 2 : null,
      maxCadenceSPM: null,
      avgSpeedKmH: activity.average_speed * 3.6,
      maxSpeedKmH: activity.max_speed * 3.6,
      strideLength: null
    };
  } else if (sport === 'swimming') {
    completed.metrics.swimming = {
      tss: null,                  // Renseigné plus bas si source=pace
      intensityFactor: null,
      avgPace100m: speedMsToPace100m(activity.average_speed),
      bestPace100m: null,
      strokeType: null,
      avgStrokeRate: null,
      avgSwolf: null,
      poolLengthMeters: null,
      totalStrokes: null,
    };
  }

  // --- CASCADE TSS UNIFIÉE (puissance/allure → cardio → défaut, par sport) ---
  const tssResult = computeWorkoutTSS(sport, completed, profile);
  completed.calculatedTSS = tssResult.tss;
  completed.tssSource = tssResult.source;
  if (tssResult.intensityFactor != null) completed.intensityFactor = tssResult.intensityFactor;

  // --- SIGNAUX D'ANALYSE (VI, distribution de zones, type réel) ---
  const hrData = streams?.heartrate?.data ?? null;

  // Variability Index = NP / puissance moyenne (vélo). >1.15 ≈ effort en yoyo
  // (intervalles), ≈1.0 ≈ effort lisse (endurance). Dispo sans le stream.
  if (sport === 'cycling') {
    const avgP = completed.metrics.cycling?.avgPowerWatts ?? null;
    const np = completed.metrics.cycling?.normalizedPowerWatts ?? null;
    if (avgP && np && avgP > 0) {
      completed.variabilityIndex = Math.round((np / avgP) * 100) / 100;
    }
    // Distribution par zones de puissance (prioritaire si capteur disponible).
    const powerZones = profile?.cycling?.Test?.zones;
    if (powerData && powerData.length > 0 && powerZones) {
      const dist = bucketByZones(powerData, powerZones);
      if (dist.length > 0) {
        completed.zoneDistribution = dist;
        completed.zoneDistributionSource = 'power';
      }
    }
  }

  // Distribution FC depuis le stream heartrate — utilisée pour tous les sports
  // sans distribution puissance (running, swimming, vélo sans capteur de puissance).
  if (!completed.zoneDistribution && hrData && hrData.length > 0) {
    const hrZones = profile?.heartRate?.zones;
    if (hrZones) {
      const dist = bucketByZones(hrData, hrZones);
      if (dist.length > 0) {
        completed.zoneDistribution = dist;
        completed.zoneDistributionSource = 'hr';
      }
    }
  }

  // Type réellement effectué (remplace la devinette "endurance" de l'IA).
  completed.detectedType = classifySessionType(completed, sport, profile);

  // metrics.{sport}.tss n'est rempli que si la source est la métrique primaire
  // de ce sport (vélo→power, run/swim→pace). Sinon il reste null pour ne pas
  // induire en erreur les consommateurs qui lisent ce champ.
  if (tssResult.source === 'power' && completed.metrics.cycling) {
    completed.metrics.cycling.tss = tssResult.tss;
    completed.metrics.cycling.intensityFactor = tssResult.intensityFactor;
  } else if (tssResult.source === 'pace' && sport === 'running' && completed.metrics.running) {
    completed.metrics.running.tss = tssResult.tss;
    completed.metrics.running.intensityFactor = tssResult.intensityFactor;
  } else if (tssResult.source === 'pace' && sport === 'swimming' && completed.metrics.swimming) {
    completed.metrics.swimming.tss = tssResult.tss;
    completed.metrics.swimming.intensityFactor = tssResult.intensityFactor;
  }

  return completed;
}



// Define le style de la signature
const BRANDING_SUFFIX = "\n⚡ Powered by PulsePeak";

/**
 * Met à jour la description sur Strava via leur API
 * À appeler juste après la synchronisation de l'activité
 */
export async function tagStravaActivity(
    accessToken: string, // Le token de l'utilisateur
    activityId: number | string,
    currentDescription: string | null,
    stats?: { tss?: number | null }
) {
    const description = currentDescription || "";

    // 1. Éviter de taguer deux fois (boucle infinie)
    if (description.includes("⚡ PulsePeak") || description.includes("by PulsePeak")) {
        return;
    }

    // 2. Construction du footer minimaliste
    let footer = BRANDING_SUFFIX;
    
    // Bonus : Si on a calculé un TSS, on l'affiche joliment avant le branding
    if (stats?.tss && stats.tss > 0) {
        // On remplace le footer standard par une version avec stats
        // Rendu: "TSS: 120 • ⚡ Powered by PulsePeak"
        footer = `\nTSS: ${stats.tss} • ⚡ PulsePeak`;
    }

    const newDescription = description + footer;

    // 3. Appel API Strava (PUT)
    try {
        const response = await fetch(`https://www.strava.com/api/v3/activities/${activityId}`, {
            method: 'PUT',
            headers: {
                'Authorization': `Bearer ${accessToken}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                description: newDescription
            })
        });

        if (!response.ok) {
            console.warn("Impossible de mettre à jour la description Strava", await response.text());
        }
    } catch (error) {
        console.error("Erreur réseau update Strava:", error);
    }
}
