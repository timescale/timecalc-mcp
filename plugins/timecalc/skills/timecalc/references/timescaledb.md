# Time windows for SQL over time-series data

Read this reference when translating a natural-language question into SQL against TimescaleDB or PostgreSQL time-series tables. Use it to resolve the time window before writing the query.

## Procedure: resolve, then query

1. Decide the semantics of the requested window: which time zone, calendar units or elapsed units, and where the boundaries fall.
2. Ask the user for their time zone if the window depends on local days, weeks, or months and the zone is not known. Do not assume the MCP server's zone or the database session's zone is the user's zone.
3. Resolve the window's start and end to instants (or to calendar dates for month boundaries) with `evaluate_date_expression`.
4. Write the SQL with those literal values in the `WHERE` clause. Use half-open bounds: `time >= start AND time < end`. Do not use `BETWEEN` on timestamps.
5. Pass the user's zone to `time_bucket` when buckets are a day or longer, and pass resolved instants to functions that need them (`time_bucket_gapfill` start and finish, `time_bucket` origin).
6. State the resolved window and zone in the answer so the user can verify what was queried.

Do not put `now()` arithmetic in the query to express a window the user described in words. Hypertable timestamps are `timestamptz` (UTC instants), so a window computed in the wrong zone or with the wrong units still runs and returns a plausible but wrong result.

All examples below use `now` = `2026-09-03T14:22:07Z` and a user in `America/Chicago`.

## Start of a local day

Floor the current zoned time to the start of today, then convert to an instant:

```lisp
(to-instant (round (with-time-zone (now) "America/Chicago")
                   :smallest-unit "day" :rounding-mode "floor"))
; 2026-09-03T05:00:00Z
```

Step back with calendar days before converting. "Yesterday" is the window from one day before this bound up to this bound:

```lisp
(to-instant (subtract (round (with-time-zone (now) "America/Chicago")
                             :smallest-unit "day" :rounding-mode "floor")
                      P1D))
; 2026-09-02T05:00:00Z
```

```sql
SELECT time_bucket('1 hour', time, 'America/Chicago') AS bucket, avg(cpu)
FROM metrics
WHERE time >= '2026-09-02T05:00:00Z' AND time < '2026-09-03T05:00:00Z'
GROUP BY bucket
ORDER BY bucket;
```

Round to `"hour"` or `"minute"` (optionally with `:rounding-increment`) for finer-grained window starts. `round` supports `day` and smaller units only.

## Rolling window versus calendar period

"The last 7 days" is a rolling window. Subtract calendar days from the start of today:

```lisp
(to-instant (subtract (round (with-time-zone (now) "America/Chicago")
                             :smallest-unit "day" :rounding-mode "floor")
                      P7D))
; 2026-08-27T05:00:00Z
```

"This week" is a calendar week starting Monday. The DSL cannot round to weeks, so find the weekday first, then step back that many days minus one in a second call:

```lisp
(day-of-week (to-date (with-time-zone (now) "America/Chicago")))
; 4    (1 = Monday ... 7 = Sunday, so Monday is 3 days back)

(to-instant (subtract (round (with-time-zone (now) "America/Chicago")
                             :smallest-unit "day" :rounding-mode "floor")
                      P3D))
; 2026-08-31T05:00:00Z
```

Use that instant as the `origin` when weekly buckets must align to the same Monday:

```sql
time_bucket('7 days', time, 'America/Chicago', origin => '2026-08-31T05:00:00Z'::timestamptz)
```

Ask the user if "week" should start on Monday or Sunday when it is not clear.

## Same period last year

Shift a zoned bound by a calendar year before converting it, so the result is the same local date even if the offset differs:

```lisp
(to-instant (subtract (round (with-time-zone (now) "America/Chicago")
                             :smallest-unit "day" :rounding-mode "floor")
                      P1Y))
; 2025-09-03T05:00:00Z
```

Subtracting `P1Y`, `P1M`, or `P1D` from an instant is rejected with `INVALID_TEMPORAL_OPERATION` because those units have no fixed length. Convert to a zoned date-time first, or use elapsed units such as `PT24H` if the user means exact elapsed time.

## Month boundaries

`round` does not support months. Resolve month boundaries as calendar dates and let PostgreSQL attach the zone:

```lisp
(subtract 2026-09-01 P1M)
; 2026-08-01
```

```sql
WHERE time >= timestamptz '2026-08-01 00:00 America/Chicago'
  AND time <  timestamptz '2026-09-01 00:00 America/Chicago'
```

Get the current month from `(to-date (with-time-zone (now) "America/Chicago"))` and its `year` and `month` inspectors; the first of that month is a date literal you can write directly. Use `days-in-month` when the question involves month length.

Alternatively write a zoned literal such as `2026-08-01T00:00:00-05:00[America/Chicago]` and convert it with `to-instant`. The offset must be correct for that date: `2026-01-01T00:00:00-05:00[America/Chicago]` is rejected with `INVALID_TEMPORAL_VALUE` because Chicago is at `-06:00` in January. If a zoned literal is rejected for this reason, fix the offset from the error rather than dropping the zone.

## Gap filling

`time_bucket_gapfill` needs explicit `start` and `finish`. Use the resolved window bounds with named arguments and casts:

```sql
SELECT time_bucket_gapfill('15 minutes', time,
                           start  => '2026-09-02T05:00:00Z'::timestamptz,
                           finish => '2026-09-03T05:00:00Z'::timestamptz) AS bucket,
       locf(avg(cpu))
FROM metrics
WHERE time >= '2026-09-02T05:00:00Z' AND time < '2026-09-03T05:00:00Z'
GROUP BY bucket
ORDER BY bucket;
```

The `WHERE` bounds and the gapfill `start`/`finish` must be the same instants.

## Retention and age cutoffs

"Older than 90 days" needs a cutoff instant. Ninety calendar days and 2,160 elapsed hours are different quantities; pick the one the user means:

```lisp
(to-instant (subtract (with-time-zone (now) "UTC") P90D))   ; calendar days in UTC
; 2026-06-05T14:22:07Z

(subtract (now) PT2160H)                                    ; exactly 90 x 24 hours
; 2026-06-05T14:22:07Z
```

They agree in UTC. Across a daylight-saving change in a local zone they differ by an hour: from `2026-04-15T12:00:00Z`, ninety calendar days back in `America/Chicago` is `2026-01-15T13:00:00Z`, while `PT2160H` back is `2026-01-15T12:00:00Z`. For TimescaleDB retention and compression policies, which are defined in elapsed intervals, prefer the elapsed form.

## Daylight-saving days

A local day is 23 or 25 hours on transition days. Use `P1D` to move by a local day and `PT24H` to move by exactly 24 hours, and say which one you used when it affects the answer:

```lisp
(add 2026-11-01T00:00:00-05:00[America/Chicago] P1D)
; 2026-11-02T00:00:00-06:00[America/Chicago]

(add 2026-11-01T00:00:00-05:00[America/Chicago] PT24H)
; 2026-11-01T23:00:00-06:00[America/Chicago]
```

`time_bucket('1 day', time, 'America/Chicago')` produces local-day buckets that follow the same rule; without the zone argument it buckets in UTC.

## Reporting

In the answer, include the resolved window as instants, the zone it was derived from, and whether periods were calendar or elapsed. For example: "Queried 2026-09-02T05:00:00Z to 2026-09-03T05:00:00Z, which is Wednesday 2 September in America/Chicago."
