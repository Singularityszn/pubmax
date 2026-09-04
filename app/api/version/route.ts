import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const revalidate = 0;

function currentDeploymentId(): string | null {
  const deploymentId =
    process.env.NEXT_DEPLOYMENT_ID ??
    process.env.VERCEL_DEPLOYMENT_ID ??
    process.env.NEXT_PUBLIC_SW_VERSION;
  return typeof deploymentId === "string" && deploymentId ? deploymentId : null;
}

// The commit the running code was built from. A deployment id names WHICH
// deploy answered; it does not name WHAT is in it, so proving "this preview
// serves the SHA I pushed" needed a second trip through the Vercel API. Vercel
// sets VERCEL_GIT_COMMIT_SHA on every build it owns; a local or self-hosted
// run sets nothing, and null is the honest answer there rather than a guess.
function currentGitCommitSha(): string | null {
  const sha = process.env.VERCEL_GIT_COMMIT_SHA;
  return typeof sha === "string" && sha ? sha : null;
}

export function GET(): NextResponse {
  return NextResponse.json(
    {
      deploymentId: currentDeploymentId(),
      gitCommitSha: currentGitCommitSha(),
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
