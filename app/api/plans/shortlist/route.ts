import { publicApiError } from "@/lib/apiError";
import { jsonNoStore } from "@/lib/apiResponses";
import { shortlistCandidates, shortlistFilters } from "@/lib/planShortlistCandidates.server";

export async function GET(request: Request): Promise<Response> {
  const filters = shortlistFilters(new URL(request.url).searchParams);
  if (!filters) return publicApiError("Choose a London area and a valid per-pint limit.", "INVALID_REQUEST", 400);
  return jsonNoStore({ options: await shortlistCandidates(filters) });
}
