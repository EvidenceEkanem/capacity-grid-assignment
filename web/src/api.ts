export type CapacityPerson = {
  id: number
  name: string
  weeklyHours: number
  /** Allocated hours, one entry per item in CapacityResponse.weeks. */
  allocated: number[]
}

export type CapacityResponse = {
  from: string
  to: string
  /** Monday of each week, YYYY-MM-DD. */
  weeks: string[]
  total: number
  offset: number
  limit: number
  people: CapacityPerson[]
}

export type Person = {
  id: number
  name: string
  weeklyHours: number
}

export class ApiError extends Error {
  readonly status: number
  constructor(message: string, status: number) {
    super(message)
    this.name = 'ApiError'
    this.status = status
  }
}

async function readError(res: Response): Promise<ApiError> {
  let message = `Request failed (${res.status})`
  try {
    const body = (await res.json()) as { error?: string }
    if (body.error) message = body.error
  } catch {
    // Not JSON (proxy error page, empty body); keep the status message.
  }
  return new ApiError(message, res.status)
}

export async function fetchCapacity(
  params: { from: string; to: string; offset: number; limit: number },
  signal?: AbortSignal,
): Promise<CapacityResponse> {
  const qs = new URLSearchParams({
    from: params.from,
    to: params.to,
    offset: String(params.offset),
    limit: String(params.limit),
  })
  const res = await fetch(`/api/capacity?${qs}`, { signal })
  if (!res.ok) throw await readError(res)
  return (await res.json()) as CapacityResponse
}

export async function updateWeeklyHours(id: number, weeklyHours: number): Promise<Person> {
  let res: Response
  try {
    res = await fetch(`/api/people/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ weeklyHours }),
    })
  } catch {
    throw new ApiError('Could not reach the server. Check your connection and try again.', 0)
  }
  if (!res.ok) throw await readError(res)
  return (await res.json()) as Person
}
