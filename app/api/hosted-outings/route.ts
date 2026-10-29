import { createHostedOuting, readHostedOutings } from "@/lib/hostedOutingStore.server";
import { hostedOutingRoute } from "@/lib/hostedOutingsHttp.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET(request: Request): Promise<Response> {
  return hostedOutingRoute(request, false, (actor) => readHostedOutings(actor));
}
export function POST(request: Request): Promise<Response> {
  return hostedOutingRoute(request, true, createHostedOuting);
}
