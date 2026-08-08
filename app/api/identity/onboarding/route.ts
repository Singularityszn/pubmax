import { publicApiError } from "@/lib/apiError";
import { jsonNoStore } from "@/lib/apiResponses";
import { callerUserId } from "@/lib/authServer";
import { isHandleClaimLimited } from "@/lib/identityHandleClaimRateLimit";
import { privateIdentityStore } from "@/lib/privateIdentityStore";
import { profileStore } from "@/lib/profileStore";
import { assertServerEnv } from "@/lib/serverEnv";

assertServerEnv();

export async function GET(request: Request): Promise<Response> {
  const userId = await callerUserId(request);
  if (!userId) {
    return publicApiError("Sign in to finish setting up your account.", "UNAUTHENTICATED", 401);
  }
  try {
    const [profile, privateIdentity] = await Promise.all([
      profileStore().getByUserId(userId),
      privateIdentityStore().read(userId),
    ]);
    if (!profile) return jsonNoStore({ complete: false });
    if (!privateIdentity?.dateOfBirth) {
      return jsonNoStore({
        complete: false,
        handle: profile.handle,
        ...(privateIdentity?.fullName
          ? { fullName: privateIdentity.fullName }
          : {}),
        ...(privateIdentity?.sex ? { sex: privateIdentity.sex } : {}),
      });
    }
    return jsonNoStore({
      complete: true,
      handle: profile.handle,
      ...(privateIdentity?.fullName
        ? { fullName: privateIdentity.fullName }
        : {}),
      ...(privateIdentity?.sex ? { sex: privateIdentity.sex } : {}),
    });
  } catch {
    return publicApiError("Account details are unavailable right now.", "UNAVAILABLE", 503, { retryable: true });
  }
}

export async function POST(request: Request): Promise<Response> {
  const userId = await callerUserId(request);
  if (!userId) {
    return publicApiError("Sign in to finish setting up your account.", "UNAUTHENTICATED", 401);
  }
  if (await isHandleClaimLimited(request, userId)) {
    return publicApiError("Too many handle attempts. Try again shortly.", "RATE_LIMITED", 429, { retryable: true });
  }
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return publicApiError("Malformed request body.", "MALFORMED_REQUEST", 400);
  }
  const result = await privateIdentityStore().completeOnboarding({
    userId,
    handle: typeof body.handle === "string" ? body.handle : "",
    dateOfBirth: body.dateOfBirth,
    fullName: body.fullName,
    sex: body.sex,
  });
  if (!result.ok) {
    const status =
      result.code === "storage"
        ? 503
        : result.code === "taken" || result.code === "already_has_handle"
          ? 409
          : 400;
    return publicApiError(result.error, result.code, status, {
      retryable: status >= 500,
    });
  }
  return jsonNoStore(
    {
      complete: true,
      handle: result.handle,
      ...(result.privateIdentity.fullName
        ? { fullName: result.privateIdentity.fullName }
        : {}),
      ...(result.privateIdentity.sex
        ? { sex: result.privateIdentity.sex }
        : {}),
    },
    { status: 201 },
  );
}

export async function PATCH(request: Request): Promise<Response> {
  const userId = await callerUserId(request);
  if (!userId) {
    return publicApiError("Sign in to update your account details.", "UNAUTHENTICATED", 401);
  }
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return publicApiError("Malformed request body.", "MALFORMED_REQUEST", 400);
  }
  try {
    const [profile, privateIdentity] = await Promise.all([
      profileStore().getByUserId(userId),
      privateIdentityStore().updateDetails(userId, {
        ...("fullName" in body ? { fullName: body.fullName } : {}),
        ...("sex" in body ? { sex: body.sex } : {}),
      }),
    ]);
    if (!profile || !privateIdentity) {
      return publicApiError("Finish account setup before editing private details.", "CONFLICT", 409);
    }
    return jsonNoStore({
      complete: true,
      handle: profile.handle,
      ...(privateIdentity.fullName
        ? { fullName: privateIdentity.fullName }
        : {}),
      ...(privateIdentity.sex ? { sex: privateIdentity.sex } : {}),
    });
  } catch {
    return publicApiError("Account details could not be saved.", "UNAVAILABLE", 503, { retryable: true });
  }
}
