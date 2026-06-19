import { initDb, query } from '../../../../../lib/db.js';
import { getRoomByCode, getPlayers } from '../../../../../lib/game.js';
import { randomStaticScenario } from '../../../../../lib/scenarios.js';
import { generateScenario } from '../../../../../lib/llm.js';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));

export async function POST(req, ctx) {
  try {
    await initDb();
    const { code } = await ctx.params;
    const body = await req.json().catch(() => ({}));
    const { playerId, topic, difficulty } = body;

    const room = await getRoomByCode(code);
    if (!room) return Response.json({ error: 'Room tidak ditemukan.' }, { status: 404 });

    const players = await getPlayers(room.id);
    const me = players.find((p) => p.id === playerId);
    if (!me || !me.is_host) {
      return Response.json({ error: 'Hanya host yang bisa generate soal.' }, { status: 403 });
    }
    if (room.status === 'playing') {
      return Response.json({ error: 'Game sedang berjalan.' }, { status: 409 });
    }

    // One step per player so everyone gets a turn (clamped 3–6).
    const steps = clamp(players.length, 3, 6);

    let scenario;
    let fallback = false;
    try {
      scenario = await generateScenario({ topic, difficulty, steps });
    } catch (err) {
      console.error('generateScenario failed, using static fallback:', err?.message || err);
      scenario = randomStaticScenario();
      fallback = true;
    }

    await query(
      `UPDATE rooms SET scenario_data = $1::jsonb, scenario_id = $2 WHERE id = $3`,
      [JSON.stringify(scenario), scenario.id, room.id]
    );

    return Response.json({
      ok: true,
      fallback,
      scenario: {
        title: scenario.title,
        description: scenario.description,
        difficulty: scenario.difficulty,
        totalSteps: scenario.steps.length,
        generated: !!scenario.generated,
      },
    });
  } catch (err) {
    console.error('generate error:', err);
    return Response.json({ error: 'Server error: ' + (err?.message || 'unknown') }, { status: 500 });
  }
}
