// Rule-based injury estimate per team, on the page's scale:
// +40 = low/minimal key injuries, 0 = moderate impact, -60 to -120 = severe

export type Injury = {
  athleteId: string | null;
  name: string;
  position: string | null;
  status: string;
};

export type InjuryContribution = Injury & {
  starter: boolean;
  points: number;
};

export type InjuryEstimate = {
  score: number;
  impact: number;
  contributions: InjuryContribution[]; // players that count, biggest impact first
  startersKnown: boolean; // false when the depth chart couldn't be loaded and everyone counts as a starter
};

// How likely the player misses the game
const STATUS_WEIGHT: Record<string, number> = {
  "Out": 1,
  "Injured Reserve": 1,
  "Doubtful": 0.75,
  "Questionable": 0.25,
};

// How much losing a starter at the position hurts; the quarterback dominates
const POSITION_WEIGHT: Record<string, number> = {
  QB: 10,
  OT: 2.5, DE: 2.5, CB: 2.5,
  WR: 2,
  G: 1.5, C: 1.5, TE: 1.5, RB: 1.5, DT: 1.5, LB: 1.5, S: 1.5,
  K: 0.5, P: 0.5, LS: 0.5, FB: 0.5,
};
const OTHER_POSITION_WEIGHT = 1;

// A backup's absence matters far less than a starter's
const BACKUP_FACTOR = 0.25;

// Long-term absences are already partly reflected in the record and points the power ranking uses
const INJURED_RESERVE_FACTOR = 0.5;

// Impact thresholds for the scale
const MINIMAL_BELOW = 3;
const MODERATE_BELOW = 7;
const SEVERE_POINTS_PER_IMPACT = 6;

/**
 * Adds up "missing starter" points (status × position × starter × long-term factors) and maps the total
 * onto the scale. E.g. a starting QB ruled out is 10 points, which gives -78.
 * starterIds = null means the depth chart is unknown, so every player counts as a starter.
 */
export function estimateInjuryScore(injuries: Injury[], starterIds: Set<string> | null): InjuryEstimate {
  const contributions = injuries
      .map(injury => {
        const starter = starterIds === null || (injury.athleteId !== null && starterIds.has(injury.athleteId));
        const points = (STATUS_WEIGHT[injury.status] ?? 0)
            * (POSITION_WEIGHT[injury.position ?? ""] ?? OTHER_POSITION_WEIGHT)
            * (starter ? 1 : BACKUP_FACTOR)
            * (injury.status === "Injured Reserve" ? INJURED_RESERVE_FACTOR : 1);
        return { ...injury, starter, points };
      })
      .filter(contribution => contribution.points > 0)
      .sort((a, b) => b.points - a.points);

  const impact = contributions.reduce((sum, contribution) => sum + contribution.points, 0);
  let score: number;
  if (impact < MINIMAL_BELOW) score = 40;
  else if (impact < MODERATE_BELOW) score = 0;
  else score = Math.max(-120, Math.round(-60 - (impact - MODERATE_BELOW) * SEVERE_POINTS_PER_IMPACT));

  return { score, impact, contributions, startersKnown: starterIds !== null };
}

export function formatInjuryScore(score: number) {
  return score > 0 ? `+${score}` : String(score);
}
