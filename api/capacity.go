package main

import (
	"errors"
	"fmt"
	"net/http"
	"strconv"
	"time"
)

const (
	dateLayout = "2006-01-02"

	// maxWeeks caps one request. Two years of history is ~104 weeks; a manager
	// moves through it a window at a time and doesn't need it in one payload.
	maxWeeks = 26

	defaultLimit = 100
	maxLimit     = 500
)

type capacityPerson struct {
	ID          int       `json:"id"`
	Name        string    `json:"name"`
	WeeklyHours float64   `json:"weeklyHours"`
	Allocated   []float64 `json:"allocated"` // aligned with capacityResponse.Weeks
}

type capacityResponse struct {
	From   string           `json:"from"`  // Monday of the first week
	To     string           `json:"to"`    // Sunday of the last week
	Weeks  []string         `json:"weeks"` // Monday of each week, ISO date
	Total  int              `json:"total"` // people in the roster, for paging
	Offset int              `json:"offset"`
	Limit  int              `json:"limit"`
	People []capacityPerson `json:"people"`
}

// handleCapacity serves GET /api/capacity?from=YYYY-MM-DD&to=YYYY-MM-DD&offset=&limit=
//
// The range is widened to whole Monday-Sunday weeks. Allocation counts
// working days (Mon-Fri) only; capacity is the person's weekly_hours.
// People are paged so a roster of thousands doesn't come back in one go.
func (s *server) handleCapacity(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()

	from, err := parseDate(q.Get("from"))
	if err != nil {
		writeError(w, http.StatusBadRequest, "from: "+err.Error())
		return
	}
	to, err := parseDate(q.Get("to"))
	if err != nil {
		writeError(w, http.StatusBadRequest, "to: "+err.Error())
		return
	}
	if to.Before(from) {
		writeError(w, http.StatusBadRequest, "to must not be before from")
		return
	}

	start := mondayOf(from)
	end := mondayOf(to).AddDate(0, 0, 6)
	weeks := weekStarts(start, end)
	if len(weeks) > maxWeeks {
		writeError(w, http.StatusBadRequest, fmt.Sprintf("range spans %d weeks; at most %d per request", len(weeks), maxWeeks))
		return
	}

	offset, err := intParam(q.Get("offset"), 0, 0, 1<<31-1)
	if err != nil {
		writeError(w, http.StatusBadRequest, "offset: "+err.Error())
		return
	}
	limit, err := intParam(q.Get("limit"), defaultLimit, 1, maxLimit)
	if err != nil {
		writeError(w, http.StatusBadRequest, "limit: "+err.Error())
		return
	}

	ctx := r.Context()

	var total int
	if err := s.db.QueryRow(ctx, `SELECT count(*) FROM people`).Scan(&total); err != nil {
		writeError(w, http.StatusInternalServerError, "could not load people")
		return
	}

	rows, err := s.db.Query(ctx, `
		SELECT id, name, weekly_hours::float8
		FROM people
		ORDER BY name, id
		LIMIT $1 OFFSET $2`, limit, offset)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "could not load people")
		return
	}
	people := []capacityPerson{}
	index := map[int]int{}
	ids := []int{}
	for rows.Next() {
		var p capacityPerson
		if err := rows.Scan(&p.ID, &p.Name, &p.WeeklyHours); err != nil {
			rows.Close()
			writeError(w, http.StatusInternalServerError, "could not load people")
			return
		}
		p.Allocated = make([]float64, len(weeks))
		index[p.ID] = len(people)
		ids = append(ids, p.ID)
		people = append(people, p)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		writeError(w, http.StatusInternalServerError, "could not load people")
		return
	}

	if len(ids) > 0 {
		// Each assignment row is expanded to the working days it covers inside
		// the range, then summed per person per week. Rows are summed, never
		// de-duplicated: the seed splits one logical assignment into several
		// identical-looking fragments that only add up to the real hours.
		alloc, err := s.db.Query(ctx, `
			SELECT a.person_id,
			       date_trunc('week', d)::date AS week_start,
			       sum(a.hours_per_day)::float8 AS hours
			FROM assignments a
			CROSS JOIN LATERAL generate_series(
			    greatest(a.start_date, $2::date),
			    least(a.end_date, $3::date),
			    interval '1 day'
			) AS d
			WHERE a.person_id = ANY($1)
			  AND a.start_date <= $3::date
			  AND a.end_date >= $2::date
			  AND extract(isodow FROM d) < 6
			GROUP BY a.person_id, week_start`, ids, start.Format(dateLayout), end.Format(dateLayout))
		if err != nil {
			writeError(w, http.StatusInternalServerError, "could not load allocations")
			return
		}
		defer alloc.Close()
		for alloc.Next() {
			var personID int
			var week time.Time
			var hours float64
			if err := alloc.Scan(&personID, &week, &hours); err != nil {
				writeError(w, http.StatusInternalServerError, "could not load allocations")
				return
			}
			i, ok := index[personID]
			wi := int(week.Sub(start).Hours()/24) / 7
			if !ok || wi < 0 || wi >= len(weeks) {
				continue
			}
			people[i].Allocated[wi] = hours
		}
		if err := alloc.Err(); err != nil {
			writeError(w, http.StatusInternalServerError, "could not load allocations")
			return
		}
	}

	labels := make([]string, len(weeks))
	for i, wk := range weeks {
		labels[i] = wk.Format(dateLayout)
	}

	writeJSON(w, http.StatusOK, capacityResponse{
		From:   start.Format(dateLayout),
		To:     end.Format(dateLayout),
		Weeks:  labels,
		Total:  total,
		Offset: offset,
		Limit:  limit,
		People: people,
	})
}

func parseDate(s string) (time.Time, error) {
	if s == "" {
		return time.Time{}, errors.New("required, YYYY-MM-DD")
	}
	t, err := time.Parse(dateLayout, s)
	if err != nil {
		return time.Time{}, errors.New("must be YYYY-MM-DD")
	}
	return t, nil
}

// mondayOf returns the Monday on or before t (ISO weeks, same as date_trunc('week')).
func mondayOf(t time.Time) time.Time {
	offset := (int(t.Weekday()) + 6) % 7 // Monday=0 ... Sunday=6
	return t.AddDate(0, 0, -offset)
}

func weekStarts(start, end time.Time) []time.Time {
	var out []time.Time
	for wk := start; !wk.After(end); wk = wk.AddDate(0, 0, 7) {
		out = append(out, wk)
	}
	return out
}

func intParam(s string, def, min, max int) (int, error) {
	if s == "" {
		return def, nil
	}
	n, err := strconv.Atoi(s)
	if err != nil || n < min || n > max {
		return 0, fmt.Errorf("must be an integer between %d and %d", min, max)
	}
	return n, nil
}

func writeError(w http.ResponseWriter, status int, msg string) {
	writeJSON(w, status, map[string]string{"error": msg})
}
