import { NextResponse } from "next/server";

import { isCronAuthorized } from "@/lib/cronAuth";
import { readBuildStamp } from "@/lib/buildInfo.mjs";
import { currentDeploymentId } from "@/lib/deploymentEnv";

export const dynamic = "force-dynamic";
export const revalidate = 0;

// The commit the running code was built from, plus WHERE that answer came from
// and WHEN the build ran. The values are decided in next.config.mjs and inlined
// there (lib/buildInfo.mjs owns the rule), so this route runs no git and reads
// no request-time platform variable: VERCEL_GIT_COMMIT_SHA is absent from the
// runtime of a CLI deploy, which is what made this marker answer null on every
// preview it was needed for. Each name is read as a STATIC member expression
// because that is the form Next replaces with the build-time literal.
function currentBuildStamp() {
  return readBuildStamp({
    PUBMAX_BUILD_COMMIT_SHA: process.env.PUBMAX_BUILD_COMMIT_SHA,
    PUBMAX_BUILD_COMMIT_SHA_SOURCE: process.env.PUBMAX_BUILD_COMMIT_SHA_SOURCE,
    PUBMAX_BUILD_TIME: process.env.PUBMAX_BUILD_TIME,
  });
}

const VERSION_CACHE_HEADERS = {
  "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
  "CDN-Cache-Control": "no-store",
  "Vercel-CDN-Cache-Control": "no-store",
};

export function GET(request: Request = new Request("http://localhost/api/version")): NextResponse {
  // A stale tab compares this id with no credential (lib/deploymentSkewRecovery).
  // The browser already holds the same value as NEXT_DEPLOYMENT_ID. The commit,
  // its source and the build time stay behind the cron check.
  const deploymentId = currentDeploymentId();
  if (!isCronAuthorized(request)) {
    return NextResponse.json({ ok: true, deploymentId }, { headers: VERSION_CACHE_HEADERS });
  }

  const build = currentBuildStamp();

  return NextResponse.json(
    {
      deploymentId,
      gitCommitSha: build.commitSha,
      // "vercel-git" is a commit Vercel checked out; "working-tree" is the
      // commit of the tree the build ran over. A verifier that wants a pushed
      // commit needs to be able to tell those apart.
      gitCommitShaSource: build.commitShaSource,
      builtAt: build.builtAt,
    },
    { headers: VERSION_CACHE_HEADERS },
  );
}
