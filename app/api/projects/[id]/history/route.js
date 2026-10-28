import { handle } from '../../../../../lib/api.js';
import { getEngine } from '../../../../../lib/store.js';

export const dynamic = 'force-dynamic';
// GET /api/projects/P-001/history?unit=U2
export const GET = (req, { params }) =>
  handle(async () => {
    const { id } = await params;
    const unitId = new URL(req.url).searchParams.get('unit') || undefined;
    return getEngine().history({ projectId: id, unitId });
  });
