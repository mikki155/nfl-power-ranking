import {useEffect, useRef, useState} from 'react'
import './App.css'
import {
  Alert,
  Avatar,
  Box,
  Breadcrumbs,
  Button, Card, CardActions, CardContent,
  Chip,
  CircularProgress,
  MenuItem,
  Paper,
  Snackbar,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow, TextField, Tooltip, Typography
} from "@mui/material";
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-expect-error
import {fetchFinalScores, fetchGameMarkets, fetchGameStarterIds, fetchInjuryReport, fetchNflTeamData, fetchPolymarketLines, fetchPolymarketOdds, fetchRecentGames, fetchStarterIds, fetchUpcomingMatchups} from "./fetch.js";
import {estimateInjuryScore, formatInjuryScore, type Injury, type InjuryEstimate} from "./injuries.ts";
import {teamLogo} from "./logos.ts";
import {LineChart} from "@mui/x-charts/LineChart";
import {ChartsReferenceLine} from "@mui/x-charts/ChartsReferenceLine";
import {ppsCalculate, sendMailNotification, type Matchup, type Team} from "./utils.ts";
import {
  type Bet,
  betId,
  betProfit,
  buildNotification,
  deleteWeekBets,
  fetchBets,
  formatBet,
  formatMatchup,
  formatOdds,
  formatOutcome,
  formatWeek,
  gradeBet,
  isSameWeek,
  opponentOf,
  priceBet,
  roiOverTime,
  saveBet,
  seasonRecord,
  type TeamMarket,
  type Week,
} from "./bets.ts";

type IState = {
  teams: Team[],
  matchups: Matchup[],
  week: Week | null,
};

type Game = Matchup & {
  homeTeam: Team,
  awayTeam: Team,
};

type Message = {
  severity: "success" | "error",
  text: string,
};

// Grades open bets whose games have finished, saves the results, and returns the graded bets by id
async function gradeOpenBets(bets: Bet[]): Promise<Map<string, Bet>> {
  const openBets = bets.filter(bet => bet.result === null && bet.team !== null);
  const weeks: Week[] = [...new Map(openBets.map(bet => [
    `${bet.season}-${bet.seasonType}-${bet.week}`,
    {season: bet.season, seasonType: bet.seasonType, week: bet.week},
  ])).values()];
  const graded = new Map<string, Bet>();

  await Promise.all(weeks.map(async week => {
    const scores: Record<string, Record<string, number>> = await fetchFinalScores(week).catch(() => ({}));
    for (const bet of openBets.filter(bet => isSameWeek(bet, week))) {
      const opponent = opponentOf(bet);
      const teamScore = bet.team === null ? undefined : scores[bet.gameId]?.[bet.team];
      const opponentScore = opponent === null ? undefined : scores[bet.gameId]?.[opponent];
      if (teamScore === undefined || opponentScore === undefined) continue;
      const gradedBet = {...bet, teamScore, opponentScore, result: gradeBet(bet.ats, teamScore, opponentScore)};
      // If saving fails the bet is simply graded again on the next load
      await saveBet(gradedBet).catch(() => {});
      graded.set(bet.id, gradedBet);
    }
  }));

  return graded;
}

// A bet's price at a given time: Polymarket first, then DraftKings (estimated for lines DraftKings didn't offer)
async function fetchBetPrice(bet: Bet, at: string): Promise<Pick<Bet, "odds" | "oddsSource" | "oddsProvider"> | null> {
  if (bet.team === null || bet.home === null || bet.away === null || bet.kickoff === null) return null;
  const polymarket: { odds: number } | null = await fetchPolymarketOdds({
    home: bet.home, away: bet.away, kickoff: bet.kickoff, team: bet.team, ats: bet.ats, at,
  }).catch(() => null);
  if (polymarket) {
    return { odds: polymarket.odds, oddsSource: bet.ats === null ? "moneyline" : "spread", oddsProvider: "polymarket" };
  }

  const markets: { home: TeamMarket, away: TeamMarket } | null = await fetchGameMarkets(bet.gameId).catch(() => null);
  const draftKings = markets && priceBet(bet.ats, bet.team === bet.home ? markets.home : markets.away);
  return draftKings && { ...draftKings, oddsProvider: "draftkings" };
}

function formatKickoff(date: string) {
  return new Date(date).toLocaleString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

const CARD_GRID_SX = {
  width: '100%',
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))',
  gap: 2,
};

// A game's open Polymarket markets with current prices by team name (see fetchPolymarketLines)
type Spread = { favourite: string, line: number, prices: Record<string, number> };
type GameLines = { moneyline: Record<string, number> | null, spreads: Spread[] };

// Dropdown keys: the moneyline, or one spread market named after its favourite
const MONEYLINE = "moneyline";
function spreadKey(spread: Spread) {
  return `${spread.favourite}|${spread.line}`;
}

// A team's side of the selected market: the favourite gives the points, the other team gets them.
// null is the moneyline (a straight bet)
function teamLine(lines: GameLines | null | undefined, key: string, team: string): number | null {
  if (key === MONEYLINE) return null;
  const spread = lines?.spreads.find(candidate => spreadKey(candidate) === key);
  if (!spread) return null;
  return spread.favourite === team ? spread.line : -spread.line;
}

// The market's main line is the spread priced closest to 50/50
function defaultLineKey(lines: GameLines | null | undefined) {
  if (!lines?.spreads.length) return MONEYLINE;
  const main = lines.spreads.reduce((best, spread) =>
      Math.abs((spread.prices[spread.favourite] ?? 0) - 0.5) < Math.abs((best.prices[best.favourite] ?? 0) - 0.5) ? spread : best);
  return spreadKey(main);
}

function nickname(team: string) {
  return team.split(" ").pop() ?? team;
}

function formatAts(ats: number | null) {
  if (ats === null) return "ML";
  return ats > 0 ? `+${ats}` : String(ats);
}

function formatPrice(price: number) {
  return `${Math.round(price * 100)}¢`;
}

// An injury estimate with the players behind it in a tooltip (focusable, so it also works from the keyboard)
function renderInjuryScore(estimate: InjuryEstimate | undefined) {
  if (!estimate) return <span>–</span>;
  const shown = estimate.contributions.slice(0, 6);
  const breakdown = (
      <Box sx={{ p: 0.5 }}>
        {shown.length === 0 && <div>No injuries that count</div>}
        {shown.map(player => (
            <div key={`${player.athleteId}-${player.name}`}>
              {player.name} ({player.position ?? "?"}, {player.status}{player.starter ? "" : ", backup"})
            </div>
        ))}
        {estimate.contributions.length > shown.length && <div>+{estimate.contributions.length - shown.length} more</div>}
        <Box sx={{ mt: 0.5, opacity: 0.8 }}>
          Impact {estimate.impact.toFixed(1)}{estimate.startersKnown ? "" : " · depth chart unavailable, all counted as starters"}
        </Box>
      </Box>
  );
  return (
      <Tooltip title={breakdown} arrow>
        <Box component="span" tabIndex={0} sx={{ textDecoration: 'underline dotted', textUnderlineOffset: '3px', cursor: 'help' }}>
          {formatInjuryScore(estimate.score)}
        </Box>
      </Tooltip>
  );
}

// One dropdown row: the line on the left, the away / home prices on the right
function renderLineOption(label: string, awayPrice: number | undefined, homePrice: number | undefined) {
  return (
      <Box sx={{ display: 'flex', justifyContent: 'space-between', gap: 2, width: '100%' }}>
        <span>{label}</span>
        {awayPrice !== undefined && homePrice !== undefined &&
            <Box component="span" sx={{ color: 'var(--text)', fontVariantNumeric: 'tabular-nums' }}>
              {formatPrice(awayPrice)} / {formatPrice(homePrice)}
            </Box>}
      </Box>
  );
}

function App() {
  const [state, setState] = useState<IState>({
    teams: [],
    matchups: [],
    week: null,
  });
  const [loading, setLoading] = useState(true);
  // The ref blocks a second send immediately; the state shows it on the button
  const sendingRef = useRef(false);
  const [sending, setSending] = useState(false);
  const [bets, setBets] = useState<Bet[]>([]);
  // Polymarket markets per game id (null = no Polymarket event), and the line picked in each game's dropdown
  const [polymarketLines, setPolymarketLines] = useState<Record<string, GameLines | null>>({});
  // Injury estimate per team name; shown only, not part of the power-ranking score
  const [injuryEstimates, setInjuryEstimates] = useState<Record<string, InjuryEstimate>>({});
  const [selectedLines, setSelectedLines] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<Message>({ severity: "success", text: "" });
  const [messageOpen, setMessageOpen] = useState(false);
  const [view, setView] = useState<"ranking" | "bets" | "roi" | "history">("ranking");

  function showMessage(severity: Message["severity"], text: string) {
    setMessage({ severity, text });
    setMessageOpen(true);
  }

  // Everything is loaded once when the page opens; refresh the browser to get new data
  useEffect(() => {
    async function load() {
      try {
        const [teams, schedule, savedBets]: [Team[], { week: Week, matchups: Matchup[] } | null, Bet[] | null] = await Promise.all([
          fetchNflTeamData(),
          // Without matchups the bets view falls back to an ungrouped list, so don't fail the whole load
          fetchUpcomingMatchups().catch(() => null),
          fetchBets().catch(() => null),
        ]);
        // Replace rather than append, so the double load in StrictMode never duplicates teams
        setState({
          teams: teams.map(team => ({...team, pps: ppsCalculate(team.wins, team.losses, team.ties, team.pd, team.pf, team.pa)})),
          matchups: schedule?.matchups ?? [],
          week: schedule?.week ?? null,
        });

        // Estimate injuries in the background from ESPN's injury report. A starter is first on the team's depth
        // chart now, or started one of its last two games (ESPN moves injured players down the depth chart).
        // Both are needed: game rosters miss e.g. receivers and special teams that only the depth chart lists
        const season = schedule?.week.season ?? new Date().getFullYear();
        Promise.all([
          fetchInjuryReport(),
          schedule ? fetchRecentGames(schedule.week, 2).catch(() => []) : [],
        ]).then(async ([report, recentGames]: [{ teamId: string, team: string, injuries: Injury[] }[], { gameId: string, teamIds: string[] }[]]) => {
          const entries = await Promise.all(report.map(async team => {
            const [depthChart, ...gameStarters]: (string[] | null)[] = await Promise.all([
              fetchStarterIds(team.teamId, season).catch(() => null),
              ...recentGames
                  .filter(game => game.teamIds.includes(team.teamId))
                  .map(game => fetchGameStarterIds(game.gameId, team.teamId).catch(() => [])),
            ]);
            // Without a depth chart, everyone counts as a starter (the estimate says so)
            const starters = depthChart && new Set([...depthChart, ...gameStarters.flatMap(ids => ids ?? [])]);
            return [team.team, estimateInjuryScore(team.injuries, starters)] as const;
          }));
          setInjuryEstimates(Object.fromEntries(entries));
        }).catch(() => {});

        // Load each game's Polymarket lines in the background; the dropdowns fill in when they arrive
        const matchups = schedule?.matchups ?? [];
        Promise.all(matchups.map(async matchup => [
          matchup.id,
          await fetchPolymarketLines({ home: matchup.home, away: matchup.away, kickoff: matchup.date }).catch(() => null),
        ] as const)).then(entries => setPolymarketLines(Object.fromEntries(entries)));

        if (savedBets === null) {
          setMessage({ severity: "error", text: "Saved bets could not be loaded. Is the app running with npm run dev?" });
          setMessageOpen(true);
          return;
        }
        setBets(savedBets);
        // Grade in the background; merge so bets placed meanwhile aren't lost
        gradeOpenBets(savedBets).then(graded => {
          if (graded.size > 0) setBets(current => current.map(bet => graded.get(bet.id) ?? bet));
        });
      } catch {
        setMessage({ severity: "error", text: "The NFL standings could not be loaded. Refresh the page to try again." });
        setMessageOpen(true);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  async function onClickCard(team: Team, game: Game) {
    const week = state.week;
    if (!week) return;
    // The team's side of the line selected for this game; null is a moneyline (straight) bet
    const line = teamLine(polymarketLines[game.id], selectedLineKey(game), team.name);
    // Odds are looked up when the notification is sent, not here
    const bet: Bet = {
      ...week,
      id: betId(week, game.id),
      gameId: game.id,
      kickoff: game.date,
      home: game.home,
      away: game.away,
      team: team.name,
      opponent: game.home === team.name ? game.away : game.home,
      ats: line,
      bookSpread: bookSpreadByTeam.get(team.name) ?? null,
      odds: null,
      oddsSource: null,
      oddsProvider: null,
      placedAt: new Date().toISOString(),
      result: null,
      teamScore: null,
      opponentScore: null,
    };
    try {
      await saveBet(bet);
      setBets(current => [...current.filter(existing => existing.id !== bet.id), bet]);
    } catch {
      showMessage("error", "The bet could not be saved. Please try again.");
    }
  }

  async function onClickClearBets() {
    const week = state.week;
    if (!week) return;
    try {
      await deleteWeekBets(week);
      setBets(current => current.filter(bet => !isSameWeek(bet, week)));
      setSelectedLines({});
    } catch {
      showMessage("error", "The bets could not be cleared. Please try again.");
    }
  }

  async function onClickSendNotification() {
    // Ignore presses while a send is running, so a double-click can't price, save or email twice
    if (!state.week || currentWeekBets.length === 0 || sendingRef.current) return;
    sendingRef.current = true;
    setSending(true);
    try {
      // Price this week's bets that don't have odds yet, at the moment the notification goes out.
      // Bets priced by an earlier send keep their odds, so sending again writes nothing new
      const sentAt = new Date().toISOString();
      const priced = new Map<string, Bet>();
      await Promise.all(currentWeekBets.filter(bet => bet.odds === null && bet.team !== null).map(async bet => {
        const price = await fetchBetPrice(bet, sentAt);
        if (!price) return;
        const pricedBet = { ...bet, ...price };
        // Updates the bet's existing row; if saving fails, the bet is priced again on the next send
        await saveBet(pricedBet).catch(() => {});
        priced.set(bet.id, pricedBet);
      }));
      const allBets = bets.map(bet => priced.get(bet.id) ?? bet);
      if (priced.size > 0) setBets(current => current.map(bet => priced.get(bet.id) ?? bet));

      const { subject, text } = buildNotification(state.week, allBets);
      const sent = await sendMailNotification(subject, text).catch(() => false);
      showMessage(sent ? "success" : "error", sent
          ? "Notification sent successfully!"
          : "The notification could not be sent. Please try again.");
    } finally {
      sendingRef.current = false;
      setSending(false);
    }
  }

  const currentWeek = state.week;
  const currentWeekBets = currentWeek ? bets.filter(bet => isSameWeek(bet, currentWeek)) : [];
  const betCount = currentWeekBets.length;

  // Newest week first, for the history view
  const betHistory = [...bets].sort((a, b) =>
      b.season - a.season || b.seasonType - a.seasonType || b.week - a.week || (a.placedAt ?? "").localeCompare(b.placedAt ?? ""));
  const historySeason = state.week?.season ?? betHistory[0]?.season;
  const record = historySeason === undefined ? null : seasonRecord(bets, historySeason);

  // ROI view: 1 unit per graded bet that has odds
  const roiPoints = roiOverTime(bets);
  const latestRoi = roiPoints[roiPoints.length - 1];
  const settledBets = bets.filter(bet => betProfit(bet) !== null);
  const estimatedCount = settledBets.filter(bet => bet.oddsSource === "estimate").length;
  const draftKingsCount = settledBets.filter(bet => bet.oddsProvider !== "polymarket").length;
  const unpricedCount = bets.filter(bet => bet.result !== null && bet.odds === null).length;

  const rankedTeams = [...state.teams].sort((a, b) => b.pps - a.pps);

  const rankByName = new Map(rankedTeams.map((team, index) => [team.name, index + 1]));
  const teamByName = new Map(rankedTeams.map(team => [team.name, team]));
  const games: Game[] = state.matchups.flatMap(matchup => {
    const home = teamByName.get(matchup.home);
    const away = teamByName.get(matchup.away);
    return home && away ? [{...matchup, homeTeam: home, awayTeam: away}] : [];
  });
  const teamsInGames = new Set(games.flatMap(game => [game.home, game.away]));
  const teamsWithoutGame = rankedTeams.filter(team => !teamsInGames.has(team.name));

  // Each team's DraftKings line, saved with each bet for reference
  const bookSpreadByTeam = new Map<string, number>(games.flatMap(game =>
      game.homeSpread === null ? [] : [[game.home, game.homeSpread], [game.away, -game.homeSpread]]));

  // The dropdown's selection for a game, falling back to the main line if nothing (still valid) is picked
  function selectedLineKey(game: Game) {
    const lines = polymarketLines[game.id];
    const selected = selectedLines[game.id];
    const valid = selected === MONEYLINE || lines?.spreads.some(spread => spreadKey(spread) === selected);
    return selected !== undefined && valid ? selected : defaultLineKey(lines);
  }

  // Spreads from the away team's point of view, biggest away favourite first
  function lineOptions(game: Game) {
    const awayLine = (spread: Spread) => spread.favourite === game.away ? spread.line : -spread.line;
    return [...(polymarketLines[game.id]?.spreads ?? [])]
        .sort((a, b) => awayLine(a) - awayLine(b))
        .map(spread => ({ key: spreadKey(spread), awayLine: awayLine(spread), prices: spread.prices }));
  }

  // Teams without a game this week get a card without a spread and can't be bet on
  function renderTeamCard(team: Team, game?: Game) {
    // This team's side of the line picked in the game's dropdown, named on the bet button
    const ats = game ? teamLine(polymarketLines[game.id], selectedLineKey(game), team.name) : null;
    const placedBet = currentWeekBets.find(bet => bet.team === team.name);
    const betPlaced = placedBet !== undefined;
    // Either team's button replaces the game's existing bet
    const gameHasBet = game !== undefined && currentWeekBets.some(bet => bet.gameId === game.id);
    return (
        <Card
            key={team.name}
            elevation={0}
            sx={{
              display: 'flex',
              flexDirection: 'column',
              textAlign: 'left',
              bgcolor: 'var(--code-bg)',
              boxShadow: 'var(--shadow)',
              border: 2,
              borderColor: betPlaced ? 'success.main' : 'var(--border)',
            }}
        >
          <CardContent sx={{ flexGrow: 1, display: 'flex', flexDirection: 'column', gap: 1.5, p: 2 }}>
            {/* Header: logo, name, and rank with record */}
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
              <Avatar src={teamLogo(team.name)} alt="" variant="square" sx={{ width: 40, height: 40, flexShrink: 0 }} />
              <Box sx={{ minWidth: 0 }}>
                <Typography variant="subtitle1" sx={{ fontWeight: 'bold', lineHeight: 1.25, color: 'var(--text-h)' }}>
                  {team.name}
                </Typography>
                <Typography variant="body2" sx={{ color: 'var(--text)', mt: 0.25 }}>
                  #{rankByName.get(team.name)} · {team.wins}-{team.losses}-{team.ties}
                </Typography>
              </Box>
            </Box>

            {/* Details: labels on the left, values on the right */}
            <Box
                component="dl"
                sx={{
                  display: 'grid',
                  gridTemplateColumns: '1fr auto',
                  columnGap: 2,
                  rowGap: 0.75,
                  m: 0,
                  pt: 1.5,
                  borderTop: 1,
                  borderColor: 'var(--border)',
                  typography: 'body2',
                  '& dt': { color: 'var(--text)' },
                  '& dd': { m: 0, color: 'var(--text-h)', fontWeight: 600, textAlign: 'right', fontVariantNumeric: 'tabular-nums' },
                }}
            >
              <dt>Power score</dt>
              <dd>{team.pps}</dd>
              <dt>Injuries</dt>
              <dd>{renderInjuryScore(injuryEstimates[team.name])}</dd>
            </Box>

            {placedBet &&
                <Chip
                    label={`Bet placed: ${formatAts(placedBet.ats)}`}
                    color="success"
                    size="small"
                    sx={{ alignSelf: 'flex-start' }}
                />}
          </CardContent>
          <CardActions sx={{ px: 2, pt: 0, pb: 2 }}>
            <Button
                variant="contained"
                fullWidth
                disabled={!game || !state.week}
                onClick={() => game && onClickCard(team, game)}
            >
              {!game ? "No game to bet on" : `${gameHasBet ? "Update bet" : "Bet"}: ${nickname(team.name)} ${formatAts(ats)}`}
            </Button>
          </CardActions>
        </Card>
    );
  }

  return (
    <>
      <section id="center">
        <Typography variant="body2" sx={{ color: 'var(--text)' }}>
          The injury estimate is calculated from ESPN's injury report and depth charts, and is not part of the
          power-ranking score. Hover or focus an estimate to see the players behind it.
        </Typography>

        <Breadcrumbs
            aria-label="Sections"
            separator="›"
            sx={{
              alignSelf: 'flex-start',
              color: 'var(--text)',
              '& .MuiBreadcrumbs-separator': { fontSize: '1.25rem' },
            }}
        >
          {([
            { key: "ranking", label: "Power ranking" },
            { key: "bets", label: `Bets (${betCount})` },
            { key: "roi", label: "ROI" },
            { key: "history", label: "History" },
          ] as const).map(crumb => {
            const active = view === crumb.key;
            return (
                <Chip
                    key={crumb.key}
                    label={crumb.label}
                    clickable={!active}
                    color={active ? "primary" : "default"}
                    variant={active ? "filled" : "outlined"}
                    aria-current={active ? "page" : undefined}
                    onClick={active ? undefined : () => setView(crumb.key)}
                    sx={{
                      fontWeight: active ? 'bold' : 'normal',
                      ...(!active && {
                        color: 'var(--text-h)',
                        borderColor: 'var(--border)',
                        bgcolor: 'var(--code-bg)',
                      }),
                    }}
                />
            );
          })}
        </Breadcrumbs>
        {loading ?
            <CircularProgress />
             : view === "ranking" ?
            <TableContainer
                component={Paper}
                elevation={0}
                sx={{ bgcolor: 'var(--bg)', border: 1, borderColor: 'var(--border)', boxShadow: 'var(--shadow)' }}
            >
              <Table
                  sx={{
                    minWidth: 650,
                    '& .MuiTableCell-root': { color: 'var(--text-h)', borderColor: 'var(--border)' },
                  }}
              >
                <TableHead>
                  <TableRow sx={{ bgcolor: 'var(--code-bg)' }}>
                    <TableCell sx={{ fontWeight: 'bold' }}>Ranking</TableCell>
                    <TableCell sx={{ fontWeight: 'bold' }}>Team</TableCell>
                    <TableCell sx={{ fontWeight: 'bold' }}>Power ranking score</TableCell>
                    <TableCell sx={{ fontWeight: 'bold' }}>Injury estimate</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {rankedTeams.map((team, index) => (
                      <TableRow
                          key={index + team.name}
                          sx={{ bgcolor: index % 2 === 0 ? 'var(--bg)' : 'var(--code-bg)' }}
                      >
                        <TableCell>{index + 1}</TableCell>
                        <TableCell>
                          {team.name}{" "}
                          <Box component="span" sx={{ color: 'var(--text)' }}>
                            ({team.wins}-{team.losses}-{team.ties})
                          </Box>
                        </TableCell>
                        <TableCell>{team.pps}</TableCell>
                        <TableCell sx={{ fontVariantNumeric: 'tabular-nums' }}>
                          {renderInjuryScore(injuryEstimates[team.name])}
                        </TableCell>
                      </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>
             : view === "roi" ?
            <Paper
                elevation={0}
                sx={{
                  width: '100%',
                  boxSizing: 'border-box',
                  p: 3,
                  bgcolor: 'var(--bg)',
                  border: 1,
                  borderColor: 'var(--border)',
                  boxShadow: 'var(--shadow)',
                  textAlign: 'left',
                }}
            >
              <Typography variant="h6" sx={{ color: 'var(--text-h)' }}>Return on investment</Typography>
              <Typography variant="body2" sx={{ color: 'var(--text)', mb: 3 }}>
                Cumulative ROI after each game day, staking 1 unit per bet
              </Typography>
              {!latestRoi ?
                  <Typography sx={{ color: 'var(--text)' }}>No graded bets with odds yet.</Typography>
                  :
                  <>
                    <Stack direction="row" useFlexGap sx={{ flexWrap: 'wrap', gap: 4, mb: 3 }}>
                      <Box>
                        <Typography variant="body2" sx={{ color: 'var(--text)' }}>ROI</Typography>
                        <Typography sx={{ color: 'var(--text-h)', fontSize: '3rem', fontWeight: 600, lineHeight: 1.1 }}>
                          {latestRoi.roi > 0 ? "+" : ""}{latestRoi.roi.toFixed(1)}%
                        </Typography>
                      </Box>
                      <Box>
                        <Typography variant="body2" sx={{ color: 'var(--text)' }}>Profit</Typography>
                        <Typography sx={{ color: 'var(--text-h)', fontSize: '1.5rem', fontWeight: 600 }}>
                          {latestRoi.profit > 0 ? "+" : ""}{latestRoi.profit.toFixed(2)} units
                        </Typography>
                      </Box>
                      <Box>
                        <Typography variant="body2" sx={{ color: 'var(--text)' }}>Bets</Typography>
                        <Typography sx={{ color: 'var(--text-h)', fontSize: '1.5rem', fontWeight: 600 }}>
                          {latestRoi.staked}
                        </Typography>
                      </Box>
                    </Stack>
                    <Box sx={{ width: '100%', height: 320 }}>
                      <LineChart
                          xAxis={[{
                            data: roiPoints.map(point => point.date),
                            scaleType: 'time',
                            valueFormatter: (date: Date) => date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }),
                            tickNumber: 6,
                          }]}
                          yAxis={[{ valueFormatter: (value: number) => `${value}%` }]}
                          series={[{
                            data: roiPoints.map(point => Math.round(point.roi * 10) / 10),
                            label: 'Cumulative ROI',
                            color: 'var(--chart-line)',
                            curve: 'linear',
                            showMark: true,
                            valueFormatter: (value: number | null, { dataIndex }) => {
                              const point = roiPoints[dataIndex];
                              return `${value! > 0 ? "+" : ""}${value}% · ${point.profit >= 0 ? "+" : ""}${point.profit.toFixed(2)} units over ${point.staked} bets`;
                            },
                          }]}
                          grid={{ horizontal: true }}
                          hideLegend
                          margin={{ left: 8, right: 16, top: 16, bottom: 8 }}
                          sx={{
                            '& .MuiLineElement-root': { strokeWidth: 2, strokeLinejoin: 'round', strokeLinecap: 'round' },
                            '& .MuiMarkElement-root': { stroke: 'var(--bg)', strokeWidth: 2, r: 4, fill: 'var(--chart-line)' },
                            '& .MuiChartsGrid-line': { stroke: 'var(--border)', strokeWidth: 1 },
                            '& .MuiChartsAxis-line, & .MuiChartsAxis-tick': { stroke: 'var(--border)' },
                            '& .MuiChartsAxis-tickLabel': { fill: 'var(--text) !important' },
                          }}
                      >
                        <ChartsReferenceLine
                            y={0}
                            lineStyle={{ stroke: 'var(--text)', strokeWidth: 1 }}
                        />
                      </LineChart>
                    </Box>
                    <Typography variant="body2" sx={{ color: 'var(--text)', mt: 2 }}>
                      Odds are Polymarket prices when each bet was placed (decimal odds = 1 / price), for the
                      moneyline or the exact spread bet.
                      {draftKingsCount > 0 && ` ${draftKingsCount} of ${settledBets.length} bets had no Polymarket market and use
                      DraftKings closing odds instead${estimatedCount > 0 ? `, ${estimatedCount} of them estimated from the
                      probability of covering a line DraftKings didn't offer` : ""}.`}
                      {unpricedCount > 0 && ` ${unpricedCount} graded ${unpricedCount === 1 ? "bet has" : "bets have"} no odds and ${unpricedCount === 1 ? "is" : "are"} left out.`}
                      {" "}Each bet's odds are listed in History.
                    </Typography>
                  </>}
            </Paper>
             : view === "history" ?
            <Box sx={{ width: '100%', display: 'flex', flexDirection: 'column', gap: 2 }}>
              {record &&
                  <Typography variant="h6" sx={{ color: 'var(--text-h)', alignSelf: 'flex-start' }}>
                    {historySeason} record: {record.wins}-{record.losses}-{record.pushes} (W-L-P)
                  </Typography>}
              {betHistory.length === 0 ?
                  <Typography sx={{ color: 'var(--text)' }}>No bets placed yet.</Typography>
                  :
                  <TableContainer
                      component={Paper}
                      elevation={0}
                      sx={{ bgcolor: 'var(--bg)', border: 1, borderColor: 'var(--border)', boxShadow: 'var(--shadow)' }}
                  >
                    <Table
                        sx={{
                          minWidth: 650,
                          '& .MuiTableCell-root': { color: 'var(--text-h)', borderColor: 'var(--border)' },
                        }}
                    >
                      <TableHead>
                        <TableRow sx={{ bgcolor: 'var(--code-bg)' }}>
                          <TableCell sx={{ fontWeight: 'bold' }}>Week</TableCell>
                          <TableCell sx={{ fontWeight: 'bold' }}>Game</TableCell>
                          <TableCell sx={{ fontWeight: 'bold' }}>Bet</TableCell>
                          <TableCell sx={{ fontWeight: 'bold' }}>Odds</TableCell>
                          <TableCell sx={{ fontWeight: 'bold' }}>Outcome</TableCell>
                        </TableRow>
                      </TableHead>
                      <TableBody>
                        {betHistory.map((bet, index) => (
                            <TableRow
                                key={bet.id}
                                sx={{ bgcolor: index % 2 === 0 ? 'var(--bg)' : 'var(--code-bg)' }}
                            >
                              <TableCell>{formatWeek(bet)}, {bet.season}</TableCell>
                              <TableCell>{formatMatchup(bet) || `vs ${opponentOf(bet) ?? "?"}`}</TableCell>
                              <TableCell sx={{ color: bet.team === null ? 'var(--text) !important' : undefined }}>
                                {formatBet(bet)}
                              </TableCell>
                              <TableCell sx={{ fontVariantNumeric: 'tabular-nums' }}>
                                {bet.odds === null ? "–" : formatOdds(bet.odds)}
                                {bet.odds !== null && bet.oddsProvider !== "polymarket" &&
                                    <Box component="span" sx={{ color: 'var(--text)' }}>
                                      {bet.oddsSource === "estimate" ? " (DraftKings est.)" : " (DraftKings)"}
                                    </Box>}
                              </TableCell>
                              <TableCell>
                                <Chip
                                    size="small"
                                    label={formatOutcome(bet)}
                                    variant={bet.result === null ? "outlined" : "filled"}
                                    color={bet.result === "win" ? "success" : bet.result === "loss" ? "error" : "default"}
                                />
                              </TableCell>
                            </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </TableContainer>}
            </Box>
             :
            <Box sx={{ width: '100%', display: 'flex', flexDirection: 'column', gap: 2 }}>
              <Paper
                  elevation={0}
                  sx={{
                    p: 2,
                    bgcolor: 'var(--code-bg)',
                    border: 1,
                    borderColor: 'var(--border)',
                    display: 'flex',
                    flexWrap: 'wrap',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: 2,
                  }}
              >
                <Typography sx={{ color: 'var(--text-h)' }}>
                  {state.week ? `${formatWeek(state.week)}: ` : ""}
                  {betCount === 0 ? "No bets placed yet" : `${betCount} ${betCount === 1 ? "bet" : "bets"} placed`}
                </Typography>
                <Stack direction="row" spacing={1}>
                  <Button
                      variant="outlined"
                      color="error"
                      disabled={betCount === 0}
                      onClick={() => onClickClearBets()}
                  >
                    Clear bets
                  </Button>
                  <Button variant="contained" disabled={betCount === 0 || sending} onClick={() => onClickSendNotification()}>
                    {sending ? "Sending…" : "Send notification"}
                  </Button>
                </Stack>
              </Paper>
              {games.length === 0 ?
                  // No schedule available: fall back to all teams, ungrouped
                  <Box sx={CARD_GRID_SX}>
                    {rankedTeams.map(team => renderTeamCard(team))}
                  </Box>
                  :
                  <>
                    <Box
                        sx={{
                          width: '100%',
                          display: 'grid',
                          gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 500px), 1fr))',
                          gap: 2,
                        }}
                    >
                      {games.map(game => (
                          <Paper
                              key={game.id}
                              elevation={0}
                              sx={{ p: 2, bgcolor: 'var(--bg)', border: 1, borderColor: 'var(--border)' }}
                          >
                            <Typography variant="body2" sx={{ color: 'var(--text)', mb: 1.5 }}>
                              {formatKickoff(game.date)} · {game.neutralSite
                                  ? `Neutral site${game.venueCity ? ` (${game.venueCity})` : ""}`
                                  : `at ${game.home}`}
                            </Typography>
                            <TextField
                                select
                                size="small"
                                fullWidth
                                label="Polymarket line"
                                value={selectedLineKey(game)}
                                onChange={(e) => setSelectedLines(prev => ({...prev, [game.id]: e.target.value}))}
                                disabled={!(game.id in polymarketLines)}
                                helperText={game.id in polymarketLines && polymarketLines[game.id] === null
                                    ? "No Polymarket market found for this game" : undefined}
                                sx={{ mb: 1.5, textAlign: 'left' }}
                            >
                              <MenuItem value={MONEYLINE}>
                                {renderLineOption(
                                    "Moneyline",
                                    polymarketLines[game.id]?.moneyline?.[game.away],
                                    polymarketLines[game.id]?.moneyline?.[game.home],
                                )}
                              </MenuItem>
                              {lineOptions(game).map(option => (
                                  <MenuItem key={option.key} value={option.key}>
                                    {renderLineOption(
                                        `${nickname(game.away)} ${formatAts(option.awayLine)} / ${nickname(game.home)} ${formatAts(-option.awayLine)}`,
                                        option.prices[game.away],
                                        option.prices[game.home],
                                    )}
                                  </MenuItem>
                              ))}
                            </TextField>
                            <Box
                                sx={{
                                  display: 'grid',
                                  gridTemplateColumns: { xs: '1fr', sm: '1fr auto 1fr' },
                                  alignItems: 'stretch',
                                  gap: 1.5,
                                }}
                            >
                              {renderTeamCard(game.awayTeam, game)}
                              <Box
                                  aria-label="versus"
                                  sx={{
                                    alignSelf: 'center',
                                    justifySelf: 'center',
                                    width: 40,
                                    height: 40,
                                    borderRadius: '50%',
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    bgcolor: 'primary.main',
                                    color: 'primary.contrastText',
                                    fontWeight: 'bold',
                                    fontSize: '0.875rem',
                                  }}
                              >
                                VS
                              </Box>
                              {renderTeamCard(game.homeTeam, game)}
                            </Box>
                          </Paper>
                      ))}
                    </Box>
                    {teamsWithoutGame.length > 0 &&
                        <>
                          <Typography variant="h6" sx={{ color: 'var(--text-h)', mt: 2 }}>
                            No upcoming game this week
                          </Typography>
                          <Box sx={CARD_GRID_SX}>
                            {teamsWithoutGame.map(team => renderTeamCard(team))}
                          </Box>
                        </>}
                  </>}
            </Box>}
        <Snackbar
            open={messageOpen}
            autoHideDuration={4000}
            onClose={() => setMessageOpen(false)}
            anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
        >
          <Alert severity={message.severity} variant="filled" onClose={() => setMessageOpen(false)}>
            {message.text}
          </Alert>
        </Snackbar>
      </section>
    </>
  )
}

export default App
