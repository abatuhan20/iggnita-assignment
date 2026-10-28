import { handle } from '../../../lib/api.js';
import { getEngine } from '../../../lib/store.js';
import { portfolio } from '../../../lib/summary.js';

export const dynamic = 'force-dynamic';
export const GET = () => handle(() => portfolio(getEngine().state));
