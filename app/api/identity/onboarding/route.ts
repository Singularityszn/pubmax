import { jsonNoStore } from "@/lib/apiResponses";
import { callerUserId } from "@/lib/authServer";
import { isHandleClaimLimited } from "@/lib/identityHandleClaimRateLimit";
import { cleanDateOfBirth } from "@/lib/privateIdentity";
import { privateIdentityStore } from "@/lib/privateIdentityStore";
import { profileStore } from "@/lib/profileStore";
import { assertServerEnv } from "@/lib/serverEnv";

assertServerEnv();

export async function GET(request: Request): Promise<Response> {
  const userId = await callerUserId(request);
  if (!userId) {
    return jsonNoStore(
      { error: "Sign in to finish setting up your account." },
      { status: 401 },
    );
  }
  try {
    const [profile, privateIdentity] = await Promise.all([
      profileStore().getByUserId(userId),
      privateIdentityStore().read(userId),
    ]);
    if (!profile) return jsonNoStore({ complete: false });
    if (!privateIdentity?.dateOfBirth) {
      return jsonNoStore({ complete: false, handle: profile.handle });
    }
    return jsonNoStore({
      complete: true,
      handle: profile.handle,
      dateOfBirth: privateIdentity.dateOfBirth,
      ...(privateIdentity?.fullName
        ? { fullName: privateIdentity.fullName }
        : {}),
      ...(privateIdentity?.sex ? { sex: privateIdentity.sex } : {}),
    });
  } catch {
    return jsonNoStore(
      { error: "Account details are unavailable right now." },
      { status: 503 },
    );
  }
}

export async function POST(request: Request): Promise<Response> {
  const userId = await callerUserId(request);
  if (!userId) {
    return jsonNoStore(
      { error: "Sign in to finish setting up your account." },
      { status: 401 },
    );
  }
  if (await isHandleClaimLimited(request, userId)) {
    return jsonNoStore(
      { error: "Too many handle attempts. Try again shortly." },
      { status: 429 },
    );
  }
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return jsonNoStore({ error: "Malformed request body." }, { status: 400 });
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
    return jsonNoStore(
      { code: result.code, error: result.error },
      { status },
    );
  }
  return jsonNoStore(
    {
      complete: true,
      handle: result.handle,
      dateOfBirth: result.privateIdentity.dateOfBirth,
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
    return jsonNoStore(
      { error: "Sign in to update your account details." },
      { status: 401 },
    );
  }
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return jsonNoStore({ error: "Malformed request body." }, { status: 400 });
  }
  if ("dateOfBirth" in body && !cleanDateOfBirth(body.dateOfBirth)) {
    return jsonNoStore(
      { code: "invalid", error: "Add a valid date of birth." },
      { status: 400 },
    );
  }
  try {
    const [profile, privateIdentity] = await Promise.all([
      profileStore().getByUserId(userId),
      privateIdentityStore().updateDetails(userId, {
        ...("fullName" in body ? { fullName: body.fullName } : {}),
        ...("sex" in body ? { sex: body.sex } : {}),
        ...("dateOfBirth" in body ? { dateOfBirth: body.dateOfBirth } : {}),
      }),
    ]);
    if (!profile || !privateIdentity) {
      return jsonNoStore(
        { error: "Finish account setup before editing private details." },
        { status: 409 },
      );
    }
    return jsonNoStore({
      complete: true,
      handle: profile.handle,
      dateOfBirth: privateIdentity.dateOfBirth,
      ...(privateIdentity.fullName
        ? { fullName: privateIdentity.fullName }
        : {}),
      ...(privateIdentity.sex ? { sex: privateIdentity.sex } : {}),
    });
  } catch {
    return jsonNoStore(
      { error: "Account details could not be saved." },
      { status: 503 },
    );
  }
}
