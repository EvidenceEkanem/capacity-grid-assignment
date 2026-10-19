// Calendar dates as "YYYY-MM-DD" strings, computed in UTC.
//
// `new Date('2026-01-05')` is midnight UTC, so formatting it with local-time
// getters shows the previous day anywhere west of UTC. Everything here stays
// in UTC so a date means the same day for every manager.

const DAY_MS = 24 * 60 * 60 * 1000

export const MAX_WEEKS = 26 // matches the API cap

export function parseDate(iso: string): Date {
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d))
}

export function formatDate(date: Date): string {
  return date.toISOString().slice(0, 10)
}

export function isValidDate(iso: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return false
  return formatDate(parseDate(iso)) === iso
}

export function addDays(iso: string, days: number): string {
  return formatDate(new Date(parseDate(iso).getTime() + days * DAY_MS))
}

export function addWeeks(iso: string, weeks: number): string {
  return addDays(iso, weeks * 7)
}

/** Monday on or before the date (ISO weeks). */
export function mondayOf(iso: string): string {
  const day = parseDate(iso).getUTCDay() // 0 = Sunday
  return addDays(iso, -((day + 6) % 7))
}

/** Sunday on or after the date. */
export function sundayOf(iso: string): string {
  return addDays(mondayOf(iso), 6)
}

/** Number of Mon-Sun weeks the range touches. */
export function weekCount(from: string, to: string): number {
  const ms = parseDate(mondayOf(to)).getTime() - parseDate(mondayOf(from)).getTime()
  return Math.round(ms / DAY_MS / 7) + 1
}

/**
 * Snap a requested range to whole weeks, keep `to` after `from`, and cap it
 * at MAX_WEEKS by pulling `to` in (the start is what the manager chose).
 */
export function normalizeRange(from: string, to: string): { from: string; to: string } {
  let start = mondayOf(from)
  let end = sundayOf(to)
  if (end < start) end = sundayOf(start)
  if (weekCount(start, end) > MAX_WEEKS) end = addDays(addWeeks(start, MAX_WEEKS - 1), 6)
  return { from: start, to: end }
}

const weekLabel = new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short', timeZone: 'UTC' })
const yearLabel = new Intl.DateTimeFormat(undefined, { year: 'numeric', timeZone: 'UTC' })

export function formatWeek(iso: string): string {
  return weekLabel.format(parseDate(iso))
}

export function formatYear(iso: string): string {
  return yearLabel.format(parseDate(iso))
}

export function todayISO(now: Date = new Date()): string {
  // The manager's own calendar day, not UTC's.
  const y = now.getFullYear()
  const m = String(now.getMonth() + 1).padStart(2, '0')
  const d = String(now.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}
