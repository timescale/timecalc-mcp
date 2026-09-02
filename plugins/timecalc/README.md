# timecalc Claude Code plugin

Installs the timecalc MCP server and its Agent Skill together.

```text
/plugin marketplace add timescale/timecalc-mcp
/plugin install timecalc@timecalc
```

The MCP server runs as `npx -y @tigerdata/timecalc mcp --system-context`, so Node.js and npm must be
available on `PATH`. The first session downloads the platform executable (a few tens of megabytes);
later sessions start from the npm cache.

If you already added a `timecalc` MCP server to Claude Code manually, remove it before installing the
plugin, otherwise two servers with the same tool will be registered.

The skill in `skills/timecalc/` is a copy of the canonical skill at `.agents/skills/timecalc/` in the
repository root. Do not edit it here; edit the canonical copy and run `./bun run plugin:sync`.

Full documentation: <https://github.com/timescale/timecalc-mcp>
