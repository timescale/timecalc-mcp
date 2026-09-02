import { describe, expect, test } from "bun:test";
import { evaluateYamlTestCase, expectedOutput, loadYamlTestCases } from "../scripts/yaml-cases";

const cases = await loadYamlTestCases(`${import.meta.dir}/cases.yaml`);

describe("YAML DSL cases", () => {
  for (const testCase of cases) {
    test(testCase.description, () => {
      expect(evaluateYamlTestCase(testCase)).toBe(expectedOutput(testCase));
    });
  }
});
