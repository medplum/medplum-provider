/**
 * Date adjustment utilities for the Bayshore demo.
 *
 * The seed data in bayshore-test-data uses fixed dates starting 2026-03-03.
 * This module computes an offset so that demo visits are relative to today:
 *   Visit 1 (Initial)  → today - 5 days
 *   Visit 2 (Routine)  → today - 2 days
 *   Visit 3 (Routine)  → today           ← "today's visit" for the demo
 *   Visit 4 (Routine)  → today + 3 days
 */

const BUNDLE_BASE_DATE = new Date('2026-03-03'); // Initial visit date in bundle

function stripTime(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

/** Milliseconds per day */
const MS_PER_DAY = 86_400_000;

/**
 * Returns the number of days to add to bundle dates so that the initial visit
 * lands 5 days before today (giving us past visits + a "today" visit).
 */
export function getDateOffsetDays(): number {
  const today = stripTime(new Date());
  const base = stripTime(BUNDLE_BASE_DATE);
  const diffDays = Math.round((today.getTime() - base.getTime()) / MS_PER_DAY);
  // We want the initial visit to be 5 days in the past
  return diffDays - 5;
}

/**
 * Offset a date string (YYYY-MM-DD or ISO datetime) by the demo offset.
 */
export function adjustDate(dateStr: string): string {
  const offsetDays = getDateOffsetDays();
  const d = new Date(dateStr);
  d.setDate(d.getDate() + offsetDays);

  // If input was date-only (YYYY-MM-DD), return date-only
  if (dateStr.length === 10) {
    return d.toISOString().slice(0, 10);
  }
  return d.toISOString();
}

/**
 * Get a date string for "today + n days" in YYYY-MM-DD format.
 */
export function todayPlus(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

/**
 * Get a datetime ISO string for "today at HH:MM" with optional day offset.
 */
export function todayAt(hours: number, minutes: number, dayOffset = 0): string {
  const d = new Date();
  d.setDate(d.getDate() + dayOffset);
  d.setHours(hours, minutes, 0, 0);
  return d.toISOString();
}
