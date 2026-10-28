import { DomainError } from '../../../../lib/constants.js';
import { handle } from '../../../../lib/api.js';
import { getEngine } from '../../../../lib/store.js';
import { projectDetail } from '../../../../lib/summary.js';

export const dynamic = 'force-dynamic';
export const GET = (_req, { params }) =>
  handle(async () => {
    const { id } = await params;
    const detail = projectDetail(getEngine().state, id);
    if (!detail) throw new DomainError(`Project ${id} not found`, { status: 404 });
    return detail;
  });
