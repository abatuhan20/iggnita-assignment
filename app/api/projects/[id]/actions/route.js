import { DomainError } from '../../../../../lib/constants.js';
import { handle } from '../../../../../lib/api.js';
import { evaluateLoadTest } from '../../../../../lib/loadtest.js';
import { getEngine, readSampleCsv } from '../../../../../lib/store.js';

export const dynamic = 'force-dynamic';

const WRITE = ['completeTask', 'addDocument', 'advanceEquipment', 'advanceUnit', 'recordLoadTest', 'importLoadTest', 'raiseIssue'];

// POST /api/projects/P-001/actions   { "action": "raiseIssue", ...payload }
export const POST = (req, { params }) =>
  handle(async () => {
    const { id } = await params;
    const { action, useSample, ...payload } = await req.json();
    const engine = getEngine();
    if (!engine.state.projects[id]) throw new DomainError(`Project ${id} not found`, { status: 404 });
    if ((action === 'importLoadTest' || action === 'previewLoadTest') && useSample) {
      payload.csvText = readSampleCsv();
      payload.filename = 'load-test-P-001.csv (sample)';
    }
    if (action === 'previewLoadTest') {
      if (!payload.csvText) throw new DomainError('The CSV file is required');
      return evaluateLoadTest(payload.csvText, engine.state.projects[id].units);
    }
    if (action === 'suggestInvalidations') return engine.query('suggestInvalidations', { ...payload, projectId: id });
    if (!WRITE.includes(action)) throw new DomainError(`Unknown action "${action}"`);
    const events = engine.dispatch(action, { ...payload, projectId: id });
    return { ok: true, events };
  });
