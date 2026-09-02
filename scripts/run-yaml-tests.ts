#!/usr/bin/env bun

import { evaluateYamlTestCase, expectedOutput, loadYamlTestCases } from "./yaml-cases";

const path = Bun.argv[2] ?? `${import.meta.dir}/../test/cases.yaml`;

try {
  const cases = await loadYamlTestCases(path);
  let failures = 0;

  for (const [index, testCase] of cases.entries()) {
    try {
      const actual = evaluateYamlTestCase(testCase);
      if (actual === expectedOutput(testCase)) {
        console.log(`✓ ${index + 1}. ${testCase.description}`);
      } else {
        failures++;
        console.error(`✗ ${index + 1}. ${testCase.description}`);
        console.error(`  expression: ${format(testCase.expression)}`);
        console.error(`  expected:   ${JSON.stringify(expectedOutput(testCase))}`);
        console.error(`  actual:     ${JSON.stringify(actual)}`);
      }
    } catch (error) {
      failures++;
      console.error(`✗ ${index + 1}. ${testCase.description}`);
      console.error(`  expression: ${format(testCase.expression)}`);
      console.error(`  error:      ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  const passed = cases.length - failures;
  console.log(`\n${passed}/${cases.length} YAML cases passed`);
  process.exitCode = failures === 0 ? 0 : 1;
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 2;
}

function format(value: string): string {
  return JSON.stringify(value.replace(/\s+/g, " ").trim());
}
