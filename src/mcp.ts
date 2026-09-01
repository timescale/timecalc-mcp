import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import * as z from "zod/v4";
import { OPERATOR_CATALOG } from "./operators/catalog";
import { evaluateRequest, type EvaluationRequest } from "./service";
import { VERSION } from "./version";

export const MCP_SERVER_NAME = "timecalc";
export const MCP_SERVER_VERSION = VERSION;
export const EVALUATE_TOOL_NAME = "evaluate_date_expression";

const inputSchema = z.object({
  expression: z
    .string()
    .min(1)
    .max(64 * 1024)
    .describe("One timecalc S-expression using unquoted Temporal literals."),
  now: z
    .string()
    .min(1)
    .optional()
    .describe("Optional deterministic current instant, such as 2025-01-01T00:00:00Z."),
  defaultTimeZone: z
    .string()
    .min(1)
    .optional()
    .describe("Optional IANA or fixed-offset time-zone identifier."),
  defaultCalendar: z
    .string()
    .min(1)
    .optional()
    .describe("Optional Temporal calendar identifier."),
}).strict();

// The SDK's high-level API expects an object shape here. Fields specific to
// success or failure remain optional so both structured result envelopes are
// valid for MCP clients that enforce the advertised output schema.
const outputSchema = {
  ok: z.boolean(),
  type: z.enum([
    "date",
    "instant",
    "zoned-date-time",
    "duration",
    "string",
    "number",
    "boolean",
  ]).optional(),
  value: z.union([z.string(), z.number(), z.boolean()]).optional(),
  calendar: z.string().optional(),
  timeZone: z.string().optional(),
  offset: z.string().optional(),
  error: z.object({
    code: z.enum([
      "LEX_ERROR",
      "PARSE_ERROR",
      "UNKNOWN_OPERATOR",
      "ARITY_ERROR",
      "UNKNOWN_OPTION",
      "DUPLICATE_OPTION",
      "TYPE_MISMATCH",
      "INVALID_TEMPORAL_VALUE",
      "INVALID_TEMPORAL_OPERATION",
      "RESOURCE_LIMIT",
      "INTERNAL_ERROR",
    ]),
    message: z.string(),
    span: z.object({ start: z.number(), end: z.number() }).optional(),
    line: z.number().optional(),
    column: z.number().optional(),
  }).strict().optional(),
};

export type EvaluateToolInput = z.infer<typeof inputSchema>;

export function handleEvaluateDateExpression(input: EvaluationRequest): CallToolResult {
  const outcome = evaluateRequest(input);
  if (outcome.ok) {
    return {
      content: [{ type: "text", text: outcome.text }],
      structuredContent: { ...outcome.response },
    };
  }

  return {
    isError: true,
    content: [{ type: "text", text: outcome.text }],
    structuredContent: { ...outcome.response },
  };
}

export function createTimecalcMcpServer(): McpServer {
  const server = new McpServer({
    name: MCP_SERVER_NAME,
    version: MCP_SERVER_VERSION,
  });

  server.registerTool(
    EVALUATE_TOOL_NAME,
    {
      title: "Evaluate a date expression",
      description: createToolDescription(),
      inputSchema,
      outputSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async (input) => handleEvaluateDateExpression(input),
  );

  return server;
}

export async function runStdioMcpServer(): Promise<void> {
  const server = createTimecalcMcpServer();
  const transport = new StdioServerTransport();
  let closing = false;

  const close = async () => {
    if (closing) return;
    closing = true;
    try {
      await server.close();
    } catch (error) {
      console.error(error instanceof Error ? error.message : String(error));
    }
  };

  process.once("SIGINT", close);
  process.once("SIGTERM", close);

  try {
    await server.connect(transport);
  } catch (error) {
    process.off("SIGINT", close);
    process.off("SIGTERM", close);
    throw error;
  }
}

function createToolDescription(): string {
  const operators = OPERATOR_CATALOG
    .map((operator) => `- ${operator.signature}: ${operator.description}`)
    .join("\n");

  return `Evaluate one deterministic timecalc date-math expression with Bun Temporal.

Temporal literals are unquoted and self-describing:
- date: 2025-01-31
- instant: 2025-06-01T12:00:00Z
- zoned date-time: 2025-06-01T08:00:00-04:00[America/New_York]
- duration: P1M or PT24H
Quoted values are strings.

Examples:
(add 2025-01-31 P1M)
(subtract 2025-12-31 2025-01-01 :largest-unit "months")
(add 2025-03-08T12:00:00-05:00[America/New_York] P1D)

For a zoned date-time, P1D means one calendar day; PT24H means exactly 24 elapsed hours.
Keyword options follow positional arguments.

Operators:
${operators}`;
}
