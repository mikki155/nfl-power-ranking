import {useEffect, useState} from 'react'
import './App.css'
import {
  Button,
  CircularProgress,
  Paper,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow
} from "@mui/material";
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-expect-error
import {fetchNflTeamData} from "./fetch.js";
import {ppsCalculate, type Team} from "./utils.ts";

type IState = {
  teams: Team[],
};

function App() {
  const [state, setState] = useState<IState>({
    teams: [],
  });
  const [updateClicked, setUpdateClicked] = useState(false) ;

  async function onClickUpdate() {
    setUpdateClicked(true);
    const teams: Team[] = await fetchNflTeamData();
    teams.forEach(team => {
      setState(prevState => ({
        ...prevState,
        teams: [...prevState.teams, {...team, pps: ppsCalculate(team.wins, team.losses, team.ties, team.pd, team.pf, team.pa)}],
      }))
    });
  }

  useEffect(() => {
    if (state.teams.length !== 0) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setUpdateClicked(false);
    }
  }, [state.teams])

  return (
    <>
      <Button onClick={() => onClickUpdate()}>Update</Button>
      <section id="center">
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
                      <TableRow sx={{ bgcolor: '#9ca3af' }}>
                        <TableCell>{index + 1}</TableCell>
                        <TableCell>{team.name + ` (${team.wins}-${team.losses}-${team.ties})`}</TableCell>
                        <TableCell>{team.pps}</TableCell>
                      </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>}

      </section>
    </>
  )
}

export default App
