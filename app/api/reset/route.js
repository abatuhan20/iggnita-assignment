import { DomainError } from '../../../lib/constants.js';
import { handle } from '../../../lib/api.js';
import { resetEvents } from '../../../lib/store.js';

export const dynamic = 'force-dynamic';

// POST /api/reset  (set ALLOW_RESET=false to switch it off)
export const POST = () =>
  handle(() => {
    if (process.env.ALLOW_RESET === 'false') throw new DomainError('Reset is disabled', { status: 403 });
    return { ok: true, backup: resetEvents() };
  });