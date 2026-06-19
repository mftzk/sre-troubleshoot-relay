import { initDb, query } from '../../../../../lib/db.js';
import {
  getRoomByCode,
  getPlayers,
  wrongAttempts,
  recentLog,
  getActiveScenario,
} from '../../../../../lib/game.js';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req, ctx) {
  try {
    await initDb();
    const { code } = await ctx.params;
    const url = new URL(req.url);
    const playerId = url.searchParams.get('playerId');

    const room = await getRoomByCode(code);
    if (!room) return Response.json({ error: 'Room tidak ditemukan.' }, { status: 404 });

    if (playerId) {
      await query('UPDATE players SET last_seen = now() WHERE id = $1', [playerId]);
    }

    const players = (await getPlayers(room.id)).map((p) => ({
      id: p.id,
      nickname: p.nickname,
      avatar: p.avatar,
      score: p.score,
      join_order: p.join_order,
      is_host: p.is_host,
    }));

    const scenario = getActiveScenario(room);
    const maxAttempts = parseInt(process.env.MAX_ATTEMPTS || '3', 10);

    let currentStep = null;
    if (scenario && room.status === 'playing') {
      const step = scenario.steps[room.current_step_index];
      if (step) {
        const wrong = await wrongAttempts(room.id, room.current_step_index);
        // Reveal clues progressively: 1 + number of wrong attempts so far.
        const visibleClues = step.clues.slice(0, Math.min(wrong + 1, step.clues.length));
        currentStep = {
          index: room.current_step_index,
          role: step.role,
          objective: step.objective,
          clues: visibleClues,
          attemptsUsed: wrong,
          maxAttempts,
        };
      }
    }

    const log = await recentLog(room.id, 40);

    return Response.json({
      room: {
        code: room.code,
        status: room.status,
        current_step_index: room.current_step_index,
        current_turn_player_id: room.current_turn_player_id,
      },
      scenario: scenario
        ? {
            id: scenario.id,
            title: scenario.title,
            description: scenario.description,
            difficulty: scenario.difficulty || null,
            totalSteps: scenario.steps.length,
            generated: !!scenario.generated,
          }
        : null,
      players,
      currentStep,
      log,
    });
  } catch (err) {
    console.error('state error:', err);
    return Response.json({ error: 'Server error: ' + (err?.message || 'unknown') }, { status: 500 });
  }
}
