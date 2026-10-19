import { describe, expect, it } from 'vitest'
import type { CapacityResponse } from './api'
import { applyPerson, cellStatus, parseWeeklyHours, reconcile, type SavedHours } from './capacity'
import { mondayOf, normalizeRange, weekCount } from './dates'

const grid: CapacityResponse = {
  from: '2026-01-05',
  to: '2026-01-11',
  weeks: ['2026-01-05'],
  total: 2,
  offset: 0,
  limit: 100,
  people: [
    { id: 1, name: 'Ana', weeklyHours: 40, allocated: [45] },
    { id: 2, name: 'Eli', weeklyHours: 0, allocated: [20] },
  ],
}

describe('cellStatus', () => {
  it('flags any allocation against zero capacity as over', () => {
    expect(cellStatus(20, 0)).toBe('over')
    expect(cellStatus(0, 0)).toBe('idle')
  })

  it('does not flag float noise from summed fragments', () => {
    expect(cellStatus(40.000000001, 40)).toBe('full')
    expect(cellStatus(40.5, 40)).toBe('over')
    expect(cellStatus(12, 40)).toBe('under')
  })
})

describe('saving weekly hours', () => {
  it('changes capacity only, leaving allocation alone', () => {
    const next = applyPerson(grid, { id: 1, name: 'Ana', weeklyHours: 48 })
    expect(next.people[0]).toEqual({ id: 1, name: 'Ana', weeklyHours: 48, allocated: [45] })
    expect(next.people[1]).toBe(grid.people[1])
  })

  it('re-applies a save that finished after a slower fetch was sent', () => {
    const saved: SavedHours = new Map([[1, { person: { id: 1, name: 'Ana', weeklyHours: 48 }, savedAt: 2000 }]])
    // Fetch sent at t=1000 still carries the old 40h.
    expect(reconcile(grid, saved, 1000).people[0].weeklyHours).toBe(48)
    // Fetch sent after the save already has the truth; trust the server.
    expect(reconcile(grid, saved, 3000).people[0].weeklyHours).toBe(40)
  })

  it('validates input before sending', () => {
    expect(parseWeeklyHours('')).toEqual({ error: 'Enter weekly hours' })
    expect(parseWeeklyHours('-1')).toEqual({ error: 'Between 0 and 168' })
    expect(parseWeeklyHours('abc')).toEqual({ error: 'Must be a number' })
    expect(parseWeeklyHours(' 32 ')).toEqual({ value: 32 })
  })
})

describe('dates', () => {
  it('finds the Monday across a year boundary without timezone drift', () => {
    expect(mondayOf('2026-01-01')).toBe('2025-12-29')
    expect(mondayOf('2026-01-04')).toBe('2025-12-29') // Sunday
    expect(mondayOf('2026-01-05')).toBe('2026-01-05')
  })

  it('snaps a range to whole weeks and caps it at 26', () => {
    expect(normalizeRange('2025-12-31', '2026-01-16')).toEqual({ from: '2025-12-29', to: '2026-01-18' })
    const capped = normalizeRange('2026-01-05', '2027-01-05')
    expect(weekCount(capped.from, capped.to)).toBe(26)
  })
})
