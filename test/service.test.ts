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

  test("uses system context once and reports the resolved defaults", () => {
    let instantCalls = 0;
    let timeZoneCalls = 0;
    const outcome = evaluateRequest(
      { expression: "(to-date (with-time-zone (now) (default-time-zone)))" },
      {
        systemContext: true,
        systemContextProvider: {
          instant: () => {
            instantCalls++;
            return "2025-01-01T04:30:00Z";
          },
          timeZoneId: () => {
            timeZoneCalls++;
            return "America/New_York";
          },
        },
      },
    );

    expect(instantCalls).toBe(1);
    expect(timeZoneCalls).toBe(1);
    expect(outcome).toMatchObject({
      ok: true,
      text: "2024-12-31",
      response: {
        context: {
          now: "2025-01-01T04:30:00Z",
          defaultTimeZone: "America/New_York",
          defaultCalendar: "iso8601",
        },
      },
    });
  });

  test("gives explicit context precedence over system defaults", () => {
    const outcome = evaluateRequest(
      {
        expression: "(with-time-zone (now) (default-time-zone))",
        now: "2025-06-01T12:00:00Z",
        defaultTimeZone: "UTC",
      },
      {
        systemContext: true,
        systemContextProvider: {
          instant: () => {
            throw new Error("system clock should not be read");
          },
          timeZoneId: () => {
            throw new Error("system time zone should not be read");
          },
        },
      },
    );
    expect(outcome).toMatchObject({
      ok: true,
      text: "2025-06-01T12:00:00+00:00[UTC]",
      response: {
        context: {
          now: "2025-06-01T12:00:00Z",
          defaultTimeZone: "UTC",
          defaultCalendar: "iso8601",
        },
      },
    });
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
