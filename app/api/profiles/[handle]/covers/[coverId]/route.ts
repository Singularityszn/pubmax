// One cover in the rotation.
//
//   PATCH { move: "up" | "down" } -> 200 { profile, covers }
//   DELETE                        -> 200 { profile, covers }
//
// Thin over `lib/profileCoverPhotoRoute.server.ts`, which owns the per-actor
// budget, the ownership gate and the storage cleanup.

import {
  defaultProfileCoverPhotoRouteDeps,
  handleProfileCoverPhotoDelete,
  handleProfileCoverPhotoMove,
  type ProfileCoverPhotoRouteDeps,
} from "@/lib/profileCoverPhotoRoute.server";
import { assertServerEnv } from "@/lib/serverEnv";

assertServerEnv();

let testDeps: Partial<ProfileCoverPhotoRouteDeps> | null = null;

export function __setProfileCoverPhotoRouteDepsForTest(
  deps: Partial<ProfileCoverPhotoRouteDeps> | null,
): void {
  testDeps = deps;
}

function deps(): ProfileCoverPhotoRouteDeps {
  return { ...defaultProfileCoverPhotoRouteDeps, ...testDeps };
}

type RouteContext = { params: Promise<{ handle: string; coverId: string }> };

export async function PATCH(request: Request, { params }: RouteContext): Promise<Response> {
  const { handle, coverId } = await params;
  return handleProfileCoverPhotoMove(request, handle, coverId);
}

export async function DELETE(request: Request, { params }: RouteContext): Promise<Response> {
  const { handle, coverId } = await params;
  return handleProfileCoverPhotoDelete(request, handle, coverId, deps());
}
