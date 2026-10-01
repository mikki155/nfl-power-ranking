import { mkdirSync } from 'node:fs'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { dirname } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import type { Plugin } from 'vite'

// Mirrors the Bet type in src/bets.ts
type Bet = {
  id: string
  season: number
  seasonType: number
  week: number
  gameId: string
  kickoff: string | null
  home: string | null
  away: string | null
  team: string | null
  opponent: string | null
  ats: number | null
  bookSpread: number | null
  odds: number | null
  oddsSource: 'moneyline' | 'spread' | 'estimate' | null
  oddsProvider: 'polymarket' | 'draftkings' | null
  placedAt: string | null
  result: 'win' | 'loss' | 'push' | null
  teamScore: number | null
  opponentScore: number | null
}

type BetRow = {
  id: string
  season: number
  season_type: number
  week: number
  game_id: string
  kickoff: string | null
  home: string | null
  away: string | null
  team: string | null
  opponent: string | null
  ats: number | null
  book_spread: number | null
  odds: number | null
  odds_source: Bet['oddsSource']
  odds_provider: Bet['oddsProvider']
  placed_at: string | null
  result: Bet['result']
  team_score: number | null
  opponent_score: number | null
}

function toBet(row: BetRow): Bet {
  return {
    id: row.id,
    season: row.season,
    seasonType: row.season_type,
    week: row.week,
    gameId: row.game_id,
    kickoff: row.kickoff,
    home: row.home,
    away: row.away,
    team: row.team,
    opponent: row.opponent,
    ats: row.ats,
    bookSpread: row.book_spread,
    odds: row.odds,
    oddsSource: row.odds_source,
    oddsProvider: row.odds_provider,
    placedAt: row.placed_at,
    result: row.result,
    teamScore: row.team_score,
    opponentScore: row.opponent_score,
  }
}

const BETS_TABLE = `
  CREATE TABLE IF NOT EXISTS bets (
    id             TEXT PRIMARY KEY,
    season         INTEGER NOT NULL,
    season_type    INTEGER NOT NULL,
    week           INTEGER NOT NULL,
    game_id        TEXT NOT NULL,
    kickoff        TEXT,
    home           TEXT,
    away           TEXT,
    team           TEXT,  -- NULL until a pick is entered for this game
    opponent       TEXT,
    ats            REAL,
    book_spread    REAL,
    odds           REAL,  -- decimal price the bet is valued at, e.g. 1.91 for -110
    odds_source    TEXT CHECK (odds_source IN ('moneyline', 'spread', 'estimate')),
    odds_provider  TEXT CHECK (odds_provider IN ('polymarket', 'draftkings')),
    placed_at      TEXT,
    result         TEXT CHECK (result IN ('win', 'loss', 'push')),
    team_score     INTEGER,
    opponent_score INTEGER
  )
`

// Creates the bets table, or rebuilds a table from before home/away existed (SQLite can't drop NOT NULL in place)
export function migrate(db: DatabaseSync) {
  const columns = db.prepare('PRAGMA table_info(bets)').all() as { name: string }[]
  if (columns.length > 0 && !columns.some((column) => column.name === 'home')) {
    db.exec(`
      BEGIN;
      ALTER TABLE bets RENAME TO bets_old;
      ${BETS_TABLE};
      INSERT INTO bets (id, season, season_type, week, game_id, team, opponent, ats, book_spread,
                        placed_at, result, team_score, opponent_score)
        SELECT id, season, season_type, week, game_id, team, opponent, ats, book_spread,
               placed_at, result, team_score, opponent_score FROM bets_old;
      DROP TABLE bets_old;
      COMMIT;
    `)
  } else {
    db.exec(BETS_TABLE)
  }

  // Columns added later; new nullable columns can be added in place
  const existing = new Set((db.prepare('PRAGMA table_info(bets)').all() as { name: string }[]).map((column) => column.name))
  const added: Record<string, string> = {
    kickoff: 'TEXT',
    odds: 'REAL',
    odds_source: "TEXT CHECK (odds_source IN ('moneyline', 'spread', 'estimate'))",
    odds_provider: "TEXT CHECK (odds_provider IN ('polymarket', 'draftkings'))",
  }
  for (const [name, definition] of Object.entries(added)) {
    if (!existing.has(name)) db.exec(`ALTER TABLE bets ADD COLUMN ${name} ${definition}`)
  }
}

function readJson(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let body = ''
    req.on('data', (chunk) => (body += chunk))
    req.on('end', () => {
      try {
        resolve(JSON.parse(body))
      } catch (error) {
        reject(error)
      }
    })
    req.on('error', reject)
  })
}

function sendJson(res: ServerResponse, status: number, data: unknown) {
  res.statusCode = status
  res.setHeader('Content-Type', 'application/json')
  res.end(JSON.stringify(data))
}

/**
 * Serves /api/bets from a local SQLite file while the Vite dev server runs:
 *   GET    /api/bets                                  all bets
 *   PUT    /api/bets/:id                              create or replace one bet
 *   DELETE /api/bets?season=&seasonType=&week=        remove one week's bets
 */
export function betsApi(dbPath: string): Plugin {
  return {
    name: 'bets-api',
    configureServer(server) {
      mkdirSync(dirname(dbPath), { recursive: true })
      const db = new DatabaseSync(dbPath)
      migrate(db)

      const listBets = db.prepare('SELECT * FROM bets ORDER BY season, season_type, week, placed_at')
      const upsertBet = db.prepare(`
        INSERT INTO bets (id, season, season_type, week, game_id, kickoff, home, away, team, opponent, ats, book_spread,
                          odds, odds_source, odds_provider, placed_at, result, team_score, opponent_score)
        VALUES ($id, $season, $seasonType, $week, $gameId, $kickoff, $home, $away, $team, $opponent, $ats, $bookSpread,
                $odds, $oddsSource, $oddsProvider, $placedAt, $result, $teamScore, $opponentScore)
        ON CONFLICT (id) DO UPDATE SET
          game_id = excluded.game_id, kickoff = excluded.kickoff, home = excluded.home, away = excluded.away,
          team = excluded.team, opponent = excluded.opponent, ats = excluded.ats,
          odds = excluded.odds, odds_source = excluded.odds_source, odds_provider = excluded.odds_provider,
          book_spread = excluded.book_spread, placed_at = excluded.placed_at, result = excluded.result,
          team_score = excluded.team_score, opponent_score = excluded.opponent_score
      `)
      const deleteWeek = db.prepare('DELETE FROM bets WHERE season = $season AND season_type = $seasonType AND week = $week')

      server.middlewares.use('/api/bets', async (req, res) => {
        try {
          const url = new URL(req.url ?? '/', 'http://localhost')
          const id = decodeURIComponent(url.pathname.slice(1))

          if (req.method === 'GET' && !id) {
            return sendJson(res, 200, (listBets.all() as BetRow[]).map(toBet))
          }

          if (req.method === 'PUT' && id) {
            const bet = (await readJson(req)) as Bet
            if (bet?.id !== id || typeof bet.gameId !== 'string') {
              return sendJson(res, 400, { error: 'Invalid bet' })
            }
            upsertBet.run({ ...bet })
            return sendJson(res, 200, bet)
          }

          if (req.method === 'DELETE' && !id) {
            const season = Number(url.searchParams.get('season'))
            const seasonType = Number(url.searchParams.get('seasonType'))
            const week = Number(url.searchParams.get('week'))
            if (![season, seasonType, week].every(Number.isInteger)) {
              return sendJson(res, 400, { error: 'season, seasonType and week are required' })
            }
            const { changes } = deleteWeek.run({ season, seasonType, week })
            return sendJson(res, 200, { deleted: changes })
          }

          sendJson(res, 405, { error: 'Method not allowed' })
        } catch (error) {
          sendJson(res, 500, { error: String(error) })
        }
      })
    },
  }
}
