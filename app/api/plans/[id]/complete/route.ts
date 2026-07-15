import { jsonNoStore } from "@/lib/apiResponses";
import { isPlanId, type CrawlEnding } from "@/lib/plan";
import { completePlan, getPlanCompletion } from "@/lib/planCompletion";
import { planStore } from "@/lib/planStore";
import { cleanText } from "@/lib/textClean";

type Context = { params: Promise<{ id: string }> };
const ENDINGS: CrawlEnding[] = ["food", "get_home", "keep_going"];

export async function GET(_request: Request, context: Context): Promise<Response> {
  const { id } = await context.params;
  if (!isPlanId(id)) return jsonNoStore({ error: "That Plan doesn't exist." }, { status: 404 });
  return jsonNoStore({ completion: await getPlanCompletion(id) });
}

export async function POST(request: Request, context: Context): Promise<Response> {
  const { id } = await context.params;
  if (!isPlanId(id)) return jsonNoStore({ error: "That Plan doesn't exist." }, { status: 404 });
  let body: Record<string, unknown>;
  try { body = await request.json() as Record<string, unknown>; } catch { return jsonNoStore({ error: "Malformed request body." }, { status: 400 }); }
  const ending = typeof body.ending === "string" && ENDINGS.includes(body.ending as CrawlEnding) ? body.ending as CrawlEnding : null;
  const memberToken = cleanText(body.memberToken, 128);
  const terminalVenueId = cleanText(body.terminalVenueId, 80);
  const finalPintDropId = cleanText(body.finalPintDropId, 80);
  if (!ending || !memberToken) return jsonNoStore({ error: "Add a valid Crawl Ending and member capability." }, { status: 400 });
  if (ending === "food" && !terminalVenueId) return jsonNoStore({ error: "Choose the food stop before completing this Plan." }, { status: 400 });
  const existing = await getPlanCompletion(id);
  if (existing) return jsonNoStore({ completion: existing }, { status: 200 });
  const action = await planStore().addAction(id, memberToken, { type: "ending", ending });
  if (!action.ok) return jsonNoStore({ error: action.error === "forbidden" ? "That member capability cannot complete this Plan." : "Could not complete this Plan." }, { status: action.error === "forbidden" ? 403 : action.error === "not_found" ? 404 : 400 });
  try {
    const completion = await completePlan({ planId: id, ending, memberToken, ...(terminalVenueId ? { terminalVenueId } : {}), ...(finalPintDropId ? { finalPintDropId } : {}) });
    return jsonNoStore({ plan: action.plan, completion }, { status: 201 });
  } catch { return jsonNoStore({ error: "The ending was recorded, but its completion record could not be saved. Retry safely." }, { status: 503 }); }
}
