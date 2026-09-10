export async function fetchNflTeamData() {
    const response = await fetch('https://site.api.espn.com/apis/v2/sports/football/nfl/standings');
    const conferences = await response.json().then(data => data?.children);
    const teams= [];

    if (conferences !== null && conferences !== undefined) {
        conferences.map(conference => {
            conference?.standings?.entries.forEach((entry) => {
                teams.push({
                    name: entry.team.displayName || entry.team.name,
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