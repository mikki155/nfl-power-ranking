import {useEffect, useState} from 'react'
import './App.css'
import {
  Box,
  Button, Card, CardActions, CardContent,
  CircularProgress,
  Paper,
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

function App() {
  const [state, setState] = useState<IState>({
    teams: [],
  });
  const [updateClicked, setUpdateClicked] = useState(false);
  const [teamBets, setTeamBets] = useState([] as string[]);
  const [atsInput, setAtsInput] = useState("");

  async function onClickUpdate() {
    if (state.teams.length !== 0) return
    setUpdateClicked(true);
    const teams: Team[] = await fetchNflTeamData();
    teams.forEach(team => {
      setState(prevState => ({
        teams: [...prevState.teams, {...team, pps: ppsCalculate(team.wins, team.losses, team.ties, team.pd, team.pf, team.pa)}],
      }))
    });
  }

  async function onClickCard(teamName: string) {
    setTeamBets([...teamBets, teamName + " " + atsInput]);
  }

  useEffect(() => {
    if (state.teams.length !== 0) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setUpdateClicked(false);
    }
  }, [state.teams])

  return (
    <>
      <section id="center">
        <Button onClick={() => onClickUpdate()} variant="contained">Update</Button>
        {updateClicked ?
            <CircularProgress />
             :
            <TableContainer component={Paper}>
              <Table sx={{ minWidth: 650 }}>
                <TableHead>
                  <TableRow sx={{ bgcolor: '#9ca3af' }}>
                    <TableCell>Ranking</TableCell>
                    <TableCell>Team</TableCell>
                    <TableCell>Power ranking score</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {state.teams.sort((a, b) => b.pps - a.pps).map((team, index) => (
                      <TableRow key={index + team.name} sx={{ bgcolor: '#9ca3af' }}>
                        <TableCell>{index + 1}</TableCell>
                        <TableCell>{team.name + ` (${team.wins}-${team.losses}-${team.ties})`}</TableCell>
                        <TableCell>{team.pps}</TableCell>
                      </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>}
        <Box
            sx={{
              width: '100%',
              display: 'ruby',
            }}
        >
          {state.teams.length !== 0 && state.teams.map((team, index) => (
              <Card key={index}>
                <CardContent sx={{
                          height: '100%',
                          backgroundColor: '#9ca3af',
                }}>
                  <Typography gutterBottom sx={{ color: 'text.secondary', fontSize: 14 }}>
                    {team.name}
                  </Typography>
                  <TextField onChange={(e) => setAtsInput(e.target.value)}>
                    ATS:
                  </TextField>
                </CardContent>
                <CardActions sx={{
                  height: '100%',
                  backgroundColor: '#9ca3af',
                }}>
                  <Button size="small" onClick={() => onClickCard(team.name)}>Place bet</Button>
                </CardActions>
              </Card>
          ))}
        </Box>
        <Button onClick={() => setTeamBets([])}>Clear bets</Button>
        <Button onClick={() => sendMailNotification(teamBets)}>Send notification</Button>
      </section>
    </>
  )
}

export default App
