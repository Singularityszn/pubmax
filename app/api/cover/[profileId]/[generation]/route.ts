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
  return { ...defaultProfileImageServeDeps, ...testDeps };
}

type RouteContext = { params: Promise<{ profileId: string; generation: string }> };

export async function GET(request: Request, context: RouteContext): Promise<Response> {
  return handleProfileImageServe(request, "cover", await context.params, deps());
}
