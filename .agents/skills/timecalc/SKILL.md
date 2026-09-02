---
name: timecalc
description: Use the timecalc MCP server for deterministic date, calendar, time-zone, instant, and duration calculations. Activate when a user asks to add or subtract dates or durations, calculate elapsed or calendar time, compare dates or instants, convert time zones, inspect date fields, handle leap years or daylight-saving transitions, or verify date math. Prefer this skill over mental or manual date arithmetic.
license: Apache-2.0
compatibility: Requires a configured timecalc MCP server exposing evaluate_date_expression.
metadata:
  author: "Timescale, Inc., d/b/a Tiger Data"
  version: "1.0"
---

# Use timecalc for date math

Use the timecalc MCP tool `evaluate_date_expression` whenever a task requires date, duration, instant, calendar, or time-zone arithmetic. Do not calculate the result mentally and do not generate JavaScript as a substitute.

## Procedure

1. Identify the semantics of every input:
   - Use a date literal for a calendar date with no time or zone.
   - Use an instant when the input is an absolute timestamp with `Z` or a numeric offset.
   - Use a zoned date-time when local wall-clock and named-zone behavior matters.
   - Use an ISO 8601 duration for the amount being added, subtracted, compared, or rounded.
2. Resolve ambiguous inputs before calling the tool:
   - Ask for a time zone when the answer depends on one and no default is available.
   - Do not invent an offset for a named time zone.
   - Use `(now)` for the context's current instant and `(default-time-zone)` for its zone. In system-context mode the MCP server supplies both; otherwise pass explicit `now` and `defaultTimeZone` inputs.
3. Build one valid timecalc expression.
4. Call `evaluate_date_expression` with the expression.
5. Use the returned value as authoritative. Briefly explain calendar-versus-elapsed-time behavior when it materially affects the answer.
6. If the tool returns an error, correct the expression from its code, message, and source location, then retry. Do not silently fall back to manual date arithmetic.

## MCP call

Send one expression:

```json
{
  "expression": "(add 2025-01-31 P1M)"
}
```

Optional deterministic context fields are:

```json
{
  "expression": "(add 2025-01-31 P1M)",
  "now": "2025-01-01T00:00:00Z",
  "defaultTimeZone": "UTC",
  "defaultCalendar": "iso8601"
}
```

`(now)` and `(default-time-zone)` consult these values. Explicit fields override defaults supplied by system-context mode.

## Literal forms

Temporal literals are unquoted and self-describing:

```text
2025-01-31                                      date
2025-06-01T12:00:00Z                           instant
2025-06-01T08:00:00-04:00[America/New_York]    zoned date-time
P1M                                             duration
PT24H                                           duration
-P2D                                            negative duration
```

Quoted values are strings. For example, `P1M` is a duration but `"P1M"` is a string.

A zoned date-time must include both an offset and a bracketed zone identifier. Do not provide only a local date-time and zone name.

## Core patterns

### Add a duration

```lisp
(add 2025-01-31 P1M)
```

### Subtract an amount

```lisp
(subtract 2025-03-03 P2D)
```

### Calculate a signed difference

`subtract` always means left minus right. Subtracting two compatible Temporal values returns a duration:

```lisp
(subtract 2025-03-03 2025-03-01)
; P2D

(subtract 2025-03-01 2025-03-03)
; -P2D
```

Use unit options when the representation matters:

```lisp
(subtract 2025-12-31 2025-01-01 :largest-unit "months")
; P11M30D
```

Do not use `until` or `since`; they are not DSL operators.

### Use the current local date

```lisp
(to-date (with-time-zone (now) (default-time-zone)))
```

If this returns `MISSING_CONTEXT`, pass explicit `now` and `defaultTimeZone` tool inputs or tell the user that the MCP server must be started with `timecalc mcp --system-context`. Never guess the current time or zone.

### Convert a time zone

```lisp
(with-time-zone 2025-06-01T12:00:00Z "America/New_York")
```

### Nest calculations

Arguments can be expressions:

```lisp
(day-of-week (add 2025-01-31 P1M))

(add 2025-01-01 (subtract 2025-01-03 2025-01-01))
```

## Calendar versus elapsed time

For a zoned date-time, `P1D` is one calendar day while `PT24H` is exactly 24 elapsed hours. They can produce different local times across daylight-saving transitions:

```lisp
(add 2025-03-08T12:00:00-05:00[America/New_York] P1D)
; 2025-03-09T12:00:00-04:00[America/New_York]

(add 2025-03-08T12:00:00-05:00[America/New_York] PT24H)
; 2025-03-09T13:00:00-04:00[America/New_York]
```

Choose the duration that matches the user's intent. If intent is unclear, ask whether they mean a calendar day or 24 hours.

## Using results

Successful tool results include text and typed structured content. Prefer `structuredContent` when another calculation or typed response follows:

```json
{
  "ok": true,
  "type": "date",
  "value": "2025-02-28",
  "calendar": "iso8601"
}
```

Preserve zone, offset, calendar, and evaluation-context metadata when relevant. In particular, use the returned `context.now` and `context.defaultTimeZone` to state what “now” or “today” meant. Do not strip a named zone from a zoned result or present an instant as local time without an explicit conversion.

For detailed operator signatures, options, and error handling, read [references/dsl-reference.md](references/dsl-reference.md).
