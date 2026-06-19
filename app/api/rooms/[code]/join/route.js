import { initDb, query } from '../../../../../lib/db.js';
import { newId, getRoomByCode, getPlayers } from '../../../../../lib/game.js';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req, ctx) {
  try {
    await initDb();
    const { code } = await ctx.params;
    const body = await req.json().catch(() => ({}));
    const nickname = (body.nickname || '').trim().slice(0, 24);
    const avatar = (body.avatar || '🧑‍💻').slice(0, 8);
    if (!nickname) {
      return Response.json({ error: 'Nickname wajib diisi.' }, { status: 400 });
    }

    const room = await getRoomByCode(code);
    if (!room) return Response.json({ error: 'Room tidak ditemukan.' }, { status: 404 });
    if (room.status !== 'lobby') {
      return Response.json({ error: 'Game sudah dimulai, tidak bisa join.' }, { status: 409 });
    }

    const players = await getPlayers(room.id);
    if (players.length >= 8) {
      return Response.json({ error: 'Room penuh (maks 8 pemain).' }, { status: 409 });
    }
    const joinOrder = players.length;
    const playerId = newId();
    await query(
      `INSERT INTO players (id, room_id, nickname, avatar, join_order, is_host)
       VALUES ($1, $2, $3, $4, $5, false)`,
      [playerId, room.id, nickname, avatar, joinOrder]
    );

    return Response.json({ playerId, roomId: room.id, code: room.code });
  } catch (err) {
    console.error('join error:', err);
    return Response.json({ error: 'Server error: ' + (err?.message || 'unknown') }, { status: 500 });
  }
}
