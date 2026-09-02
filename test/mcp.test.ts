import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  createTimecalcMcpServer,
  EVALUATE_TOOL_NAME,
  handleEvaluateDateExpression,
} from "../src/mcp";
import { loadYamlTestCases } from "../scripts/yaml-cases";

const yamlCases = await loadYamlTestCases(`${import.meta.dir}/cases.yaml`);

function textOf(result: unknown): string | undefined {
  if (typeof result !== "object" || result === null || !("content" in result)) return undefined;
  const content = (result as { content?: unknown[] }).content?.[0];
  if (typeof content !== "object" || content === null) return undefined;
  if (!("type" in content) || content.type !== "text" || !("text" in content)) return undefined;
  return typeof content.text === "string" ? content.text : undefined;
}

describe("MCP handler", () => {
  test("returns text and structured success output", () => {
    expect(handleEvaluateDateExpression({ expression: "(add 2025-01-31 P1M)" })).toEqual({
      content: [{ type: "text", text: "2025-02-28" }],
      structuredContent: {
        ok: true,
        type: "date",
        value: "2025-02-28",
        calendar: "iso8601",
      },
    });
  });

  test("evaluates context-backed operators with explicit request context", () => {
    expect(handleEvaluateDateExpression({
      expression: "(to-date (with-time-zone (now) (default-time-zone)))",
      now: "2025-01-01T04:30:00Z",
      defaultTimeZone: "America/New_York",
    })).toMatchObject({
      content: [{ type: "text", text: "2024-12-31" }],
      structuredContent: {
        ok: true,
        type: "date",
        value: "2024-12-31",
        context: {
          now: "2025-01-01T04:30:00Z",
          defaultTimeZone: "America/New_York",
        },
      },
    });
  });

  test("returns repairable errors without stack traces", () => {
    const result = handleEvaluateDateExpression({
      expression: "(add 2025-01-31 2025-02-01)",
    });
    expect(result).toMatchObject({
      isError: true,
      structuredContent: {
        ok: false,
        error: { code: "TYPE_MISMATCH", line: 1, column: 1 },
      },
    });
    expect(JSON.stringify(result)).not.toContain("stack");
  });

  for (const fixture of yamlCases) {
    test(`YAML parity: ${fixture.description}`, () => {
      const result = handleEvaluateDateExpression({
        expression: fixture.expression,
        ...(fixture.now !== undefined ? { now: fixture.now } : {}),
        ...(fixture.defaultTimeZone !== undefined ? { defaultTimeZone: fixture.defaultTimeZone } : {}),
        ...(fixture.defaultCalendar !== undefined ? { defaultCalendar: fixture.defaultCalendar } : {}),
      });
      if (fixture.error !== undefined) {
        expect(result.isError).toBe(true);
        const structured = result.structuredContent as { error?: { code?: string } };
        expect(structured.error?.code).toBe(fixture.error);
      } else {
        expect(result.isError).not.toBe(true);
        expect(textOf(result)).toBe(fixture.expected);
      }
    });
  }
});

describe("MCP protocol", () => {
  let server: McpServer;
  let client: Client;

  beforeAll(async () => {
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    server = createTimecalcMcpServer();
    client = new Client({ name: "timecalc-test", version: "1.0.0" });
    await server.connect(serverTransport);
    await client.connect(clientTransport);
  });

  afterAll(async () => {
    await client.close();
    await server.close();
  });

  test("advertises exactly one read-only tool", async () => {
    const result = await client.listTools();
    expect(result.tools).toHaveLength(1);
    expect(result.tools[0]).toMatchObject({
      name: EVALUATE_TOOL_NAME,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    });
    expect(result.tools[0].inputSchema.additionalProperties).toBe(false);
    expect(result.tools[0].outputSchema?.type).toBe("object");
  });

  test("marks system-context servers as non-idempotent", async () => {
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const systemServer = createTimecalcMcpServer({
      systemContext: true,
      systemContextProvider: {
        instant: () => "2025-01-01T04:30:00Z",
        timeZoneId: () => "America/New_York",
      },
    });
    const systemClient = new Client({ name: "timecalc-system-test", version: "1.0.0" });

    try {
      await systemServer.connect(serverTransport);
      await systemClient.connect(clientTransport);
      const tools = await systemClient.listTools();
      expect(tools.tools[0].annotations?.idempotentHint).toBe(false);
      const result = await systemClient.callTool({
        name: EVALUATE_TOOL_NAME,
        arguments: { expression: "(to-date (with-time-zone (now) (default-time-zone)))" },
      });
      expect(textOf(result)).toBe("2024-12-31");
      expect(result.structuredContent).toMatchObject({
        context: {
          now: "2025-01-01T04:30:00Z",
          defaultTimeZone: "America/New_York",
          defaultCalendar: "iso8601",
        },
      });
    } finally {
      await systemClient.close();
      await systemServer.close();
    }
  });

  test("calls the tool through MCP", async () => {
    const result = await client.callTool({
      name: EVALUATE_TOOL_NAME,
      arguments: { expression: "(day-of-week 2025-06-01)" },
    });
    expect(textOf(result)).toBe("7");
    expect(result.structuredContent).toEqual({ ok: true, type: "number", value: 7 });
  });

  test("returns structured tool errors", async () => {
    const typeError = await client.callTool({
      name: EVALUATE_TOOL_NAME,
      arguments: { expression: "(add 2025-01-31 2025-02-01)" },
    });
    expect(typeError.isError).toBe(true);
    expect(typeError.structuredContent).toMatchObject({
      ok: false,
      error: { code: "TYPE_MISMATCH" },
    });

    const contextError = await client.callTool({
      name: EVALUATE_TOOL_NAME,
      arguments: { expression: "(now)" },
    });
    expect(contextError.isError).toBe(true);
    expect(contextError.structuredContent).toMatchObject({
      ok: false,
      error: { code: "MISSING_CONTEXT" },
    });
  });

  test("rejects unknown input properties", async () => {
    const result = await client.callTool({
      name: EVALUATE_TOOL_NAME,
      arguments: { expression: "2025-01-01", unexpected: true },
    });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toMatch(/Input validation error.*Unrecognized key/);
  });
});

describe("MCP stdio", () => {
  test("starts through the CLI without corrupting protocol output", async () => {
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: ["run", `${import.meta.dir}/../src/cli.ts`, "mcp"],
      stderr: "pipe",
    });
    const client = new Client({ name: "timecalc-stdio-test", version: "1.0.0" });

    try {
      await client.connect(transport);
      const tools = await client.listTools();
      expect(tools.tools.map((tool) => tool.name)).toEqual([EVALUATE_TOOL_NAME]);
      const result = await client.callTool({
        name: EVALUATE_TOOL_NAME,
        arguments: { expression: "(add 2025-01-31 P1M)" },
      });
      expect(textOf(result)).toBe("2025-02-28");
    } finally {
      await client.close();
    }
  }, 10_000);

  test("enables system context through the CLI flag", async () => {
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: ["run", `${import.meta.dir}/../src/cli.ts`, "mcp", "--system-context"],
      stderr: "pipe",
    });
    const client = new Client({ name: "timecalc-system-stdio-test", version: "1.0.0" });

    try {
      await client.connect(transport);
      const tools = await client.listTools();
      expect(tools.tools[0].annotations?.idempotentHint).toBe(false);
      const result = await client.callTool({
        name: EVALUATE_TOOL_NAME,
        arguments: { expression: "(now)" },
      });
      expect(result.structuredContent).toMatchObject({
        ok: true,
        type: "instant",
        context: { defaultCalendar: "iso8601" },
      });
    } finally {
      await client.close();
    }
  }, 10_000);
});
