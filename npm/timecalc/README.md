# @tigerdata/timecalc

Deterministic date, calendar, time-zone, instant, and duration calculations as a CLI and an
[MCP](https://modelcontextprotocol.io) server. The package installs a standalone executable built with
Bun; no Bun or Node.js runtime is needed at execution time beyond the `npx` launcher.

Full documentation: <https://github.com/timescale/timecalc-mcp>

## MCP server

Add to any MCP client that supports stdio servers:

```json
{
  "mcpServers": {
    "timecalc": {
      "command": "npx",
      "args": ["-y", "@tigerdata/timecalc", "mcp", "--system-context"]
    }
  }
}
```

`--system-context` lets the server resolve `(now)` and the default time zone from the host. Omit it for
fully deterministic operation, in which case expressions that need the current instant or a default zone
must receive that context in the tool call.

## CLI

```bash
npx -y @tigerdata/timecalc '(add 2025-01-31 P1M)'
npx -y @tigerdata/timecalc --help
```

## How it works

`@tigerdata/timecalc` is a small launcher. The executable lives in a platform-specific package selected
through `optionalDependencies`:

| Platform | Package |
| --- | --- |
| Linux x64 | `@tigerdata/timecalc-linux-amd64` |
| Linux arm64 | `@tigerdata/timecalc-linux-arm64` |
| macOS Intel | `@tigerdata/timecalc-darwin-amd64` |
| macOS Apple Silicon | `@tigerdata/timecalc-darwin-arm64` |
| Windows x64 | `@tigerdata/timecalc-windows-amd64` |
| Windows arm64 | `@tigerdata/timecalc-windows-arm64` |

npm installs only the package matching the current machine. Each executable embeds the Bun runtime and
is 60-90 MB on disk, so the first `npx` run downloads a few tens of megabytes.

If you prefer not to use npm, the same executables are attached to each
[GitHub release](https://github.com/timescale/timecalc-mcp/releases) with an installer script.

## License

Apache-2.0. See `LICENSE` and `NOTICE`.
