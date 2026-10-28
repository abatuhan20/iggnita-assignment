import { handle } from '../../../lib/api.js';
import { readJson } from '../../../lib/store.js';

export const dynamic = 'force-dynamic';
export const GET = () => handle(() => readJson('people.json'));
