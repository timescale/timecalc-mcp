import { afterEach, describe, expect, test } from "bun:test";
import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

const INSTALLER = `${import.meta.dir}/../install.sh`;
const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true })));
});

describe("install.sh", () => {
  test("detects the platform, verifies the checksum, and installs the latest release", async () => {
    const fixture = await createFixture();
    const result = runInstaller(fixture);

    expect(result.exitCode).toBe(0);
    expect(result.stderr.toString()).toContain("is not on PATH");
    expect(result.stdout.toString()).toContain("Checksum verified");
    expect(result.stdout.toString()).toContain("Installing timecalc 9.9.9 (linux-amd64)");
    expect(result.stdout.toString()).toContain(`Installed timecalc to ${fixture.installDir}/timecalc`);

    const installed = join(fixture.installDir, "timecalc");
    const version = Bun.spawnSync({ cmd: [installed, "--version"] });
    expect(version.exitCode).toBe(0);
    expect(version.stdout.toString()).toBe("9.9.9\n");
  });

  test("does not install an archive with a mismatched checksum", async () => {
    const fixture = await createFixture("0".repeat(64));
    const result = runInstaller(fixture);

    expect(result.exitCode).not.toBe(0);
    expect(result.stderr.toString()).toContain("Checksum mismatch");
    expect(await Bun.file(join(fixture.installDir, "timecalc")).exists()).toBe(false);
  });
});

interface Fixture {
  root: string;
  fakeBin: string;
  releaseDir: string;
  installDir: string;
}

async function createFixture(checksumOverride?: string): Promise<Fixture> {
  const root = await mkdtemp(join(tmpdir(), "timecalc-installer-test-"));
  temporaryDirectories.push(root);
  const fakeBin = join(root, "bin");
  const releaseDir = join(root, "release");
  const archiveSource = join(root, "archive");
  const installDir = join(root, "install");
  await Promise.all([mkdir(fakeBin), mkdir(releaseDir), mkdir(archiveSource)]);

  const executable = join(archiveSource, "timecalc");
  await writeFile(executable, '#!/bin/sh\nprintf "9.9.9\\n"\n');
  await chmod(executable, 0o755);

  const archiveName = "timecalc-v9.9.9-linux-amd64.tar.gz";
  const archive = join(releaseDir, archiveName);
  const tar = Bun.spawnSync({
    cmd: ["tar", "-czf", archive, "-C", archiveSource, "timecalc"],
  });
  if (tar.exitCode !== 0) throw new Error(tar.stderr.toString());

  const hasher = new Bun.CryptoHasher("sha256");
  hasher.update(await Bun.file(archive).arrayBuffer());
  const checksum = checksumOverride ?? hasher.digest("hex");
  await writeFile(join(releaseDir, "SHA256SUMS"), `${checksum}  ${archiveName}\n`);

  await writeExecutable(join(fakeBin, "uname"), `#!/bin/sh
case "$1" in
  -s) printf 'Linux\\n' ;;
  -m) printf 'x86_64\\n' ;;
  *) exit 1 ;;
esac
`);
  await writeExecutable(join(fakeBin, "curl"), `#!/bin/sh
output=''
url=''
while [ "$#" -gt 0 ]; do
  case "$1" in
    -o) output="$2"; shift 2 ;;
    -w) shift 2 ;;
    -*) shift ;;
    *) url="$1"; shift ;;
  esac
done
case "$url" in
  */releases/latest)
    printf 'https://github.com/timescale/timecalc-mcp/releases/tag/v9.9.9'
    ;;
  */SHA256SUMS)
    cp "$FIXTURE_RELEASE_DIR/SHA256SUMS" "$output"
    ;;
  */timecalc-v9.9.9-linux-amd64.tar.gz)
    cp "$FIXTURE_RELEASE_DIR/timecalc-v9.9.9-linux-amd64.tar.gz" "$output"
    ;;
  *)
    printf 'unexpected URL: %s\\n' "$url" >&2
    exit 1
    ;;
esac
`);

  return { root, fakeBin, releaseDir, installDir };
}

function runInstaller(fixture: Fixture) {
  return Bun.spawnSync({
    cmd: ["sh", INSTALLER],
    env: {
      ...process.env,
      PATH: `${fixture.fakeBin}:${process.env.PATH}`,
      FIXTURE_RELEASE_DIR: fixture.releaseDir,
      TIMECALC_INSTALL_DIR: fixture.installDir,
    },
  });
}

async function writeExecutable(path: string, contents: string): Promise<void> {
  await writeFile(path, contents);
  await chmod(path, 0o755);
}
