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
  team: string
  opponent: string
  ats: number | null
  bookSpread: number | null
  placedAt: string
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
  team: string
  opponent: string
  ats: number | null
  book_spread: number | null
  placed_at: string
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
    team: row.team,
    opponent: row.opponent,
    ats: row.ats,
    bookSpread: row.book_spread,
    placedAt: row.placed_at,
    result: row.result,
    teamScore: row.team_score,
    opponentScore: row.opponent_score,
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
      db.exec(`
        CREATE TABLE IF NOT EXISTS bets (
          id             TEXT PRIMARY KEY,
          season         INTEGER NOT NULL,
          season_type    INTEGER NOT NULL,
          week           INTEGER NOT NULL,
          game_id        TEXT NOT NULL,
          team           TEXT NOT NULL,
          opponent       TEXT NOT NULL,
          ats            REAL,
          book_spread    REAL,
          placed_at      TEXT NOT NULL,
          result         TEXT CHECK (result IN ('win', 'loss', 'push')),
          team_score     INTEGER,
          opponent_score INTEGER
        )
      `)

      const listBets = db.prepare('SELECT * FROM bets ORDER BY season, season_type, week, placed_at')
      const upsertBet = db.prepare(`
        INSERT INTO bets (id, season, season_type, week, game_id, team, opponent, ats, book_spread,
                          placed_at, result, team_score, opponent_score)
        VALUES ($id, $season, $seasonType, $week, $gameId, $team, $opponent, $ats, $bookSpread,
                $placedAt, $result, $teamScore, $opponentScore)
        ON CONFLICT (id) DO UPDATE SET
          game_id = excluded.game_id, opponent = excluded.opponent, ats = excluded.ats,
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
            if (bet?.id !== id || typeof bet.team !== 'string' || typeof bet.gameId !== 'string') {
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
