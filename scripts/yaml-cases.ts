import { evaluateRequest } from "../src/service";

export interface YamlTestCase {
  description: string;
  expression: string;
  expected?: string;
  error?: string;
  now?: string;
  defaultTimeZone?: string;
  defaultCalendar?: string;
}

export async function loadYamlTestCases(path: string): Promise<YamlTestCase[]> {
  const file = Bun.file(path);
  if (!(await file.exists())) throw new Error(`YAML test file not found: ${path}`);

  const parsed: unknown = Bun.YAML.parse(await file.text());
  if (!Array.isArray(parsed)) throw new Error(`${path}: root value must be an array`);

  return parsed.map((value, index) => validateCase(value, index, path));
}

/**
 * Evaluate a case and return the string to compare against `expectedOutput`.
 * On success this is the human-readable value; on failure it is the error code,
 * so error cases can assert the failure they expect.
 */
export function evaluateYamlTestCase(testCase: YamlTestCase): string {
  const outcome = evaluateRequest({
    expression: testCase.expression,
    ...(testCase.now !== undefined ? { now: testCase.now } : {}),
    ...(testCase.defaultTimeZone !== undefined
      ? { defaultTimeZone: testCase.defaultTimeZone }
      : {}),
    ...(testCase.defaultCalendar !== undefined
      ? { defaultCalendar: testCase.defaultCalendar }
      : {}),
  });
  return outcome.ok ? outcome.text : outcome.response.error.code;
}

/** The target string a case's evaluation should equal. */
export function expectedOutput(testCase: YamlTestCase): string {
  return testCase.error ?? (testCase.expected as string);
}

function validateCase(value: unknown, index: number, path: string): YamlTestCase {
  const location = `${path}: test ${index + 1}`;
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${location} must be an object`);
  }

  const record = value as Record<string, unknown>;
  const { description, expression, expected, error } = record;
  if (typeof description !== "string") throw new Error(`${location}.description must be a string`);
  if (typeof expression !== "string") throw new Error(`${location}.expression must be a string`);

  if (description.length === 0) throw new Error(`${location}.description must not be empty`);
  if (expression.trim().length === 0) throw new Error(`${location}.expression must not be empty`);

  const hasExpected = expected !== undefined;
  const hasError = error !== undefined;
  if (hasExpected === hasError) {
    throw new Error(`${location} must set exactly one of 'expected' or 'error'`);
  }
  if (hasExpected && typeof expected !== "string") {
    throw new Error(`${location}.expected must be a string`);
  }
  if (hasError && typeof error !== "string") {
    throw new Error(`${location}.error must be a string`);
  }

  const testCase: YamlTestCase = { description, expression };
  if (hasExpected) testCase.expected = expected as string;
  if (hasError) testCase.error = error as string;
  for (const field of ["now", "defaultTimeZone", "defaultCalendar"] as const) {
    const contextValue = record[field];
    if (contextValue === undefined) continue;
    if (typeof contextValue !== "string") {
      throw new Error(`${location}.${field} must be a string`);
    }
    testCase[field] = contextValue;
  }

  return testCase;
}
