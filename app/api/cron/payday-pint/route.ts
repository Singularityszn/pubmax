import { assertCronRequest } from "@/lib/cronAuth";
import { publicApiError } from "@/lib/apiError";
import { dispatchPaydayPint } from "@/lib/paydayPintJob.server";

export async function GET(request: Request): Promise<Response> {
  const denied = assertCronRequest(request);
  if (denied) return denied;
  try { return Response.json(await dispatchPaydayPint(), { headers: { "Cache-Control": "no-store" } }); }
  catch { return publicApiError("Could not run payday email job.", "UNAVAILABLE", 503); }
}
