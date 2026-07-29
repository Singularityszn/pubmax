import { jsonNoStore } from "@/lib/apiResponses";
import { callerUserId } from "@/lib/authServer";
import { privateIdentityStore } from "@/lib/privateIdentityStore";
import { assertServerEnv } from "@/lib/serverEnv";

assertServerEnv();

export async function POST(request: Request): Promise<Response> {
  const userId = await callerUserId(request);
  if (!userId) {
    return jsonNoStore(
      { status: "sign_in_required", error: "Sign in to contribute." },
      { status: 401 },
    );
  }
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return jsonNoStore({ error: "Malformed request body." }, { status: 400 });
  }
  try {
    const result = await privateIdentityStore().assessContributionAge(
      userId,
      body.dateOfBirth,
    );
    if (result.status === "missing") {
      return jsonNoStore(
        {
          status: "onboarding_required",
          error: "Choose your public handle before contributing.",
        },
        { status: 409 },
      );
    }
    if (result.status === "invalid") {
      return jsonNoStore(
        { error: "Enter a valid date of birth." },
        { status: 400 },
      );
    }
    if (result.status === "underage") {
      return jsonNoStore(
        {
          status: "age_restricted",
          error: `You cannot contribute while under 18. You can contribute from ${result.eligibleFrom}.`,
        },
        { status: 403 },
      );
    }
    return jsonNoStore({ status: "adult" });
  } catch {
    return jsonNoStore(
      { error: "Age confirmation is unavailable right now." },
      { status: 503 },
    );
  }
}
