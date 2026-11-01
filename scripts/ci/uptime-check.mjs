// IS PRODUCTION UP? ASKED EVERY FIVE MINUTES, AND ASKED TWICE BEFORE THE ANSWER IS NO.
//
// `.github/workflows/uptime.yml` runs this on a schedule. It reads two public
// routes on the canonical origin, which `lib/siteUrlConfig.mjs` owns, so the
// monitor and the app can never name two different sites:
//
//   /api/health   200 with `ok: true` and `database: "ok"`. The deployment
//                 answered AND its database answered (app/api/health/route.ts).
//                 A 503 there is a database the deployment cannot reach.
//   /api/version  200 with `ok: true`. The deployment answered from memory, so
//                 a failed health beside a good version points at the database,
//                 and two failures point at the site itself.
//
// A probe that fails is asked once more after UPTIME_RETRY_DELAY_MS, which is
// longer than the 15 seconds the health route holds its answer, so the second
// ask is a fresh read. A probe that fails BOTH times is DOWN, and a DOWN probe
// exits 1. That fails the scheduled run, and
// `.github/workflows/alert-on-failure.yml` posts a failed scheduled run to the
// alert webhook. A probe that failed once and then answered is a FLAP: it
// prints a warning and the run stays green, because one dropped request is
// not an outage and an alert nobody can act on teaches people to mute alerts.
//
// THREE THINGS IT NEVER DOES. It sends no credential and reads none. It never
// prints a response body, only the status, the time taken and the fields it
// judged. And it never prints a value it read from the network unless that
// value matches a narrow pattern, because a GitHub log line that starts with
// `::` is a workflow command and a response is somebody else's string.
//
// Pin: __tests__/uptimeMonitor.test.ts. Runbook: docs/SOFT_LAUNCH_RUNBOOK.md
// section 8.

import { fileURLToPath } from "node:url";

import { PRODUCTION_SITE_ORIGIN } from "../../lib/siteUrlConfig.mjs";

/** Wait between the first ask and the second. The health route holds an answer for 15 s. */
export const UPTIME_RETRY_DELAY_MS = 30_000;

/** How long one ask may take, body included. The health route gives its database 4 s. */
export const UPTIME_REQUEST_TIMEOUT_MS = 15_000;

/** Names the monitor in the Vercel request log, so its traffic is easy to tell apart. */
export const UPTIME_USER_AGENT = "pubmaxx-uptime-check (+https://github.com/Singularityszn/pubmax)";

const DEPLOYMENT_ID = /^[A-Za-z0-9_-]{1,64}$/;
const MITIGATION = /^[a-z-]{1,20}$/;
const ERROR_CODE = /^[A-Z][A-Z0-9_]{1,40}$/;

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** The two routes, and what a good answer from each one says. */
export const UPTIME_PROBES = Object.freeze([
  Object.freeze({
    path: "/api/health",
    judge(body) {
      if (!isRecord(body) || body.ok !== true) return "the body did not say ok";
      if (body.database !== "ok") return "the body did not say the database is ok";
      return null;
    },
  }),
  Object.freeze({
    path: "/api/version",
    judge(body) {
      if (!isRecord(body) || body.ok !== true) return "the body did not say ok";
      return null;
    },
  }),
]);

function safeDeploymentId(value) {
  return typeof value === "string" && DEPLOYMENT_ID.test(value) ? value : null;
}

function seconds(ms) {
  return `${Math.round(ms / 1000)} s`;
}

function isTimeout(error) {
  return isRecord(error) && (error.name === "TimeoutError" || error.name === "AbortError");
}

function describeFetchError(error, timeoutMs) {
  if (isTimeout(error)) return `no answer within ${seconds(timeoutMs)}`;
  const code = isRecord(error) && isRecord(error.cause) ? error.cause.code : undefined;
  if (typeof code === "string" && ERROR_CODE.test(code)) return `the request failed (${code})`;
  return "the request failed";
}

async function discardBody(response) {
  try {
    await response.body?.cancel();
  } catch {
    // A body that cannot be cancelled is already closed.
  }
}

/** Ask one route once. Never throws. */
export async function probeOnce(probe, { origin, fetchImpl, timeoutMs, now }) {
  const url = new URL(probe.path, origin).toString();
  const started = now();
  const result = (fields) => ({ path: probe.path, ms: Math.max(0, now() - started), ...fields });

  let response;
  try {
    response = await fetchImpl(url, {
      method: "GET",
      // A redirect is an answer about some other place. /api is never
      // canonicalised (proxy.ts), so a redirect here is a fault, not a hop.
      redirect: "manual",
      headers: {
        accept: "application/json",
        "cache-control": "no-cache",
        "user-agent": UPTIME_USER_AGENT,
      },
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    return result({ up: false, status: null, reason: describeFetchError(error, timeoutMs) });
  }

  if (response.status !== 200) {
    const mitigated = response.headers.get("x-vercel-mitigated");
    await discardBody(response);
    const firewall = mitigated && MITIGATION.test(mitigated) ? `, Vercel firewall ${mitigated}` : "";
    return result({ up: false, status: response.status, reason: `answered ${response.status}${firewall}` });
  }

  let body;
  try {
    body = await response.json();
  } catch (error) {
    const reason = isTimeout(error)
      ? `no whole answer within ${seconds(timeoutMs)}`
      : "answered 200 with a body that is not JSON";
    return result({ up: false, status: 200, reason });
  }

  const problem = probe.judge(body);
  if (problem) return result({ up: false, status: 200, reason: `answered 200, but ${problem}` });
  return result({
    up: true,
    status: 200,
    deploymentId: isRecord(body) ? safeDeploymentId(body.deploymentId) : null,
  });
}

function defaultSleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Ask every route, then ask a failed route once more. Each entry is one route
 * with its first answer and, only when the first one failed, its second.
 */
export async function checkUptime({
  origin = PRODUCTION_SITE_ORIGIN,
  fetchImpl = globalThis.fetch,
  sleep = defaultSleep,
  retryDelayMs = UPTIME_RETRY_DELAY_MS,
  timeoutMs = UPTIME_REQUEST_TIMEOUT_MS,
  now = Date.now,
} = {}) {
  const ask = (probe) => probeOnce(probe, { origin, fetchImpl, timeoutMs, now });
  const first = await Promise.all(UPTIME_PROBES.map(ask));
  const entries = UPTIME_PROBES.map((probe, index) => ({ probe, first: first[index], retry: null }));
  const failed = entries.filter((entry) => !entry.first.up);
  if (failed.length > 0) {
    await sleep(retryDelayMs);
    const retried = await Promise.all(failed.map((entry) => ask(entry.probe)));
    failed.forEach((entry, index) => {
      entry.retry = retried[index];
    });
  }
  return entries.map(({ first: firstAnswer, retry }) => ({
    path: firstAnswer.path,
    first: firstAnswer,
    retry,
    state: firstAnswer.up ? "up" : retry?.up ? "flap" : "down",
  }));
}

/** GitHub workflow command escaping for a message. */
function commandText(text) {
  return text.replace(/%/g, "%25").replace(/\r/g, "%0D").replace(/\n/g, "%0A");
}

function upLine(path, answer) {
  const deployment = answer.deploymentId ? `, deployment ${answer.deploymentId}` : "";
  return `UP ${path}: 200 in ${answer.ms} ms${deployment}.`;
}

/** The lines a run prints, and the exit code it ends with. */
export function reportUptime(entries, { origin = PRODUCTION_SITE_ORIGIN, retryDelayMs = UPTIME_RETRY_DELAY_MS } = {}) {
  const lines = [`Checking ${origin}.`];
  for (const entry of entries) {
    if (entry.state === "up") {
      lines.push(upLine(entry.path, entry.first));
    } else if (entry.state === "flap") {
      lines.push(upLine(entry.path, entry.retry));
      lines.push(
        `::warning title=Production answered on the retry::${commandText(
          `${entry.path} failed once (${entry.first.reason}), then answered 200 ${seconds(retryDelayMs)} later. One failure is not an outage.`,
        )}`,
      );
    } else {
      lines.push(
        `::error title=Production is down::${commandText(
          `${entry.path} failed twice, ${seconds(retryDelayMs)} apart: ${entry.first.reason}, then ${entry.retry?.reason ?? "no second answer"}.`,
        )}`,
      );
    }
  }

  const down = entries.filter((entry) => entry.state === "down").map((entry) => entry.path);
  if (down.length === 0) {
    lines.push("Production is up.");
    return { lines, exitCode: 0 };
  }
  lines.push(`Production is down: ${down.join(" and ")}.`);
  if (down.length === entries.length) {
    lines.push("Nothing answered. Read Vercel first: the deployment, its logs and the firewall.");
  } else if (down.includes("/api/health")) {
    lines.push("The site answers but its database does not. Read the Supabase dashboard first.");
  }
  return { lines, exitCode: 1 };
}

/** One whole check: ask, print, and answer the exit code. */
export async function runUptimeCheck({ log = console.log, ...deps } = {}) {
  const entries = await checkUptime(deps);
  const { lines, exitCode } = reportUptime(entries, deps);
  for (const line of lines) log(line);
  return exitCode;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  process.exitCode = await runUptimeCheck();
}
