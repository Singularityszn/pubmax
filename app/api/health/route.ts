import { publicApiError } from "@/lib/apiError";
import { jsonNoStore } from "@/lib/apiResponses";
import { checkDatabaseHealth } from "@/lib/healthProbe.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

// GET /api/health - the route an external uptime monitor polls.
//
// 200 means this deployment answered AND its database answered; 503 means the
// database did not, so a monitor that alerts on any non-2xx status catches a
// paused, unreachable or over-quota Supabase that `/api/version` (memory only)
// would sail past. It names the deployment so an alert says which build was
// failing, and nothing else: no host, no error text, no table, no version
// detail. `lib/healthProbe.server.ts` owns the probe and its per-instance cache.
function currentDeploymentId(): string | null {
  const deploymentId =
    process.env.NEXT_DEPLOYMENT_ID ??
    process.env.VERCEL_DEPLOYMENT_ID ??
    process.env.NEXT_PUBLIC_SW_VERSION;
  return typeof deploymentId === "string" && deploymentId ? deploymentId : null;
}

export async function GET(): Promise<Response> {
  const deploymentId = currentDeploymentId();
  const database = await checkDatabaseHealth();
  if (database === "down") {
    return publicApiError("The database is not answering.", "DATABASE_UNAVAILABLE", 503, {
      retryable: true,
      compatibilityFields: { ok: false, deploymentId, database },
    });
  }
  return jsonNoStore({ ok: true, deploymentId, database });
}
