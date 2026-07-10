/******************************************************************************
 * @file    classifySession.ts
 * @brief   Classification DÉTERMINISTE du "stimulus réel" d'une séance réalisée.
 *
 *          Pur calcul (aucun appel IA, aucun accès DB). Remplace la devinette
 *          de l'IA ("tout endurance") par un type fiable déduit des signaux
 *          disponibles, dans cet ordre de fiabilité décroissante :
 *            1. Distribution en zones (puissance vélo, calculée à l'import).
 *            2. Détection d'intervalles (VI puissance, variabilité des laps).
 *            3. Intensity Factor (IF) global.
 *            4. FC moyenne rapportée aux zones FC de l'athlète.
 *
 *          Le résultat alimente `completedData.detectedType` (persisté à
 *          l'import Strava) ET sert de fallback à la lecture pour les séances
 *          anciennes/manuelles qui n'ont pas ce champ.
 ******************************************************************************/
import type { CompletedData, SportType, Zones } from '@/lib/data/type';
import type { Profile } from '@/lib/data/DatabaseTypes';

export type SessionType =
  | 'Récupération'
  | 'Endurance'
  | 'Tempo'
  | 'Seuil'
  | 'VO2max'
  | 'Intervalles'
  | 'Mixte'
  | 'Sortie Libre';

/**
 * Répartit une série de valeurs (watts ou bpm) dans les zones fournies et
 * renvoie le pourcentage de temps passé par zone (index 0 = Z1).
 * Les zones sont traitées par seuils `max` ascendants ; au-delà du dernier max
 * la valeur tombe dans la dernière zone définie.
 */
export function bucketByZones(values: number[], zones: Zones): number[] {
  const thresholds: number[] = [
    zones.z1.max,
    zones.z2.max,
    zones.z3.max,
    zones.z4.max,
    zones.z5.max,
    ...(zones.z6 ? [zones.z6.max] : []),
    ...(zones.z7 ? [zones.z7.max] : []),
  ];
  const counts = new Array(thresholds.length).fill(0);
  let total = 0;
  for (const v of values) {
    if (v == null || !isFinite(v) || v < 0) continue;
    total++;
    let idx = thresholds.findIndex(t => v <= t);
    if (idx === -1) idx = thresholds.length - 1; // au-dessus de tout → dernière zone
    counts[idx]++;
  }
  if (total === 0) return [];
  return counts.map(c => Math.round((c / total) * 1000) / 10); // % à 0.1 près
}

/** Coefficient de variation (écart-type / moyenne) d'une série. */
function coeffVar(values: number[]): number {
  if (values.length < 2) return 0;
  const mean = values.reduce((s, v) => s + v, 0) / values.length;
  if (mean === 0) return 0;
  const variance = values.reduce((s, v) => s + (v - mean) ** 2, 0) / values.length;
  return Math.sqrt(variance) / mean;
}

/**
 * Détecte si la séance présente un profil d'intervalles (effort en yoyo).
 * Signaux : Variability Index puissance, ou forte variabilité des laps.
 */
function detectIntervals(cd: CompletedData): boolean {
  // VI puissance (vélo) — signal le plus fiable.
  if (cd.variabilityIndex != null && cd.variabilityIndex >= 1.15) return true;

  const laps = cd.laps ?? [];
  const powerLaps = laps.map(l => l.avgPower).filter((v): v is number => v != null && v > 0);
  if (powerLaps.length >= 4) {
    return coeffVar(powerLaps) >= 0.2;
  }
  const hrLaps = laps.map(l => l.avgHeartRate).filter((v): v is number => v != null && v > 0);
  if (hrLaps.length >= 4) {
    return coeffVar(hrLaps) >= 0.1;
  }
  return false;
}

/** Classifie selon la distribution en zones (% par zone, index 0 = Z1). */
function classifyByZoneDistribution(dist: number[], intervals: boolean): SessionType {
  const z1 = dist[0] ?? 0;
  const z2 = dist[1] ?? 0;
  const z3 = dist[2] ?? 0;
  const z4 = dist[3] ?? 0;
  const z5plus = dist.slice(4).reduce((s, v) => s + (v ?? 0), 0);

  if (z5plus >= 12) return 'VO2max';
  if (z4 >= 18) return intervals ? 'Intervalles' : 'Seuil';
  if (intervals && z4 + z5plus >= 8) return 'Intervalles';
  if (z3 >= 25) return 'Tempo';
  if (z1 >= 75) return 'Récupération';
  if (z2 >= 50) return 'Endurance';
  return 'Mixte';
}

/** Fallback : FC moyenne rapportée aux zones FC de l'athlète. */
function classifyByAvgHR(cd: CompletedData, profile: Profile): SessionType | null {
  const avgHR = cd.heartRate?.avgBPM;
  const zones = profile.heartRate?.zones;
  if (!avgHR || !zones) return null;
  if (avgHR <= zones.z1.max) return 'Récupération';
  if (avgHR <= zones.z2.max) return 'Endurance';
  if (avgHR <= zones.z3.max) return 'Tempo';
  if (avgHR <= zones.z4.max) return 'Seuil';
  return 'VO2max';
}

/**
 * Détermine le type de séance réellement effectué à partir des données
 * complétées. Ne lève jamais ; renvoie 'Sortie Libre' si aucun signal exploitable.
 */
export function classifySessionType(
  cd: CompletedData,
  sport: SportType,
  profile: Profile | null,
): SessionType {
  const intervals = detectIntervals(cd);

  // 1. Distribution en zones (puissance vélo, calculée à l'import).
  if (cd.zoneDistribution && cd.zoneDistribution.length >= 3) {
    return classifyByZoneDistribution(cd.zoneDistribution, intervals);
  }

  // 2. Intervalles détectés sans distribution → on tranche directement.
  if (intervals) return 'Intervalles';

  // 3. Intensity Factor global.
  const ifv = cd.intensityFactor ?? null;
  if (ifv != null && ifv > 0) {
    if (ifv < 0.55) return 'Récupération';
    if (ifv < 0.75) return 'Endurance';
    if (ifv < 0.85) return 'Tempo';
    if (ifv < 0.95) return 'Seuil';
    return 'VO2max';
  }

  // 4. FC moyenne vs zones FC.
  if (profile) {
    const hrType = classifyByAvgHR(cd, profile);
    if (hrType) return hrType;
  }

  return 'Sortie Libre';
}
