export type BetResult = "win" | "loss" | "push";

// moneyline = straight bet at the book's price; spread = bet at the book's line and price;
// estimate = bet at a line the book didn't offer, priced from the probability of covering it
export type OddsSource = "moneyline" | "spread" | "estimate";

// Polymarket is where bets are placed; DraftKings (via ESPN) is the fallback when Polymarket has no market
export type OddsProvider = "polymarket" | "draftkings";

// One team's side of the sportsbook market for a game, as decimal odds
export type TeamMarket = {
  spread: number | null;       // e.g. 3 for +3
  spreadOdds: number | null;   // e.g. 1.91 for -110
  moneyline: number | null;    // e.g. 2.36 for +136
};

// Typical standard deviation of an NFL final margin around the closing spread
const NFL_MARGIN_SD = 13.5;
// A -110/-110 market prices both sides at 52.4%, i.e. a 4.76% overround
const SPREAD_OVERROUND = 1.0476;

// Standard normal CDF (Abramowitz & Stegun 7.1.26, accurate to ~1e-7)
function normalCdf(x: number) {
  const t = 1 / (1 + 0.3275911 * Math.abs(x) / Math.SQRT2);
  const erf = 1 - t * (0.254829592 + t * (-0.284496736 + t * (1.421413741 + t * (-1.453152027 + t * 1.061405429))))
      * Math.exp(-(x * x) / 2);
  return x >= 0 ? (1 + erf) / 2 : (1 - erf) / 2;
}

/**
 * The decimal odds a bet is valued at. With a team expected to lose by its book spread,
 * the chance of covering your own line is P(margin > -ats), and the price is that
 * probability with the book's usual margin added.
 */
export function priceBet(ats: number | null, market: TeamMarket): { odds: number, oddsSource: OddsSource } | null {
  if (ats === null) {
    return market.moneyline === null ? null : { odds: market.moneyline, oddsSource: "moneyline" };
  }
  if (market.spread === null) return null;
  if (ats === market.spread && market.spreadOdds !== null) {
    return { odds: market.spreadOdds, oddsSource: "spread" };
  }
  const coverProbability = normalCdf((ats - market.spread) / NFL_MARGIN_SD);
  const odds = Math.max(1.01, 1 / (coverProbability * SPREAD_OVERROUND));
  return { odds: Math.round(odds * 100) / 100, oddsSource: "estimate" };
}

// Units won or lost on a graded 1-unit bet; null if ungraded or unpriced
export function betProfit(bet: Bet) {
  if (bet.result === null || bet.odds === null) return null;
  if (bet.result === "win") return bet.odds - 1;
  if (bet.result === "loss") return -1;
  return 0;
}

export function formatOdds(decimal: number) {
  const american = decimal >= 2 ? (decimal - 1) * 100 : -100 / (decimal - 1);
  const rounded = Math.round(american);
  return rounded > 0 ? `+${rounded}` : String(rounded);
}

/**
 * Cumulative ROI after each game day: total profit / total staked, 1 unit per graded, priced bet.
 * Pushes count as staked (the stake comes back), so they pull ROI towards 0.
 */
export function roiOverTime(bets: Bet[]) {
  const settled = bets
      .filter(bet => bet.kickoff !== null && betProfit(bet) !== null)
      .sort((a, b) => a.kickoff!.localeCompare(b.kickoff!));

  const points: { date: Date, roi: number, profit: number, staked: number, bets: Bet[] }[] = [];
  let profit = 0;
  let staked = 0;
  for (const bet of settled) {
    profit += betProfit(bet)!;
    staked += 1;
    const day = new Date(bet.kickoff!);
    day.setHours(0, 0, 0, 0);
    const last = points[points.length - 1];
    if (last && last.date.getTime() === day.getTime()) {
      Object.assign(last, { roi: profit / staked * 100, profit, staked });
      last.bets.push(bet);
    } else {
      points.push({ date: day, roi: profit / staked * 100, profit, staked, bets: [bet] });
    }
  }
  return points;
}

// ESPN season types: 1 = preseason, 2 = regular season, 3 = postseason
export type Week = {
  season: number;
  seasonType: number;
  week: number;
};

export type Bet = Week & {
  id: string;
  gameId: string;
  kickoff: string | null;
  home: string | null;
  away: string | null;
  team: string | null; // null = game imported without a pick yet; never graded
  opponent: string | null;
  ats: number | null; // null = straight bet (team must win outright)
  bookSpread: number | null;
  odds: number | null; // decimal price, e.g. 1.91 for -110; null when no odds could be found
  oddsSource: OddsSource | null;
  oddsProvider: OddsProvider | null;
  placedAt: string | null;
  result: BetResult | null; // null until the game is final
  teamScore: number | null;
  opponentScore: number | null;
};

// One bet per game, so any new bet on a game (either team, any line) replaces the earlier one,
// including after the notification was sent
export function betId(week: Week, gameId: string) {
  return `${week.season}-${week.seasonType}-${week.week}-game-${gameId}`;
}

export function isSameWeek(a: Week, b: Week) {
  return a.season === b.season && a.seasonType === b.seasonType && a.week === b.week;
}

/**
 * Grades a bet against the spread: add the ATS line to the team's margin of victory.
 * E.g. Commanders +2 losing 17-20: -3 + 2 = -1, so the bet is a loss.
 */
export function gradeBet(ats: number | null, teamScore: number, opponentScore: number): BetResult {
  const coverMargin = teamScore - opponentScore + (ats ?? 0);
  if (coverMargin > 0) return "win";
  if (coverMargin < 0) return "loss";
  return "push";
}

export function formatWeek(week: Week) {
  if (week.seasonType === 1) return `Preseason week ${week.week}`;
  if (week.seasonType === 3) return `Postseason week ${week.week}`;
  return `Week ${week.week}`;
}

// The other team in the game; falls back to home/away for bets entered by hand without an opponent
export function opponentOf(bet: Bet) {
  if (bet.opponent !== null) return bet.opponent;
  if (bet.team === null) return null;
  return bet.team === bet.home ? bet.away : bet.home;
}

export function formatMatchup(bet: Bet) {
  return bet.home && bet.away ? `${bet.away} @ ${bet.home}` : "";
}

export function formatBet(bet: Bet) {
  if (bet.team === null) return "No pick yet";
  if (bet.ats === null) return bet.team;
  return `${bet.team} ${bet.ats > 0 ? "+" : ""}${bet.ats}`;
}

export function formatOutcome(bet: Bet) {
  if (bet.result === null || bet.teamScore === null || bet.opponentScore === null) return "Pending";
  const label = { win: "Win", loss: "Loss", push: "Push" }[bet.result];
  return `${label} (${bet.teamScore}-${bet.opponentScore})`;
}

export function seasonRecord(bets: Bet[], season: number) {
  const seasonBets = bets.filter(bet => bet.season === season);
  return {
    wins: seasonBets.filter(bet => bet.result === "win").length,
    losses: seasonBets.filter(bet => bet.result === "loss").length,
    pushes: seasonBets.filter(bet => bet.result === "push").length,
  };
}

// The email lists only this week's bets, each with its outcome so far
export function buildNotification(week: Week, allBets: Bet[]) {
  const weekBets = allBets.filter(bet => isSameWeek(bet, week) && bet.team !== null);
  const record = seasonRecord(allBets, week.season);
  const lines = [
    `${formatWeek(week)} bets (${week.season}):`,
    ...weekBets.map(bet => `• ${formatBet(bet)} vs ${opponentOf(bet)}: ${formatOutcome(bet)}`),
    "",
    `Season record: ${record.wins}-${record.losses}-${record.pushes} (W-L-P)`,
  ];
  return {
    subject: `${formatWeek(week)} bets`,
    text: lines.join("\n"),
  };
}

export async function fetchBets(): Promise<Bet[]> {
  const response = await fetch("/api/bets");
  if (!response.ok) throw new Error(`Loading bets failed: ${response.status}`);
  return response.json();
}

export async function saveBet(bet: Bet): Promise<void> {
  const response = await fetch(`/api/bets/${encodeURIComponent(bet.id)}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(bet),
  });
  if (!response.ok) throw new Error(`Saving bet failed: ${response.status}`);
}

export async function deleteWeekBets(week: Week): Promise<void> {
  const params = new URLSearchParams({
    season: String(week.season),
    seasonType: String(week.seasonType),
    week: String(week.week),
  });
  const response = await fetch(`/api/bets?${params}`, { method: "DELETE" });
  if (!response.ok) throw new Error(`Clearing bets failed: ${response.status}`);
}
