#!/usr/bin/env bun

import { mkdir, readFile, stat } from "node:fs/promises";
import { resolve } from "node:path";

interface BuildTarget {
  id: string;
  bunTarget: string;
  extension: "" | ".exe";
}

const TARGETS: readonly BuildTarget[] = [
  { id: "linux-amd64", bunTarget: "bun-linux-x64", extension: "" },
  { id: "linux-arm64", bunTarget: "bun-linux-arm64", extension: "" },
  { id: "darwin-arm64", bunTarget: "bun-darwin-arm64", extension: "" },
  { id: "windows-amd64", bunTarget: "bun-windows-x64", extension: ".exe" },
  { id: "windows-arm64", bunTarget: "bun-windows-arm64", extension: ".exe" },
];

interface Options {
  version: string;
  outdir: string;
  targets: BuildTarget[];
}

const HELP = `Build standalone timecalc executables with Bun.

Usage:
  bun run build:executables [options]

Options:
  --version X.Y.Z       Version embedded in executable and filename
  --outdir PATH         Output directory (default: dist)
  --target TARGET       Build one target; may be repeated
  -h, --help            Show help

Targets:
${TARGETS.map((target) => `  ${target.id}`).join("\n")}

macOS targets built on macOS are ad-hoc signed with JIT entitlements.
`;

const options = await parseOptions(Bun.argv.slice(2));
const outdir = resolve(options.outdir);
await mkdir(outdir, { recursive: true });

for (const target of options.targets) {
  const filename = `timecalc-v${options.version}-${target.id}${target.extension}`;
  const outfile = resolve(outdir, filename);
  console.log(`Building ${filename} (${target.bunTarget})`);

  const child = Bun.spawn({
    cmd: [
      process.execPath,
      "build",
      "--compile",
      "--minify",
      "--no-compile-autoload-dotenv",
      "--no-compile-autoload-bunfig",
      `--target=${target.bunTarget}`,
      "--define",
      `TIMECALC_VERSION=${JSON.stringify(options.version)}`,
      "--outfile",
      outfile,
      "src/cli.ts",
    ],
    stdin: "ignore",
    stdout: "inherit",
    stderr: "inherit",
  });

  const exitCode = await child.exited;
  if (exitCode !== 0) {
    throw new Error(`Build failed for ${target.id} with exit code ${exitCode}`);
  }

  if (target.id === "darwin-arm64") {
    if (process.platform === "darwin") {
      await signMacOSExecutable(outfile);
    } else {
      console.warn(
        `Built ${filename} without a macOS signature; build this target on macOS before distribution`,
      );
    }
  }

  const { size } = await stat(outfile);
  console.log(`Built ${filename} (${formatBytes(size)})`);
}

console.log(`Built ${options.targets.length} executable(s) in ${outdir}`);

async function signMacOSExecutable(executable: string): Promise<void> {
  const entitlements = resolve(import.meta.dir, "macos-entitlements.plist");

  const removeSignature = Bun.spawn({
    cmd: ["codesign", "--remove-signature", executable],
    stdin: "ignore",
    stdout: "ignore",
    stderr: "ignore",
  });
  await removeSignature.exited;

  console.log(`Signing ${executable} with macOS JIT entitlements`);
  await runCommand([
    "codesign",
    "--entitlements",
    entitlements,
    "--force",
    "--deep",
    "--sign",
    "-",
    executable,
  ], "macOS code signing");
  await runCommand(
    ["codesign", "--verify", "--deep", "--strict", "--verbose=2", executable],
    "macOS signature verification",
  );

  const inspect = Bun.spawn({
    cmd: ["codesign", "-d", "--entitlements", ":-", executable],
    stdin: "ignore",
    stdout: "pipe",
    stderr: "ignore",
  });
  const entitlementsOutput = new Response(inspect.stdout).text();
  const [inspectExitCode, embeddedEntitlements] = await Promise.all([
    inspect.exited,
    entitlementsOutput,
  ]);
  if (
    inspectExitCode !== 0 ||
    !embeddedEntitlements.includes("<key>com.apple.security.cs.allow-jit</key>")
  ) {
    throw new Error("macOS signature does not contain the required JIT entitlement");
  }
}

async function runCommand(command: string[], description: string): Promise<void> {
  const child = Bun.spawn({
    cmd: command,
    stdin: "ignore",
    stdout: "inherit",
    stderr: "inherit",
  });
  const exitCode = await child.exited;
  if (exitCode !== 0) {
    throw new Error(`${description} failed with exit code ${exitCode}`);
  }
}

async function parseOptions(args: string[]): Promise<Options> {
  const packageJson = JSON.parse(await readFile("package.json", "utf8")) as { version?: unknown };
  let version = typeof packageJson.version === "string" ? packageJson.version : "0.0.0";
  let outdir = "dist";
  const selectedTargetIds: string[] = [];

  for (let index = 0; index < args.length; index++) {
    const argument = args[index];
    switch (argument) {
      case "--version":
        version = requiredValue(argument, args, ++index);
        break;
      case "--outdir":
        outdir = requiredValue(argument, args, ++index);
        break;
      case "--target":
        selectedTargetIds.push(requiredValue(argument, args, ++index));
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
  const targets = targetIds.map((id) => {
    const target = TARGETS.find((candidate) => candidate.id === id);
    if (!target) {
      throw new Error(`Unknown target '${id}'. Expected one of: ${TARGETS.map((item) => item.id).join(", ")}`);
    }
    return target;
  });

  return { version, outdir, targets };
}

function requiredValue(option: string, args: string[], index: number): string {
  const value = args[index];
  if (!value || value.startsWith("--")) throw new Error(`${option} requires a value`);
  return value;
}

function formatBytes(bytes: number): string {
  return `${(bytes / 1024 / 1024).toFixed(1)} MiB`;
}
