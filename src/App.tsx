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
import {fetchNflTeamData} from "./fetch.js";
import {ppsCalculate, sendMailNotification, type Team} from "./utils.ts";

type IState = {
  teams: Team[],
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
  });
  const [updateClicked, setUpdateClicked] = useState(false);
  const [teamBets, setTeamBets] = useState([] as string[]);
  const [atsInputs, setAtsInputs] = useState<Record<string, string>>({});
  const [notificationResult, setNotificationResult] = useState<"success" | "error">("success");
  const [notificationOpen, setNotificationOpen] = useState(false);
  const [view, setView] = useState<"ranking" | "bets">("ranking");

  async function onClickUpdate() {
    setUpdateClicked(true);
    try {
      const teams: Team[] = await fetchNflTeamData();
      // Replace rather than append, so refreshing (or a double load in StrictMode) never duplicates teams
      setState({
        teams: teams.map(team => ({...team, pps: ppsCalculate(team.wins, team.losses, team.ties, team.pd, team.pf, team.pa)})),
      });
    } finally {
      setUpdateClicked(false);
    }
  }

  async function onClickCard(teamName: string) {
    const ats = atsInputs[teamName]?.trim();
    // An ATS of 0 (or none) means a straight bet on the team, so only the name is stored
    const hasSpread = ats !== undefined && ats !== "" && Number(ats) !== 0;
    setTeamBets([...teamBets, hasSpread ? teamName + " " + ats : teamName]);
  }

  async function onClickSendNotification() {
    if (teamBets.length === 0) return;
    try {
      const sent = await sendMailNotification(teamBets);
      setNotificationResult(sent ? "success" : "error");
    } catch {
      setNotificationResult("error");
    }
    setNotificationOpen(true);
  }

  function hasBet(teamName: string) {
    return teamBets.some(bet => bet === teamName || bet.startsWith(teamName + " "));
  }

  const rankedTeams = [...state.teams].sort((a, b) => b.pps - a.pps);
  const betCount = new Set(teamBets).size;

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    onClickUpdate();
  }, [])

  return (
    <>
      <section id="center">
        <Typography variant="h6">Current score: 17 - 9</Typography>
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
                  {betCount === 0 ? "No bets placed yet" : `${betCount} ${betCount === 1 ? "bet" : "bets"} placed`}
                </Typography>
                <Stack direction="row" spacing={1}>
                  <Button
                      variant="outlined"
                      color="error"
                      disabled={betCount === 0}
                      onClick={() => {
                        setTeamBets([]);
                        setAtsInputs({});
                      }}
                  >
                    Clear bets
                  </Button>
                  <Button variant="contained" disabled={betCount === 0} onClick={() => onClickSendNotification()}>
                    Send notification
                  </Button>
                </Stack>
              </Paper>
            <Box
                sx={{
                  width: '100%',
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))',
                  gap: 2,
                }}
            >
              {rankedTeams.map((team, index) => {
                const ats = atsInputs[team.name] ?? "";
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
                              #{index + 1} · {team.wins}-{team.losses}-{team.ties} · {team.pps}
                            </Typography>
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
                                          onClick={() => setAtsInputs(prev => ({...prev, [team.name]: stepAts(prev[team.name], -1)}))}
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
                                          onClick={() => setAtsInputs(prev => ({...prev, [team.name]: stepAts(prev[team.name], 1)}))}
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
                            disabled={atsError}
                            onClick={() => onClickCard(team.name)}
                        >
                          Place bet
                        </Button>
                      </CardActions>
                    </Card>
                );
              })}
            </Box>
            </Box>}
        <Snackbar
            open={notificationOpen}
            autoHideDuration={4000}
            onClose={() => setNotificationOpen(false)}
            anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
        >
          {notificationResult === "error" ?
              <Alert severity="error" variant="filled" onClose={() => setNotificationOpen(false)}>
                The notification could not be sent. Please try again.
              </Alert>
              :
              <Alert severity="success" variant="filled" onClose={() => setNotificationOpen(false)}>
                Notification sent successfully!
              </Alert>}
        </Snackbar>
      </section>
    </>
  )
}

export default App
