import { useCallback, useEffect, useRef, useState } from 'react'
import { ApiError, fetchCapacity, updateWeeklyHours, type CapacityPerson, type CapacityResponse, type Person } from './api'
import { applyPerson, cellStatus, formatHours, parseWeeklyHours, reconcile, type SavedHours } from './capacity'
import { addWeeks, formatWeek, formatYear, isValidDate, MAX_WEEKS, mondayOf, todayISO, weekCount } from './dates'

type Props = {
  from: string
  to: string
  onRangeChange: (range: { from: string; to: string }) => void
}

const PAGE_SIZE = 100

type Load = { status: 'loading' } | { status: 'ready' } | { status: 'error'; message: string }

// CapacityGrid renders one row per person and one column per week, showing
// how allocated each person is and making over-allocation obvious.
//
// Loading keeps the previous grid on screen (dimmed) so navigating doesn't
// flash to empty; superseded requests are aborted. Saves are confirmed by the
// server before the numbers change, then patched into the loaded data
// (weekly hours only change capacity, never allocation).
export function CapacityGrid({ from, to, onRangeChange }: Props) {
  const [offset, setOffset] = useState(0)
  const [data, setData] = useState<CapacityResponse | null>(null)
  const [load, setLoad] = useState<Load>({ status: 'loading' })
  const [reloadKey, setReloadKey] = useState(0)
  const saved = useRef<SavedHours>(new Map())

  useEffect(() => {
    const controller = new AbortController()
    const requestedAt = Date.now()
    setLoad({ status: 'loading' })
    fetchCapacity({ from, to, offset, limit: PAGE_SIZE }, controller.signal)
      .then((res) => {
        setData(reconcile(res, saved.current, requestedAt))
        setLoad({ status: 'ready' })
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted) return
        const message = err instanceof ApiError ? err.message : 'Could not reach the server'
        setLoad({ status: 'error', message })
      })
    return () => controller.abort()
  }, [from, to, offset, reloadKey])

  const onSaved = useCallback((person: Person) => {
    saved.current.set(person.id, { person, savedAt: Date.now() })
    setData((current) => (current ? applyPerson(current, person) : current))
  }, [])

  const weeks = weekCount(from, to)
  const shift = (n: number) => onRangeChange({ from: addWeeks(from, n), to: addWeeks(to, n) })
  const total = data?.total ?? 0
  const loading = load.status === 'loading'

  return (
    <section className="capacity" aria-busy={loading}>
      <div className="toolbar">
        <div className="nav" role="group" aria-label="Move range">
          <button type="button" onClick={() => shift(-1)} aria-label="Previous week">
            ‹ Week
          </button>
          <button
            type="button"
            onClick={() => {
              const start = mondayOf(todayISO())
              onRangeChange({ from: start, to: addWeeks(start, weeks - 1) })
            }}
          >
            This week
          </button>
          <button type="button" onClick={() => shift(1)} aria-label="Next week">
            Week ›
          </button>
        </div>
        <DateField label="From" value={from} onCommit={(d) => onRangeChange({ from: d, to })} />
        <DateField label="To" value={to} min={from} onCommit={(d) => onRangeChange({ from, to: d })} />
        <span className="hint">
          {weeks} {weeks === 1 ? 'week' : 'weeks'} (max {MAX_WEEKS}), Mon to Sun
        </span>
        <span className="status" role="status">
          {loading && data ? 'Updating…' : ''}
        </span>
      </div>

      <Legend />

      {load.status === 'error' && (
        <div className="banner error" role="alert">
          <span>
            {data
              ? `Couldn't load ${formatWeek(from)} to ${formatWeek(to)} (${load.message}). Still showing ${formatWeek(data.from)} to ${formatWeek(data.to)}.`
              : `Couldn't load capacity (${load.message}).`}
          </span>
          <button type="button" onClick={() => setReloadKey((k) => k + 1)}>
            Retry
          </button>
        </div>
      )}

      {!data && loading && <SkeletonGrid weeks={weeks} />}

      {data && (
        <>
          <div className={`grid-wrap${loading ? ' stale' : ''}`}>
            <table className="grid">
              <thead>
                <tr>
                  <th scope="col" className="person-col">
                    Person
                  </th>
                  <th scope="col" className="hours-col">
                    Hours / week
                  </th>
                  {data.weeks.map((wk, i) => (
                    <th scope="col" key={wk} className="week-col">
                      {formatWeek(wk)}
                      {(i === 0 || formatYear(wk) !== formatYear(data.weeks[i - 1])) && (
                        <span className="year">{formatYear(wk)}</span>
                      )}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.people.map((p) => (
                  <Row key={p.id} person={p} weeks={data.weeks} onSaved={onSaved} />
                ))}
              </tbody>
            </table>
            {data.people.length === 0 && <p className="empty">No people on this page.</p>}
          </div>
          <div className="pager">
            <button type="button" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}>
              ‹ Previous {PAGE_SIZE}
            </button>
            <span>
              {total === 0 ? 'No people' : `${offset + 1} to ${Math.min(offset + PAGE_SIZE, total)} of ${total} people`}
            </span>
            <button type="button" disabled={offset + PAGE_SIZE >= total} onClick={() => setOffset(offset + PAGE_SIZE)}>
              Next {PAGE_SIZE} ›
            </button>
          </div>
        </>
      )}
    </section>
  )
}

function Row({ person, weeks, onSaved }: { person: CapacityPerson; weeks: string[]; onSaved: (p: Person) => void }) {
  const overWeeks = person.allocated.filter((a) => cellStatus(a, person.weeklyHours) === 'over').length
  return (
    <tr>
      <th scope="row" className="person-col">
        <bdi>{person.name}</bdi>
        {overWeeks > 0 && (
          <span className="over-count" title={`Over capacity in ${overWeeks} of ${weeks.length} weeks`}>
            {overWeeks} over
          </span>
        )}
      </th>
      <td className="hours-col">
        <HoursEditor person={person} onSaved={onSaved} />
      </td>
      {weeks.map((wk, i) => {
        const allocated = person.allocated[i] ?? 0
        const status = cellStatus(allocated, person.weeklyHours)
        return (
          <td
            key={wk}
            className={`cell ${status}`}
            title={`Week of ${formatWeek(wk)}: ${formatHours(allocated)}h allocated of ${formatHours(person.weeklyHours)}h`}
          >
            <span className="alloc">{formatHours(allocated)}</span>
            <span className="cap"> / {formatHours(person.weeklyHours)}</span>
            {status === 'over' && <span className="sr-only"> over capacity</span>}
          </td>
        )
      })}
    </tr>
  )
}

type EditState =
  | { mode: 'view'; flash?: boolean }
  | { mode: 'edit'; draft: string; error?: string }
  | { mode: 'saving'; draft: string }

export function HoursEditor({ person, onSaved }: { person: Person; onSaved: (p: Person) => void }) {
  const [state, setState] = useState<EditState>({ mode: 'view' })
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (state.mode === 'edit') inputRef.current?.focus()
  }, [state.mode])

  useEffect(() => {
    if (state.mode !== 'view' || !state.flash) return
    const t = setTimeout(() => setState({ mode: 'view' }), 1500)
    return () => clearTimeout(t)
  }, [state])

  const save = async (draft: string) => {
    const parsed = parseWeeklyHours(draft)
    if ('error' in parsed) {
      setState({ mode: 'edit', draft, error: parsed.error })
      return
    }
    if (parsed.value === person.weeklyHours) {
      setState({ mode: 'view' })
      return
    }
    setState({ mode: 'saving', draft })
    try {
      const updated = await updateWeeklyHours(person.id, parsed.value)
      onSaved(updated)
      setState({ mode: 'view', flash: true })
    } catch (err) {
      const message = err instanceof ApiError ? err.message : 'Something went wrong'
      setState({ mode: 'edit', draft, error: `Not saved: ${message}.` })
    }
  }

  if (state.mode === 'view') {
    return (
      <button
        type="button"
        className={`hours-button${state.flash ? ' saved' : ''}`}
        onClick={() => setState({ mode: 'edit', draft: String(person.weeklyHours) })}
        aria-label={`Edit weekly hours for ${person.name}, currently ${formatHours(person.weeklyHours)}`}
      >
        {formatHours(person.weeklyHours)}h{state.flash ? ' ✓ saved' : ''}
      </button>
    )
  }

  const saving = state.mode === 'saving'
  const error = state.mode === 'edit' ? state.error : undefined
  return (
    <form
      className="hours-form"
      onSubmit={(e) => {
        e.preventDefault()
        void save(state.draft)
      }}
    >
      <input
        ref={inputRef}
        type="number"
        inputMode="decimal"
        min={0}
        max={168}
        step="any"
        value={state.draft}
        disabled={saving}
        aria-label={`Weekly hours for ${person.name}`}
        aria-invalid={error ? true : undefined}
        onChange={(e) => setState({ mode: 'edit', draft: e.target.value })}
        onKeyDown={(e) => {
          if (e.key === 'Escape') setState({ mode: 'view' })
        }}
      />
      <button type="submit" disabled={saving}>
        {saving ? 'Saving…' : error ? 'Retry' : 'Save'}
      </button>
      <button type="button" disabled={saving} onClick={() => setState({ mode: 'view' })}>
        Cancel
      </button>
      {error && (
        <span className="field-error" role="alert">
          {error} Still {formatHours(person.weeklyHours)}h.
        </span>
      )}
    </form>
  )
}

// A date input that keeps showing what the manager typed while it has focus.
// Typing fires a change per segment, and each valid intermediate date is
// snapped to its Monday by the range; writing that back mid-typing would
// overwrite the keystrokes. The snapped value shows once focus leaves.
function DateField({
  label,
  value,
  min,
  onCommit,
}: {
  label: string
  value: string
  min?: string
  onCommit: (date: string) => void
}) {
  const [draft, setDraft] = useState<string | null>(null)
  return (
    <label>
      {label}
      <input
        type="date"
        value={draft ?? value}
        min={min}
        onFocus={() => setDraft(value)}
        onBlur={() => setDraft(null)}
        onChange={(e) => {
          setDraft(e.target.value)
          if (isValidDate(e.target.value)) onCommit(e.target.value)
        }}
      />
    </label>
  )
}

function Legend() {
  return (
    <ul className="legend" aria-label="Legend">
      <li>
        <span className="swatch over" /> Over capacity
      </li>
      <li>
        <span className="swatch full" /> Fully booked
      </li>
      <li>
        <span className="swatch under" /> Has room
      </li>
      <li>
        <span className="swatch idle" /> Nothing allocated
      </li>
      <li className="hint">Cells: allocated / capacity hours, working days only</li>
    </ul>
  )
}

function SkeletonGrid({ weeks }: { weeks: number }) {
  return (
    <div className="grid-wrap">
      <p className="sr-only" role="status">
        Loading capacity…
      </p>
      <table className="grid skeleton" aria-hidden="true">
        <tbody>
          {Array.from({ length: 8 }, (_, r) => (
            <tr key={r}>
              <th className="person-col">
                <span className="bar" />
              </th>
              <td className="hours-col">
                <span className="bar short" />
              </td>
              {Array.from({ length: weeks }, (_, c) => (
                <td key={c} className="cell">
                  <span className="bar short" />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
