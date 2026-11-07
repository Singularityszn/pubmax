// Scheduled cache refresh. Route requests consume only the checked-in snapshot;
// they never wait on a third-party weather request.

import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

import { isPullRequestPermissionError } from "./lib/pullRequestPermission.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUTPUT = join(ROOT, "public", "data", "weather", "latest.json");
const AREAS = {
  clapham: [51.462, -0.138], victoria: [51.496, -0.143], "piccadilly-soho": [51.511, -0.134],
  "canary-wharf": [51.505, -0.022], barnes: [51.474, -0.239], chiswick: [51.493, -0.255],
  shoreditch: [51.524, -0.079], camden: [51.539, -0.143], brixton: [51.461, -0.115],
  "bermondsey-london-bridge": [51.504, -0.082], "kings-cross": [51.531, -0.124], islington: [51.534, -0.104],
  dalston: [51.546, -0.075], peckham: [51.473, -0.069], greenwich: [51.482, -0.009],
  hammersmith: [51.492, -0.224], balham: [51.443, -0.152], marylebone: [51.522, -0.163],
  richmond: [51.461, -0.303], putney: [51.461, -0.216],
};

export function conditionForCode(code) {
  if ([0].includes(code)) return "Clear";
  if ([1, 2, 3].includes(code)) return "Cloudy";
  if ([45, 48].includes(code)) return "Fog";
  if ([51, 53, 55, 56, 57].includes(code)) return "Drizzle";
  if ([61, 63, 65, 66, 67, 80, 81, 82].includes(code)) return "Rain";
  if ([71, 73, 75, 77, 85, 86].includes(code)) return "Snow";
  if ([95, 96, 99].includes(code)) return "Thunderstorm";
  return `Weather code ${code}`;
}

/**
 * Review publication policy: docs/CI_RUNBOOK.md#scheduled-work-split.
 */
export const WEATHER_REVIEW_BRANCH = "weather-cache/latest";

function commandOutput(value) {
  if (Buffer.isBuffer(value)) return value.toString("utf8");
  return typeof value === "string" ? value : "";
}

/**
 * Commit the refreshed cache to the stable review branch, then open its review
 * PR or leave the open one to pick up the new commit. When the repository does
 * not let GITHUB_TOKEN open pull requests, the pushed branch is the handoff:
 * the run logs its URL as a warning and stays green. Any other failure still
 * fails the run.
 */
export function publishWeatherReview({
  stamp,
  env = process.env,
  rootDir = ROOT,
  outPath = OUTPUT,
  runCommand = execFileSync,
  log = console.log,
}) {
  const branch = WEATHER_REVIEW_BRANCH;
  const run = (command, args) =>
    runCommand(command, args, { cwd: rootDir, env: { ...process.env, ...env }, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  const relativePath = relative(rootDir, outPath);
  // Switching to the review branch replaces the tracked file with that branch's
  // older snapshot. Hold this run's bytes across the switch so they are staged.
  const refreshed = readFileSync(outPath);
  run("git", ["restore", "--worktree", "--source=HEAD", "--", relativePath]);
  let expectedRemote = "";
  if (commandOutput(run("git", ["ls-remote", "--heads", "origin", branch])).trim()) {
    run("git", ["fetch", "origin", branch]);
    expectedRemote = commandOutput(run("git", ["rev-parse", `origin/${branch}`])).trim();
    run("git", ["switch", "--force-create", branch, `origin/${branch}`]);
  } else {
    run("git", ["switch", "--create", branch]);
  }
  writeFileSync(outPath, refreshed);
  run("git", ["add", "--", relativePath]);
  try {
    run("git", ["diff", "--cached", "--quiet"]);
    log(`Weather review branch ${branch} already holds this snapshot; nothing pushed.`);
    return { status: "no-change", branch };
  } catch {
    // git diff --quiet exits 1 when the refresh staged a change.
  }
  run("git", ["commit", "-m", `chore(weather): refresh ${stamp}`]);
  run("git", ["push", "--set-upstream", `--force-with-lease=refs/heads/${branch}:${expectedRemote}`, "origin", branch]);

  try {
    const listed = commandOutput(
      run("gh", ["pr", "list", "--base", "main", "--head", branch, "--state", "open", "--json", "number,url", "--limit", "1"]),
    );
    const existing = JSON.parse(listed || "[]")[0];
    if (existing?.url) {
      log(`Updated the open weather review PR ${existing.url}.`);
      return { status: "updated", branch, pullRequestUrl: existing.url };
    }
    const created = commandOutput(
      run("gh", [
        "pr", "create", "--base", "main", "--head", branch,
        "--title", `Weather cache ${stamp}`,
        "--body", "Scheduled Open-Meteo cache refresh. The captain approved one reused weather-cache/latest branch with one PR as the route that lands the refresh on main through the required checks. Route generation remains third-party-free and consumes this snapshot only after merge. Each later run adds its refresh to this PR.",
      ]),
    );
    const pullRequestUrl = created.split(/\s+/).find((token) => /^https?:\/\//.test(token));
    return { status: "created", branch, ...(pullRequestUrl ? { pullRequestUrl } : {}) };
  } catch (error) {
    if (!isPullRequestPermissionError(error)) throw error;
    const server = String(env.GITHUB_SERVER_URL ?? "https://github.com").replace(/\/+$/, "");
    const repository = String(env.GITHUB_REPOSITORY ?? "Singularityszn/pubmax");
    const branchUrl = `${server}/${repository}/tree/${branch}`;
    log(`::warning::GitHub Actions may not open pull requests in this repository. The weather cache is on ${branchUrl}; open its PR by hand.`);
    return { status: "branch-only", branch, branchUrl };
  }
}

async function observation([nightArea, [lat, lng]]) {
  const url = new URL("https://api.open-meteo.com/v1/forecast");
  url.search = new URLSearchParams({
    latitude: String(lat),
    longitude: String(lng),
    current: "apparent_temperature,weather_code,wind_speed_10m",
    hourly: "precipitation_probability",
    forecast_hours: "1",
    timezone: "UTC",
  }).toString();
  const response = await fetch(url, { headers: { accept: "application/json", "user-agent": "PUBMAXX-weather-cache/1" } });
  if (!response.ok) throw new Error(`${nightArea}: Open-Meteo returned ${response.status}`);
  const body = await response.json();
  const observedAt = typeof body?.current?.time === "string" ? new Date(`${body.current.time}Z`) : new Date(Number.NaN);
  const feelsLikeC = body?.current?.apparent_temperature;
  const weatherCode = body?.current?.weather_code;
  const windKph = body?.current?.wind_speed_10m;
  const precipitationProbabilityPct = body?.hourly?.precipitation_probability?.[0];
  if (![observedAt.getTime(), feelsLikeC, weatherCode, windKph, precipitationProbabilityPct].every(Number.isFinite)) {
    throw new Error(`${nightArea}: Open-Meteo response did not satisfy the cache contract`);
  }
  return {
    nightArea,
    observedAt: observedAt.toISOString(),
    expiresAt: new Date(observedAt.getTime() + 12 * 60 * 60_000).toISOString(),
    condition: conditionForCode(weatherCode),
    feelsLikeC,
    precipitationProbabilityPct,
    windKph,
    source: {
      sourceUrl: url.toString(),
      publisher: "Open-Meteo",
      publishedAt: observedAt.toISOString(),
    },
  };
}

async function main() {
  const observations = await Promise.all(Object.entries(AREAS).map(observation));
  const snapshot = { version: 1, generatedAt: new Date().toISOString(), observations };
  let current = null;
  try { current = JSON.parse(readFileSync(OUTPUT, "utf8")); } catch { /* replace missing or malformed cache */ }
  if (JSON.stringify(current?.observations) === JSON.stringify(observations)) {
    console.log("Weather observations unchanged; snapshot and PR skipped.");
    return;
  }
  mkdirSync(dirname(OUTPUT), { recursive: true });
  writeFileSync(OUTPUT, `${JSON.stringify(snapshot, null, 2)}\n`);
  console.log(`Wrote ${observations.length} cached weather observations.`);
  if (!process.argv.includes("--open-pr")) return;
  publishWeatherReview({ stamp: new Date().toISOString().slice(0, 10).replaceAll("-", "") });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main();
