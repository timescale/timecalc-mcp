import { describe, expect, test } from "bun:test";

const CLI = `${import.meta.dir}/../src/cli.ts`;

function cli(...args: string[]) {
  return Bun.spawnSync({ cmd: [process.execPath, "run", CLI, ...args] });
}

describe("CLI", () => {
  test("evaluates an expression", () => {
    const result = cli("(add 2025-01-31 P1M)");
    expect(result.exitCode).toBe(0);
    expect(result.stdout.toString()).toBe("2025-02-28\n");
    expect(result.stderr.toString()).toBe("");
  });

  test("accepts a negative literal as the expression argument", () => {
    const result = cli("-P1D");
    expect(result.exitCode).toBe(0);
    expect(result.stdout.toString()).toBe("-P1D\n");
  });

  test("emits structured JSON", () => {
    const result = cli("--json", "(day-of-week 2025-06-01)");
    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.stdout.toString())).toEqual({
      ok: true,
      type: "number",
      value: 7,
    });
  });

  test("returns structured errors and exit code 1", () => {
    const result = cli("--json", "(add 2025-01-31 2025-02-01)");
    expect(result.exitCode).toBe(1);
    expect(JSON.parse(result.stdout.toString())).toMatchObject({
      ok: false,
      error: { code: "TYPE_MISMATCH", line: 1, column: 1 },
    });
  });

  test("reads stdin", () => {
    const result = Bun.spawnSync({
      cmd: [process.execPath, "run", CLI, "--stdin"],
      stdin: new TextEncoder().encode("(year 2025-06-01)"),
    });
    expect(result.exitCode).toBe(0);
    expect(result.stdout.toString()).toBe("2025\n");
  });

  test("validates expressions", () => {
    const result = cli("validate", "(add 2025-01-31 P1M)");
    expect(result.exitCode).toBe(0);
    expect(result.stdout.toString()).toBe("valid\n");
  });
});
