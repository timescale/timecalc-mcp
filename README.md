# timecalc

`timecalc` gives AI agents and humans a small, reliable calculator for date, time-zone, and duration arithmetic. It runs as both a Model Context Protocol (MCP) server and a command-line tool, with both interfaces backed by the same Temporal evaluator.

## Why an MCP date calculator?

Date math is deceptively difficult. Month lengths vary, leap years matter, daylight-saving transitions make “one day” different from “24 hours,” and an answer involving “today” is meaningless without a clock and time zone. Language models should not have to approximate those rules or generate ad hoc date code.

The timecalc MCP server lets an agent translate a user's request into one constrained expression and delegate the calculation to Bun's implementation of JavaScript Temporal. The result is typed and machine-readable. Expressions are inspectable, and calculations can be replayed with the same explicit context. The evaluator never uses JavaScript `eval` and does not parse natural-language dates itself.

At a glance:

- **One MCP tool:** `evaluate_date_expression`
- **Four Temporal types:** `PlainDate`, `Instant`, `ZonedDateTime`, and `Duration`
- **Explicit semantics:** calendar dates, absolute instants, zoned times, and durations remain distinct
- **Current-time support:** deterministic context injection or an opt-in host clock and time zone
- **Same behavior everywhere:** MCP and CLI share the parser, evaluator, errors, and serialization
- **Portable releases:** standalone executables do not require Bun at runtime

## Guide to this README

- Start with [Quick start](#quick-start) to run the CLI or configure an MCP client.
- Read [Evaluation context and `now`](#evaluation-context-and-now) before handling “now,” “today,” or local-time questions.
- Use the [Language overview](#language-overview) and [Operator reference](#operator-reference) when writing expressions.
- See the [CLI](#cli) and [MCP server](#mcp-server) sections for complete interface details.
- Contributors can jump to [Architecture](#architecture) and [Development](#development).

## Quick start

### Install a release binary (recommended)

Download the archive for your platform from the [latest GitHub release](https://github.com/timescale/timecalc-mcp/releases/latest):

| Platform | Release asset |
|---|---|
| Linux AMD64 | `timecalc-v<version>-linux-amd64.tar.gz` |
| Linux ARM64 | `timecalc-v<version>-linux-arm64.tar.gz` |
| macOS ARM64 | `timecalc-v<version>-darwin-arm64.tar.gz` |
| Windows AMD64 | `timecalc-v<version>-windows-amd64.zip` |
| Windows ARM64 | `timecalc-v<version>-windows-arm64.zip` |

Each archive contains `timecalc` (or `timecalc.exe`), `LICENSE`, and `NOTICE`. The executable includes Bun and all runtime dependencies, so **Bun does not need to be installed**.

Download `SHA256SUMS` from the same release and verify the archive before extracting it. For example, on Linux:

```bash
ARCHIVE=timecalc-vX.Y.Z-linux-amd64.tar.gz  # replace X.Y.Z
grep -F "$ARCHIVE" SHA256SUMS | sha256sum -c -
```

On Linux or macOS, extract the archive and install the executable:

```bash
VERSION=X.Y.Z                 # replace with the release version
TARGET=linux-amd64            # or linux-arm64 / darwin-arm64
ARCHIVE="timecalc-v${VERSION}-${TARGET}.tar.gz"

mkdir -p "$HOME/.local/bin"
tar -xzf "$ARCHIVE"
install -m 0755 timecalc "$HOME/.local/bin/timecalc"
"$HOME/.local/bin/timecalc" --version
```

Add `$HOME/.local/bin` to `PATH` if it is not already present. On macOS, the binary is ad-hoc signed but not notarized; depending on Gatekeeper policy, its first launch may require explicit approval.

On Windows, verify the archive against `SHA256SUMS`, extract the `.zip`, and move `timecalc.exe` to a directory on `PATH`. Then confirm the executable from PowerShell:

```powershell
.\timecalc.exe --version
```

To develop timecalc or run it from source, see [Development](#development).

### As an MCP server

For an interactive agent, system-context mode is usually the most useful configuration because many agent harnesses do not expose their current clock or local time zone:

```json
{
  "mcpServers": {
    "timecalc": {
      "command": "timecalc",
      "args": ["mcp", "--system-context"]
    }
  }
}
```

This still permits a caller to override the clock and zone for reproducible calculations. Use `args: ["mcp"]` instead when all context must be supplied explicitly. See [MCP client configuration](#mcp-client-configuration) for source-checkout configuration.

Typical agent requests include:

- “What date is 30 days from today?”
- “How many calendar months are between these dates?”
- “Convert this timestamp to America/New_York.”
- “Will adding one day across this DST boundary preserve the local hour?”

A current-local-date calculation is explicit in the DSL:

```lisp
(to-date (with-time-zone (now) (default-time-zone)))
```

### As a CLI

```bash
# Deterministic date arithmetic; no clock or zone is needed
timecalc '(add 2025-01-31 P1M)'

# Use the host clock and time zone
timecalc --system-context \
  '(to-date (with-time-zone (now) (default-time-zone)))'
```

## Evaluation context and `now`

`now` is represented as a `Temporal.Instant`: one absolute point on the timeline. A time zone is a separate context value because the same instant can correspond to different local dates around the world.

There are two context modes:

- **Deterministic mode is the default.** The evaluator does not read the host clock or time zone. Expressions that do not depend on current context work without any extra input. `(now)` and `(default-time-zone)` return `MISSING_CONTEXT` unless their values are supplied explicitly.
- **System-context mode is opt-in.** `--system-context` fills missing values from `Temporal.Now.instant()` and `Temporal.Now.timeZoneId()`. Explicit `now` and time-zone inputs always take precedence. The system zone belongs to the process running timecalc; it may be UTC or otherwise differ from the end user's zone, especially in a container or on a remote host.

For a user-specific local-time question, pass that user's IANA zone explicitly instead of assuming the system zone.

The context is resolved once at the start of each evaluation. Therefore, every `(now)` within one expression returns the same instant. In system-context mode, a later tool call resolves a new instant. Successful structured results include the resolved context so an answer involving “now” or “today” is auditable.

Convert the instant before asking calendar questions:

```lisp
; Current instant
(now)

; Current zoned date-time
(with-time-zone (now) (default-time-zone))

; Current local date
(to-date (with-time-zone (now) (default-time-zone)))
```

The optional default calendar is validated and reported as context, but current operators do not use it for implicit conversion. Temporal values continue to carry their own calendars.

## Language overview

Expressions use S-expression syntax:

```lisp
(operator positional-argument ... :keyword-option value ...)
```

For example:

```lisp
(subtract
  2025-12-31
  2025-01-01
  :largest-unit "months")
```

There must be exactly one top-level expression. Positional arguments must come before keyword options. A semicolon begins a comment that continues through the end of the line:

```lisp
; Move to the next calendar day
(add
  2025-12-31
  P1D)
```

The canonical grammar is [`src/grammar.ebnf`](src/grammar.ebnf), written in ISO/IEC 14977 EBNF. Generated railroad diagrams are available as [HTML](docs/grammar.html) and [Markdown](docs/grammar.md).

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
| `subtract` | `(subtract temporal compatible-temporal [difference options])` | `Duration` |

`add` accepts a `PlainDate`, `Instant`, or `ZonedDateTime` followed by a `Duration`.

`subtract` is overloaded but always means **left minus right**:

- when the right operand is a `Duration`, it subtracts that amount and returns the same type as the left operand;
- when both operands have the same Temporal type, it returns the signed duration between them.

```lisp
(subtract 2025-03-03 P2D)
; 2025-03-01

(subtract 2025-03-03 2025-03-01)
; P2D

(subtract 2025-03-01 2025-03-03)
; -P2D
```

The `:overflow` option applies when adding or subtracting a duration from a date or zoned date-time, not instant arithmetic.

Subtracting two Temporal values supports these difference options:

```text
:largest-unit string
:smallest-unit string
:rounding-increment positive-integer
:rounding-mode string
```

Example:

```lisp
(subtract 2025-12-31 2025-01-01 :largest-unit "months")
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

### Context and conversion

| Operator | Signature | Result |
|---|---|---|
| `now` | `(now)` | Context's current `Instant` |
| `default-time-zone` | `(default-time-zone)` | Context's time-zone identifier |
| `with-time-zone` | `(with-time-zone instant-or-zoned-date-time "zone")` | `ZonedDateTime` |
| `to-instant` | `(to-instant zoned-date-time)` | `Instant` |
| `to-date` | `(to-date zoned-date-time)` | Local `PlainDate` |

`now` and `default-time-zone` read the resolved evaluation context described above. They return `MISSING_CONTEXT` when the corresponding value is unavailable.

```lisp
(with-time-zone 2025-06-01T12:00:00Z "America/New_York")
; 2025-06-01T08:00:00-04:00[America/New_York]

(to-instant 2025-06-01T08:00:00-04:00[America/New_York])
; 2025-06-01T12:00:00Z

(to-date (with-time-zone (now) (default-time-zone)))
; the current local date
```

In system-context mode, the host clock is sampled once before evaluation; `(now)` only reads that captured instant.

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
timecalc '(add 2025-01-31 P1M)'
timecalc eval '(add 2025-01-31 P1M)'
```

Expressions containing shell-significant characters or whitespace should be quoted. Use `--` before a top-level negative literal if required by your shell or invocation environment.

### Read from stdin

```bash
echo '(day-of-week 2025-06-01)' | timecalc --stdin
```

An expression argument and `--stdin` cannot be used together.

### Validate

`validate` performs parsing, type checking, and evaluation:

```console
$ timecalc validate '(add 2025-01-31 P1M)'
valid
```

### JSON output

```bash
timecalc --json --pretty \
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
--system-context        Use the host clock and time zone as defaults
-o, --output <file>     Set grammar diagram output for `grammar`
-h, --help              Show help
-V, --version           Show version
```

`(now)` reads `--now`, and `(default-time-zone)` reads `--time-zone`. With `--system-context`, missing values come from `Temporal.Now.instant()` and `Temporal.Now.timeZoneId()`; explicit options take precedence. See [Evaluation context and `now`](#evaluation-context-and-now) for the complete resolution rules. Resolved context is included in successful JSON output.

CLI exit codes:

| Code | Meaning |
|---:|---|
| `0` | Success |
| `1` | Invalid expression, type, Temporal operation, or value |
| `2` | Invalid CLI usage or internal failure |

The `grammar` command is a source-development utility because it depends on the project's diagram generator. Release-binary users can read the committed [HTML](docs/grammar.html) and [Markdown](docs/grammar.md) diagrams directly.

## MCP server

The MCP server is built into the standalone executable and communicates over stdio. Start it in deterministic mode with:

```bash
timecalc mcp
```

Or enable host clock and time-zone defaults for interactive use:

```bash
timecalc mcp --system-context
```

The server is stateless and exposes exactly one tool:

```text
evaluate_date_expression
```

The tool is annotated as read-only, non-destructive, and closed-world. It is idempotent in deterministic mode and marked non-idempotent when the server enables system context.

### Tool input

A context-free request only needs an expression:

```json
{
  "expression": "(add 2025-01-31 P1M)"
}
```

A deterministic current-local-date request supplies its clock and zone explicitly:

```json
{
  "expression": "(to-date (with-time-zone (now) (default-time-zone)))",
  "now": "2025-01-01T04:30:00Z",
  "defaultTimeZone": "America/New_York"
}
```

| Field | Required | Description |
|---|---:|---|
| `expression` | yes | One DSL expression, at most 64 KiB |
| `now` | no | Explicit Temporal instant for clock-dependent operations |
| `defaultTimeZone` | no | IANA or fixed-offset time-zone identifier |
| `defaultCalendar` | no | Temporal calendar identifier; validated and reported, but not implicitly applied by current operators |

Unknown input properties are rejected. Optional context fields are validated and passed to the shared evaluator. `(now)` and `(default-time-zone)` read the corresponding values. In system-context mode, explicit request fields override host defaults.

### Successful result

MCP responses include concise text for display and structured content for programmatic use. When context is resolved, `structuredContent` records the exact values used:

```json
{
  "content": [
    { "type": "text", "text": "2024-12-31" }
  ],
  "structuredContent": {
    "ok": true,
    "type": "date",
    "value": "2024-12-31",
    "calendar": "iso8601",
    "context": {
      "now": "2025-01-01T04:30:00Z",
      "defaultTimeZone": "America/New_York"
    }
  }
}
```

For context-free expressions, the result remains concise:

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
MISSING_CONTEXT
RESOURCE_LIMIT
INTERNAL_ERROR
```

Stack traces, host paths, and environment details are not returned. In stdio mode, stdout is reserved exclusively for MCP protocol messages; diagnostics go to stderr.

### Agent Skill

A portable [Agent Skill](https://agentskills.io) for teaching compatible agents when and how to use the MCP server is included at [`.agents/skills/timecalc/SKILL.md`](.agents/skills/timecalc/SKILL.md).

Clients that discover project skills from `.agents/skills/` can use it directly. For other clients, copy the `.agents/skills/timecalc/` directory into that client's skill directory. The skill assumes the timecalc MCP server is already configured and exposes `evaluate_date_expression`.

### MCP client configuration

Use the installed release binary for normal MCP operation. For interactive agents that cannot discover the current time or host zone, enable system context:

```json
{
  "mcpServers": {
    "timecalc": {
      "command": "timecalc",
      "args": ["mcp", "--system-context"]
    }
  }
}
```

System-context mode resolves missing request context from the host for each tool call. The runtime and host environment, including `TZ` where supported, determine the default time zone. This is the time zone of the machine or container running timecalc, not necessarily the end user's time zone.

For deterministic operation, omit `--system-context`. Context-free calculations still work normally; expressions using `(now)` or `(default-time-zone)` then require explicit tool inputs:

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

Contributors running directly from a source checkout can configure an absolute source path instead:

```json
{
  "mcpServers": {
    "timecalc": {
      "command": "bun",
      "args": [
        "run",
        "/absolute/path/to/timecalc/src/cli.ts",
        "mcp",
        "--system-context"
      ]
    }
  }
}
```

Launch MCP Inspector from a source checkout with:

```bash
bun run mcp:inspect
```

Pinned protocol dependencies:

- `@modelcontextprotocol/sdk` 1.30.0
- Zod 4.5.4

Only stdio transport is implemented. HTTP transport is intentionally deferred until authentication, origin, session, and rate-limiting requirements are defined.

## Determinism and safety

- Deterministic mode never uses the host clock or local time zone implicitly.
- System-context mode is explicit, samples the clock once per evaluation, reports resolved context in successful structured output, and marks the MCP tool non-idempotent.
- Explicit request context overrides system defaults.
- Tests use injected fixed clocks and explicit zones for system-context behavior.
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
- implicit conversion between Temporal types (explicit `with-time-zone`, `to-instant`, and `to-date` conversions are available);
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

Lint and regenerate both the HTML and Markdown grammar diagrams:

```bash
bun run grammar:lint
bun run grammar:diagram
```

Generate only one format when needed:

```bash
bun run grammar:diagram:html
bun run grammar:diagram:markdown
```

### Standalone executables

Build all release executables with Bun:

```bash
bun run build:executables -- --version 1.2.3
```

Outputs are written to `dist/`:

| Target | Output |
|---|---|
| Linux AMD64 | `timecalc-v1.2.3-linux-amd64` |
| Linux ARM64 | `timecalc-v1.2.3-linux-arm64` |
| macOS ARM64 | `timecalc-v1.2.3-darwin-arm64` |
| Windows AMD64 | `timecalc-v1.2.3-windows-amd64.exe` |
| Windows ARM64 | `timecalc-v1.2.3-windows-arm64.exe` |

The executables contain the Bun runtime and all runtime dependencies; users do not need to install Bun. The supplied version is embedded in CLI and MCP server metadata.

Build a subset by repeating `--target`:

```bash
bun run build:executables -- \
  --version 1.2.3 \
  --target linux-amd64 \
  --target darwin-arm64
```

Use `--outdir PATH` to change the output directory. Run `bun run build:executables -- --help` for the complete interface.

### Automation

The GitHub Actions workflow in [`.github/workflows/ci.yml`](.github/workflows/ci.yml) runs on pushes to `main`, pull requests, and manual dispatches. It installs the locked dependencies with Bun 1.4.0, type-checks the project, lints the grammar, runs the Bun and YAML test suites, and verifies a production bundle.

The release workflow in [`.github/workflows/release.yml`](.github/workflows/release.yml) runs when `main` is tagged with an exact `vX.Y.Z` tag, for example:

```bash
git tag v1.2.3
git push origin v1.2.3
```

It reruns all checks, builds the five supported executables, packages each with `LICENSE` and `NOTICE`, generates `SHA256SUMS`, and publishes a GitHub Release with generated release notes. Unix assets use `.tar.gz`; Windows assets use `.zip`. macOS AMD64 is intentionally not built.

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
