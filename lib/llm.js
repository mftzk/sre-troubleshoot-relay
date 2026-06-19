import OpenAI from 'openai';

let client;
function getClient() {
  if (!client) {
    client = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY || 'sk-noop',
      baseURL: process.env.OPENAI_BASE_URL || 'http://localhost:20128/v1',
    });
  }
  return client;
}

// Keyword fallback used when the LLM is unreachable / returns garbage,
// so the game never hard-blocks on the model.
function keywordFallback(step, input) {
  const text = (input || '').toLowerCase();
  const kws = (step.keywords || []).map((k) => k.toLowerCase());
  if (kws.length === 0) return { correct: false, feedback: 'Tidak bisa memvalidasi otomatis.', next_clue: '' };
  const hits = kws.filter((k) => text.includes(k)).length;
  // Require a meaningful overlap of expected keywords.
  const correct = hits >= Math.max(2, Math.ceil(kws.length / 2));
  return {
    correct,
    feedback: correct
      ? 'Benar (divalidasi via fallback keyword — LLM tidak tersedia).'
      : 'Belum tepat. Coba sebutkan langkah/command yang lebih spesifik.',
    next_clue: '',
  };
}

/**
 * Grade a player's input for a step using the 9Router (OpenAI-compatible) LLM.
 * Returns { correct: boolean, feedback: string, next_clue: string }.
 */
export async function gradeAnswer({ scenario, step, stepIndex, input, attemptNo, maxAttempts }) {
  const system = [
    'Kamu adalah juri game troubleshooting incident untuk tim SRE.',
    'Tugasmu: menilai apakah input pemain BENAR menyelesaikan langkah (step) saat ini.',
    'Bersikaplah longgar soal sintaks persis, nama namespace/pod/resource, dan flag — terima command/jawaban yang secara konsep ekuivalen dan benar arahnya.',
    'Jika input mengarah ke tujuan step (sesuai "expected"), nilai correct=true.',
    'Balas HANYA dengan JSON valid, tanpa teks lain, berbentuk:',
    '{"correct": boolean, "feedback": string, "next_clue": string}',
    '- feedback: 1-2 kalimat singkat dalam Bahasa Indonesia menjelaskan kenapa benar/salah.',
    '- next_clue: jika salah, beri clue yang lebih spesifik (jangan langsung membocorkan jawaban kecuali ini percobaan terakhir). Jika benar, kosongkan "".',
  ].join('\n');

  const user = [
    `INCIDENT: ${scenario.title}`,
    `KONTEKS: ${scenario.description}`,
    `LANGKAH #${stepIndex + 1} (${step.role}): ${step.objective}`,
    `SOLUSI YANG DIHARAPKAN (rahasia, untuk penilaian): ${step.expected}`,
    `PERCOBAAN KE: ${attemptNo} dari ${maxAttempts}`,
    `INPUT PEMAIN: """${input}"""`,
  ].join('\n');

  try {
    const resp = await getClient().chat.completions.create({
      model: process.env.LLM_MODEL || 'gpt-4o-mini',
      temperature: 0,
      max_tokens: 300,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
    });
    const raw = resp.choices?.[0]?.message?.content || '';
    const parsed = JSON.parse(extractJson(raw));
    return {
      correct: !!parsed.correct,
      feedback: String(parsed.feedback || ''),
      next_clue: String(parsed.next_clue || ''),
    };
  } catch (err) {
    console.error('gradeAnswer LLM error, using keyword fallback:', err?.message || err);
    return keywordFallback(step, input);
  }
}

function extractJson(text) {
  const t = (text || '').trim();
  if (t.startsWith('{')) return t;
  const start = t.indexOf('{');
  const end = t.lastIndexOf('}');
  if (start !== -1 && end !== -1 && end > start) return t.slice(start, end + 1);
  return '{}';
}
