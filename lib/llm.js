import OpenAI from 'openai';
import { randomUUID } from 'crypto';

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

/**
 * Generate a fresh SRE incident scenario via the LLM.
 * Returns a full scenario object { id, title, description, difficulty, steps[] }.
 * Throws if the LLM is unreachable or returns an invalid/short structure — the
 * caller is expected to fall back to a static scenario.
 */
export async function generateScenario({ topic, difficulty, steps }) {
  const n = Math.max(3, Math.min(6, parseInt(steps, 10) || 3));
  const diff = (difficulty || '').trim() || 'acak (pilih sendiri yang masuk akal)';
  const topicLine = (topic || '').trim()
    ? `TOPIK yang diminta: ${topic.trim()}`
    : 'TOPIK: bebas — pilih satu incident SRE realistis secara acak (boleh seputar Kubernetes, database, jaringan/DNS, message queue, observability, TLS/cert, storage, dll).';

  const system = [
    'Kamu adalah pembuat soal game troubleshooting incident untuk tim SRE.',
    'Buat SATU skenario incident yang realistis dan edukatif, lalu pecah menjadi langkah-langkah relay yang dikerjakan bergiliran.',
    `Hasilkan TEPAT ${n} langkah, berurutan logis: dari triage → diagnosa → remediasi/verifikasi.`,
    'Balas HANYA JSON valid (tanpa teks lain) dengan bentuk:',
    '{',
    '  "title": string,            // judul incident singkat',
    '  "description": string,      // 1-2 kalimat konteks incident (gejala, dampak)',
    '  "difficulty": "easy"|"medium"|"hard",',
    '  "steps": [                  // tepat ' + n + ' item',
    '    {',
    '      "role": string,         // label singkat peran langkah, mis. "Triage"',
    '      "objective": string,    // apa yang harus dicapai pemain di langkah ini',
    '      "clues": [string, string, string], // 3 clue makin spesifik; clue terakhir nyaris membocorkan',
    '      "expected": string,     // solusi/command yang diharapkan + catatan penilaian (RAHASIA)',
    '      "keywords": [string]    // 4-8 kata kunci huruf kecil untuk fallback pencocokan',
    '    }',
    '  ]',
    '}',
    'Gunakan Bahasa Indonesia. Command/teknis (mis. kubectl, psql) boleh tetap dalam bentuk aslinya.',
  ].join('\n');

  const user = [topicLine, `TINGKAT KESULITAN: ${diff}`, `JUMLAH LANGKAH: ${n}`].join('\n');

  const resp = await getClient().chat.completions.create({
    model: process.env.LLM_MODEL || 'gpt-4o-mini',
    temperature: 0.8,
    max_tokens: 1800,
    response_format: { type: 'json_object' },
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ],
  });

  const raw = resp.choices?.[0]?.message?.content || '';
  const parsed = JSON.parse(extractJson(raw));

  // Validate structure — throw on anything malformed so the caller can fall back.
  if (!parsed || typeof parsed !== 'object') throw new Error('LLM tidak mengembalikan objek');
  if (!Array.isArray(parsed.steps) || parsed.steps.length < 3) {
    throw new Error('Jumlah langkah tidak valid dari LLM');
  }
  const steps2 = parsed.steps.slice(0, n).map((s) => {
    const clues = Array.isArray(s.clues) ? s.clues.filter(Boolean).map(String) : [];
    const keywords = Array.isArray(s.keywords) ? s.keywords.filter(Boolean).map((k) => String(k).toLowerCase()) : [];
    if (!s.objective || !s.expected || clues.length < 2) {
      throw new Error('Langkah dari LLM tidak lengkap');
    }
    return {
      role: String(s.role || 'Langkah'),
      objective: String(s.objective),
      clues,
      expected: String(s.expected),
      keywords: keywords.length ? keywords : [],
    };
  });
  if (steps2.length < 3) throw new Error('Langkah valid kurang dari 3');

  return {
    id: 'ai-' + randomUUID().slice(0, 8),
    title: String(parsed.title || 'Incident SRE'),
    description: String(parsed.description || ''),
    difficulty: ['easy', 'medium', 'hard'].includes(parsed.difficulty) ? parsed.difficulty : 'medium',
    steps: steps2,
    generated: true,
  };
}

function extractJson(text) {
  const t = (text || '').trim();
  if (t.startsWith('{')) return t;
  const start = t.indexOf('{');
  const end = t.lastIndexOf('}');
  if (start !== -1 && end !== -1 && end > start) return t.slice(start, end + 1);
  return '{}';
}
