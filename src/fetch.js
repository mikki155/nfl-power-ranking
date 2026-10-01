export async function fetchNflTeamData() {
    const response = await fetch('https://site.api.espn.com/apis/v2/sports/football/nfl/standings');
    const conferences = await response.json().then(data => data?.children);
    const teams= [];

    if (conferences !== null && conferences !== undefined) {
        conferences.map(conference => {
            conference?.standings?.entries.forEach((entry) => {
                teams.push({
                    name: entry.team.displayName || entry.team.name,
                    logo: entry.team.logos?.[0]?.href,
                    wins: entry.stats.find(stat => stat.name === "wins").value,
                    losses: entry.stats.find(stat => stat.name === "losses").value,
                    ties: entry.stats.find(stat => stat.name === "ties").value,
                    pa: entry.stats.find(stat => stat.name === "pointsAgainst").value,
                    pf: entry.stats.find(stat => stat.name === "pointsFor").value,
                    pd: entry.stats.find(stat => stat.name === "pointDifferential").value,
                    pps: 0,
                })
            })
        });
    }

    return teams;
}

// The current week, plus its games that haven't kicked off yet, ordered by kickoff time
export async function fetchUpcomingMatchups() {
    const response = await fetch('https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard');
    const data = await response.json();
    const events = data?.events ?? [];
    const week = {
        season: data?.season?.year,
        seasonType: data?.season?.type,
        week: data?.week?.number,
    };

    const matchups = events
        .filter(event => event?.status?.type?.state === "pre")
        .map(event => {
            const competitors = event.competitions?.[0]?.competitors ?? [];
            const home = competitors.find(competitor => competitor.homeAway === "home");
            const away = competitors.find(competitor => competitor.homeAway === "away");
            const competition = event.competitions?.[0];
            const odds = competition?.odds?.[0];
            return {
                id: event.id,
                date: event.date,
                home: home?.team?.displayName,
                away: away?.team?.displayName,
                // ESPN's spread is the home team's line, e.g. 2.5 means home +2.5 and away -2.5
                homeSpread: typeof odds?.spread === "number" ? odds.spread : null,
                oddsProvider: odds?.provider?.displayName ?? odds?.provider?.name ?? null,
                neutralSite: competition?.neutralSite === true,
                venueCity: competition?.venue?.address?.city ?? null,
            };
        })
        .filter(matchup => matchup.home && matchup.away)
        .sort((a, b) => new Date(a.date) - new Date(b.date));

    return { week, matchups };
}

// DraftKings odds for one game as { home: TeamMarket, away: TeamMarket } in decimal odds,
// using the closing line for finished games and the current line for upcoming ones
export async function fetchGameMarkets(gameId) {
    const response = await fetch(`https://sports.core.api.espn.com/v2/sports/football/leagues/nfl/events/${gameId}/competitions/${gameId}/odds`);
    if (!response.ok) throw new Error(`Odds for game ${gameId}: HTTP ${response.status}`);
    const items = await response.json().then(data => data?.items ?? []);
    const odds = items.find(item => item?.provider?.name === "DraftKings") ?? items[0];
    if (!odds) return null;

    const market = (teamOdds) => {
        const line = teamOdds?.close ?? teamOdds?.current;
        const american = line?.pointSpread?.american;
        // A pick'em line is shown as text rather than 0
        const spread = american === "PK" || american === "EVEN" ? 0 : Number.parseFloat(american);
        return {
            spread: Number.isFinite(spread) ? spread : null,
            spreadOdds: line?.spread?.decimal ?? null,
            moneyline: line?.moneyLine?.decimal ?? null,
        };
    };
    return { home: market(odds.homeTeamOdds), away: market(odds.awayTeamOdds) };
}

// Final scores for one week's finished games, keyed by game id: { [gameId]: { [teamName]: score } }
export async function fetchFinalScores({ season, seasonType, week }) {
    const params = new URLSearchParams({ dates: season, seasontype: seasonType, week });
    const response = await fetch(`https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard?${params}`);
    const events = await response.json().then(data => data?.events ?? []);
    const scores = {};

    events
        .filter(event => event?.status?.type?.completed === true)
        .forEach(event => {
            scores[event.id] = {};
            (event.competitions?.[0]?.competitors ?? []).forEach(competitor => {
                scores[event.id][competitor.team.displayName] = Number(competitor.score);
            });
        });

    return scores;
}