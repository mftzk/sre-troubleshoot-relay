import { randomUUID } from 'crypto';
import { query } from './db.js';

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no ambiguous chars

export function newId() {
  return randomUUID();
}

export function makeCode() {
  let c = '';
  for (let i = 0; i < 6; i++) {
    c += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
  }
  return c;
}

export async function getRoomByCode(code) {
  const { rows } = await query('SELECT * FROM rooms WHERE code = $1', [
    (code || '').toUpperCase(),
  ]);
  return rows[0] || null;
}

export async function getPlayers(roomId) {
  const { rows } = await query(
    'SELECT * FROM players WHERE room_id = $1 ORDER BY join_order ASC',
    [roomId]
  );
  return rows;
}

// Round-robin: the player after the current one (wraps around).
export function nextPlayerId(players, currentId) {
  if (players.length === 0) return null;
  const idx = players.findIndex((p) => p.id === currentId);
  if (idx === -1) return players[0].id;
  return players[(idx + 1) % players.length].id;
}

// How many wrong attempts have been made on a given step in this room.
export async function wrongAttempts(roomId, stepIndex) {
  const { rows } = await query(
    `SELECT COUNT(*)::int AS n FROM game_log
     WHERE room_id = $1 AND step_index = $2 AND verdict = 'wrong'`,
    [roomId, stepIndex]
  );
  return rows[0]?.n || 0;
}

export async function recentLog(roomId, limit = 30) {
  const { rows } = await query(
    `SELECT step_index, nickname, avatar, input, attempt_no, verdict, feedback, created_at
     FROM game_log WHERE room_id = $1 ORDER BY id DESC LIMIT $2`,
    [roomId, limit]
  );
  return rows.reverse();
}
