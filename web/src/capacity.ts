import type { CapacityResponse, Person } from './api'

export type CellStatus = 'over' | 'full' | 'under' | 'idle'

// Hours are sums of fractional fragments; don't flag 40.0000001 as over 40.
const EPSILON = 0.005

export function cellStatus(allocated: number, capacity: number): CellStatus {
  if (allocated > capacity + EPSILON) return 'over' // includes any work on 0 capacity
  if (allocated <= EPSILON) return 'idle'
  if (allocated >= capacity - EPSILON) return 'full'
  return 'under'
}

export function formatHours(hours: number): string {
  return Number.isInteger(hours) ? String(hours) : hours.toFixed(1).replace(/\.0$/, '')
}

/** Replace one person's weekly hours in a loaded grid. Allocation is unaffected. */
export function applyPerson(data: CapacityResponse, person: Person): CapacityResponse {
  let changed = false
  const people = data.people.map((p) => {
    if (p.id !== person.id || p.weeklyHours === person.weeklyHours) return p
    changed = true
    return { ...p, weeklyHours: person.weeklyHours }
  })
  return changed ? { ...data, people } : data
}

export type SavedHours = Map<number, { person: Person; savedAt: number }>

/**
 * A fetch that started before a save finished can return the old weekly
 * hours. Re-apply any save that completed after the request was sent, so a
 * late response can't undo an edit the manager already saw succeed.
 */
export function reconcile(data: CapacityResponse, saved: SavedHours, requestedAt: number): CapacityResponse {
  let out = data
  for (const { person, savedAt } of saved.values()) {
    if (savedAt >= requestedAt) out = applyPerson(out, person)
  }
  return out
}

export function parseWeeklyHours(input: string): { value: number } | { error: string } {
  const trimmed = input.trim()
  if (trimmed === '') return { error: 'Enter weekly hours' }
  const value = Number(trimmed)
  if (!Number.isFinite(value)) return { error: 'Must be a number' }
  if (value < 0 || value > 168) return { error: 'Between 0 and 168' }
  return { value: Math.round(value * 100) / 100 }
}
