// File-backed engine for the Next.js app. The log is data/events.jsonl: one JSON event per line,
// only ever appended to. Delete the file (npm run reset) to start again from the seed.

import fs from 'node:fs';
import path from 'node:path';
import { Engine } from './engine.js';

const DATA_DIR = process.env.DATA_DIR || path.join(process.cwd(), 'data');
const EVENTS_FILE = process.env.EVENTS_FILE || path.join(DATA_DIR, 'events.jsonl');

export const readJson = (name) => JSON.parse(fs.readFileSync(path.join(DATA_DIR, name), 'utf8'));
export const readSampleCsv = () => fs.readFileSync(path.join(DATA_DIR, 'load-test-P-001.csv'), 'utf8');

function readEvents() {
  if (!fs.existsSync(EVENTS_FILE)) return [];
  return fs.readFileSync(EVENTS_FILE, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
}

// A fresh engine per request: the file is the single source of truth (and is tiny).
export function getEngine() {
  return new Engine({
    seed: readJson('projects.json'),
    people: readJson('people.json'),
    events: readEvents(),
    onAppend: (events) => {
      fs.mkdirSync(path.dirname(EVENTS_FILE), { recursive: true });
      fs.appendFileSync(EVENTS_FILE, `${events.map((e) => JSON.stringify(e)).join('\n')}\n`);
    },
  });
}

// Demo helper: moves the log aside (never deletes it) so the app starts again from the seed.
export function resetEvents() {
  if (!fs.existsSync(EVENTS_FILE)) return null;
  const backup = EVENTS_FILE.replace(/\.jsonl$/, `.${Date.now()}.bak.jsonl`);
  fs.renameSync(EVENTS_FILE, backup);
  return path.basename(backup);
}
