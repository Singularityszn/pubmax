import { isModerator } from "@/lib/adminAuth";
import { publicApiError } from "@/lib/apiError";
import { jsonNoStore } from "@/lib/apiResponses";
import {
  areaDemandStore,
  normaliseAreaDemandSummaryOptions,
} from "@/lib/areaDemandStore";
import { assertServerEnv } from "@/lib/serverEnv";

function forbidden(): Response {
  return publicApiError("Not authorised.", "FORBIDDEN", 403);
}

function numericQueryValue(value: string | null): number | undefined {
  if (value === null || value.trim() === "") return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

export async function GET(request: Request): Promise<Response> {
  assertServerEnv();
  if (!isModerator(request)) return forbidden();

  const url = new URL(request.url);
  const options = normaliseAreaDemandSummaryOptions({
    limit: numericQueryValue(url.searchParams.get("limit")),
    sinceDays: numericQueryValue(url.searchParams.get("sinceDays")),
  });
  const result = await areaDemandStore().listSummary(options);

  return jsonNoStore(
    {
      summary: result.items,
      partial: result.partial,
      sinceDays: options.sinceDays,
      status: result.status,
    },
    { status: 200 },
  );
}
