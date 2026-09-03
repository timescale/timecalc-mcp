#!/usr/bin/env bun

/**
 * Generate the npm packages for a release.
 *
 * Output goes to `npm/dist/` (gitignored); the committed `npm/timecalc/` directory is a
 * template and is never modified.
 *
 * - `npm/dist/timecalc/`: copy of `npm/timecalc/` with `version` and exact-pinned
 *   `optionalDependencies` stamped into package.json, plus LICENSE and NOTICE.
 * - `npm/dist/<target>/`: one package per executable, containing the binary from
 *   `dist/`, LICENSE, NOTICE, and a short README.
 *
 * With `--placeholder`, platform packages contain only package.json and README so the
 * packages can be created on npm once before trusted publishing is configured.
 */

import { chmod, copyFile, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { type BuildTarget, TARGETS, executableFilename, findTarget } from "./targets.ts";

const SCOPE = "@tigerdata";
const SHIM_NAME = `${SCOPE}/timecalc`;
const REPOSITORY_URL = "https://github.com/timescale/timecalc-mcp";

interface Options {
  version: string;
  dist: string;
  out: string;
  placeholder: boolean;
  targets: BuildTarget[];
}

const HELP = `Generate npm packages for timecalc.

Usage:
  bun run build:npm -- [options]

Options:
  --version X.Y.Z       Version to publish (default: root package.json version)
  --dist PATH           Directory containing built executables (default: dist)
  --out PATH            Output directory for generated packages (default: npm/dist)
  --target TARGET       Generate one platform package; may be repeated (default: all)
  --placeholder         Generate placeholder packages without executables
  -h, --help            Show help

Targets:
${TARGETS.map((target) => `  ${target.id}`).join("\n")}
`;

const options = await parseOptions(Bun.argv.slice(2));
const repoRoot = resolve(import.meta.dir, "..");
const shimTemplateDir = resolve(repoRoot, "npm/timecalc");
const outDir = resolve(repoRoot, options.out);
const shimOutDir = resolve(outDir, "timecalc");
const distDir = resolve(repoRoot, options.dist);

await rm(outDir, { recursive: true, force: true });
await mkdir(outDir, { recursive: true });

for (const target of options.targets) {
  await generatePlatformPackage(target);
}
await generateShimPackage();

console.log(`Generated ${options.targets.length} platform package(s) and ${SHIM_NAME}@${options.version} in ${outDir}`);

function platformPackageName(target: BuildTarget): string {
  return `${SCOPE}/timecalc-${target.id}`;
}

async function generatePlatformPackage(target: BuildTarget): Promise<void> {
  const name = platformPackageName(target);
  const packageDir = resolve(outDir, target.id);
  await mkdir(packageDir, { recursive: true });

  const files = ["README.md"];
  if (!options.placeholder) {
    const binDir = resolve(packageDir, "bin");
    await mkdir(binDir, { recursive: true });
    const source = resolve(distDir, executableFilename(options.version, target));
    await stat(source).catch(() => {
      throw new Error(`Missing executable ${source}. Run build:executables first.`);
    });
    const destination = resolve(binDir, `timecalc${target.extension}`);
    await copyFile(source, destination);
    await chmod(destination, 0o755);
    await copyFile(resolve(repoRoot, "LICENSE"), resolve(packageDir, "LICENSE"));
    await copyFile(resolve(repoRoot, "NOTICE"), resolve(packageDir, "NOTICE"));
    files.push("bin", "LICENSE", "NOTICE");
  }

  const packageJson = {
    name,
    version: options.version,
    description: options.placeholder
      ? `Placeholder for the timecalc ${target.id} executable. Use ${SHIM_NAME} instead.`
      : `timecalc standalone executable for ${target.id}. Install ${SHIM_NAME} instead of this package.`,
    license: "Apache-2.0",
    author: "TigerData",
    homepage: `${REPOSITORY_URL}#readme`,
    repository: { type: "git", url: `git+${REPOSITORY_URL}.git` },
    os: [target.nodeOs],
    cpu: [target.nodeCpu],
    files,
    publishConfig: { access: "public" },
  };
  await writeFile(resolve(packageDir, "package.json"), `${JSON.stringify(packageJson, null, 2)}\n`);

  const readme = options.placeholder
    ? `# ${name}\n\nPlaceholder release. Install [${SHIM_NAME}](https://www.npmjs.com/package/${SHIM_NAME}) instead.\n`
    : [
        `# ${name}`,
        "",
        `Standalone timecalc executable for ${target.id} (${target.nodeOs}/${target.nodeCpu}).`,
        "",
        `This package is an implementation detail of [${SHIM_NAME}](https://www.npmjs.com/package/${SHIM_NAME}),`,
        "which selects the right platform package through `optionalDependencies`. Install that package instead.",
        "",
        `Documentation: <${REPOSITORY_URL}>`,
        "",
      ].join("\n");
  await writeFile(resolve(packageDir, "README.md"), readme);

  console.log(`Generated ${name}@${options.version}${options.placeholder ? " (placeholder)" : ""}`);
}

async function generateShimPackage(): Promise<void> {
  await mkdir(resolve(shimOutDir, "bin"), { recursive: true });
  await copyFile(resolve(shimTemplateDir, "bin/timecalc.js"), resolve(shimOutDir, "bin/timecalc.js"));
  await chmod(resolve(shimOutDir, "bin/timecalc.js"), 0o755);
  await copyFile(resolve(shimTemplateDir, "README.md"), resolve(shimOutDir, "README.md"));
  await copyFile(resolve(repoRoot, "LICENSE"), resolve(shimOutDir, "LICENSE"));
  await copyFile(resolve(repoRoot, "NOTICE"), resolve(shimOutDir, "NOTICE"));

  const packageJson = JSON.parse(
    await readFile(resolve(shimTemplateDir, "package.json"), "utf8"),
  ) as Record<string, unknown>;
  packageJson.version = options.version;
  packageJson.optionalDependencies = Object.fromEntries(
    TARGETS.map((target) => [platformPackageName(target), options.version]),
  );
  await writeFile(resolve(shimOutDir, "package.json"), `${JSON.stringify(packageJson, null, 2)}\n`);
  console.log(`Generated ${SHIM_NAME}@${options.version}`);
}

async function parseOptions(args: string[]): Promise<Options> {
  const rootPackageJson = JSON.parse(
    await readFile(resolve(import.meta.dir, "../package.json"), "utf8"),
  ) as { version?: unknown };
  let version = typeof rootPackageJson.version === "string" ? rootPackageJson.version : "0.0.0";
  let dist = "dist";
  let out = "npm/dist";
  let placeholder = false;
  const selectedTargetIds: string[] = [];

  for (let index = 0; index < args.length; index++) {
    const argument = args[index];
    switch (argument) {
      case "--version":
        version = requiredValue(argument, args, ++index);
        break;
      case "--dist":
        dist = requiredValue(argument, args, ++index);
        break;
      case "--out":
        out = requiredValue(argument, args, ++index);
        break;
      case "--target":
        selectedTargetIds.push(requiredValue(argument, args, ++index));
        break;
      case "--placeholder":
        placeholder = true;
        break;
      case "--help":
      case "-h":
        console.log(HELP);
        process.exit(0);
      default:
        throw new Error(`Unknown argument: ${argument}`);
    }
  }

  if (!/^\d+\.\d+\.\d+$/.test(version)) {
    throw new Error(`Version must have X.Y.Z format, received: ${version}`);
  }

  const targetIds = selectedTargetIds.length > 0
    ? [...new Set(selectedTargetIds)]
    : TARGETS.map((target) => target.id);

  return { version, dist, out, placeholder, targets: targetIds.map(findTarget) };
}

function requiredValue(option: string, args: string[], index: number): string {
  const value = args[index];
  if (!value || value.startsWith("--")) throw new Error(`${option} requires a value`);
  return value;
}
