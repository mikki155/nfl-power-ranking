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

// Polymarket's NFL teams by full name (same names as ESPN), e.g. "Baltimore Ravens" -> { abbreviation: "bal", alias: "Ravens" }
let polymarketTeams;
function fetchPolymarketTeams() {
    polymarketTeams ??= fetch('https://gamma-api.polymarket.com/teams?league=nfl&limit=100')
        .then(response => response.json())
        .then(teams => new Map(teams.map(team => [team.name, team])))
        .catch(error => {
            polymarketTeams = undefined; // retry on the next call
            throw error;
        });
    return polymarketTeams;
}

// Polymarket names game events nfl-<away>-<home>-<UTC kickoff date>; neutral-site games may list the teams the other way round
async function fetchPolymarketEvent(home, away, kickoff) {
    const teams = await fetchPolymarketTeams();
    const homeCode = teams.get(home)?.abbreviation;
    const awayCode = teams.get(away)?.abbreviation;
    if (!homeCode || !awayCode) return null;
    const date = new Date(kickoff).toISOString().slice(0, 10);

    for (const slug of [`nfl-${awayCode}-${homeCode}-${date}`, `nfl-${homeCode}-${awayCode}-${date}`]) {
        const response = await fetch(`https://gamma-api.polymarket.com/events?slug=${slug}`);
        const events = response.ok ? await response.json() : [];
        if (events?.[0]) return events[0];
    }
    return null;
}

/**
 * The open moneyline and spread markets for a game, with current prices by full team name:
 * { moneyline: { [team]: price } | null, spreads: [{ favourite, line, prices: { [team]: price } }] }
 * Spreads are named after the favourite, e.g. { favourite: "Pittsburgh Steelers", line: -2.5 } is Steelers -2.5 / Browns +2.5.
 */
export async function fetchPolymarketLines({ home, away, kickoff }) {
    const [teams, event] = await Promise.all([fetchPolymarketTeams(), fetchPolymarketEvent(home, away, kickoff)]);
    if (!event) return null;
    const fullName = new Map([home, away].map(name => [teams.get(name)?.alias, name]));

    const prices = (market) => {
        const outcomes = JSON.parse(market.outcomes ?? '[]');
        const outcomePrices = JSON.parse(market.outcomePrices ?? '[]').map(Number);
        return Object.fromEntries(outcomes.map((alias, index) => [fullName.get(alias), outcomePrices[index]]));
    };
    const open = (event.markets ?? []).filter(market => market.closed !== true);

    const moneyline = open.find(market => market.sportsMarketType === 'moneyline');
    const spreads = open
        .filter(market => market.sportsMarketType === 'spreads' && typeof market.line === 'number')
        .map(market => {
            const favouriteAlias = market.question?.match(/^Spread: (.+) \(/)?.[1];
            return { favourite: fullName.get(favouriteAlias), line: market.line, prices: prices(market) };
        })
        .filter(spread => spread.favourite);

    return { moneyline: moneyline ? prices(moneyline) : null, spreads };
}

// Last traded price of a Polymarket outcome at a given time, falling back to the first trade after it
async function fetchPolymarketPrice(tokenId, at, kickoff) {
    const end = Math.floor(Date.parse(kickoff) / 1000);
    const target = Math.min(Math.floor(Date.parse(at) / 1000), end);
    const params = new URLSearchParams({ market: tokenId, startTs: target - 7 * 86400, endTs: end, fidelity: 60 });
    const response = await fetch(`https://clob.polymarket.com/prices-history?${params}`);
    if (!response.ok) return null;
    const history = await response.json().then(data => data?.history ?? []);
    const before = history.filter(point => point.t <= target);
    const point = before[before.length - 1] ?? history[0];
    return point?.p > 0 ? point.p : null;
}

/**
 * Polymarket price of a bet at a given time, as decimal odds (1 / price).
 * A straight bet (ats null) is the team's side of the moneyline market. A spread bet is the team's side of
 * the spread market named after the favourite: Colts +6.5 is "Spread: Ravens (-6.5)", Ravens -6.5 the same market.
 */
export async function fetchPolymarketOdds({ home, away, kickoff, team, ats, at }) {
    const teams = await fetchPolymarketTeams();
    const event = await fetchPolymarketEvent(home, away, kickoff);
    const alias = teams.get(team)?.alias;
    const otherAlias = teams.get(team === home ? away : home)?.alias;
    if (!event || !alias || !otherAlias) return null;

    const favourite = ats !== null && ats < 0 ? alias : otherAlias;
    const market = (event.markets ?? []).find(candidate => {
        if (ats === null) return candidate.sportsMarketType === 'moneyline';
        return candidate.sportsMarketType === 'spreads'
            && candidate.line === -Math.abs(ats)
            && candidate.question?.startsWith(`Spread: ${favourite} (`);
    });
    if (!market) return null;

    const outcomes = JSON.parse(market.outcomes ?? '[]');
    const tokenIds = JSON.parse(market.clobTokenIds ?? '[]');
    const tokenId = tokenIds[outcomes.indexOf(alias)];
    if (!tokenId) return null;

    const price = await fetchPolymarketPrice(tokenId, at, kickoff);
    return price === null ? null : { odds: Math.round(1000 / price) / 1000, price, market: market.slug };
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