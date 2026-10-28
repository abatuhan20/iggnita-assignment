import fs from 'node:fs';
import path from 'node:path';
const file = process.env.EVENTS_FILE || path.join(process.cwd(), 'data', 'events.jsonl');
fs.rmSync(file, { force: true });
console.log(`Reset: ${file} removed. The app starts again from the seed data.`);
