import { profileCoverPhotoStore } from "@/lib/profileCoverPhotoStore";
import {
  defaultProfileImageServeDeps,
  handleProfileImageServe,
  type ProfileImageServeDeps,
} from "@/lib/profileImageServe.server";
import { assertServerEnv } from "@/lib/serverEnv";

assertServerEnv();

let testDeps: Partial<ProfileImageServeDeps> | null = null;

export function __setCoverServeRouteDepsForTest(
  deps: Partial<ProfileImageServeDeps> | null,
): void {
  testDeps = deps;
}

function deps(): ProfileImageServeDeps {
  return {
    ...defaultProfileImageServeDeps,
    // A profile holds up to five covers and the row names only the first, so
    // this route also serves any generation the rotation records for it. The
    // store checks approval and the serving-key shape itself.
    extraServingKey: (profileId, generation) =>
      profileCoverPhotoStore().approvedObjectKey(profileId, generation),
    ...testDeps,
  };
}

type RouteContext = { params: Promise<{ profileId: string; generation: string }> };

export async function GET(request: Request, context: RouteContext): Promise<Response> {
  return handleProfileImageServe(request, "cover", await context.params, deps());
}
