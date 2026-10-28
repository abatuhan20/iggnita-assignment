// Load-test evaluation (R3).
//
// Rule: a unit PASSES if active power stays >= 95 % of rated output for >= 4 continuous hours,
// with a reading every 15 minutes.
//
// The CSV comes from a real data logger, so parsing is defensive and every decision is reported
// back as a "finding" (and written down in the README):
//   - unit ids are trimmed and upper-cased        (" U1", "u3")
//   - MW values are converted to kW               (1.952 MW -> 1952 kW)
//   - empty / non-numeric / implausible readings   are EXCLUDED, never guessed
//   - exact duplicate rows are dropped; conflicting duplicates are both excluded
//   - a missing reading BREAKS the continuous run (strict). We also compute whether the unit
//     would pass if single missing readings were bridged, and flag it for an engineer's decision.

import { DomainError, LOAD_TEST_RULE } from './constants.js';

const MIN = 60 * 1000;

export function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  let line = 1;
  let rowLine = 1;
  const src = text.replace(/^\uFEFF/, '');
  const pushField = () => { row.push(field); field = ''; };
  const pushRow = () => {
    pushField();
    if (!(row.length === 1 && row[0].trim() === '')) rows.push({ line: rowLine, cells: row });
    row = [];
    rowLine = line + 1;
  };
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (inQuotes) {
      if (c === '"' && src[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') inQuotes = false;
      else { if (c === '\n') line++; field += c; }
    } else if (c === '"') inQuotes = true;
    else if (c === ',') pushField();
    else if (c === '\r') { /* ignore */ }
    else if (c === '\n') { pushRow(); line++; rowLine = line; }
    else field += c;
  }
  if (field !== '' || row.length) pushRow();
  return rows;
}

const fmtTime = (ms) => new Date(ms).toISOString().slice(11, 16);
const fmtDateTime = (ms) => new Date(ms).toISOString().slice(0, 16).replace('T', ' ');
const fmtHours = (ms) => `${Math.floor(ms / 3600000)}h${String(Math.round((ms % 3600000) / MIN)).padStart(2, '0')}`;

function parseTimestamp(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::\d{2})?$/.exec(s.trim());
  if (!m) return null;
  const ms = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]);
  return Number.isNaN(ms) ? null : ms;
}

// Longest stretch of consecutive readings that are all compliant and no further apart than maxGapMin.
function longestRun(readings, thresholdKw, maxGapMin) {
  let best = null;
  let cur = null;
  for (const r of readings) {
    const ok = r.kw >= thresholdKw;
    if (!ok) { cur = null; continue; }
    if (cur && r.t - cur.endT <= maxGapMin * MIN) {
      cur.endT = r.t;
      cur.readings++;
    } else {
      cur = { startT: r.t, endT: r.t, readings: 1 };
    }
    if (!best || cur.endT - cur.startT > best.endT - best.startT) best = cur;
  }
  return best && { ...best, spanMs: best.endT - best.startT };
}

// R3, step by step:
//   1. read the CSV and check the key columns exist
//   2. clean every row (normalise unit id, convert MW, drop impossible/empty/duplicate readings)
//      and write a "finding" for each thing we noticed, so the user sees what was wrong
//   3. per unit: sort readings by time, list the gaps (missing 15-min readings)
//   4. find the longest unbroken stretch of readings >= 95 % of rated (a gap breaks it)
//   5. PASS if that stretch lasts >= 4 hours; otherwise FAIL
//   6. extra: would it pass if single missing readings were bridged? -> "judgement call" flag
export function evaluateLoadTest(csvText, units, rule = LOAD_TEST_RULE) {
  const findings = [];
  const add = (severity, code, message, extra = {}) => findings.push({ severity, code, message, ...extra });
  const parsed = parseCsv(csvText);
  if (parsed.length === 0) throw new DomainError('The load-test file is empty');

  const header = parsed[0].cells.map((h) => h.trim().toLowerCase());
  const col = (name) => header.indexOf(name);
  for (const required of ['timestamp', 'unit_id', 'active_power']) {
    if (col(required) === -1) throw new DomainError(`The load-test file has no "${required}" column`);
  }
  const unitById = Object.fromEntries(units.map((u) => [u.id, u]));
  const requiredMs = rule.hours * 60 * MIN;

  const byUnit = {}; // unitId -> Map(t -> reading)
  const noteCounts = {}; // `${unit}|${note}` -> count
  let dataRows = 0;

  for (const { line, cells } of parsed.slice(1)) {
    dataRows++;
    const get = (name) => (col(name) === -1 ? '' : (cells[col(name)] ?? ''));
    const rawUnit = get('unit_id');
    const unitId = rawUnit.trim().toUpperCase();
    const where = { line };
    if (rawUnit !== unitId) add('info', 'unit_id_normalised', `Line ${line}: unit id "${rawUnit}" read as ${unitId}`, where);
    const unit = unitById[unitId];
    if (!unit) { add('error', 'unknown_unit', `Line ${line}: unit "${rawUnit}" is not a unit of this project — row ignored`, where); continue; }

    const t = parseTimestamp(get('timestamp'));
    if (t === null) { add('error', 'bad_timestamp', `Line ${line}: unreadable timestamp "${get('timestamp')}" — row ignored`, { ...where, unitId }); continue; }

    const note = get('note').trim();
    if (note) noteCounts[`${unitId}|${note}`] = (noteCounts[`${unitId}|${note}`] || 0) + 1;

    const rawPower = get('active_power').trim();
    if (rawPower === '') { add('warning', 'missing_value', `Line ${line}: ${unitId} at ${fmtTime(t)} has no power value${note ? ` (logger note: "${note}")` : ''} — reading excluded`, { ...where, unitId }); continue; }
    let kw = Number(rawPower);
    if (!Number.isFinite(kw)) { add('warning', 'non_numeric', `Line ${line}: ${unitId} at ${fmtTime(t)} has non-numeric power "${rawPower}" — reading excluded`, { ...where, unitId }); continue; }

    const powerUnit = get('power_unit').trim().toLowerCase();
    if (powerUnit === 'mw') { kw *= 1000; add('info', 'converted_mw', `Line ${line}: ${unitId} at ${fmtTime(t)} given in MW (${rawPower}), converted to ${Math.round(kw)} kW`, { ...where, unitId }); }
    else if (powerUnit === '') add('info', 'assumed_kw', `Line ${line}: no power unit for ${unitId} at ${fmtTime(t)}, assumed kW`, { ...where, unitId });
    else if (powerUnit !== 'kw') { add('warning', 'unknown_power_unit', `Line ${line}: unknown power unit "${get('power_unit')}" — reading excluded`, { ...where, unitId }); continue; }

    if (kw < 0 || kw > unit.rated_kw * 1.25) {
      add('warning', 'implausible_value', `Line ${line}: ${unitId} at ${fmtTime(t)} reads ${rawPower} ${get('power_unit').trim() || 'kW'}, impossible for a ${unit.rated_kw} kW unit${note ? ` (logger note: "${note}")` : ''} — treated as a sensor fault, reading excluded`, { ...where, unitId });
      continue;
    }

    const map = (byUnit[unitId] ||= new Map());
    const key = t;
    const prev = map.get(key);
    if (prev === undefined) {
      map.set(key, { t, kw, line });
    } else if (prev === 'conflict') {
      add('warning', 'duplicate_conflict', `Line ${line}: another conflicting reading for ${unitId} at ${fmtTime(t)} — still excluded`, { ...where, unitId });
    } else if (Math.abs(prev.kw - kw) < 1e-9) {
      add('info', 'duplicate_exact', `Line ${line}: exact duplicate of line ${prev.line} (${unitId} at ${fmtTime(t)}) — dropped`, { ...where, unitId });
    } else {
      map.set(key, 'conflict');
      add('warning', 'duplicate_conflict', `Lines ${prev.line} and ${line}: ${unitId} has two different readings at ${fmtTime(t)} (${prev.kw} vs ${kw} kW) — both excluded`, { ...where, unitId });
    }
  }

  for (const [key, count] of Object.entries(noteCounts)) {
    const [unitId, note] = key.split('|');
    add('info', 'logger_note', `${unitId}: ${count} row${count > 1 ? 's carry' : ' carries'} the logger note "${note}"`, { unitId });
  }

  const results = {};
  for (const unit of units) {
    const map = byUnit[unit.id];
    const readings = map ? [...map.values()].filter((r) => r !== 'conflict').sort((a, b) => a.t - b.t) : [];
    const thresholdKw = (unit.rated_kw * rule.thresholdPct) / 100;
    const res = {
      unitId: unit.id,
      rated_kw: unit.rated_kw,
      thresholdKw,
      validReadings: readings.length,
      result: 'no_data',
      wouldPassIfGapsBridged: false,
      reasons: [],
    };
    results[unit.id] = res;
    if (readings.length === 0) {
      add('warning', 'no_data', `${unit.id}: the file has no usable readings for this unit`, { unitId: unit.id });
      res.reasons.push('No usable readings in the file');
      continue;
    }

    // Gaps between usable readings (a gap means one or more 15-minute readings are missing).
    for (let i = 1; i < readings.length; i++) {
      const d = readings[i].t - readings[i - 1].t;
      if (d !== rule.intervalMin * MIN) {
        const missing = Math.round(d / (rule.intervalMin * MIN)) - 1;
        add('warning', 'gap', `${unit.id}: ${missing} reading${missing === 1 ? '' : 's'} missing between ${fmtTime(readings[i - 1].t)} and ${fmtTime(readings[i].t)}${missing === 1 ? ` (${fmtTime(readings[i - 1].t + rule.intervalMin * MIN)})` : ''}`, { unitId: unit.id });
      }
    }

    const strict = longestRun(readings, thresholdKw, rule.intervalMin);
    const bridged = longestRun(readings, thresholdKw, rule.intervalMin * 2);
    const kws = readings.map((r) => r.kw);
    res.peakKw = Math.max(...kws);
    res.minKw = Math.min(...kws);
    res.peakPctOfRated = Math.round((res.peakKw / unit.rated_kw) * 1000) / 10;
    res.longestRun = strict && { start: fmtDateTime(strict.startT), end: fmtDateTime(strict.endT), spanMinutes: strict.spanMs / MIN, readings: strict.readings };
    res.bridgedRun = bridged && { start: fmtDateTime(bridged.startT), end: fmtDateTime(bridged.endT), spanMinutes: bridged.spanMs / MIN, readings: bridged.readings };

    const strictPass = strict && strict.spanMs >= requiredMs;
    const bridgedPass = bridged && bridged.spanMs >= requiredMs;
    res.result = strictPass ? 'pass' : 'fail';
    res.wouldPassIfGapsBridged = !strictPass && !!bridgedPass;

    if (strictPass) {
      res.reasons.push(`Held at or above ${thresholdKw} kW (${rule.thresholdPct}% of ${unit.rated_kw} kW) from ${fmtTime(strict.startT)} to ${fmtTime(strict.endT)}: ${fmtHours(strict.spanMs)}, ${strict.readings} readings`);
    } else if (!strict) {
      res.reasons.push(`Never reached ${thresholdKw} kW; peak ${res.peakKw} kW (${res.peakPctOfRated}% of rated)`);
    } else {
      res.reasons.push(`Longest unbroken stretch at or above ${thresholdKw} kW was ${fmtHours(strict.spanMs)} (${fmtTime(strict.startT)}–${fmtTime(strict.endT)}); ${rule.hours}h needed`);
    }
    if (res.wouldPassIfGapsBridged) {
      res.reasons.push(`JUDGEMENT CALL: it would pass (${fmtHours(bridged.spanMs)}) if the missing reading(s) were treated as a logger dropout rather than a dip. A commissioning engineer should decide; use "record by hand".`);
      add('warning', 'judgement_call', `${unit.id}: result depends on missing readings — strict rule says FAIL, bridging them says PASS. Needs an engineer's decision.`, { unitId: unit.id });
    }
    const temps = ambientReadings(parsed, header, unit.id);
    if (temps.length) res.avgAmbientC = Math.round((temps.reduce((a, b) => a + b, 0) / temps.length) * 10) / 10;
  }

  return { rule, rowsRead: dataRows, units: results, findings };
}

function ambientReadings(parsed, header, unitId) {
  const iu = header.indexOf('unit_id');
  const ia = header.indexOf('ambient_temp_c');
  if (ia === -1) return [];
  return parsed
    .slice(1)
    .filter((r) => (r.cells[iu] || '').trim().toUpperCase() === unitId)
    .map((r) => Number(r.cells[ia]))
    .filter((n) => Number.isFinite(n));
}
