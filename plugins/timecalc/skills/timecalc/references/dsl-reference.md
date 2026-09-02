# timecalc DSL reference

Read this reference when constructing a complex expression, selecting options, or repairing a tool error.

## Expression syntax

```lisp
(operator positional-argument ... :keyword-option value ...)
```

- Send exactly one top-level expression.
- Put all positional arguments before keyword options.
- Expressions may be nested wherever an argument or option value is accepted.
- A semicolon starts a line comment.
- Use strings for option names and time-zone identifiers.
- Do not quote Temporal literals.

## Supported values

| Literal | Type |
|---|---|
| `2025-01-31` | date (`Temporal.PlainDate`) |
| `2025-06-01T12:00:00Z` | instant (`Temporal.Instant`) |
| `2025-06-01T08:00:00-04:00[America/New_York]` | zoned date-time (`Temporal.ZonedDateTime`) |
| `P1M`, `PT24H`, `-P2D` | duration (`Temporal.Duration`) |
| `"America/New_York"` | string |
| `5` | number |
| `true`, `false` | boolean |

The DSL does not support `PlainTime`, `PlainDateTime`, natural-language dates, locale-specific date formats, recurrence rules, holidays, or business-day arithmetic.

## Operators

### Arithmetic

```lisp
(add temporal duration [:overflow "constrain"|"reject"])
```

Returns the same type as `temporal`. `temporal` may be a date, instant, or zoned date-time. Instant arithmetic does not accept `:overflow` and cannot use calendar units requiring a calendar or zone.

```lisp
(subtract temporal duration [:overflow "constrain"|"reject"])
```

Returns the same type as `temporal`.

```lisp
(subtract temporal compatible-temporal [difference-options])
```

Returns a signed duration equal to left minus right. Both Temporal operands must have the same type.

Difference options:

```text
:largest-unit string
:smallest-unit string
:rounding-increment positive-integer
:rounding-mode string
```

### Comparison

```lisp
(compare value value [:relative-to temporal])
```

Returns `-1`, `0`, or `1`. Operands must have the same Temporal type. Duration comparison may need `:relative-to` when years, months, weeks, or days cannot be compared without context.

```lisp
(equals value value)
```

Returns a boolean. Operands must have the same Temporal type. Duration equality is structural, so `P1D` is not equal to `PT24H`.

### Rounding

```lisp
(round value :smallest-unit string [rounding-options])
```

Supports instants, zoned date-times, and durations.

```text
:smallest-unit string
:rounding-increment positive-integer
:rounding-mode string
:largest-unit string       duration only
:relative-to temporal      duration only
```

### Context and conversion

```lisp
(now)
```

Returns the current instant captured by the evaluation context. The request must provide `now`, or the MCP server must run in system-context mode. The system clock is sampled once per evaluation, so multiple `(now)` calls in one expression return the same instant.

```lisp
(default-time-zone)
```

Returns the context's default time-zone identifier. The request must provide `defaultTimeZone`, or the MCP server must run in system-context mode. A system default is the zone of the machine or container running timecalc, not necessarily the end user's zone.

```lisp
(with-time-zone instant-or-zoned-date-time "zone")
```

Returns a zoned date-time without changing the represented instant. The zone argument can be a nested expression such as `(default-time-zone)`.

```lisp
(to-instant zoned-date-time)
```

Returns an instant.

```lisp
(to-date zoned-date-time)
```

Returns the local plain date represented in that zoned date-time.

### Inspection

| Operators | Accepted values | Result |
|---|---|---|
| `year`, `month`, `day` | date, zoned date-time | number |
| `hour`, `minute`, `second` | zoned date-time | number |
| `day-of-week`, `day-of-year`, `week-of-year` | date, zoned date-time | number |
| `days-in-month`, `days-in-year`, `months-in-year` | date, zoned date-time | number |
| `offset`, `time-zone-id` | zoned date-time | string |
| `calendar-id` | date, zoned date-time | string |

Each inspection operator accepts exactly one argument.

## Choosing a value type

- Use a **date** for birthday, billing-date, end-of-month, and other date-only calculations. Do not invent midnight or a time zone.
- Use an **instant** for absolute timestamps, elapsed time, logs, and cross-system event ordering.
- Use a **zoned date-time** for human schedules where local time and daylight-saving transitions matter.
- Use a **duration** to describe the amount or signed difference.

Do not implicitly convert between types. Use `with-time-zone`, `to-instant`, and `to-date` explicitly.

## Common recipes

Current date in the evaluation context's zone:

```lisp
(to-date (with-time-zone (now) (default-time-zone)))
```

End of month:

```lisp
(add 2025-01-31 P1M)
; 2025-02-28
```

Elapsed hours between instants:

```lisp
(subtract
  2025-01-03T00:00:00Z
  2025-01-01T12:00:00Z
  :largest-unit "hours")
; PT36H
```

Calendar days across DST:

```lisp
(subtract
  2025-03-09T12:00:00-04:00[America/New_York]
  2025-03-08T12:00:00-05:00[America/New_York]
  :largest-unit "days")
; P1D
```

Inspect a calculated result:

```lisp
(days-in-month (add 2025-01-31 P1M))
; 28
```

Convert an instant for display:

```lisp
(with-time-zone 2025-06-01T12:00:00Z "Europe/London")
; 2025-06-01T13:00:00+01:00[Europe/London]
```

## Error repair

The tool returns `isError: true` and structured details for invalid expressions. Repair according to the error code:

| Code | Response |
|---|---|
| `LEX_ERROR` | Correct an unrecognized or non-canonical literal. |
| `PARSE_ERROR` | Fix parentheses, spacing, string quoting, or argument order. |
| `UNKNOWN_OPERATOR` | Select a supported operator; do not use `until` or `since`. |
| `ARITY_ERROR` | Correct the number of positional arguments. |
| `UNKNOWN_OPTION` | Remove the option or use it with the correct operand combination. |
| `DUPLICATE_OPTION` | Keep only one occurrence of the option. |
| `TYPE_MISMATCH` | Supply the required value type; do not quote Temporal literals. |
| `INVALID_TEMPORAL_VALUE` | Correct the date, offset, zone, duration, clock, or calendar value. |
| `INVALID_TEMPORAL_OPERATION` | Check Temporal unit restrictions. |
| `MISSING_CONTEXT` | Pass `now` or `defaultTimeZone`, or enable MCP system-context mode. Do not guess missing context. |
| `RESOURCE_LIMIT` | Simplify or shorten the expression. |
| `INTERNAL_ERROR` | Report that the tool failed; do not guess the answer. |

Use the returned line and column to locate the problem. Retry only after making a specific correction. If the required input is missing or semantically ambiguous, ask the user rather than guessing.
