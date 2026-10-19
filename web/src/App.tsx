import { useCallback, useEffect, useState } from 'react'
import { CapacityGrid } from './CapacityGrid'
import { isValidDate, normalizeRange } from './dates'

// The range the grid opens on when the URL doesn't say. It covers the
// hand-made rows at the top of the seed.
const FROM = '2025-12-29'
const TO = '2026-01-16'

function rangeFromUrl(): { from: string; to: string } {
  const params = new URLSearchParams(window.location.search)
  const from = params.get('from') ?? ''
  const to = params.get('to') ?? ''
  if (isValidDate(from) && isValidDate(to)) return normalizeRange(from, to)
  return normalizeRange(FROM, TO)
}

export function App() {
  const [range, setRange] = useState(rangeFromUrl)

  // Keep the range in the URL so a view can be shared or reloaded.
  const changeRange = useCallback((next: { from: string; to: string }) => {
    const normalized = normalizeRange(next.from, next.to)
    setRange(normalized)
    const params = new URLSearchParams(window.location.search)
    params.set('from', normalized.from)
    params.set('to', normalized.to)
    window.history.replaceState(null, '', `?${params}`)
  }, [])

  useEffect(() => {
    const onPop = () => setRange(rangeFromUrl())
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [])

  return (
    <main>
      <h1>Team capacity</h1>
      <CapacityGrid from={range.from} to={range.to} onRangeChange={changeRange} />
    </main>
  )
}
