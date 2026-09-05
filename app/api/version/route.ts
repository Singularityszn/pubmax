import { NextResponse } from "next/server";

import { readBuildStamp } from "@/lib/buildInfo.mjs";

export const dynamic = "force-dynamic";
export const revalidate = 0;

function currentDeploymentId(): string | null {
  const deploymentId =
    process.env.NEXT_DEPLOYMENT_ID ??
    process.env.VERCEL_DEPLOYMENT_ID ??
    process.env.NEXT_PUBLIC_SW_VERSION;
  return typeof deploymentId === "string" && deploymentId ? deploymentId : null;
}

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

export function GET(): NextResponse {
  const build = currentBuildStamp();

  return NextResponse.json(
    {
      deploymentId: currentDeploymentId(),
      gitCommitSha: build.commitSha,
      // "vercel-git" is a commit Vercel checked out; "working-tree" is the
      // commit of the tree the build ran over. A verifier that wants a pushed
      // commit needs to be able to tell those apart.
      gitCommitShaSource: build.commitShaSource,
      builtAt: build.builtAt,
    },
    {
      headers: {
        "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
        "CDN-Cache-Control": "no-store",
        "Vercel-CDN-Cache-Control": "no-store",
      },
    },
  );
}
