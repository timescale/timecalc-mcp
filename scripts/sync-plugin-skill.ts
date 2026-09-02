#!/usr/bin/env bun

/**
 * Keep the Claude Code plugin's copy of the Agent Skill in sync with the canonical
 * skill at `.agents/skills/timecalc/`.
 *
 * Claude Code plugins cannot reference files outside their own directory and symlinks
 * are skipped for `--plugin-dir` installs, so the plugin carries a real copy. Run without
 * arguments to refresh the copy; run with `--check` (CI) to fail if the copy is stale.
 */

import { cp, readdir, readFile, rm, stat } from "node:fs/promises";
import { join, relative, resolve } from "node:path";

const repoRoot = resolve(import.meta.dir, "..");
const SOURCE = resolve(repoRoot, ".agents/skills/timecalc");
const DESTINATION = resolve(repoRoot, "plugins/timecalc/skills/timecalc");

const check = Bun.argv.includes("--check");

if (check) {
  const differences = await compareTrees(SOURCE, DESTINATION);
  if (differences.length > 0) {
    console.error(`Plugin skill copy is out of sync with ${relative(repoRoot, SOURCE)}:`);
    for (const difference of differences) console.error(`  ${difference}`);
    console.error("Run `./bun run plugin:sync` and commit the result.");
    process.exit(1);
  }
  console.log(`Plugin skill copy matches ${relative(repoRoot, SOURCE)}`);
} else {
  await rm(DESTINATION, { recursive: true, force: true });
  await cp(SOURCE, DESTINATION, { recursive: true });
  console.log(`Copied ${relative(repoRoot, SOURCE)} to ${relative(repoRoot, DESTINATION)}`);
}

async function listFiles(root: string): Promise<string[]> {
  const entries = await readdir(root, { recursive: true, withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    files.push(relative(root, join(entry.parentPath, entry.name)));
  }
  return files.sort();
}

async function compareTrees(source: string, destination: string): Promise<string[]> {
  const differences: string[] = [];
  if (!(await stat(destination).catch(() => null))) {
    return [`missing directory ${relative(repoRoot, destination)}`];
  }

  const sourceFiles = await listFiles(source);
  const destinationFiles = await listFiles(destination);

  for (const file of sourceFiles) {
    if (!destinationFiles.includes(file)) {
      differences.push(`missing ${file}`);
      continue;
    }
    const [expected, actual] = await Promise.all([
      readFile(join(source, file)),
      readFile(join(destination, file)),
    ]);
    if (!expected.equals(actual)) differences.push(`modified ${file}`);
  }
  for (const file of destinationFiles) {
    if (!sourceFiles.includes(file)) differences.push(`unexpected ${file}`);
  }
  return differences;
}
