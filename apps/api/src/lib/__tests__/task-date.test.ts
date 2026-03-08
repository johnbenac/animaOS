import { describe, expect, test } from "bun:test";
import {
  isTaskOpen,
  isTaskOverdue,
  parseDueDateDeadline,
  resolveDueDate,
} from "../task-date";

describe("task-date helpers", () => {
  test("resolveDueDate normalizes date-only values to end-of-day", () => {
    const iso = resolveDueDate("2026-03-08");
    expect(iso).toBe("2026-03-08T23:59:59");
  });

  test("parseDueDateDeadline treats date-only values as end-of-day", () => {
    const deadline = parseDueDateDeadline("2026-03-08");
    expect(deadline).not.toBeNull();
    expect(deadline?.getHours()).toBe(23);
    expect(deadline?.getMinutes()).toBe(59);
    expect(deadline?.getSeconds()).toBe(59);
  });

  test("isTaskOpen false when done regardless of due date", () => {
    expect(isTaskOpen(true, null)).toBe(false);
    expect(isTaskOpen(true, "2099-01-01T00:00:00")).toBe(false);
  });

  test("isTaskOpen true for not-done future task", () => {
    expect(isTaskOpen(false, "2099-01-01T00:00:00")).toBe(true);
  });

  test("isTaskOverdue true for past due task", () => {
    expect(isTaskOverdue("2000-01-01T00:00:00")).toBe(true);
  });

  test("isTaskOverdue false for missing/invalid due dates", () => {
    expect(isTaskOverdue(null)).toBe(false);
    expect(isTaskOverdue("not-a-date")).toBe(false);
  });
});
