import { describe, expect, test } from "bun:test";
import { createEvaluationContext, evaluateRequest } from "../src/service";

describe("evaluation service", () => {
  test("returns text and structured output", () => {
    expect(evaluateRequest({ expression: "(add 2025-01-31 P1M)" })).toEqual({
      ok: true,
      text: "2025-02-28",
      response: {
        ok: true,
        type: "date",
        value: "2025-02-28",
        calendar: "iso8601",
      },
    });
  });

  test("returns structured errors with source positions", () => {
    const outcome = evaluateRequest({ expression: "(add 2025-01-31 2025-02-01)" });
    expect(outcome).toMatchObject({
      ok: false,
      response: {
        ok: false,
        error: { code: "TYPE_MISMATCH", line: 1, column: 1 },
      },
    });
  });

  test("validates deterministic context", () => {
    const context = createEvaluationContext({
      now: "2025-01-01T00:00:00Z",
      defaultTimeZone: "America/New_York",
      defaultCalendar: "iso8601",
    });
    expect(context.now.toString()).toBe("2025-01-01T00:00:00Z");
    expect(context.defaultTimeZone).toBe("America/New_York");
    expect(context.defaultCalendar).toBe("iso8601");
  });

  test("rejects invalid context without throwing across the service boundary", () => {
    const outcome = evaluateRequest({ expression: "2025-01-01", now: "tomorrow" });
    expect(outcome).toMatchObject({
      ok: false,
      response: { error: { code: "INVALID_TEMPORAL_VALUE" } },
    });
  });

  test("enforces expression resource limits", () => {
    const outcome = evaluateRequest({ expression: `"${"x".repeat(64 * 1024)}"` });
    expect(outcome).toMatchObject({
      ok: false,
      response: { error: { code: "RESOURCE_LIMIT" } },
    });
  });
});
