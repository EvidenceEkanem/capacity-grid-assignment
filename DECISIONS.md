# Decisions

Yours to write, not your AI's. Short is good — bullets are fine, and half a page is
plenty. We read this first.

## What did the spec not tell you?

There are things this brief doesn't specify. Which ones did you hit, what did you decide,
and why?

- **Weekends**: The database has over 3,000 assignments that end on a Saturday or Sunday. I decided to count Monday to Friday only. If we include weekends, it artificially inflates the workload and shows people like Ana at 56/40 hours when they aren’t actually over-committed.
- **Fragment rows**: Assignments are stored as multiple rows that look like duplicates but actually add up to the real total. I made sure the query sums them. If we just stripped out the “duplicates”, it would only show a fraction of the real load.
- **Saving updates**: When you change someone’s weekly hours, the UI waits for the server to confirm before updating that specific row. I didn’t bother refetching the whole grid since capacity changes don’t affect allocations. I also skipped optimistic updates. A cell turning green and snapping back to red on a network error is much more annoying than a short “Saving…” state.
- **Request limits**: I capped requests to 26 weeks, and paged the people (the grid shows 100 at a time, but the API allows up to 500 per request). The real system has thousands of people and two years of data, so we can’t load it all at once.
- **Capacity history**: Since the `people` table only has one `weekly_hours` value per person, editing their hours today retroactively changes their capacity for past weeks. I left this as-is since the brief specifically states the database schema is fixed input.

## What did you notice that looked wrong?

Anything in the output that didn't match what you expected. Whether you fixed it or left
it, we want to know you saw it.

- Eli has 0h capacity but 20h allocated. I left it alone and just let the grid highlight it as over-allocated.
- 1 Jan counts as a normal working day. There’s no holiday or PTO data in the schema, so I didn’t try to hack around it.
- Editing someone’s hours recolours past weeks (as mentioned above, I left it since the schema is fixed).
- A couple of minor UI quirks: “Has room” and “Nothing allocated” look pretty similar, and pushing the “From” date past “To” just shrinks the range to a single week. I left these to focus on the core functionality.

## What did the AI get wrong that you caught?

One concrete example. Every real session has one.

Typing a date manually into the From/To fields was broken. Typing “04/02/2026” would jump to “01/12/2025”. The AI’s code was trying to snap the date to a Monday on every single keystroke while I was still typing. Clicking the calendar picker worked fine, so the AI missed it in testing.
I didn’t trust the first AI’s “verified” claim, so I had a second AI pass run it on the real stack and click through it in Chrome. That caught the bug, which was fixed in `f9185f4`. The first AI's notes also said it had never run the real Docker setup, so I had `make up` run and everything tested against the seeded database.

## What would you do differently with a week?

- Store capacity per date or week, so changing someone’s hours today doesn’t rewrite their history.
- Factor in public holidays and time off.
- Optimize the query or add better database indexes to handle thousands of people and two years of data smoothly.
- Drop the pagination buttons in favour of a scrolling list, plus add search and team filters.
- Write tests for the Go handlers.
