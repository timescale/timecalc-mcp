import { describe, expect, test } from "bun:test";
import { evaluate, type EvaluationContext } from "../src/evaluator";
import { parse } from "../src/parser";
import { serializeResult } from "../src/serialize";

function run(source: string, context: EvaluationContext = {}) {
  return evaluate(parse(source), context);
}

describe("evaluator", () => {
  test("performs end-of-month calendar arithmetic", () => {
    expect(run("(add 2025-01-31 P1M)").value.toString()).toBe("2025-02-28");
  });

  test("distinguishes a calendar day from 24 elapsed hours across DST", () => {
    const start = "2025-03-08T12:00:00-05:00[America/New_York]";
    expect(run(`(add ${start} P1D)`).value.toString()).toBe(
      "2025-03-09T12:00:00-04:00[America/New_York]",
    );
    expect(run(`(add ${start} PT24H)`).value.toString()).toBe(
      "2025-03-09T13:00:00-04:00[America/New_York]",
    );
  });

  test("subtracts compatible Temporal values to calculate signed differences", () => {
    expect(run('(subtract 2025-12-31 2025-01-01 :largest-unit "months")').value.toString()).toBe(
      "P11M30D",
    );
    expect(run("(subtract 2025-01-01 2025-01-03)").value.toString()).toBe("-P2D");
    expect(
      run(
        '(subtract 2025-01-03T00:00:00Z 2025-01-01T12:00:00Z :largest-unit "hours")',
      ).value.toString(),
    ).toBe("PT36H");
    expect(
      run(
        '(subtract 2025-03-09T12:00:00-04:00[America/New_York] 2025-03-08T12:00:00-05:00[America/New_York] :largest-unit "days")',
      ).value.toString(),
    ).toBe("P1D");
  });

  test("does not expose until or since aliases", () => {
    expect(() => run("(until 2025-01-01 2025-01-02)")).toThrow(
      expect.objectContaining({ code: "UNKNOWN_OPERATOR" }),
    );
    expect(() => run("(since 2025-01-02 2025-01-01)")).toThrow(
      expect.objectContaining({ code: "UNKNOWN_OPERATOR" }),
    );
  });

  test("validates subtract options according to its operand types", () => {
    expect(() => run('(subtract 2025-03-03 P2D :largest-unit "days")')).toThrow(
      expect.objectContaining({ code: "UNKNOWN_OPTION" }),
    );
    expect(() => run('(subtract 2025-03-03 2025-03-01 :overflow "constrain")')).toThrow(
      expect.objectContaining({ code: "UNKNOWN_OPTION" }),
    );
  });

  test("converts instants to zones, dates, and back", () => {
    const zoned = run('(with-time-zone 2025-06-01T12:00:00Z "America/New_York")');
    expect(zoned.value.toString()).toBe("2025-06-01T08:00:00-04:00[America/New_York]");
    expect(run(`(to-instant ${zoned.value.toString()})`).value.toString()).toBe(
      "2025-06-01T12:00:00Z",
    );
    expect(run(`(to-date ${zoned.value.toString()})`).value.toString()).toBe("2025-06-01");
  });

  test("exposes the injected clock and default time zone", () => {
    const TemporalAPI = (globalThis as any).Temporal;
    const context = {
      now: TemporalAPI.Instant.from("2025-01-01T05:00:00Z"),
      defaultTimeZone: "America/New_York",
    };
    expect(run("(now)", context).value.toString()).toBe("2025-01-01T05:00:00Z");
    expect(run("(default-time-zone)", context).value).toBe("America/New_York");
    expect(
      run("(to-date (with-time-zone (now) (default-time-zone)))", context).value.toString(),
    ).toBe("2025-01-01");
  });

  test("rejects context operators when their context is unavailable", () => {
    expect(() => run("(now)")).toThrow(expect.objectContaining({ code: "MISSING_CONTEXT" }));
    expect(() => run("(default-time-zone)")).toThrow(
      expect.objectContaining({ code: "MISSING_CONTEXT" }),
    );
  });

  test("supports structural duration equality", () => {
    expect(run("(equals P1D P1D)").value).toBe(true);
    expect(run("(equals P1D PT24H)").value).toBe(false);
  });

  test("supports comparison, rounding, and inspection", () => {
    expect(run("(compare 2025-01-01 2025-01-02)").value).toBe(-1);
    expect(run('(round 2025-01-01T12:34:56Z :smallest-unit "minute")').value.toString()).toBe(
      "2025-01-01T12:35:00Z",
    );
    expect(run("(day-of-week 2025-06-01)").value).toBe(7);
  });

  test("rejects type mismatches", () => {
    expect(() => run("(add 2025-01-31 2025-02-01)")).toThrow(
      expect.objectContaining({ code: "TYPE_MISMATCH" }),
    );
  });

  test("rejects invalid Temporal values after lexical classification", () => {
    expect(() => run("2025-02-30")).toThrow(
      expect.objectContaining({ code: "INVALID_TEMPORAL_VALUE" }),
    );
  });

  test("serializes typed metadata", () => {
    expect(serializeResult(run("2025-06-01T08:00:00-04:00[America/New_York]"))).toEqual({
      ok: true,
      type: "zoned-date-time",
      value: "2025-06-01T08:00:00-04:00[America/New_York]",
      calendar: "iso8601",
      timeZone: "America/New_York",
      offset: "-04:00",
    });
  });
});
