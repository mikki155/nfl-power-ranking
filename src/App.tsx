import {useEffect, useState} from 'react'
import './App.css'
import {
  Box,
  Button, Card, CardActionArea, CardContent,
  CircularProgress,
  Paper,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow, Typography
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
  const [selectedCard, setSelectedCard] = useState(0);
  const [teamBets, setTeamBets] = useState([] as string[]);

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

  async function onClickCard(index: number, teamName: string) {
    setSelectedCard(index);
    setTeamBets([...teamBets, teamName]);
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
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(min(200px, 100%), 1fr))',
              gap: 2,
            }}
        >
          {state.teams.length !== 0 && state.teams.map((team, index) => (
              <Card key={index}>
                <CardActionArea
                    onClick={() => onClickCard(index, team.name)}
                    data-active={selectedCard === index ? '' : undefined}
                    sx={{
                      height: '100%',
                      '&[data-active]': {
                        backgroundColor: '#9ca3af',
                      },
                    }}
                >
                  <CardContent sx={{ height: '100%' }}>
                    <Typography variant="h5" component="div">
                      {team.name}
                    </Typography>
                    <Typography variant="body2" sx={{ color: 'text.secondary' }}>
                      Place bet
                    </Typography>
                  </CardContent>
                </CardActionArea>
              </Card>
          ))}
        </Box>
        <Button onClick={() => sendMailNotification(teamBets)}>Send notification</Button>
      </section>
    </>
  )
}

export default App
