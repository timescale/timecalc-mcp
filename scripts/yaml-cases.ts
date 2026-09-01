import { evaluate } from "../src/evaluator";
import { parse } from "../src/parser";
import { humanResult } from "../src/serialize";

export interface YamlTestCase {
  description: string;
  expression: string;
  expected: string;
}

export async function loadYamlTestCases(path: string): Promise<YamlTestCase[]> {
  const file = Bun.file(path);
  if (!(await file.exists())) throw new Error(`YAML test file not found: ${path}`);

  const parsed: unknown = Bun.YAML.parse(await file.text());
  if (!Array.isArray(parsed)) throw new Error(`${path}: root value must be an array`);

  return parsed.map((value, index) => validateCase(value, index, path));
}

export function evaluateYamlTestCase(testCase: YamlTestCase): string {
  return humanResult(evaluate(parse(testCase.expression)));
}

function validateCase(value: unknown, index: number, path: string): YamlTestCase {
  const location = `${path}: test ${index + 1}`;
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${location} must be an object`);
  }

  const record = value as Record<string, unknown>;
  const { description, expression, expected } = record;
  if (typeof description !== "string") throw new Error(`${location}.description must be a string`);
  if (typeof expression !== "string") throw new Error(`${location}.expression must be a string`);
  if (typeof expected !== "string") throw new Error(`${location}.expected must be a string`);

  if (description.length === 0) throw new Error(`${location}.description must not be empty`);
  if (expression.trim().length === 0) throw new Error(`${location}.expression must not be empty`);

  return { description, expression, expected };
}
