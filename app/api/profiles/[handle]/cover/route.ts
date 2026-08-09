// The owner's backdrop. Same journey as the face — staging, scan, promote,
// tombstone-safe cleanup — through the one shared handler pair.

import {
  defaultProfileImageRouteDeps,
  handleProfileImageDelete,
  handleProfileImageUpload,
  type ProfileImageRouteDeps,
} from "@/lib/profileImageRoute.server";
import { assertServerEnv } from "@/lib/serverEnv";

assertServerEnv();

export const maxDuration = 15;

/** Test seam: production callers leave this unset. */
let testDeps: Partial<ProfileImageRouteDeps> | null = null;

export function __setProfileCoverRouteDepsForTest(
  deps: Partial<ProfileImageRouteDeps> | null,
): void {
  testDeps = deps;
}

function deps(): ProfileImageRouteDeps {
  return { ...defaultProfileImageRouteDeps, ...testDeps };
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ handle: string }> },
): Promise<Response> {
  return handleProfileImageUpload(request, (await params).handle, "cover", deps());
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ handle: string }> },
): Promise<Response> {
  return handleProfileImageDelete(request, (await params).handle, "cover", deps());
}
