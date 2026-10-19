import '@testing-library/jest-dom/vitest'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { HoursEditor } from './CapacityGrid'

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

const ana = { id: 1, name: 'Ana', weeklyHours: 40 }

function editTo(value: string) {
  fireEvent.click(screen.getByRole('button', { name: /edit weekly hours for ana/i }))
  fireEvent.change(screen.getByLabelText('Weekly hours for Ana'), { target: { value } })
  fireEvent.click(screen.getByRole('button', { name: 'Save' }))
}

describe('HoursEditor', () => {
  it('keeps the old value and the typed draft when the save fails', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ error: 'could not save weekly hours' }), { status: 500 })),
    )
    const onSaved = vi.fn()
    render(<HoursEditor person={ana} onSaved={onSaved} />)

    editTo('32')

    expect(await screen.findByRole('alert')).toHaveTextContent('Not saved: could not save weekly hours. Still 40h.')
    expect(screen.getByLabelText('Weekly hours for Ana')).toHaveValue(32)
    expect(screen.getByRole('button', { name: 'Retry' })).toBeEnabled()
    expect(onSaved).not.toHaveBeenCalled()
  })

  it('hands the server copy to the grid on success', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ ...ana, weeklyHours: 32 }))))
    const onSaved = vi.fn()
    render(<HoursEditor person={ana} onSaved={onSaved} />)

    editTo('32')

    await waitFor(() => expect(onSaved).toHaveBeenCalledWith({ id: 1, name: 'Ana', weeklyHours: 32 }))
  })
})
