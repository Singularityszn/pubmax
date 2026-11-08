// Every tool download in a required workflow retries (Firstmate decision,
// 8 Nov 2026). Security CI and RLS session tests are required checks, and a
// GitHub release asset that answered 504 once removed two green pull requests
// from the merge queue. A download retry is not a test retry: the checksum
// still checks the bytes, and a test that passes only on retry still fails its
// gate (scripts/assert-playwright-gate.mjs).
//
// Each install step runs under bash with `curl` and `sudo` replaced by
// recorders, so the test reads the arguments the step really passes.

import { spawnSync } from "node:child_process";
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, describe, expect, it } from "vitest";
import { parse } from "yaml";

type Step = { name?: string; run?: string };
type Workflow = { jobs: Record<string, { steps?: Step[] }> };

const ROOT = process.cwd();
const REQUIRED_WORKFLOWS = ["ci.yml", "e2e.yml", "rls-session.yml", "security-ci.yml", "freshness.yml"];

const scratch = mkdtempSync(join(tmpdir(), "ci-download-retries-"));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

function recorder(name: string, log: string, exitCode: number): string {
  const bin = mkdtempSync(join(scratch, `${name}-`));
  const path = join(bin, name);
  writeFileSync(path, `#!/bin/sh\nprintf '%s\\0' "$@" >> "${log}"\nprintf '\\n' >> "${log}"\nexit ${exitCode}\n`);
  chmodSync(path, 0o755);
  return bin;
}

type Calls = { curl: string[][]; sudo: string[][] };

/** Run one step's script until its first download, recording curl and sudo calls. */
function runStep(run: string): Calls {
  const curlLog = join(mkdtempSync(join(scratch, "log-")), "curl.log");
  const sudoLog = join(mkdtempSync(join(scratch, "log-")), "sudo.log");
  writeFileSync(curlLog, "");
  writeFileSync(sudoLog, "");
  // curl fails, so `set -e` stops the step before its checksum and install.
  const curlBin = recorder("curl", curlLog, 22);
  const sudoBin = recorder("sudo", sudoLog, 0);
  spawnSync("bash", ["-c", run], {
    encoding: "utf8",
    env: {
      ...process.env,
      PATH: `${curlBin}:${sudoBin}:${process.env.PATH}`,
      RUNNER_TEMP: mkdtempSync(join(scratch, "runner-")),
      GITHUB_PATH: join(scratch, "github-path"),
    },
  });
  const read = (log: string) =>
    readFileSync(log, "utf8")
      .split("\n")
      .filter(Boolean)
      .map((line) => line.split("\0").filter(Boolean));
  return { curl: read(curlLog), sudo: read(sudoLog) };
}

const downloadSteps = REQUIRED_WORKFLOWS.flatMap((file) => {
  const { jobs } = parse(readFileSync(join(ROOT, ".github/workflows", file), "utf8")) as Workflow;
  return Object.entries(jobs).flatMap(([job, { steps = [] }]) =>
    steps
      .filter((step) => /\b(curl|apt-get)\b/.test(step.run ?? ""))
      .map((step) => ({ file, where: `${file} / ${job} / ${step.name}`, calls: runStep(step.run ?? "") })),
  );
});

describe("tool downloads in the required workflows", () => {
  it.each(["security-ci.yml", "rls-session.yml"])("records a curl download in %s", (file) => {
    const curlCalls = downloadSteps.filter((step) => step.file === file).flatMap(({ calls }) => calls.curl);
    expect(curlCalls.length).toBeGreaterThan(0);
  });

  it.each(downloadSteps.map((entry) => [entry.where, entry] as const))(
    "%s retries a failed or timed-out download",
    (_where, { calls }) => {
      for (const args of calls.curl) {
        expect(args).toEqual(expect.arrayContaining(["--fail", "--retry-all-errors"]));
        expect(Number(args[args.indexOf("--retry") + 1])).toBe(5);
        expect(Number(args[args.indexOf("--connect-timeout") + 1])).toBeGreaterThan(0);
        expect(args.some((arg) => arg.startsWith("https://github.com/"))).toBe(true);
      }
      for (const args of calls.sudo.filter((call) => call[0] === "apt-get")) {
        expect(args.slice(0, 3)).toEqual(["apt-get", "-o", "Acquire::Retries=5"]);
      }
    },
  );

  it("installs PostgreSQL through apt-get with retries before PostgREST", () => {
    const aptCalls = downloadSteps
      .filter(({ file }) => file === "rls-session.yml")
      .flatMap(({ calls }) => calls.sudo)
      .filter((args) => args[0] === "apt-get");
    expect(aptCalls.map((args) => args.filter((arg) => !arg.startsWith("-") && !arg.includes("=")))).toEqual([
      ["apt-get", "update"],
      ["apt-get", "install", "postgresql-16"],
    ]);
  });
});
