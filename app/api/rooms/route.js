import { initDb, query } from '../../../lib/db.js';
import { newId, makeCode } from '../../../lib/game.js';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req) {
  try {
    await initDb();
    const body = await req.json().catch(() => ({}));
    const nickname = (body.nickname || '').trim().slice(0, 24);
    const avatar = (body.avatar || '🧑‍💻').slice(0, 8);
    if (!nickname) {
      return Response.json({ error: 'Nickname wajib diisi.' }, { status: 400 });
    }

    // Generate a unique room code (retry on collision).
    let code;
    for (let i = 0; i < 6; i++) {
      const candidate = makeCode();
      const { rows } = await query('SELECT 1 FROM rooms WHERE code = $1', [candidate]);
      if (rows.length === 0) {
        code = candidate;
        break;
      }
    }
    if (!code) {
      return Response.json({ error: 'Gagal membuat kode room, coba lagi.' }, { status: 500 });
    }

    const roomId = newId();
    const playerId = newId();
    await query(
      `INSERT INTO rooms (id, code, status, current_step_index) VALUES ($1, $2, 'lobby', 0)`,
      [roomId, code]
    );
    await query(
      `INSERT INTO players (id, room_id, nickname, avatar, join_order, is_host)
       VALUES ($1, $2, $3, $4, 0, true)`,
      [playerId, roomId, nickname, avatar]
    );

    return Response.json({ code, roomId, playerId });
  } catch (err) {
    console.error('create room error:', err);
    return Response.json({ error: 'Server error: ' + (err?.message || 'unknown') }, { status: 500 });
  }
}
