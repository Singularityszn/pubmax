import { assertCronRequest } from "@/lib/cronAuth";
import { publicApiError } from "@/lib/apiError";
import { dispatchPaydayPint } from "@/lib/paydayPintJob.server";

export const maxDuration = 300;

export async function GET(request: Request): Promise<Response> {
  const denied = assertCronRequest(request);
  if (denied) return denied;
  try {
    const result = await dispatchPaydayPint();
    if (result.failed > 0) return publicApiError("Payday email delivery exhausted its retries.", "UNAVAILABLE", 503, { retryable: false, compatibilityFields: result });
    if (result.retryable > 0) return publicApiError("Payday email delivery needs a retry.", "UNAVAILABLE", 503, { retryable: true, compatibilityFields: result });
    return Response.json(result, { headers: { "Cache-Control": "no-store" } });
  }
  catch { return publicApiError("Could not run payday email job.", "UNAVAILABLE", 503); }
}
