import {useEffect, useState} from 'react'
import './App.css'
import {
  Alert,
  Avatar,
  Box,
  Breadcrumbs,
  Button, Card, CardActions, CardContent,
  Chip,
  CircularProgress,
  IconButton,
  InputAdornment,
  Paper,
  Snackbar,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow, TextField, Typography
} from "@mui/material";
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-expect-error
import {fetchFinalScores, fetchNflTeamData, fetchUpcomingMatchups} from "./fetch.js";
import {ppsCalculate, sendMailNotification, type Matchup, type Team} from "./utils.ts";
import {
  type Bet,
  betId,
  buildNotification,
  deleteWeekBets,
  fetchBets,
  formatBet,
  formatMatchup,
  formatOutcome,
  formatWeek,
  gradeBet,
  isSameWeek,
  opponentOf,
  saveBet,
  seasonRecord,
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

function formatKickoff(date: string) {
  return new Date(date).toLocaleString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatSpread(spread: number) {
  if (spread === 0) return "PK";
  return spread > 0 ? `+${spread}` : String(spread);
}

const CARD_GRID_SX = {
  width: '100%',
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))',
  gap: 2,
};

// ATS spreads move in half-point increments, e.g. -3.5, +7, 0
function isValidAts(value: string | undefined) {
  if (value === undefined || value.trim() === "") return false;
  const ats = Number(value);
  return Number.isFinite(ats) && Number.isInteger(ats * 2);
}

// Moves the ATS value by one half-point step, snapping invalid values to the nearest half point
function stepAts(value: string | undefined, direction: 1 | -1) {
  const current = Number(value);
  const base = Number.isFinite(current) ? Math.round(current * 2) / 2 : 0;
  const next = base + direction * 0.5;
  return next === 0 ? "0" : String(next);
}

function App() {
  const [state, setState] = useState<IState>({
    teams: [],
    matchups: [],
    week: null,
  });
  const [updateClicked, setUpdateClicked] = useState(false);
  const [bets, setBets] = useState<Bet[]>([]);
  const [atsInputs, setAtsInputs] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<Message>({ severity: "success", text: "" });
  const [messageOpen, setMessageOpen] = useState(false);
  const [view, setView] = useState<"ranking" | "bets" | "history">("ranking");

  function showMessage(severity: Message["severity"], text: string) {
    setMessage({ severity, text });
    setMessageOpen(true);
  }

  async function onClickUpdate() {
    setUpdateClicked(true);
    try {
      const [teams, schedule, savedBets]: [Team[], { week: Week, matchups: Matchup[] } | null, Bet[] | null] = await Promise.all([
        fetchNflTeamData(),
        // Without matchups the bets view falls back to an ungrouped list, so don't fail the whole load
        fetchUpcomingMatchups().catch(() => null),
        fetchBets().catch(() => null),
      ]);
      // Replace rather than append, so refreshing (or a double load in StrictMode) never duplicates teams
      setState({
        teams: teams.map(team => ({...team, pps: ppsCalculate(team.wins, team.losses, team.ties, team.pd, team.pf, team.pa)})),
        matchups: schedule?.matchups ?? [],
        week: schedule?.week ?? null,
      });

      if (savedBets === null) {
        showMessage("error", "Saved bets could not be loaded. Is the app running with npm run dev?");
        return;
      }
      setBets(savedBets);
      // Grade in the background; merge so bets placed meanwhile aren't lost
      gradeOpenBets(savedBets).then(graded => {
        if (graded.size > 0) setBets(current => current.map(bet => graded.get(bet.id) ?? bet));
      });
    } finally {
      setUpdateClicked(false);
    }
  }

  async function onClickCard(team: Team, game: Game) {
    const week = state.week;
    if (!week) return;
    const ats = atsValue(team.name).trim();
    const bet: Bet = {
      ...week,
      id: betId(week, team.name),
      gameId: game.id,
      home: game.home,
      away: game.away,
      team: team.name,
      opponent: game.home === team.name ? game.away : game.home,
      // An ATS of 0 (or none) means a straight bet on the team, so no spread is stored
      ats: ats === "" || Number(ats) === 0 ? null : Number(ats),
      bookSpread: bookSpreadByTeam.get(team.name) ?? null,
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
      setAtsInputs({});
    } catch {
      showMessage("error", "The bets could not be cleared. Please try again.");
    }
  }

  async function onClickSendNotification() {
    if (!state.week || currentWeekBets.length === 0) return;
    const { subject, text } = buildNotification(state.week, bets);
    try {
      const sent = await sendMailNotification(subject, text);
      showMessage(sent ? "success" : "error", sent
          ? "Notification sent successfully!"
          : "The notification could not be sent. Please try again.");
    } catch {
      showMessage("error", "The notification could not be sent. Please try again.");
    }
  }

  const currentWeek = state.week;
  const currentWeekBets = currentWeek ? bets.filter(bet => isSameWeek(bet, currentWeek)) : [];
  const betCount = currentWeekBets.length;

  function hasBet(teamName: string) {
    return currentWeekBets.some(bet => bet.team === teamName);
  }

  // Newest week first, for the history view
  const betHistory = [...bets].sort((a, b) =>
      b.season - a.season || b.seasonType - a.seasonType || b.week - a.week || (a.placedAt ?? "").localeCompare(b.placedAt ?? ""));
  const historySeason = state.week?.season ?? betHistory[0]?.season;
  const record = historySeason === undefined ? null : seasonRecord(bets, historySeason);

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

  // Each team's line from the sportsbook, used as the ATS value until the user enters their own
  const bookSpreadByTeam = new Map<string, number>(games.flatMap(game =>
      game.homeSpread === null ? [] : [[game.home, game.homeSpread], [game.away, -game.homeSpread]]));

  function atsValue(teamName: string) {
    if (atsInputs[teamName] !== undefined) return atsInputs[teamName];
    const bookSpread = bookSpreadByTeam.get(teamName);
    return bookSpread === undefined ? "" : String(bookSpread);
  }

  // Teams without a game this week get a card without a spread and can't be bet on
  function renderTeamCard(team: Team, game?: Game) {
    const spread = game ? bookSpreadByTeam.get(team.name) ?? null : undefined;
    const ats = atsValue(team.name);
    const atsError = ats !== "" && !isValidAts(ats);
    const betPlaced = hasBet(team.name);
    return (
        <Card
            key={team.name}
            elevation={0}
            sx={{
              display: 'flex',
              flexDirection: 'column',
              bgcolor: 'var(--code-bg)',
              boxShadow: 'var(--shadow)',
              border: 2,
              borderColor: betPlaced ? 'success.main' : 'var(--border)',
            }}
        >
          <CardContent sx={{ flexGrow: 1 }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mb: 2 }}>
              <Avatar src={team.logo} alt={team.name} variant="square" sx={{ width: 40, height: 40 }} />
              <Box sx={{ flexGrow: 1, minWidth: 0 }}>
                <Typography variant="subtitle1" sx={{ fontWeight: 'bold', lineHeight: 1.2, color: 'var(--text-h)' }}>
                  {team.name}
                </Typography>
                <Typography variant="body2" sx={{ color: 'var(--text)' }}>
                  #{rankByName.get(team.name)} · {team.wins}-{team.losses}-{team.ties} · {team.pps}
                </Typography>
                {spread !== undefined &&
                    <Typography variant="body2" sx={{ color: 'var(--text-h)', fontWeight: 'bold' }}>
                      Spread: {spread === null ? "N/A" : formatSpread(spread)}
                    </Typography>}
              </Box>
              {betPlaced && <Chip label="Bet placed" color="success" size="small" />}
            </Box>
            <TextField
                label="ATS"
                type="number"
                size="small"
                fullWidth
                value={ats}
                error={atsError}
                helperText={atsError ? "Use steps of 0.5" : " "}
                onChange={(e) => setAtsInputs(prev => ({...prev, [team.name]: e.target.value}))}
                sx={{
                  // Hide the browser's tiny spinners; the −/+ buttons replace them
                  '& input[type=number]': { MozAppearance: 'textfield', textAlign: 'center' },
                  '& input[type=number]::-webkit-inner-spin-button, & input[type=number]::-webkit-outer-spin-button': {
                    WebkitAppearance: 'none',
                    margin: 0,
                  },
                }}
                slotProps={{
                  htmlInput: { step: 0.5, inputMode: 'decimal' },
                  input: {
                    startAdornment: (
                        <InputAdornment position="start">
                          <IconButton
                              aria-label={`Decrease ATS for ${team.name}`}
                              edge="start"
                              color="primary"
                              sx={{ fontSize: '1.5rem', fontWeight: 'bold', width: 40, height: 40 }}
                              onClick={() => setAtsInputs(prev => ({...prev, [team.name]: stepAts(ats, -1)}))}
                          >
                            −
                          </IconButton>
                        </InputAdornment>
                    ),
                    endAdornment: (
                        <InputAdornment position="end">
                          <IconButton
                              aria-label={`Increase ATS for ${team.name}`}
                              edge="end"
                              color="primary"
                              sx={{ fontSize: '1.5rem', fontWeight: 'bold', width: 40, height: 40 }}
                              onClick={() => setAtsInputs(prev => ({...prev, [team.name]: stepAts(ats, 1)}))}
                          >
                            +
                          </IconButton>
                        </InputAdornment>
                    ),
                  },
                }}
            />
          </CardContent>
          <CardActions sx={{ px: 2, pb: 2 }}>
            <Button
                variant="contained"
                fullWidth
                disabled={atsError || !game || !state.week}
                onClick={() => game && onClickCard(team, game)}
            >
              {!game ? "No game to bet on" : betPlaced ? "Update bet" : "Place bet"}
            </Button>
          </CardActions>
        </Card>
    );
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    onClickUpdate();
  }, [])

  return (
    <>
      <section id="center">
        <Typography variant="body1">How to adjust for injuries (per team):</Typography>
        <Typography variant="body1" sx={{ whiteSpace: "pre-line" }}>
          {"+40 = low/minimal key injuries \n " +
              "0 = moderate impact \n " +
              "-60 to -120 = severe (e.g., long-term QB out, multiple Pro Bowlers missing)"}
        </Typography>

        <Button onClick={() => onClickUpdate()} variant="contained" disabled={updateClicked}>
          {updateClicked ? "Updating…" : "Update"}
        </Button>
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
        {updateClicked && state.teams.length === 0 ?
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
                      </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>
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
                  <Button variant="contained" disabled={betCount === 0} onClick={() => onClickSendNotification()}>
                    Send notification
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
                              {game.oddsProvider && ` · Odds: ${game.oddsProvider}`}
                            </Typography>
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
