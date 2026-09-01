import { describe, expect, test } from "bun:test";
import { TimecalcError } from "../src/errors";
import { parse } from "../src/parser";
import type { TemporalLiteralType } from "../src/ast";

describe("parser", () => {
  test.each<[string, TemporalLiteralType]>([
    ["2025-01-31", "date"],
    ["2025-01-31T12:00:00Z", "instant"],
    ["2025-01-31T07:00:00-05:00[America/New_York]", "zoned-date-time"],
    ["-P2DT3H", "duration"],
  ])("classifies %s as %s", (source, type) => {
    const node = parse(source);
    expect(node.kind).toBe("temporal-literal");
    if (node.kind === "temporal-literal") expect(node.temporalType).toBe(type);
  });

  test("quoted lookalikes remain strings", () => {
    expect(parse('"P1M"')).toMatchObject({ kind: "string", value: "P1M" });
  });

  test("parses and preserves nested expressions", () => {
    const node = parse("(day-of-week (add 2025-01-31 P1M))");
    expect(node).toMatchObject({
      kind: "call",
      operator: "day-of-week",
      positional: [
        {
          kind: "call",
          operator: "add",
          positional: [
            { kind: "temporal-literal", temporalType: "date" },
            { kind: "temporal-literal", temporalType: "duration" },
          ],
        },
      ],
    });
  });

  test("parses calls, comments, and keyword arguments", () => {
    const node = parse(`
      ; difference
      (subtract 2025-12-31 2025-01-01 :largest-unit "months")
    `);
    expect(node.kind).toBe("call");
    if (node.kind === "call") {
      expect(node.operator).toBe("subtract");
      expect(node.positional).toHaveLength(2);
      expect(node.keywords.get("largest-unit")).toMatchObject({ kind: "string", value: "months" });
    }
  });

  test("rejects duplicate options", () => {
    expect(() => parse('(round PT1H :smallest-unit "hour" :smallest-unit "day")')).toThrow(
      expect.objectContaining({ code: "DUPLICATE_OPTION" }),
    );
  });

  test("rejects positional arguments after options", () => {
    expect(() => parse('(subtract 2025-01-01 :largest-unit "day" 2025-01-02)')).toThrow(
      expect.objectContaining({ code: "PARSE_ERROR" }),
    );
  });

  test("rejects values outside the canonical literal profiles", () => {
    try {
      parse("01/31/2025");
      throw new Error("expected parsing to fail");
    } catch (error) {
      expect(error).toBeInstanceOf(TimecalcError);
      expect((error as TimecalcError).code).toBe("LEX_ERROR");
    }
  });
});
