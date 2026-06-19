import { listScenarios } from '../../../lib/scenarios.js';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  return Response.json({ scenarios: listScenarios() });
}
