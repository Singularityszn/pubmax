import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const folders: string[] = [];
const SHA = "b58546dfe18ce2834e576e8378bf99cb6c475e04";

function evidence(complete = true) {
  const folder = mkdtempSync(join(tmpdir(), "pubmax-cut-"));
  folders.push(folder);
  const json = (name: string, value: unknown) => writeFileSync(join(folder, name), JSON.stringify(value));
  json("api-version.json", { gitCommitSha: SHA, deploymentId: "fixture-deployment" });
  json("api-pint-drops.json", { drops: [] });
  json("api-out.json", { status: "ready", venueMatch: "ready", events: [
    { id: "matched", venueId: "venue-test-pub" },
    { id: "unmatched", startsAt: "2026-10-23T20:00:00Z" },
    { id: "place", venueId: "place:concert-hall" },
  ] });
  writeFileSync(join(folder, "observations.txt"), "Recorded browser assertions.");
  if (complete) json("browser-checks.json", { checks: Object.fromEntries(
    ["map", "pint", "tonight"].flatMap((bar) => ["desktop", "mobile"].map((device) => [
      `${bar}.${device}`, { passed: true, viewport: device === "desktop" ? [1280, 800] : [390, 844], evidence: ["observations.txt"] },
    ])),
  ) });
  return { folder, json };
}

function run(folder: string, sha = SHA) {
  const result = spawnSync("python3", [resolve("scripts/cut_check.py"), "--evidence-dir", folder, "--expected-sha", sha], { encoding: "utf8" });
  expect(result.stderr).toBe("");
  return { exit: result.status, body: JSON.parse(readFileSync(join(folder, "cut-check.json"), "utf8")) };
}

afterEach(() => { for (const folder of folders.splice(0)) rmSync(folder, { recursive: true }); });

describe("the recorded battle-test scorer", () => {
  it("counts only pub-matched rows, regardless of dated unmatched events", () => {
    const { folder } = evidence();
    const result = run(folder);
    expect(result.exit).toBe(0);
    expect(result.body.tonight).toMatchObject({ rawRows: 3, pubMatchedRows: 1 });
  });

  it("accepts a checked empty feed with complete browser proof", () => {
    const { folder, json } = evidence();
    json("api-out.json", { status: "ready", venueMatch: "ready", events: [] });
    expect(run(folder).body).toMatchObject({ overall: "PASS", tonight: { pubMatchedRows: 0 } });
  });

  it("marks absent browser proof unverified", () => {
    const { folder } = evidence(false);
    expect(run(folder)).toMatchObject({ exit: 1, body: { overall: "UNVERIFIED", bars: { map: "UNVERIFIED" } } });
  });

  it("refuses stale identity and unavailable pub matching", () => {
    const { folder, json } = evidence();
    json("api-out.json", { status: "ready", venueMatch: "unavailable", events: [] });
    expect(run(folder, "another-sha").body).toMatchObject({ identity: "FAIL", overall: "FAIL", bars: { tonight: "FAIL" } });
  });

  it("requires referenced evidence files to exist", () => {
    const { folder } = evidence();
    rmSync(join(folder, "observations.txt"));
    expect(run(folder).body.overall).toBe("UNVERIFIED");
  });
});
