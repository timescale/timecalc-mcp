# timecalc

`timecalc` is a deterministic date-math evaluator for the command line and the Model Context Protocol (MCP). It uses a small S-expression DSL and Bun's built-in implementation of JavaScript Temporal.

```console
$ bun run timecalc '(add 2025-01-31 P1M)'
2025-02-28
```

The DSL preserves the semantic differences between calendar dates, absolute instants, zoned date-times, and durations. It does not evaluate JavaScript or parse natural-language dates.

## Requirements

- Bun 1.4.x

`timecalc` uses the global `Temporal` implementation included with Bun 1.4; no Temporal polyfill is required.

## Installation

From a source checkout:

```bash
bun install --frozen-lockfile
```

Run the CLI through the package script:

```bash
bun run timecalc --help
```

The package also declares a `timecalc` executable for use when installed or linked as a package.

## Language overview

Expressions use S-expression syntax:

```lisp
(operator positional-argument ... :keyword-option value ...)
```

For example:

```lisp
(until
  2025-01-01
  2025-12-31
  :largest-unit "months")
```

There must be exactly one top-level expression. Positional arguments must come before keyword options. A semicolon begins a comment that continues through the end of the line:

```lisp
; Move to the next calendar day
(add
  2025-12-31
  P1D)
```

The canonical grammar is [`src/grammar.ebnf`](src/grammar.ebnf), written in ISO/IEC 14977 EBNF. Generated railroad diagrams are available in [`docs/grammar.html`](docs/grammar.html).

### Temporal literals

Temporal values are unquoted and self-describing. Constructors and type qualifiers are not used.

| DSL literal | Temporal type | Meaning |
|---|---|---|
| `2025-01-31` | `Temporal.PlainDate` | Calendar date without a time or zone |
| `2025-06-01T12:00:00Z` | `Temporal.Instant` | Absolute point on the timeline |
| `2025-06-01T08:00:00-04:00[America/New_York]` | `Temporal.ZonedDateTime` | Local time, offset, and time-zone identifier |
| `P1M`, `PT24H`, `-P2D` | `Temporal.Duration` | Calendar and/or elapsed-time amount |

The lexer determines a Temporal type from the literal's structure, and the corresponding Temporal `from()` method validates its value. Classification never depends on the operator receiving the value.

Canonical v1 literal profiles use:

- four-digit years and two-digit month/day fields;
- uppercase `T` and `Z`;
- an explicit `Z` or numeric offset for instants;
- both an offset and bracketed identifier for zoned date-times;
- uppercase ISO 8601 duration components.

Quoted lookalikes remain strings:

```lisp
P1M       ; Temporal.Duration
"P1M"     ; string
```

The language also has string, finite number, and boolean scalar values for options and operator results.

### Calendar time versus elapsed time

Temporal distinguishes calendar units from fixed elapsed-time units. Across a daylight-saving transition, one calendar day may not contain 24 hours:

```lisp
(add 2025-03-08T12:00:00-05:00[America/New_York] P1D)
; 2025-03-09T12:00:00-04:00[America/New_York]

(add 2025-03-08T12:00:00-05:00[America/New_York] PT24H)
; 2025-03-09T13:00:00-04:00[America/New_York]
```

Use `P1D` for “the same local time tomorrow” and `PT24H` for exactly 24 elapsed hours.

## Operator reference

The machine-readable source of truth is [`src/operators/catalog.ts`](src/operators/catalog.ts).

### Arithmetic and differences

| Operator | Signature | Result |
|---|---|---|
| `add` | `(add temporal duration [:overflow "constrain"\|"reject"])` | Same type as the first argument |
| `subtract` | `(subtract temporal duration [:overflow "constrain"\|"reject"])` | Same type as the first argument |
| `until` | `(until temporal temporal [difference options])` | `Duration` |
| `since` | `(since temporal temporal [difference options])` | `Duration` |

`add` and `subtract` accept a `PlainDate`, `Instant`, or `ZonedDateTime` followed by a `Duration`. The `:overflow` option applies to date and zoned date-time arithmetic, not instant arithmetic.

`until` and `since` require operands of the same Temporal type. Supported difference options are:

```text
:largest-unit string
:smallest-unit string
:rounding-increment positive-integer
:rounding-mode string
```

Example:

```lisp
(until 2025-01-01 2025-12-31 :largest-unit "months")
; P11M30D
```

### Comparison

| Operator | Signature | Result |
|---|---|---|
| `compare` | `(compare value value [:relative-to temporal])` | `-1`, `0`, or `1` |
| `equals` | `(equals value value)` | Boolean |

Operands must have the same Temporal type. Duration comparison may require `:relative-to` when calendar units are involved:

```lisp
(compare
  P1D
  PT24H
  :relative-to 2025-03-08T12:00:00-05:00[America/New_York])
; -1
```

Duration equality is structural: `P1D` and `PT24H` are not equal even when they happen to span the same elapsed time in a particular context.

### Rounding

```lisp
(round 2025-01-01T12:34:56Z :smallest-unit "minute")
; 2025-01-01T12:35:00Z
```

`round` supports `Instant`, `ZonedDateTime`, and `Duration`. Options are:

```text
:smallest-unit string
:rounding-increment positive-integer
:rounding-mode string
:largest-unit string          ; Duration only
:relative-to temporal         ; Duration only
```

Temporal requires the appropriate unit option for the value being rounded.

### Conversion

| Operator | Signature | Result |
|---|---|---|
| `with-time-zone` | `(with-time-zone instant-or-zoned-date-time "zone")` | `ZonedDateTime` |
| `to-instant` | `(to-instant zoned-date-time)` | `Instant` |

```lisp
(with-time-zone 2025-06-01T12:00:00Z "America/New_York")
; 2025-06-01T08:00:00-04:00[America/New_York]

(to-instant 2025-06-01T08:00:00-04:00[America/New_York])
; 2025-06-01T12:00:00Z
```

### Inspection

| Operator | Accepted type |
|---|---|
| `year`, `month`, `day` | `PlainDate`, `ZonedDateTime` |
| `hour`, `minute`, `second` | `ZonedDateTime` |
| `day-of-week`, `day-of-year`, `week-of-year` | `PlainDate`, `ZonedDateTime` |
| `days-in-month`, `days-in-year`, `months-in-year` | `PlainDate`, `ZonedDateTime` |
| `offset`, `time-zone-id` | `ZonedDateTime` |
| `calendar-id` | `PlainDate`, `ZonedDateTime` |

Inspection operators take one argument and return a number or string:

```lisp
(day-of-week 2025-06-01)
; 7

(offset 2025-06-01T08:00:00-04:00[America/New_York])
; -04:00
```

## CLI

### Evaluate

`eval` is optional:

```bash
bun run timecalc '(add 2025-01-31 P1M)'
bun run timecalc eval '(add 2025-01-31 P1M)'
```

Expressions containing shell-significant characters or whitespace should be quoted. Use `--` before a top-level negative literal if required by your shell or invocation environment.

### Read from stdin

```bash
echo '(day-of-week 2025-06-01)' | bun run timecalc --stdin
```

An expression argument and `--stdin` cannot be used together.

### Validate

`validate` performs parsing, type checking, and evaluation:

```console
$ bun run timecalc validate '(add 2025-01-31 P1M)'
valid
```

### JSON output

```bash
bun run timecalc --json --pretty \
  '(add 2025-03-08T12:00:00-05:00[America/New_York] P1D)'
```

```json
{
  "ok": true,
  "type": "zoned-date-time",
  "value": "2025-03-09T12:00:00-04:00[America/New_York]",
  "calendar": "iso8601",
  "timeZone": "America/New_York",
  "offset": "-04:00"
}
```

Errors are structured when `--json` is used:

```json
{
  "ok": false,
  "error": {
    "code": "TYPE_MISMATCH",
    "message": "add expected duration as argument 2, received date",
    "span": { "start": 0, "end": 27 },
    "line": 1,
    "column": 1
  }
}
```

### CLI options

```text
--stdin                 Read the expression from standard input
--json                  Emit structured JSON
--pretty                Pretty-print JSON; requires --json
--now <instant>         Inject an explicit evaluation clock
--time-zone <zone>      Set an explicit default time zone
--calendar <calendar>   Set an explicit default calendar
-o, --output <file>     Set grammar diagram output for `grammar`
-h, --help              Show help
-V, --version           Show version
```

The context options are validated, but the current core operators do not use an implicit clock, time zone, or calendar.

CLI exit codes:

| Code | Meaning |
|---:|---|
| `0` | Success |
| `1` | Invalid expression, type, Temporal operation, or value |
| `2` | Invalid CLI usage or internal failure |

### Grammar diagrams

```bash
bun run timecalc grammar --output docs/grammar.html
```

## MCP server

The MCP server uses the official TypeScript SDK and communicates over stdio. Start it with either command:

```bash
bun run mcp
bun run timecalc mcp
```

The server is stateless and exposes exactly one tool:

```text
evaluate_date_expression
```

The tool is annotated as read-only, non-destructive, idempotent, and closed-world.

### Tool input

```json
{
  "expression": "(add 2025-01-31 P1M)",
  "now": "2025-01-01T00:00:00Z",
  "defaultTimeZone": "UTC",
  "defaultCalendar": "iso8601"
}
```

| Field | Required | Description |
|---|---:|---|
| `expression` | yes | One DSL expression, at most 64 KiB |
| `now` | no | Explicit Temporal instant for clock-dependent operations |
| `defaultTimeZone` | no | IANA or fixed-offset time-zone identifier |
| `defaultCalendar` | no | Temporal calendar identifier |

Unknown input properties are rejected. Optional context fields are validated and passed to the shared evaluator. Current core expressions do not consult host defaults.

### Successful result

MCP responses include concise text for display and structured content for programmatic use:

```json
{
  "content": [
    { "type": "text", "text": "2025-02-28" }
  ],
  "structuredContent": {
    "ok": true,
    "type": "date",
    "value": "2025-02-28",
    "calendar": "iso8601"
  }
}
```

### Error result

Expression errors are tool errors rather than server crashes:

```json
{
  "isError": true,
  "content": [
    {
      "type": "text",
      "text": "TYPE_MISMATCH at 1:1: add expected duration as argument 2, received date"
    }
  ],
  "structuredContent": {
    "ok": false,
    "error": {
      "code": "TYPE_MISMATCH",
      "message": "add expected duration as argument 2, received date",
      "span": { "start": 0, "end": 27 },
      "line": 1,
      "column": 1
    }
  }
}
```

Possible error codes are:

```text
LEX_ERROR
PARSE_ERROR
UNKNOWN_OPERATOR
ARITY_ERROR
UNKNOWN_OPTION
DUPLICATE_OPTION
TYPE_MISMATCH
INVALID_TEMPORAL_VALUE
INVALID_TEMPORAL_OPERATION
RESOURCE_LIMIT
INTERNAL_ERROR
```

Stack traces, host paths, and environment details are not returned. In stdio mode, stdout is reserved exclusively for MCP protocol messages; diagnostics go to stderr.

### MCP client configuration

During development, use an absolute source path:

```json
{
  "mcpServers": {
    "timecalc": {
      "command": "bun",
      "args": [
        "run",
        "/absolute/path/to/timecalc/src/cli.ts",
        "mcp"
      ]
    }
  }
}
```

When the `timecalc` executable is installed:

```json
{
  "mcpServers": {
    "timecalc": {
      "command": "timecalc",
      "args": ["mcp"]
    }
  }
}
```

Launch MCP Inspector with:

```bash
bun run mcp:inspect
```

Pinned protocol dependencies:

- `@modelcontextprotocol/sdk` 1.30.0
- Zod 4.5.4

Only stdio transport is implemented. HTTP transport is intentionally deferred until authentication, origin, session, and rate-limiting requirements are defined.

## Determinism and safety

- Core evaluation never uses the host's local time zone implicitly.
- Tests use fixed values and explicit zones.
- Source is parsed into an AST and never passed to JavaScript `eval`.
- The DSL has no filesystem, network, process, environment, import, variable, macro, or user-function primitives.
- MCP evaluation is stateless.
- Temporal exceptions are converted to stable public errors.

Resource limits for untrusted input:

| Resource | Limit |
|---|---:|
| Source length | 64 KiB |
| Expression nesting | 100 levels |
| AST nodes | 10,000 |
| String literal length | 32 KiB |
| Top-level expressions | 1 |

## Current scope and limitations

The initial language supports `Temporal.PlainDate`, `Temporal.Instant`, `Temporal.ZonedDateTime`, and `Temporal.Duration`.

It does not currently support:

- `Temporal.PlainTime` or `Temporal.PlainDateTime`;
- natural-language dates such as “next Tuesday”;
- locale-specific input formats;
- business calendars, holidays, or business-day arithmetic;
- recurrence rules or schedule generation;
- variables, user-defined functions, or macros;
- implicit conversion between Temporal types;
- remote MCP transports.

## Architecture

The CLI and MCP server share the complete evaluation pipeline:

```text
CLI ─┐
     ├── service → parser → typed AST → evaluator → serializer
MCP ─┘
```

Important files:

| Path | Purpose |
|---|---|
| [`src/grammar.ebnf`](src/grammar.ebnf) | Canonical ISO/IEC 14977 grammar |
| [`src/parser.ts`](src/parser.ts) | Hand-written parser and resource limits |
| [`src/evaluator.ts`](src/evaluator.ts) | Strictly typed Temporal operator evaluation |
| [`src/operators/catalog.ts`](src/operators/catalog.ts) | Operator names, signatures, and descriptions |
| [`src/service.ts`](src/service.ts) | Shared CLI/MCP evaluation boundary |
| [`src/cli.ts`](src/cli.ts) | CLI entry point |
| [`src/mcp.ts`](src/mcp.ts) | MCP server, schemas, and stdio transport |
| [`test/cases.yaml`](test/cases.yaml) | Data-driven DSL conformance cases |

## Development

Install exactly the locked dependencies:

```bash
bun install --frozen-lockfile
```

Run the complete test suite:

```bash
bun test
```

Run the YAML conformance suite with per-case output:

```bash
bun run test:cases
```

Run strict TypeScript checking:

```bash
bun run typecheck
```

Lint and regenerate the grammar diagrams:

```bash
bun run grammar:lint
bun run grammar:diagram
```

Build a standalone Bun-targeted bundle:

```bash
bun build src/cli.ts --target=bun --outfile=dist/timecalc.js
```

The automated suite covers:

- literal classification and parser errors;
- calendar, leap-year, and DST semantics;
- every v1 operator;
- CLI text, JSON, stdin, validation, and exit behavior;
- shared-service context validation and resource limits;
- direct MCP handler behavior;
- MCP tool discovery and calls over an in-memory transport;
- a real spawned stdio MCP process;
- parity between MCP output and all YAML fixtures.

## License

Copyright 2026 Timescale, Inc., d/b/a Tiger Data.

Licensed under the [Apache License, Version 2.0](LICENSE). See [NOTICE](NOTICE) for attribution information.
