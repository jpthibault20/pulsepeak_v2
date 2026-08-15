/******************************************************************************
 * @file    stats/intensityScale.ts
 * @brief   Lecture qualitative d'un Intensity Factor — UNE ÉCHELLE PAR SOURCE.
 *
 * Un IF n'a de sens que rapporté à la métrique qui l'a produit : à effort
 * identique, un ratio de puissance, un %FCmax, un %FC de réserve et un rapport
 * d'allure ne tombent pas sur les mêmes chiffres. Une échelle unique étiquetait
 * un footing rapide (0.95 = 84 % VMA, soit du tempo) en « VO2max ».
 *
 * Chaque échelle est ancrée sur la table de zones que l'athlète voit déjà dans
 * son profil, pour que la même séance ne reçoive jamais deux noms différents
 * selon l'écran :
 *   - power      : coefficients Coggan de `ftp-calculator.ts` (Z1→Z5 en % FTP)
 *   - hrMax      : zones FC de `CalibrationTest.tsx` (% FCmax)
 *   - hrReserve  : Karvonen — ≈ 10 points sous le %FCmax à effort égal, d'où
 *                  une échelle distincte quand la FC de repos est renseignée
 *   - pace       : zones course en % VMA, converties (IF = v / 0,88·VMA, donc
 *                  % VMA = IF × 88). Attention, la table course de
 *                  `CalibrationTest.tsx` ne nomme PAS ses zones comme celles de
 *                  puissance et de FC : sa Z1 est « Endu. fond. » (60-70 % VMA)
 *                  et non « Récupération ». La récupération commence donc sous
 *                  sa Z1 — sans quoi la quasi-totalité des footings tranquilles
 *                  se seraient lus « Récupération ».
 *                  Transposable à la natation : l'IF y est aussi un rapport
 *                  vitesse/seuil, donc 1.00 = seuil.
 *
 * ⚠️ L'IF est une moyenne de SÉANCE : échauffement, récups et roue libre
 * comprises. Une séance de seuil (2×20' à FTP) retombe vers 0.85–0.88 sur
 * l'ensemble et se lit donc « Tempo » — conforme à la table de session Coggan
 * (0.85–0.95 = « tempo rides, interval workouts »). L'IF donne la dose globale ;
 * c'est la répartition par zone qui montre le pic.
 ******************************************************************************/

import type { Profile } from '@/lib/data/DatabaseTypes';
import type { TssSource } from '@/lib/data/type';

export type IntensityLevel = 'Récupération' | 'Endurance' | 'Tempo' | 'Seuil' | 'VO2max';

/** Métrique + convention de calcul qui déterminent l'échelle de lecture. */
export type IntensityScaleKey = 'power' | 'hrMax' | 'hrReserve' | 'pace';

const LEVELS: readonly IntensityLevel[] = ['Récupération', 'Endurance', 'Tempo', 'Seuil', 'VO2max'];

/** Bornes HAUTES de Récupération, Endurance, Tempo et Seuil (au-delà : VO2max). */
const SCALES: Record<IntensityScaleKey, readonly [number, number, number, number]> = {
    // Coefficients Coggan Z1→Z5 (ftp-calculator.ts).
    power: [0.55, 0.75, 0.90, 1.05],
    // Bornes des zones FC du profil (CalibrationTest.tsx), en % FCmax.
    hrMax: [0.60, 0.75, 0.82, 0.89],
    // Karvonen : ≈ 10 points sous le % FCmax à effort égal.
    hrReserve: [0.45, 0.65, 0.75, 0.85],
    // 60 / 75 / 85 / 95 % VMA ÷ 88 — bornes Z1→Z5 de la table course.
    pace: [0.68, 0.85, 0.97, 1.08],
};

/**
 * Échelle applicable à un IF. Null pour la source `default` : le TSS y est une
 * estimation forfaitaire, il n'y a aucun IF à interpréter.
 */
export function intensityScaleKey(
    source: TssSource,
    profile: Profile | null | undefined,
): IntensityScaleKey | null {
    if (source === 'power') return 'power';
    if (source === 'pace') return 'pace';
    if (source === 'hr') {
        // computeTSS bascule sur FCavg/FCmax quand la FC de repos manque : les
        // deux ratios diffèrent de 10 à 15 points à effort égal.
        return (profile?.heartRate?.resting ?? 0) > 0 ? 'hrReserve' : 'hrMax';
    }
    return null;
}

/** Niveau d'intensité correspondant à un IF, ou null si non interprétable. */
export function readIntensityLevel(
    value: number,
    source: TssSource,
    profile: Profile | null | undefined,
): IntensityLevel | null {
    if (!Number.isFinite(value) || value <= 0) return null;
    const key = intensityScaleKey(source, profile);
    if (key == null) return null;

    const bounds = SCALES[key];
    const idx = bounds.findIndex(b => value < b);
    return idx === -1 ? LEVELS[LEVELS.length - 1] : LEVELS[idx];
}

/** Bornes de l'échelle, pour situer une valeur sur une jauge. */
export function intensityScaleBounds(key: IntensityScaleKey): readonly number[] {
    return SCALES[key];
}
