import scenarios from '../data/scenarios.json';

export function listScenarios() {
  // Lightweight list for the lobby (no answers leaked).
  return scenarios.map((s) => ({
    id: s.id,
    title: s.title,
    description: s.description,
    difficulty: s.difficulty,
    steps: s.steps.length,
  }));
}

export function getScenario(id) {
  return scenarios.find((s) => s.id === id) || null;
}

// A full random static scenario — used as a safety net when LLM generation fails.
export function randomStaticScenario() {
  return scenarios[Math.floor(Math.random() * scenarios.length)];
}
