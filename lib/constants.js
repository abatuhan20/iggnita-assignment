// Business vocabulary shared by every module.

export const EQUIPMENT_STATUSES = ['Ordered', 'Delivered', 'Installed', 'Commissioned'];
export const MAJOR_EQUIPMENT = ['engine', 'alternator', 'switchgear'];
export const KNOWN_DOCUMENT_TYPES = [
  'site_survey_report',
  'design_approval',
  'mechanical_completion',
  'commissioning_report',
  'other',
];

// Load-test rule (R3): >= 95 % of rated output for >= 4 continuous hours, 15-minute readings.
export const LOAD_TEST_RULE = { thresholdPct: 95, hours: 4, intervalMin: 15 };

// Used by the "suggest what is affected" rules (see rules.js).
// Which Installation tasks depend on which failed component (matched on the task title).
export const COMPONENT_KEYWORDS = {
  engine: ['engine', 'foundation', 'exhaust', 'fuel'],
  alternator: ['alternator'],
  switchgear: ['switchgear', 'grid connection'],
};

export class DomainError extends Error {
  constructor(message, { status = 400, details = [] } = {}) {
    super(message);
    this.name = 'DomainError';
    this.status = status;
    this.details = details;
  }
}

export function unitNumber(unit) {
  const m = /^Unit (\d+)$/.exec(unit.name);
  return m ? m[1] : null;
}

// "Units 1 and 3", "Unit 2", "Units 1, 2 and 3"
export function unitList(units) {
  const nums = units.map((u) => unitNumber(u));
  if (nums.every(Boolean)) {
    const body = nums.length === 1 ? nums[0] : `${nums.slice(0, -1).join(', ')} and ${nums[nums.length - 1]}`;
    return `${nums.length === 1 ? 'Unit' : 'Units'} ${body}`;
  }
  return units.map((u) => u.name).join(', ');
}

export function addDays(dateStr, days) {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
export const addWeeks = (dateStr, weeks) => addDays(dateStr, weeks * 7);
