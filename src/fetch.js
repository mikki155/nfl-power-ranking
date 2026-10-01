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

// This week's games that haven't kicked off yet, ordered by kickoff time
export async function fetchUpcomingMatchups() {
    const response = await fetch('https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard');
    const events = await response.json().then(data => data?.events ?? []);

    return events
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
}