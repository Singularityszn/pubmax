/**
 * True only when missing durable services must fail closed. Vercel Preview
 * uses NODE_ENV=production too, so VERCEL_ENV is authoritative when present.
 */
export function isDeployedProduction(): boolean {
  const vercelEnv = process.env.VERCEL_ENV;
  if (vercelEnv === "production") return true;
  if (vercelEnv === "preview" || vercelEnv === "development") return false;
  return process.env.NODE_ENV === "production";
}

/** The value Next sets on NEXT_PHASE while compiling a production build. */
const NEXT_PRODUCTION_BUILD_PHASE = "phase-production-build";

/**
 * True while `next build` is compiling, collecting page data or prerendering a
 * static page. A build is not a runtime: it sets NODE_ENV=production, so
 * isDeployedProduction() answers true on a runner that carries no keys, but no
 * request exists to serve and no write can be lost. Next never sets this phase
 * on a server answering requests, and both readers ask the production check
 * FIRST anyway (lib/supabase's store guard, lib/serverEnv's startup guard), so
 * a real Vercel Production process keeps the full fail-closed policy even when
 * this variable is set on it by hand.
 */
export function isProductionBuildPhase(): boolean {
  return process.env.NEXT_PHASE === NEXT_PRODUCTION_BUILD_PHASE;
}

/**
 * The id of the running deployment, or null when nothing set one. `/api/version`
 * and `/api/health` answer it, and every alert names it. Each name is a STATIC
 * member expression because that is the form Next inlines at build time.
 */
export function currentDeploymentId(): string | null {
  const deploymentId =
    process.env.NEXT_DEPLOYMENT_ID ??
    process.env.VERCEL_DEPLOYMENT_ID ??
    process.env.NEXT_PUBLIC_SW_VERSION;
  return typeof deploymentId === "string" && deploymentId ? deploymentId : null;
}
