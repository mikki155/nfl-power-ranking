# NFL Power Ranking

A local React app for ranking NFL teams, placing weekly bets against Polymarket lines, and tracking how those
bets perform over the season. It runs on your own machine with `npm run dev`; there is no hosted version.

## What it does

The page has four views, switched with the breadcrumb chips at the top. All data is loaded once when the page
opens; refresh the browser to get new data.

### Power ranking

A table of all 32 teams, ranked by a power-ranking score calculated from the current standings.

The **Injury estimate** column shows how injuries affect each team this week, on the scale
**+40** (minimal) / **0** (moderate) / **−60 to −120** (severe). It is shown for reference only and is **not**
part of the power-ranking score. Hover over or focus an estimate to see the players behind it.

The estimate is rule-based (`src/injuries.ts`). Each injured player adds points:
how likely he is to miss the game (Out / IR 1, Doubtful 0.75, Questionable 0.25) × how much his position
matters (QB 10, OT/DE/CB 2.5, WR 2, most others 1.5) × whether he is a starter (backups count 25%).
Players on injured reserve count half, since a long absence already shows in the record. The total maps to the
scale: under 3 is +40, under 7 is 0, and above that it falls from −60 to a floor of −120. A player counts as a
starter if he is first on his team's depth chart, or started one of the team's last two games.

### Bets

This week's games, ordered by kickoff, each in its own panel with the away team, a VS badge and the home team.
Teams without an upcoming game this week are listed separately and can't be bet on.

- **Polymarket line:** each game has a dropdown with the moneyline and every open spread Polymarket offers,
  with live prices. It defaults to the main line (the spread priced closest to 50/50).
- **Placing a bet:** each team's card shows its side of the selected line and price, e.g. `+2.5 · 48¢ · −108`,
  and a button such as **Bet: Browns +2.5**. There is one bet per game: betting again on a game, on either team
  or any line, replaces the earlier bet.
- **Clear bets** removes this week's bets.
- **Send notification** first looks up the price of this week's bets that don't have one yet (Polymarket at
  that moment, falling back to DraftKings odds), saves it, then emails this week's bets with their outcome so
  far and the season record. A success or error message confirms the result.

### ROI

Return on investment over the season, staking 1 unit per bet: the current ROI, profit in units and number of
graded bets, plus a line chart of cumulative ROI after each game day. A win pays the bet's decimal odds minus
1, a loss costs 1 unit, and a push returns the stake.

### History

Every saved bet, newest week first, with the game, the bet, the odds it was valued at, and the outcome, plus
the season record (W-L-P).

### Grading

Each time the page loads, bets whose games have finished are graded from ESPN's final scores: add your line to
the team's margin of victory; above 0 is a win, below 0 a loss, exactly 0 a push. For example, Commanders +2
losing 17-20 gives −3 + 2 = −1, a loss. A bet without a line (moneyline) needs the team to win outright.

## Getting started

Requires Node.js 22.13 or later, for Node's built-in `node:sqlite` used by the bets database (developed on
Node 24).

1. Install dependencies:

   ```sh
   npm install
   ```

2. Create a `.env` file in the project root with your [AgentMail](https://agentmail.to) API key, used for the
   notification email:

   ```
   VITE_AGENTMAIL_API_KEY=<your key>
   ```

   The key is only read by the dev server (`vite.config.ts`), which adds it to requests to AgentMail; it is not
   sent to the browser.

3. Add the private `src/utils.ts`. It is not part of the repository, and the app won't build without it.

4. Start the app:

   ```sh
   npm run dev
   ```

   Always use `npm run dev`. The bets database and the AgentMail proxy only exist inside the Vite dev server,
   so a production build (`npm run build` / `npm run preview`) shows the rankings but can't load, save or email
   bets.

## Data

### Bets database

Bets are stored in a local SQLite file, `data/bets.db`, created the first time the dev server starts. It is
git-ignored, so copy the file to back it up. The dev server serves it at `/api/bets` (`server/betsApi.ts`) and
upgrades the table automatically when new columns are added.

The `bets` table has one row per game you bet on:

| Column | Meaning |
|---|---|
| `id` | `season-seasonType-week-game-gameId`, e.g. `2026-2-4-game-401872964` |
| `season`, `season_type`, `week` | Season year; 1 = preseason, 2 = regular season, 3 = postseason; week number |
| `game_id`, `kickoff`, `home`, `away` | ESPN game id, kickoff time (UTC) and the two teams |
| `team`, `opponent` | The team bet on and its opponent. An empty `team` means no pick yet; such rows are ignored |
| `ats` | Your line, e.g. `-3` or `2.5`. Empty means a moneyline (straight) bet |
| `book_spread` | DraftKings' line for your team, for reference |
| `odds`, `odds_source`, `odds_provider` | Decimal odds the bet is valued at, the market type (`moneyline`, `spread` or `estimate`) and where it came from (`polymarket` or `draftkings`) |
| `placed_at` | When the bet was placed |
| `result`, `team_score`, `opponent_score` | `win` / `loss` / `push` and the final score, filled in by grading |

You can edit it by hand with any SQLite tool (stop the dev server first). To re-grade a bet, clear `result`,
`team_score` and `opponent_score`; to re-price one, clear `odds`.

### External data

All external data is fetched from public APIs that need no key:

| Source | Used for |
|---|---|
| ESPN standings, scoreboard and core APIs | Standings, this week's games, final scores, DraftKings odds, injury reports, depth charts and game rosters |
| Polymarket Gamma API | Game events and their moneyline and spread markets |
| Polymarket CLOB API | Price history, to value a bet at the time it was placed |
| AgentMail (through the dev server) | Sending the notification email |

Decimal odds from Polymarket are `1 / price`. When Polymarket has no market for a bet, DraftKings odds are used
instead; for a line DraftKings didn't offer, the odds are estimated from the probability of covering it.

Team logos are stored in `src/assets/logos/` (96×96 PNGs from ESPN, named after the team, e.g.
`kansas-city-chiefs.png`).

## Project structure

```
server/betsApi.ts     Vite dev-server plugin: the SQLite bets database and /api/bets
src/App.tsx           The page: views, loading, betting, grading and the ROI chart
src/bets.ts           Bet type, grading, pricing, ROI and the notification text
src/injuries.ts       Rule-based injury estimate
src/fetch.js          Requests to ESPN and Polymarket
src/logos.ts          Team logo lookup
src/utils.ts          Private, not in the repository (see Getting started)
src/assets/logos/     Team logos
vite.config.ts        Dev server: AgentMail proxy and the bets API plugin
```

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` | Start the app with the bets database and email proxy |
| `npm run build` | Type-check and build to `dist/` (without the bets API) |
| `npm run lint` | Run ESLint |
| `npm run preview` | Serve the build (without the bets API) |

Built with React 19, TypeScript, Vite, MUI and MUI X Charts.
