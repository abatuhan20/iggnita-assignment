// The engine owns the event log. dispatch() = validate (command) -> stamp -> append -> new state.
// Persistence is pluggable: tests use memory, the app uses a JSON-lines file (see store.js).

import { DomainError } from './constants.js';
import { commands } from './commands.js';
import { buildHistory } from './history.js';
import { buildState } from './state.js';

export function defaultNow(state) {
  // "Today" is the seed's as_of date (26 Oct 2026); only the time of day comes from the clock.
  return `${state.asOf}T${new Date().toISOString().slice(11, 19)}Z`;
}

export class Engine {
  constructor({ seed, people = [], events = [], now = defaultNow, onAppend = null }) {
    this.seed = seed;
    this.people = people;
    this.events = [...events];
    this.now = now;
    this.onAppend = onAppend;
    this._state = null;
  }

  get state() {
    if (!this._state) this._state = buildState(this.seed, this.events, this.people);
    return this._state;
  }

  // THE ONLY WAY TO CHANGE ANYTHING. Every button in the UI ends up here. Steps:
  //   1. find the command (completeTask, advanceUnit, raiseIssue, ...)
  //   2. the command checks the rules against the CURRENT state. If a rule is broken it throws
  //      a DomainError (with the reasons) and NOTHING is written.
  //   3. if it is fine, the command returns EVENTS (facts: "Unit 2 was sent back ...")
  //   4. we stamp each event with a number (seq), a time and who did it
  //   5. we append them to the log. We never edit or delete an old event (requirement R5).
  dispatch(name, input) {
    const command = commands[name];
    if (!command) throw new DomainError(`Unknown action "${name}"`, { status: 400 });
    const state = this.state;
    const drafts = command(state, input);
    let seq = state.lastSeq;
    const stamped = drafts.map((d) => ({ seq: ++seq, at: this.now(state), by: input.by, ...d }));
    // Build the new state BEFORE appending: if folding fails, nothing is written.
    const next = buildState(this.seed, [...this.events, ...stamped], this.people);
    this.onAppend?.(stamped);
    this.events.push(...stamped);
    this._state = next;
    return stamped;
  }

  query(name, input) {
    return commands[name](this.state, input);
  }

  history(filter) {
    return buildHistory(this.state, this.events, filter);
  }
}
