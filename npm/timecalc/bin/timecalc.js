#!/usr/bin/env node
"use strict";

// Launcher for the timecalc standalone executable published as platform-specific
// npm packages (optionalDependencies of @tigerdata/timecalc). This file runs
// under Node.js via `npx`; the executable itself embeds Bun and needs no runtime.

const { spawn } = require("node:child_process");
const packageJson = require("../package.json");

const OS_IDS = { linux: "linux", darwin: "darwin", win32: "windows" };
const ARCH_IDS = { x64: "amd64", arm64: "arm64" };
const FORWARDED_SIGNALS = ["SIGINT", "SIGTERM", "SIGHUP"];

function fail(lines) {
  process.stderr.write(`${lines.join("\n")}\n`);
  process.exit(1);
}

function supportedPackages() {
  return Object.keys(packageJson.optionalDependencies || {});
}

function platformPackageName() {
  const os = OS_IDS[process.platform];
  const arch = ARCH_IDS[process.arch];
  const name = os && arch ? `@tigerdata/timecalc-${os}-${arch}` : null;
  if (!name || !supportedPackages().includes(name)) {
    fail([
      `timecalc: unsupported platform ${process.platform}-${process.arch}.`,
      "Supported platform packages:",
      ...supportedPackages().map((entry) => `  ${entry}`),
      "See https://github.com/timescale/timecalc-mcp#quick-start for other install options.",
    ]);
  }
  return name;
}

function resolveExecutable() {
  const name = platformPackageName();
  const filename = process.platform === "win32" ? "timecalc.exe" : "timecalc";
  try {
    return require.resolve(`${name}/bin/${filename}`);
  } catch (error) {
    fail([
      `timecalc: could not find the ${name} package.`,
      "npm may have skipped optional dependencies. Reinstall with:",
      `  npm install ${packageJson.name}@${packageJson.version} --include=optional`,
      `(${error && error.message ? error.message : String(error)})`,
    ]);
  }
}

function main() {
  const executable = resolveExecutable();
  const child = spawn(executable, process.argv.slice(2), {
    stdio: "inherit",
    windowsHide: true,
  });

  const forward = (signal) => {
    if (child.exitCode === null && child.signalCode === null) {
      child.kill(signal);
    }
  };
  for (const signal of FORWARDED_SIGNALS) {
    process.on(signal, forward);
  }

  child.on("error", (error) => {
    fail([`timecalc: failed to start ${executable}: ${error.message}`]);
  });

  child.on("exit", (code, signal) => {
    for (const forwarded of FORWARDED_SIGNALS) {
      process.removeListener(forwarded, forward);
    }
    if (signal) {
      process.kill(process.pid, signal);
      return;
    }
    process.exit(code === null ? 1 : code);
  });
}

main();
