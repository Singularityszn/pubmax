import { assertServerEnv } from "@/lib/serverEnv";
import {
  defaultVenuePhotoServeDeps,
  handleVenuePhotoServe,
  VENUE_PHOTO_SERVE_CACHE_CONTROL,
  type VenuePhotoServeDeps,
} from "@/lib/venuePhotoServe.server";

assertServerEnv();

export const VENUE_PHOTO_CACHE_CONTROL = VENUE_PHOTO_SERVE_CACHE_CONTROL;

let testDeps: Partial<VenuePhotoServeDeps> | null = null;

export function __setVenuePhotoServeRouteDepsForTest(
  deps: Partial<VenuePhotoServeDeps> | null,
): void {
  testDeps = deps;
}

function deps(): VenuePhotoServeDeps {
  return { ...defaultVenuePhotoServeDeps, ...testDeps };
}

type RouteContext = { params: Promise<{ venueId: string; photoId: string }> };

export async function GET(request: Request, context: RouteContext): Promise<Response> {
  return handleVenuePhotoServe(request, await context.params, deps());
}
