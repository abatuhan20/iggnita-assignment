## Arda Batuhan AYDIN - Assignment
Next.js and javascript used no database.
events.jsonl file will be created for UI changes.
Portfolio and project view, phase gates with visible reasons, load-test evaluation,
sending units back (NCR-014) and an append-only history.

## To run it use
```bash
npm install
npm run dev # It will run at http://localhost:3000 or your local ip.
```
## Other scripts
```bash
npm test # Testing the general features of the app.
npm run demo # NCR-014 scenario replays in terminal.
npm run reset # It deletes the events.jsonl file which was created during UI changes. (For restarting and debugging)
```
## NCR-014 Scenario
1. Top right: **I am → Kemal Arslan**. Open **P-001**.
2. *Load tests* → **Use the sample file** → **Preview** (see results and what was found in the file) → **Import & record results**.
   Result: Unit 1 PASS, Unit 2 FAIL, Unit 3 FAIL (a judgement call, see below).
3. Same panel, *Record a result by hand*: Unit 3, pass, reason: *"single missing reading at 10:45 (logger dropout), neighbours 1940/1966 kW"*.
4. **I am → Selin Kaya**. *Issues*: reference `NCR-014`, tick **Unit 2** only, back to **Design**, failed component **alternator**,
   description, **1. Work out what is affected**, enter replacement name `ALT-2.5-B` / `10` weeks next to the alternator, **2. Raise issue & send back**.
5. The top of the page now reads *"Units 1 and 3 in Commissioning; Unit 2 back in Design (NCR-014)."* *What is valid, what is not* lists
   D-102 (invalid for Unit 2 only), ALT-2.1-A, T-1204/1205/1206 and the Unit 2 test result. Unit 2 history: click **history** on Unit 2.
6. Partial handover: add document `commissioning_report` for Units 1 and 3 → **Move to Handover** on Units 1 and 3 while Unit 2 stays in Design.
7. Unit 2 forward: design_approval for Unit 2 → Procurement → next status on `P001-U2-ALT-R1` until Delivered → Installation →
   Complete T-1204/5/6 → Commissioning → record re-test → commissioning_report for Unit 2 → Handover. Each blocked step names what is missing.

## Model

* **Project → Units → Phases.** The phase lives on the **unit**, not on the project. That is what lets Unit 2 go back to Design while Units 1 and 3
  carry on. The project's "stage" is just a sentence derived from its units.
* **"Part" of a project = a unit.** Some things are project-wide (site survey, mechanical completion, switchgear, grid connection, project tasks) project-wide items stay valid, 
  the rest belongs to one unit (engine, alternator, unit tasks). A document applies to *all units* or to a *list of units*.
* **Gates** (`lib/gates.js`) are one function, `evaluateGate(project, unit)`, returning the list of reasons. All units of all projects use it.
  Moving a unit forward is the only way to change its phase, except for raising an issue.
* **Event log.** Everything the user does is an event appended to `data/events.jsonl`; the current state is a fold over seed + events
  (`lib/state.js`). Nothing is edited or deleted. "Invalid" is derived from events, so the old records are still there.
* **Issues** (`issue.raised`) carry: reference, description, units, target phase, who/when, what becomes invalid and replacement orders.
  One event, so sending back is one atomic new fact.

## Load-test file: what is wrong with it and what I did

`data/load-test-P-001.csv` is a logger export with several problems. The import shows all of them to the user; the rule is applied to the cleaned readings.

| Found | Decision |
|---|---|
| `" U1"` and `"u3"` as unit ids | trimmed and upper-cased (reported) |
| U1 readings `1.952 MW` etc. | converted to kW (reported). Not converted they would read as 2 kW and fail U1 |
| U2 at 10:00 twice (identical) | duplicate dropped. Two *different* readings at one timestamp would both be excluded |
| `99999` for U1 at 13:15, note `SENSOR_FAULT?` | impossible for a 2000 kW unit (limit: negative or above 125 % of rated): treated as a sensor fault, **excluded**, not counted as a good reading |
| U2 at 12:30 empty, note `logger dropout` | excluded, never interpolated |
| U3 has no row at 10:45 | a missing reading. See the next paragraph |
| First readings of each unit are low (ramp-up) | normal, no special treatment: a run simply starts when the unit reaches the threshold |
| 18 U2 rows say `alt temp high`, ambient 31 °C against 24 °C | reported as information. It matches the NCR story, it does not change the rule |

**The rule:** 95 % of rated is inclusive (1900 kW for 2000 kW). A compliant *run* is consecutive 15-minute readings, all at or above the threshold.
Duration = last reading − first reading, so 4 hours needs 17 readings (16 readings, 3h45, fail). This is the stricter of the two readings of the brief.

**Missing readings break the run.** I do not assume that a gap was fine; a logger dropout and a real dip look the same in the data.
Consequences with this file: **U1 passes** (08:15–13:00 is 4h45 even though 13:15 is excluded), **U2 fails** (peak 1869 kW = 93.5 %, never reached 1900),
**U3 fails strictly** (2h15 before the gap at 10:45, 2h45 after). The import also computes whether a unit would pass if a *single* missing reading were bridged
(U3: yes, 5h15) and flags it as a **judgement call** for the commissioning engineer. For the NCR-014 scenario the brief says to treat Units 1 and 3 as passed,
so for **U3 a commissioning engineer's sign-off is recorded** by hand (Kemal Arslan, with the reason). The strict FAIL stays in the history next to it; the latest valid result counts.
A result is *always* recordable by hand (pass/fail + reason), also for the Unit 2 re-test.

# Assumptions
* "Today" is `as_of` 2026-10-26 from the seed. Event timestamps use that date with the real time of day.
* The load-test *tasks* (T-141…143) are not auto-completed by a result; the gate looks at the result, not at the task.
* Handover gate is per unit: its own latest valid load test passed, and a valid `commissioning_report` that applies to that unit exists. That is what makes a partial handover work.
* Reasons are required for manual results and issues; the "who" is whatever is picked at the top right

## Left out
Stretch goals
Auth and roles.
A re import screen for Unit 2 in NCR-014 Scenario so manual entry (Record a result by hand) needed. 

## Layout

```
lib/constants.js   vocabulary, errors, small helpers      lib/state.js     event fold, validity rules
lib/gates.js       phase gates with reasons               lib/rules.js     what an issue invalidates
lib/loadtest.js    CSV parsing + pass/fail rule           lib/commands.js  validated commands -> events
lib/engine.js      dispatch + append                      lib/store.js     JSON-lines persistence
lib/summary.js     portfolio, plain words, validity       lib/history.js   readable history
app/               pages and API routes (thin)            test/            gates, load test, NCR-014
```

## Phases
Survey → Design → Procurement → Installation → Commissioning → Handover.

## Units
Engine, Alternator, Switchgear or not specified.

