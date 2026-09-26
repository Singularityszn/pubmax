import { assertServerEnv } from "@/lib/serverEnv";
import { handleDrinkWallPhotoServe } from "@/lib/venuePhotoServe.server";
import { venuePhotoServeRouteDeps } from "@/lib/venuePhotoServeRouteDeps.server";

assertServerEnv();

type RouteContext = { params: Promise<{ photoId: string }> };

export async function GET(request: Request, context: RouteContext): Promise<Response> {
  return handleDrinkWallPhotoServe(request, await context.params, venuePhotoServeRouteDeps());
}
