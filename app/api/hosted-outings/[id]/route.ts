import { changeHostedOuting, readHostedOutings } from "@/lib/hostedOutingStore.server";
import { hostedOutingRoute } from "@/lib/hostedOutingsHttp.server";

type Context = { params: Promise<{ id: string }> };
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request, context: Context): Promise<Response> {
  const { id } = await context.params;
  return hostedOutingRoute(request, false, (actor) => readHostedOutings(actor, id));
}
export async function PATCH(request: Request, context: Context): Promise<Response> {
  const { id } = await context.params;
  return hostedOutingRoute(request, true, (actor, input) => changeHostedOuting(actor, id, input));
}
