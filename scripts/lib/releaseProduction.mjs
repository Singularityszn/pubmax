// The production release, as one ordered list of steps. A deploy from a CLI
// reports nothing to GitHub, so Vercel never starts prod-smoke.yml for it and a
// release used to end at `vercel promote` with nothing watching the live site.
// This list ends where the proof is: it dispatches the smoke suite on the
// released commit and waits for the verdict.
//
// Every effect arrives through `deps`, so the order and the refusals are tested
// without a network, a Vercel account or a GitHub run. The command name
// "vercel" is resolved by the entry script (scripts/lib/vercelCli.mjs).

export const PRODUCTION_ORIGIN = "https://pubmaxxing.com";
export const SMOKE_WORKFLOW = "prod-smoke.yml";
export const RELEASE_BRANCH = "main";
export const DEFAULT_REPOSITORY = "Singularityszn/pubmax";

const DEPLOYMENT_URL_PATTERN = /https:\/\/[a-z0-9-]+\.vercel\.app/g;

/** The deployment URL the Vercel CLI printed. The last one wins: it is the result line. */
export function parseDeploymentUrl(output) {
  const matches = String(output ?? "").match(DEPLOYMENT_URL_PATTERN);
  return matches ? matches[matches.length - 1] : null;
}

/**
 * The smoke run this release dispatched. A run started by somebody else, or on
 * another commit, is not this release's verdict, so a run counts only when it
 * was created after the dispatch and checked out the released commit.
 */
export function pickDispatchedRun(runs, { sha, dispatchedAtMs }) {
  const slackMs = 5_000;
  const candidates = (runs ?? [])
    .filter((run) => run.headSha === sha)
    .filter((run) => Date.parse(run.createdAt) >= dispatchedAtMs - slackMs)
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
  return candidates[0] ?? null;
}

export class ReleaseRefusal extends Error {
  constructor(message) {
    super(message);
    this.name = "ReleaseRefusal";
  }
}

/**
 * @param {object} deps
 * @param {(command: string, args: string[], options?: { capture?: boolean }) => Promise<{ status: number, stdout: string }>} deps.run
 * @param {(url: string) => Promise<string | null>} deps.deploymentIdAt  `/api/version` deploymentId at an origin, or null
 * @param {() => number} deps.now
 * @param {(ms: number) => Promise<void>} deps.sleep
 * @param {(line: string) => void} deps.say
 * @param {Array<{ name: string, run: () => Promise<void> }>} [deps.preflight]  extra checks that must pass before an upload
 */
export async function releaseProduction(deps, options = {}) {
  const { run, deploymentIdAt, now, sleep, say } = deps;
  const repository = options.repository ?? DEFAULT_REPOSITORY;
  const liveTimeoutMs = options.liveTimeoutMs ?? 180_000;
  const runLookupTimeoutMs = options.runLookupTimeoutMs ?? 120_000;
  const pollMs = options.pollMs ?? 5_000;

  const git = async (args) => {
    const result = await run("git", args, { capture: true });
    if (result.status !== 0) throw new ReleaseRefusal(`git ${args.join(" ")} failed.`);
    return result.stdout.trim();
  };

  // 1. The commit. The dispatch names a branch, so the released commit has to be
  // that branch's tip, and a dirty tree uploads code no commit names.
  if ((await git(["status", "--porcelain"])) !== "") {
    throw new ReleaseRefusal("The working tree is dirty. A release ships a commit, so commit or discard first.");
  }
  await git(["fetch", "origin", RELEASE_BRANCH]);
  const sha = await git(["rev-parse", "HEAD"]);
  const tip = await git(["rev-parse", `origin/${RELEASE_BRANCH}`]);
  if (sha !== tip) {
    throw new ReleaseRefusal(
      `HEAD ${sha.slice(0, 9)} is not origin/${RELEASE_BRANCH} ${tip.slice(0, 9)}. ` +
        `Release the tip of ${RELEASE_BRANCH} so the smoke run tests the commit that ships.`,
    );
  }
  say(`Releasing ${sha}.`);

  for (const check of deps.preflight ?? []) {
    say(`Preflight: ${check.name}.`);
    await check.run();
  }

  // 2. Deploy. scripts/deploy-vercel.mjs stamps the commit and builds in the cloud.
  const deploy = await run("node", ["scripts/deploy-vercel.mjs"], { capture: true });
  if (deploy.status !== 0) throw new ReleaseRefusal("The deploy failed, so nothing was promoted.");
  const deploymentUrl = parseDeploymentUrl(deploy.stdout);
  if (!deploymentUrl) throw new ReleaseRefusal("The deploy printed no deployment URL, so nothing was promoted.");
  const deploymentId = await deploymentIdAt(deploymentUrl);
  if (!deploymentId) {
    throw new ReleaseRefusal(`${deploymentUrl}/api/version named no deployment, so it is not safe to promote.`);
  }
  say(`Deployed ${deploymentId} at ${deploymentUrl}.`);

  // 3. Promote, then wait until the live origin serves it.
  const promote = await run("vercel", ["promote", deploymentUrl, "--yes"], {});
  if (promote.status !== 0) throw new ReleaseRefusal("vercel promote failed. Production still serves the old deploy.");
  const liveDeadline = now() + liveTimeoutMs;
  for (;;) {
    const live = await deploymentIdAt(PRODUCTION_ORIGIN);
    if (live === deploymentId) break;
    if (now() >= liveDeadline) {
      throw new ReleaseRefusal(
        `${PRODUCTION_ORIGIN} still serves ${live ?? "no deployment"} after ${liveTimeoutMs / 1000}s, not ${deploymentId}.`,
      );
    }
    await sleep(pollMs);
  }
  say(`Production serves ${deploymentId}.`);

  // 4. Dispatch the smoke suite on the released commit and wait for the verdict.
  const dispatchedAtMs = now();
  const dispatch = await run(
    "gh",
    ["workflow", "run", SMOKE_WORKFLOW, "--repo", repository, "--ref", RELEASE_BRANCH],
    {},
  );
  if (dispatch.status !== 0) {
    throw new ReleaseRefusal(`Could not dispatch ${SMOKE_WORKFLOW}. Production is live and unverified.`);
  }
  let smokeRun = null;
  const runDeadline = now() + runLookupTimeoutMs;
  while (!smokeRun) {
    const listed = await run(
      "gh",
      [
        "run", "list", "--repo", repository, "--workflow", SMOKE_WORKFLOW, "--event", "workflow_dispatch",
        "--branch", RELEASE_BRANCH, "--limit", "10", "--json", "databaseId,headSha,createdAt",
      ],
      { capture: true },
    );
    if (listed.status === 0) {
      smokeRun = pickDispatchedRun(JSON.parse(listed.stdout || "[]"), { sha, dispatchedAtMs });
    }
    if (smokeRun) break;
    if (now() >= runDeadline) {
      throw new ReleaseRefusal("The dispatched smoke run never appeared. Production is live and unverified.");
    }
    await sleep(pollMs);
  }
  say(`Smoke run ${smokeRun.databaseId} started on ${sha.slice(0, 9)}.`);
  const watched = await run(
    "gh",
    ["run", "watch", String(smokeRun.databaseId), "--repo", repository, "--exit-status"],
    {},
  );
  if (watched.status !== 0) {
    throw new ReleaseRefusal(
      `The production smoke suite failed for ${deploymentId}. Production serves it now: ` +
        "read the run, then fix forward or roll back with `vercel rollback`.",
    );
  }
  say(`Released ${sha} as ${deploymentId}. The production smoke suite passed.`);
  return { sha, deploymentId, deploymentUrl, smokeRunId: smokeRun.databaseId };
}
