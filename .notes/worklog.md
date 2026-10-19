# Worklog

Running notes on how this got built — decisions, assumptions, dead ends, and anything
left unfinished. Append as you go; a line or two per entry is right.

---

## Data, read before building

- `assignments` looks 87% duplicated, but it isn't: each logical assignment is 15 rows
  (14 x h/16 plus 1 x 2h/16) that sum to whole hours per day (2, 4, 5, 6, 8). So rows
  are summed, never DISTINCT. De-duplicating would show 1/16 to 1/8 of the real load.
- `hours_per_day` is literal hours once summed. Checked against the hand-made rows
  (people 1-5): Ana 8h/day Mon 29 Dec to Sun 4 Jan.
- Many assignments end on Sat/Sun. Decided allocation counts Mon-Fri only. Counting all
  7 days would turn Ana's first week into 56/40 and flag a lot of false overload.
- Public holidays (1 Jan) are not modelled anywhere, so they count as working days.
- Eli Nakamura has 0 weekly hours but 20h allocated in the week of 5 Jan. Any work on
  zero capacity is "over"; no percentages, so no divide by zero.
- `weekly_hours` is a single current value. Editing it re-colours past weeks too. No
  effective-dating in the schema, so I left it and flagged it.
- Names include RTL scripts (Arabic, Hebrew) and near-duplicates (Vera Novák / Vera
  Nowak). Names wrapped in `<bdi>`; sort is `name, id` so paging is stable.

## API

- Range snaps to whole Mon-Sun weeks (same as Postgres `date_trunc('week')`), capped at
  26 weeks, people paged (default 100, max 500). Thousands of people x 104 weeks is
  ~300k cells; that is not one request.
- Capacity is returned once per person, not per week, because the schema has one value.
  If capacity becomes time-varying the response grows a per-week array.
- Dates go to Postgres as `YYYY-MM-DD` strings, not `time.Time`, so a session timezone
  can't shift the week boundaries.
- Query: assignments for the page's people that overlap the range, expanded to days with
  `generate_series`, weekdays only, grouped per person per week. 500 people x 26 weeks
  takes ~0.6s locally. At real scale I'd want a (person_id, start_date, end_date) index
  or a closed-form weekday count instead of row expansion; schema is fixed so deferred.
- PATCH validates 0-168 (422), unknown person 404, returns the stored person.

## Grid

- After a save: pessimistic, then patch the row from the server's response. No refetch,
  because weekly_hours can't change allocation, only capacity. Not optimistic, because
  the colour is the thing a manager acts on and a value that may roll back is worse
  than a ~100ms "Saving…".
- A range fetch sent before a save finished would bring back the old hours. Saves are
  kept with a timestamp and re-applied to any response requested before them.
- Failed save: editor stays open with the typed value, error says "Not saved … Still
  40h.", button becomes Retry. Grid numbers never show the unsaved value.
- Loading: skeleton on first load only. On navigation the old grid stays, dimmed, with
  "Updating…"; superseded requests are aborted. Failed load keeps the old grid and says
  which range it is still showing, with Retry.
- Range lives in the URL (`?from=&to=`). Default stays the scaffold's 29 Dec - 16 Jan
  window because it holds the hand-made cases.
- All date maths is UTC on `YYYY-MM-DD` strings. Checked in a browser set to
  America/Los_Angeles: headers still read Dec 29 / Jan 5 / Jan 12.

## Verification

- Hand-checked people 1-5 for 29 Dec - 16 Jan against the seed: Ana 40/0/30, Bo 0/32/8
  (Fri-Mon assignment splits across weeks, weekend dropped), Cem 0/4/12, Dee 0/45/40,
  Eli 0/20/0. All match.
- Clicked through in headless Chromium: edit Cem 20 -> 10, his Jan 12 cell flips to
  12/10 over without reload, and survives moving to the next week. Forced 500 on PATCH
  and a dropped network on GET to see both failure states.
- Environment note: Docker images couldn't be pulled where this was built, so it ran on
  local Postgres 16, Node 22 and a Go 1.24 build of a scratch copy (older pgx). The
  committed go.mod is untouched. `make up` on the real stack is the final check.

## Not done

- Row virtualisation (paging covers it for now), name search / team filter.
- Holidays, time-off, effective-dated capacity.
- Go handler tests.

---

## Verified on the real stack (make up, Chrome)

The verification above ran on a local substitute stack. This is the `make up` check it
deferred.

- `make up` builds on Go 1.26 / Postgres 17 and runs. Health check reports 500 people.
- Recomputed people 1-5 for 29 Dec - 18 Jan with a separate SQL query. The API matches
  the numbers above. Also confirmed the data notes: all 8,413 assignment groups are 15
  fragments, their daily totals are only 2/4/5/6/8, and 3,111 end on a weekend.
- curl: bad date, reversed range, 53-week range and limit=0 all return 400. Negative
  hours 422, unknown person 404, non-JSON body 400. 500 people x 26 weeks in ~0.26s.
- Chrome:
  - Edit Cem 20 -> 10 flips his Jan 12 cell to 12/10 over with no reload.
  - Forced PATCH to 500: draft kept, error and Retry shown, grid unchanged. Cem put
    back to 20 afterwards.
  - Week back and forward and "This week" move the headers and the URL.
  - A 60-week URL range is capped to 26 columns.
  - Paging shows 101-200 of 500.
  - Forced GET failure: the banner keeps the old grid, and Retry recovers on the same
    page.
- Bug found: typing a date into From/To fired a change per segment. Each intermediate
  date was snapped to Monday and written back, overwriting the keystrokes (typing
  04/02/2026 landed on 01/12/2025). Picking from the calendar was fine. Fixed in
  f9185f4: the field shows the draft while focused and snaps on blur.
- Vitest 9/9, `tsc --noEmit` clean.

Left as is:
- Moving From past To collapses the range to one week. Keeping the week count may be
  nicer.
- An un-normalised range in the initial URL is snapped in the UI but not rewritten in
  the address bar until the next change.
- "Has room" and "Nothing allocated" colours are close; worth more contrast.
