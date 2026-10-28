import { DomainError } from './constants.js';

// Turns domain errors into 4xx JSON (with the list of reasons), anything else into a 500.
export async function handle(fn) {
  try {
    return Response.json(await fn());
  } catch (e) {
    if (e instanceof DomainError) return Response.json({ error: e.message, details: e.details }, { status: e.status });
    console.error(e);
    return Response.json({ error: 'Internal error' }, { status: 500 });
  }
}
