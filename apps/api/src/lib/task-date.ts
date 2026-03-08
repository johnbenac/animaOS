import * as chrono from "chrono-node";

const DATE_ONLY_RE = /^\d{4}-\d{2}-\d{2}$/;
const ISO_DATETIME_RE =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?(\.\d{1,3})?(Z|[+-]\d{2}:\d{2})?$/;

function formatISO(d: Date): string {
  const pad = (n: number) => n.toString().padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function endOfDayLocal(value: string): Date | null {
  const [y, m, d] = value.split("-").map(Number);
  const date = new Date(y, m - 1, d, 23, 59, 59, 999);
  return Number.isNaN(date.getTime()) ? null : date;
}

/**
 * Normalize free-form due date input into a task dueDate ISO string.
 * Date-only inputs are normalized to local end-of-day.
 */
export function resolveDueDate(value: string | undefined | null): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;

  if (DATE_ONLY_RE.test(trimmed)) {
    const date = endOfDayLocal(trimmed);
    return date ? formatISO(date) : null;
  }

  if (ISO_DATETIME_RE.test(trimmed)) {
    const parsed = new Date(trimmed);
    if (!Number.isNaN(parsed.getTime())) return formatISO(parsed);
  }

  const results = chrono.parse(trimmed, { instant: new Date() });
  if (!results.length) return null;

  const parsed = results[0].start.date();
  if (Number.isNaN(parsed.getTime())) return null;
  return formatISO(parsed);
}

/** Parse stored dueDate value into a Date. Date-only values are treated as end-of-day. */
export function parseDueDateDeadline(dueDate: string): Date | null {
  const value = dueDate.trim();
  if (!value) return null;

  if (DATE_ONLY_RE.test(value)) {
    return endOfDayLocal(value);
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed;
}

/** Open task = not done and due date has not passed (or no/invalid due date). */
export function isTaskOpen(done: boolean, dueDate: string | null): boolean {
  if (done) return false;
  if (!dueDate) return true;

  const deadline = parseDueDateDeadline(dueDate);
  if (!deadline) return true;

  return deadline.getTime() >= Date.now();
}

export function isTaskOverdue(dueDate: string | null): boolean {
  if (!dueDate) return false;

  const deadline = parseDueDateDeadline(dueDate);
  if (!deadline) return false;

  return deadline.getTime() < Date.now();
}
