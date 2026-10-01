export type BetResult = "win" | "loss" | "push";

// ESPN season types: 1 = preseason, 2 = regular season, 3 = postseason
export type Week = {
  season: number;
  seasonType: number;
  week: number;
};

export type Bet = Week & {
  id: string;
  gameId: string;
  home: string | null;
  away: string | null;
  team: string | null; // null = game imported without a pick yet; never graded
  opponent: string | null;
  ats: number | null; // null = straight bet (team must win outright)
  bookSpread: number | null;
  placedAt: string | null;
  result: BetResult | null; // null until the game is final
  teamScore: number | null;
  opponentScore: number | null;
};

// One bet per team per week, so betting on a team again replaces the earlier bet
export function betId(week: Week, team: string) {
  return `${week.season}-${week.seasonType}-${week.week}-${team}`;
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
