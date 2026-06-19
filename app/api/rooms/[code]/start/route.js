import { initDb, query } from '../../../../../lib/db.js';
import { getRoomByCode, getPlayers } from '../../../../../lib/game.js';
import { getScenario } from '../../../../../lib/scenarios.js';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req, ctx) {
  try {
    await initDb();
    const { code } = await ctx.params;
    const body = await req.json().catch(() => ({}));
    const { playerId, scenarioId } = body;

    const room = await getRoomByCode(code);
    if (!room) return Response.json({ error: 'Room tidak ditemukan.' }, { status: 404 });

    const players = await getPlayers(room.id);
    const me = players.find((p) => p.id === playerId);
    if (!me || !me.is_host) {
      return Response.json({ error: 'Hanya host yang bisa memulai game.' }, { status: 403 });
    }
    if (room.status === 'playing') {
      return Response.json({ error: 'Game sudah berjalan.' }, { status: 409 });
    }
    if (players.length < 1) {
      return Response.json({ error: 'Butuh minimal 1 pemain.' }, { status: 400 });
    }

    // Resolve the scenario to play with:
    //  - explicit static scenarioId (manual pick) → load & persist into scenario_data
    //  - else an already-generated/saved scenario_data → use as-is
    let scenarioData = room.scenario_data || null;
    let scenarioId2 = room.scenario_id || null;
    if (scenarioId) {
      const scenario = getScenario(scenarioId);
      if (!scenario) return Response.json({ error: 'Scenario tidak valid.' }, { status: 400 });
      scenarioData = scenario;
      scenarioId2 = scenario.id;
    }
    if (!scenarioData) {
      return Response.json(
        { error: 'Belum ada soal. Generate soal (AI) dulu atau pilih skenario.' },
        { status: 400 }
      );
    }

    const firstTurn = players[0].id; // join_order 0 (host) starts
    await query(
      `UPDATE rooms SET scenario_id = $1, scenario_data = $2::jsonb, status = 'playing',
       current_step_index = 0, current_turn_player_id = $3 WHERE id = $4`,
      [scenarioId2, JSON.stringify(scenarioData), firstTurn, room.id]
    );
    // Fresh start: clear any prior log + reset scores (allows replay).
    await query('DELETE FROM game_log WHERE room_id = $1', [room.id]);
    await query('UPDATE players SET score = 0 WHERE room_id = $1', [room.id]);

    return Response.json({ ok: true });
  } catch (err) {
    console.error('start error:', err);
    return Response.json({ error: 'Server error: ' + (err?.message || 'unknown') }, { status: 500 });
  }
}
