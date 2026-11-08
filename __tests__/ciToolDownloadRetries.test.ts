// Every tool download in a required workflow survives a GitHub release outage
// (Firstmate decisions, 8 Nov 2026). Security CI and RLS session tests are
// required checks. GitHub release assets answered 504 to hosted runners for
// most of an hour, and the merge queue removed green pull requests because
// those summaries went red. A download retry is not a test retry: the checksum
// still checks the bytes, and a test that passes only on retry still fails its
// gate (scripts/assert-playwright-gate.mjs).
//
// PostgREST and the Security CI tools use scripts/ci/install-pinned-tool.sh: the
// cached release download, else the release download with a long retry
// window, else a verified source that is not a GitHub release. The script runs
// here for real, with curl, python3, go, docker and sudo replaced by recorders.

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, describe, expect, it } from "vitest";
import { parse } from "yaml";

type Step = { name?: string; run?: string; uses?: string; env?: Record<string, string>; with?: Record<string, string> };
type Workflow = { jobs: Record<string, { steps?: Step[] }> };

const ROOT = process.cwd();
const INSTALLER = join(ROOT, "scripts/ci/install-pinned-tool.sh");
const REQUIRED_WORKFLOWS = ["ci.yml", "e2e.yml", "rls-session.yml", "security-ci.yml", "freshness.yml"];

const scratch = mkdtempSync(join(tmpdir(), "ci-tool-install-"));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

function dir(name: string): string {
  return mkdtempSync(join(scratch, `${name}-`));
}

function script(path: string, body: string): void {
  writeFileSync(path, `#!/bin/sh\n${body}\n`);
  chmodSync(path, 0o755);
}

const hostBin = dir("host-bin");
for (const tool of [
  "bash", "sh", "tar", "gzip", "xz", "sha256sum", "awk", "install", "mktemp", "find", "sort", "grep",
  "cp", "mv", "rm", "mkdir", "chmod", "cat", "printf", "dirname", "tail", "env",
]) {
  const resolved = spawnSync("bash", ["--noprofile", "--norc", "-c", 'enable -n printf; command -v "$1"', "resolve-tool", tool], { encoding: "utf8" });
  if (resolved.status !== 0 || !resolved.stdout.trim().startsWith("/")) throw new Error(`Missing host tool: ${tool}`);
  symlinkSync(resolved.stdout.trim(), join(hostBin, tool));
}

function readCalls(log: string): string[][] {
  if (!existsSync(log)) return [];
  return readFileSync(log, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((line) => line.split("\0").filter(Boolean));
}

const RECORD = (log: string) => `printf '%s\\0' "$@" >> "${log}"; printf '\\n' >> "${log}"`;

function workflow(file: string): Workflow {
  return parse(readFileSync(join(ROOT, ".github/workflows", file), "utf8")) as Workflow;
}

function commands(step: Step): string[] {
  return (step.run ?? "")
    .replace(/\\\n/g, " ")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"));
}

describe("the required workflows", () => {
  const installerSteps = ["security-ci.yml", "rls-session.yml"].flatMap((file) =>
    Object.values(workflow(file).jobs).flatMap(({ steps = [] }) =>
      steps.flatMap((step, index) =>
        commands(step).some((line) => line.split(/\s+/)[0] === "scripts/ci/install-pinned-tool.sh")
          ? [{ file, step, before: steps[index - 1] }] : [],
      ),
    ),
  );

  it.each(["security-ci.yml", "rls-session.yml"])("covers active installer commands in %s", (file) => {
    expect(installerSteps.some((entry) => entry.file === file)).toBe(true);
  });

  it.each(installerSteps.map((entry) => [entry.step.env?.TOOL_NAME, entry] as const))(
    "%s retries its release download and never caches fallback output",
    (_tool, { step, before }) => {
      const env = step.env ?? {};
      expect(before?.uses).toMatch(/^actions\/cache@[0-9a-f]{40}$/);
      const cachePath = defined(before?.with?.path);
      expect(cachePath).toBe(`~/.cache/pubmax-tools/${env.TOOL_NAME}-${env.TOOL_VERSION}-${env.TOOL_SHA256}`);
      expect(before?.with?.key).toContain(env.TOOL_VERSION);
      expect(before?.with?.key).toContain(env.TOOL_SHA256);
      expect(env.TOOL_SHA256).toMatch(/^[0-9a-f]{64}$/);
      expect(env.TOOL_URL).toMatch(/^https:\/\/github\.com\/.+\/releases\/download\//);
      expect(env.TOOL_URL).toContain(env.TOOL_VERSION);
      if (env.TOOL_FALLBACK === "pip") {
        expect(env.TOOL_PIP_REQUIREMENT).toMatch(new RegExp(`==${env.TOOL_VERSION} --hash=sha256:[0-9a-f]{64}$`));
      } else if (env.TOOL_FALLBACK === "docker") {
        expect(env.TOOL_IMAGE).toBe("postgrest/postgrest@sha256:bea1c76a856fa39d1e542d25911cf95d02fe2bf971992d033044ff209f1504b8");
        expect(env.TOOL_IMAGE_PATH).toBe("/bin/postgrest");
        expect(env.TOOL_BINARY_SHA256).toBe("9d363ab48d45a2d02d8ab82f8e9c6b541eca87c86be76bad5a3ff090ae03f3cc");
      } else {
        expect(env.TOOL_FALLBACK).toBe("go");
        expect(env.TOOL_GO_MODULE).toMatch(new RegExp(`@v${env.TOOL_VERSION}$`));
      }
      const cache = dir("cache");
      const run = install({
        sha256: defined(env.TOOL_SHA256),
        fallback: env.TOOL_FALLBACK as "pip" | "go" | "docker",
        cache,
        step,
      });
      if (env.TOOL_FALLBACK === "docker") {
        // The fixture must fail the real workflow's binary pin.
        expect(run.status).not.toBe(0);
        expect(run.stderr).toContain("binary checksum mismatch");
        expect(run.installed).toBe("");
        expectDockerSource(run.docker, defined(env.TOOL_IMAGE));
      } else {
        expect(run.status, run.stderr).toBe(0);
        expect(run.installed).not.toBe("");
      }
      expect(run.curl.length).toBeGreaterThan(0);
      for (const args of run.curl) {
        expectRetryWindow(args);
        expect(args.at(-1)).toBe(env.TOOL_URL);
      }
      expect(existsSync(join(cache, cachePath.slice("~/.cache/pubmax-tools/".length)))).toBe(false);
    },
  );

  // A download that is still a plain curl in a step retries over a window.
  const curlSteps = REQUIRED_WORKFLOWS.flatMap((file) =>
    Object.values(workflow(file).jobs).flatMap(({ steps = [] }) =>
      steps.filter((step) => commands(step).some((line) => /\b(curl|apt-get)\b/.test(line))).map((step) => ({ file, step })),
    ),
  );

  it("records the PostgreSQL package downloads in RLS session tests", () => {
    expect(curlSteps.map(({ file }) => file)).toContain("rls-session.yml");
  });

  it.each(curlSteps.map((entry) => [`${entry.file} / ${entry.step.name}`, entry] as const))(
    "%s retries every download",
    (_where, { step }) => {
      const curlLog = join(dir("log"), "curl.log");
      const sudoLog = join(dir("log"), "sudo.log");
      const bin = dir("bin");
      script(join(bin, "curl"), `${RECORD(curlLog)}\nexit 22`);
      script(join(bin, "sudo"), RECORD(sudoLog));
      for (const tool of ["initdb", "postgres", "psql"]) script(join(bin, tool), "exit 0");
      spawnSync("bash", ["-c", step.run ?? ""], {
        env: { NODE_ENV: "test", PATH: `${bin}:${hostBin}`, RUNNER_TEMP: dir("runner"), GITHUB_PATH: join(scratch, "path") },
      });
      const curls = readCalls(curlLog);
      for (const args of curls) expectRetryWindow(args);
      const apt = readCalls(sudoLog).filter((args) => args[0] === "apt-get");
      expect(apt.length).toBeGreaterThan(0);
      for (const args of apt) expect(args.slice(0, 3)).toEqual(["apt-get", "-o", "Acquire::Retries=5"]);
    },
  );
});

function expectRetryWindow(args: string[]): void {
  const value = (flag: string) => Number(args[args.indexOf(flag) + 1]);
  expect(args).toEqual(expect.arrayContaining(["--fail", "--retry-all-errors"]));
  expect(value("--retry")).toBeGreaterThanOrEqual(5);
  // Five quick retries covered about 30 seconds and lost to a longer outage.
  expect(value("--retry-max-time")).toBeGreaterThanOrEqual(300);
  expect(value("--connect-timeout")).toBeGreaterThan(0);
}

/** A compressed release archive holding a tool that prints its version. */
function releaseAsset(tool: string, version: string, archive = "tar.gz"): { path: string; sha256: string } {
  const src = dir("asset-src");
  script(join(src, tool), `echo "${tool} ${version} (release)"`);
  const path = join(dir("asset"), `${tool}.${archive}`);
  const tar = spawnSync("tar", [archive === "tar.xz" ? "-cJf" : "-czf", path, "-C", src, tool]);
  expect(tar.status).toBe(0);
  return { path, sha256: createHash("sha256").update(readFileSync(path)).digest("hex") };
}

type Run = { status: number | null; stdout: string; stderr: string; curl: string[][]; pip: string[][]; go: string[][]; docker: string[][]; installed: string };

const DOCKER_BINARY = '#!/bin/sh\necho "postgrest 14.16 (docker)"\n';
const DOCKER_SHA256 = createHash("sha256").update(DOCKER_BINARY).digest("hex");
const DOCKER_IMAGE = `postgrest/postgrest@sha256:${"b".repeat(64)}`;

function expectDockerSource(calls: string[][], image: string): void {
  expect(calls).toEqual([
    ["pull", "--platform", "linux/amd64", image],
    ["create", "--platform", "linux/amd64", image],
    ["cp", "fixture-container:/bin/postgrest", expect.any(String)],
    ["rm", "fixture-container"],
  ]);
}

function install(options: {
  tool?: string;
  version?: string;
  sha256: string;
  serve?: string;
  fallback: "pip" | "go" | "docker";
  cache: string;
  archive?: "tar.gz" | "tar.xz";
  binarySha256?: string;
  goVersion?: string;
  goOnPath?: boolean;
  step?: Step;
}): Run {
  const tool = options.step?.env?.TOOL_NAME ?? options.tool ?? "zizmor";
  const version = options.step?.env?.TOOL_VERSION ?? options.version ?? "1.30.1";
  const bin = dir("bin");
  const logs = dir("logs");
  const curlLog = join(logs, "curl");
  const pipLog = join(logs, "pip");
  const goLog = join(logs, "go");
  const dockerLog = join(logs, "docker");
  const target = bin;
  const toolCache = dir("toolcache");
  // curl copies the served asset to --output, or fails like a 504.
  script(
    join(bin, "curl"),
    `${RECORD(curlLog)}\n${
      options.serve
        ? `while [ $# -gt 0 ]; do if [ "$1" = --output ]; then cp "${options.serve}" "$2"; fi; shift; done; exit 0`
        : "exit 22"
    }`,
  );
  // python3 -m venv DIR makes a pip that records its arguments and the
  // requirements file, then provides the tool.
  script(
    join(bin, "python3"),
    `mkdir -p "$3/bin"
cat > "$3/bin/pip" <<'PIP'
#!/bin/sh
printf '%s\\0' "$@" >> "${pipLog}"; printf '\\n' >> "${pipLog}"
while [ $# -gt 0 ]; do if [ "$1" = --requirement ]; then printf 'REQ\\0%s\\n' "$(cat "$2")" >> "${pipLog}"; fi; shift; done
dir=$(dirname "$0")
printf '#!/bin/sh\\necho "${tool} ${version} (pip)"\\n' > "$dir/${tool}"; chmod +x "$dir/${tool}"
PIP
chmod +x "$3/bin/pip"`,
  );
  const goScript = `if [ "$1" = install ]; then
  ${RECORD(goLog)}
  printf 'ENV\\0%s\\0%s\\0%s\\0%s\\n' "GOPROXY=$GOPROXY" "GOSUMDB=$GOSUMDB" "GOTOOLCHAIN=$GOTOOLCHAIN" "GOFLAGS=$GOFLAGS" >> "${goLog}"
  mkdir -p "$GOBIN"; printf '#!/bin/sh\\necho "${tool} (go)"\\n' > "$GOBIN/${tool}"; chmod +x "$GOBIN/${tool}"
elif [ "$1" = version ]; then
  printf '%s: go1.27.0\\n\\tpath\\tthe/cmd\\n\\tmod\\tthe/module\\t${options.goVersion ?? `v${version}`}\\th1:abc=\\n' "$3"
fi`;
  if (options.goOnPath === false) {
    const goBin = join(toolCache, "go", "1.26.10", "x64", "bin");
    mkdirSync(goBin, { recursive: true });
    script(join(goBin, "go"), goScript);
  } else {
    script(join(bin, "go"), goScript);
  }
  script(join(bin, "sudo"), `"$@"`);
  const dockerBinary = join(dir("docker"), "postgrest");
  writeFileSync(dockerBinary, DOCKER_BINARY);
  script(join(bin, "docker"), `${RECORD(dockerLog)}
case "$1" in
  create) echo fixture-container ;;
  cp) cp "${dockerBinary}" "$3" ;;
esac`);
  const result = spawnSync("bash", ["-e", "-o", "pipefail", "-c", options.step?.run ?? `bash "${INSTALLER}"`], {
    encoding: "utf8",
    cwd: ROOT,
    env: {
      NODE_ENV: "test",
      PATH: `${bin}:${hostBin}`,
      HOME: dir("home"),
      TOOL_NAME: tool,
      TOOL_VERSION: version,
      TOOL_URL: `https://github.com/example/${tool}/releases/download/v${version}/${tool}.tar.gz`,
      TOOL_SHA256: options.sha256,
      TOOL_ARCHIVE: options.archive ?? "tar.gz",
      TOOL_FALLBACK: options.fallback,
      TOOL_PIP_REQUIREMENT: `${tool}==${version} --hash=sha256:${"e".repeat(64)}`,
      TOOL_GO_MODULE: `the/module/cmd/${tool}@v${version}`,
      TOOL_IMAGE: DOCKER_IMAGE,
      TOOL_IMAGE_PATH: "/bin/postgrest",
      TOOL_BINARY_SHA256: options.binarySha256 ?? DOCKER_SHA256,
      ...options.step?.env,
      PUBMAX_TOOL_CACHE: options.cache,
      PUBMAX_TOOL_BIN: target,
      RUNNER_TOOL_CACHE: toolCache,
    },
  });
  const binary = join(target, tool);
  const installed = existsSync(binary) ? spawnSync(binary, { encoding: "utf8" }).stdout.trim() : "";
  return {
    status: result.status,
    stdout: result.stdout,
    stderr: result.stderr,
    curl: readCalls(curlLog),
    pip: readCalls(pipLog),
    go: readCalls(goLog),
    docker: readCalls(dockerLog),
    installed,
  };
}

describe("scripts/ci/install-pinned-tool.sh", () => {
  it("installs and reuses a checksum-matched tar.xz release", () => {
    const asset = releaseAsset("postgrest", "14.16", "tar.xz");
    const cache = dir("cache");
    const options = { tool: "postgrest", version: "14.16", sha256: asset.sha256, archive: "tar.xz", fallback: "docker", cache } as const;
    const run = install({ ...options, serve: asset.path });
    expect(run.status, run.stderr).toBe(0);
    expect(run.installed).toBe("postgrest 14.16 (release)");
    expect(run.docker).toEqual([]);
    const again = install(options);
    expect(again.status, again.stderr).toBe(0);
    expect(again.installed).toBe("postgrest 14.16 (release)");
    expect(again.curl).toEqual([]);
    expect(again.docker).toEqual([]);
  });

  it("installs a checksum-matched Docker binary without caching it", () => {
    const cache = dir("cache");
    const run = install({ tool: "postgrest", version: "14.16", sha256: "a".repeat(64), fallback: "docker", cache });
    expect(run.status, run.stderr).toBe(0);
    expect(run.installed).toBe("postgrest 14.16 (docker)");
    expectDockerSource(run.docker, DOCKER_IMAGE);
    expect(existsSync(join(cache, `postgrest-14.16-${"a".repeat(64)}`))).toBe(false);
  });

  it("refuses a Docker binary with a different checksum", () => {
    const run = install({ tool: "postgrest", version: "14.16", sha256: "a".repeat(64), fallback: "docker", binarySha256: "0".repeat(64), cache: dir("cache") });
    expect(run.status).not.toBe(0);
    expect(run.installed).toBe("");
    expect(run.stderr).toContain("binary checksum mismatch");
    expectDockerSource(run.docker, DOCKER_IMAGE);
  });

  it("installs the release download when it matches the pin, retrying over a window, and caches it", () => {
    const asset = releaseAsset("zizmor", "1.30.1");
    const cache = dir("cache");
    const run = install({ sha256: asset.sha256, serve: asset.path, fallback: "pip", cache });
    expect(run.status, run.stderr).toBe(0);
    expect(run.installed).toBe("zizmor 1.30.1 (release)");
    expect(run.curl).toHaveLength(1);
    expectRetryWindow(defined(run.curl[0]));
    expect(run.pip).toEqual([]);

    // The next run finds the verified download in the cache and asks no one.
    const again = install({ sha256: asset.sha256, fallback: "pip", cache });
    expect(again.status, again.stderr).toBe(0);
    expect(again.installed).toBe("zizmor 1.30.1 (release)");
    expect(again.curl).toEqual([]);
    expect(again.stdout).toContain("from the cache source");
  });

  it("discards a cached download that no longer matches the pin", () => {
    const asset = releaseAsset("zizmor", "1.30.1");
    const cache = dir("cache");
    writeFileSync(join(cache, `zizmor-1.30.1-${asset.sha256}`), "tampered");
    const run = install({ sha256: asset.sha256, serve: asset.path, fallback: "pip", cache });
    expect(run.status, run.stderr).toBe(0);
    expect(run.curl).toHaveLength(1);
    expect(run.installed).toBe("zizmor 1.30.1 (release)");
  });

  it("never installs a release download that does not match the pin", () => {
    const asset = releaseAsset("zizmor", "1.30.1");
    const run = install({ sha256: "0".repeat(64), serve: asset.path, fallback: "pip", cache: dir("cache") });
    expect(run.status, run.stderr).toBe(0);
    expect(run.installed).toBe("zizmor 1.30.1 (pip)");
  });

  it("installs zizmor from a hash-pinned wheel when GitHub releases fail", () => {
    const run = install({ sha256: "a".repeat(64), fallback: "pip", cache: dir("cache") });
    expect(run.status, run.stderr).toBe(0);
    expect(run.installed).toBe("zizmor 1.30.1 (pip)");
    expect(run.stdout).toContain("::warning::zizmor 1.30.1");
    const [args, requirement] = run.pip;
    expect(args).toEqual(expect.arrayContaining(["install", "--require-hashes", "--no-deps", "--only-binary=:all:"]));
    expect(requirement).toEqual(["REQ", `zizmor==1.30.1 --hash=sha256:${"e".repeat(64)}`]);
  });

  it("builds a Go tool through the module proxy and checksum database when GitHub releases fail", () => {
    const run = install({ tool: "gitleaks", version: "8.30.0", sha256: "a".repeat(64), fallback: "go", cache: dir("cache") });
    expect(run.status, run.stderr).toBe(0);
    expect(run.installed).toBe("gitleaks (go)");
    expect(run.go[0]).toEqual(["install", "the/module/cmd/gitleaks@v8.30.0"]);
    expect(run.go[1]).toEqual([
      "ENV",
      "GOPROXY=https://proxy.golang.org",
      "GOSUMDB=sum.golang.org",
      "GOTOOLCHAIN=auto",
      "GOFLAGS=-mod=mod",
    ]);
  });

  it("refuses a Go build that was not made from the pinned version", () => {
    const run = install({ tool: "osv-scanner", version: "2.6.0", sha256: "a".repeat(64), fallback: "go", goVersion: "v2.5.9", cache: dir("cache") });
    expect(run.status).not.toBe(0);
    expect(run.installed).toBe("");
    expect(run.stderr).toContain("was not built from v2.6.0");
  });

  it("finds Go in the runner tool cache when it is not on PATH", () => {
    const run = install({ tool: "osv-scanner", version: "2.6.0", sha256: "a".repeat(64), fallback: "go", goOnPath: false, cache: dir("cache") });
    expect(run.status, run.stderr).toBe(0);
    expect(run.installed).toBe("osv-scanner (go)");
  });
});

function defined<T>(value: T | undefined): T {
  if (value === undefined) throw new Error("expected a value");
  return value;
}
