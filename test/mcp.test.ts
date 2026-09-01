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
      const result = handleEvaluateDateExpression({ expression: fixture.expression });
      expect(result.isError).not.toBe(true);
      expect(textOf(result)).toBe(fixture.expected);
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

  test("calls the tool through MCP", async () => {
    const result = await client.callTool({
      name: EVALUATE_TOOL_NAME,
      arguments: { expression: "(day-of-week 2025-06-01)" },
    });
    expect(textOf(result)).toBe("7");
    expect(result.structuredContent).toEqual({ ok: true, type: "number", value: 7 });
  });

  test("returns a structured tool error", async () => {
    const result = await client.callTool({
      name: EVALUATE_TOOL_NAME,
      arguments: { expression: "(add 2025-01-31 2025-02-01)" },
    });
    expect(result.isError).toBe(true);
    expect(result.structuredContent).toMatchObject({
      ok: false,
      error: { code: "TYPE_MISMATCH" },
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
});
