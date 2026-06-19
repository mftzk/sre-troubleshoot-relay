import { initDb, query } from '../../../../../lib/db.js';
import {
  getRoomByCode,
  getPlayers,
  nextPlayerId,
  wrongAttempts,
  getActiveScenario,
} from '../../../../../lib/game.js';
import { gradeAnswer } from '../../../../../lib/llm.js';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function pointsFor(attemptNo) {
  // Reward fewer attempts: 10, 7, 4, ... min 1.
  return Math.max(10 - (attemptNo - 1) * 3, 1);
}

async function advance(room, players, scenario) {
  const isLast = room.current_step_index >= scenario.steps.length - 1;
  if (isLast) {
    await query(`UPDATE rooms SET status = 'done', current_turn_player_id = NULL WHERE id = $1`, [
      room.id,
    ]);
    return { done: true };
  }
  const nextTurn = nextPlayerId(players, room.current_turn_player_id);
  await query(
    `UPDATE rooms SET current_step_index = current_step_index + 1, current_turn_player_id = $1 WHERE id = $2`,
    [nextTurn, room.id]
  );
  return { done: false, nextTurn };
}

export async function POST(req, ctx) {
  try {
    await initDb();
    const { code } = await ctx.params;
    const body = await req.json().catch(() => ({}));
    const { playerId, input } = body;
    const cmd = (input || '').trim();

    const room = await getRoomByCode(code);
    if (!room) return Response.json({ error: 'Room tidak ditemukan.' }, { status: 404 });
    if (room.status !== 'playing') {
      return Response.json({ error: 'Game tidak sedang berjalan.' }, { status: 409 });
    }
    if (room.current_turn_player_id !== playerId) {
      return Response.json({ error: 'Bukan giliranmu.' }, { status: 403 });
    }
    if (!cmd) return Response.json({ error: 'Input kosong.' }, { status: 400 });

    const players = await getPlayers(room.id);
    const me = players.find((p) => p.id === playerId);
    if (!me) return Response.json({ error: 'Pemain tidak ditemukan.' }, { status: 404 });

    const scenario = getActiveScenario(room);
    if (!scenario) return Response.json({ error: 'Soal tidak ditemukan.' }, { status: 409 });
    const step = scenario.steps[room.current_step_index];
    const maxAttempts = parseInt(process.env.MAX_ATTEMPTS || '3', 10);

    const priorWrong = await wrongAttempts(room.id, room.current_step_index);
    const attemptNo = priorWrong + 1;

    const verdict = await gradeAnswer({
      scenario,
      step,
      stepIndex: room.current_step_index,
      input: cmd,
      attemptNo,
      maxAttempts,
    });

    if (verdict.correct) {
      const gained = pointsFor(attemptNo);
      await query('UPDATE players SET score = score + $1 WHERE id = $2', [gained, me.id]);
      await query(
        `INSERT INTO game_log (room_id, step_index, player_id, nickname, avatar, input, attempt_no, verdict, feedback)
         VALUES ($1,$2,$3,$4,$5,$6,$7,'correct',$8)`,
        [room.id, room.current_step_index, me.id, me.nickname, me.avatar, cmd, attemptNo, verdict.feedback]
      );
      const adv = await advance(room, players, scenario);
      return Response.json({
        correct: true,
        feedback: verdict.feedback,
        pointsGained: gained,
        done: adv.done,
      });
    }

    // Wrong answer.
    const forcedReveal = attemptNo >= maxAttempts;
    await query(
      `INSERT INTO game_log (room_id, step_index, player_id, nickname, avatar, input, attempt_no, verdict, feedback)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [
        room.id,
        room.current_step_index,
        me.id,
        me.nickname,
        me.avatar,
        cmd,
        attemptNo,
        forcedReveal ? 'reveal' : 'wrong',
        verdict.feedback,
      ]
    );

    if (forcedReveal) {
      // Out of attempts: reveal the expected solution and move on.
      await query(
        `INSERT INTO game_log (room_id, step_index, player_id, nickname, avatar, input, attempt_no, verdict, feedback)
         VALUES ($1,$2,NULL,'sistem','💡',$3,$4,'reveal',$5)`,
        [
          room.id,
          room.current_step_index,
          'Jawaban: ' + step.expected,
          attemptNo,
          'Kesempatan habis — jawaban dibuka, lanjut ke pemain berikutnya.',
        ]
      );
      const adv = await advance(room, players, scenario);
      return Response.json({
        correct: false,
        revealed: true,
        feedback: verdict.feedback,
        answer: step.expected,
        done: adv.done,
      });
    }

    return Response.json({
      correct: false,
      revealed: false,
      feedback: verdict.feedback,
      next_clue: verdict.next_clue,
      attemptsLeft: maxAttempts - attemptNo,
    });
  } catch (err) {
    console.error('submit error:', err);
    return Response.json({ error: 'Server error: ' + (err?.message || 'unknown') }, { status: 500 });
  }
}
