export interface BuildTarget {
  /** Release asset identifier, e.g. `linux-amd64`. */
  id: string;
  /** Bun `--target` value. */
  bunTarget: string;
  /** Executable filename extension. */
  extension: "" | ".exe";
  /** Node.js `process.platform` value, used for npm `os` fields. */
  nodeOs: "linux" | "darwin" | "win32";
  /** Node.js `process.arch` value, used for npm `cpu` fields. */
  nodeCpu: "x64" | "arm64";
}

export const TARGETS: readonly BuildTarget[] = [
  { id: "linux-amd64", bunTarget: "bun-linux-x64", extension: "", nodeOs: "linux", nodeCpu: "x64" },
  { id: "linux-arm64", bunTarget: "bun-linux-arm64", extension: "", nodeOs: "linux", nodeCpu: "arm64" },
  { id: "darwin-amd64", bunTarget: "bun-darwin-x64", extension: "", nodeOs: "darwin", nodeCpu: "x64" },
  { id: "darwin-arm64", bunTarget: "bun-darwin-arm64", extension: "", nodeOs: "darwin", nodeCpu: "arm64" },
  { id: "windows-amd64", bunTarget: "bun-windows-x64", extension: ".exe", nodeOs: "win32", nodeCpu: "x64" },
  { id: "windows-arm64", bunTarget: "bun-windows-arm64", extension: ".exe", nodeOs: "win32", nodeCpu: "arm64" },
];

export function findTarget(id: string): BuildTarget {
  const target = TARGETS.find((candidate) => candidate.id === id);
  if (!target) {
    throw new Error(`Unknown target '${id}'. Expected one of: ${TARGETS.map((item) => item.id).join(", ")}`);
  }
  return target;
}

export function executableFilename(version: string, target: BuildTarget): string {
  return `timecalc-v${version}-${target.id}${target.extension}`;
}

export function isDarwin(target: BuildTarget): boolean {
  return target.nodeOs === "darwin";
}
