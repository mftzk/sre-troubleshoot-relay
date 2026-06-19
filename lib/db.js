import { Pool } from 'pg';

let pool;
let initPromise;

function getPool() {
  if (!pool) {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) {
      throw new Error('DATABASE_URL is not set');
    }
    const needsSsl =
      process.env.DB_SSL === 'true' || /sslmode=require/.test(connectionString);
    pool = new Pool({
      connectionString,
      ssl: needsSsl ? { rejectUnauthorized: false } : false,
      max: 5,
      idleTimeoutMillis: 30000,
    });
  }
  return pool;
}

export function query(text, params) {
  return getPool().query(text, params);
}

// Idempotent schema bootstrap. Runs at most once per process.
export function initDb() {
  if (!initPromise) {
    initPromise = (async () => {
      await query(`
        CREATE TABLE IF NOT EXISTS rooms (
          id TEXT PRIMARY KEY,
          code TEXT UNIQUE NOT NULL,
          scenario_id TEXT,
          status TEXT NOT NULL DEFAULT 'lobby',
          current_step_index INT NOT NULL DEFAULT 0,
          current_turn_player_id TEXT,
          created_at TIMESTAMPTZ NOT NULL DEFAULT now()
        );
      `);
      await query(`
        CREATE TABLE IF NOT EXISTS players (
          id TEXT PRIMARY KEY,
          room_id TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
          nickname TEXT NOT NULL,
          avatar TEXT NOT NULL DEFAULT '🧑‍💻',
          score INT NOT NULL DEFAULT 0,
          join_order INT NOT NULL,
          is_host BOOLEAN NOT NULL DEFAULT false,
          last_seen TIMESTAMPTZ NOT NULL DEFAULT now()
        );
      `);
      await query(`
        CREATE TABLE IF NOT EXISTS game_log (
          id BIGSERIAL PRIMARY KEY,
          room_id TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
          step_index INT NOT NULL,
          player_id TEXT,
          nickname TEXT,
          avatar TEXT,
          input TEXT,
          attempt_no INT NOT NULL DEFAULT 1,
          verdict TEXT NOT NULL,
          feedback TEXT,
          created_at TIMESTAMPTZ NOT NULL DEFAULT now()
        );
      `);
      // Holds the active scenario object (static OR AI-generated) for the room.
      await query(`ALTER TABLE rooms ADD COLUMN IF NOT EXISTS scenario_data JSONB;`);
      await query(
        `CREATE INDEX IF NOT EXISTS idx_players_room ON players(room_id);`
      );
      await query(
        `CREATE INDEX IF NOT EXISTS idx_log_room ON game_log(room_id, id);`
      );
    })().catch((e) => {
      // Reset so a later request can retry the bootstrap.
      initPromise = undefined;
      throw e;
    });
  }
  return initPromise;
}
