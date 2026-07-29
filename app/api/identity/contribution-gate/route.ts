import { jsonNoStore } from "@/lib/apiResponses";
import { callerUserId } from "@/lib/authServer";
import { assessContributionAge } from "@/lib/contributionEligibility";
import { privateIdentityStore } from "@/lib/privateIdentityStore";
import { assertServerEnv } from "@/lib/serverEnv";

assertServerEnv();

const UNDERAGE_ERROR =
  "You must be 18 or over to contribute. PUBMAXX is about buying alcohol.";

function gateResponse(
  gate:
    | { status: "onboarding_required" }
    | { status: "age_required" }
    | { status: "underage"; eligibleOn: string }
    | { status: "eligible" },
): Response {
  if (gate.status === "eligible") return jsonNoStore(gate);
  if (gate.status === "onboarding_required") {
    return jsonNoStore(
      {
        ...gate,
        error: "Choose your public handle before contributing.",
      },
      { status: 409 },
    );
  }
  if (gate.status === "age_required") {
    return jsonNoStore(
      {
        ...gate,
        error: "Confirm you are 18 or over before your first contribution.",
      },
      { status: 403 },
    );
  }
  return jsonNoStore(
    { ...gate, error: UNDERAGE_ERROR },
    { status: 403 },
  );
}

export async function GET(request: Request): Promise<Response> {
  const userId = await callerUserId(request);
  if (!userId) {
    return jsonNoStore(
      { status: "sign_in_required", error: "Sign in to contribute." },
      { status: 401 },
    );
  }
  try {
    return gateResponse(
      await privateIdentityStore().contributionGate(userId),
    );
  } catch {
    return jsonNoStore(
      { error: "Contribution eligibility is unavailable right now." },
      { status: 503 },
    );
  }
}

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
  const assessment = assessContributionAge(body.dateOfBirth);
  if (!assessment.ok) {
    return jsonNoStore({ error: assessment.error }, { status: 400 });
  }
  try {
    const stored = await privateIdentityStore().recordAgeAssessment(
      userId,
      assessment,
    );
    if (!stored) {
      return gateResponse({ status: "onboarding_required" });
    }
    return assessment.status === "adult"
      ? gateResponse({ status: "eligible" })
      : gateResponse({
          status: "underage",
          eligibleOn: assessment.eligibleOn,
        });
  } catch {
    return jsonNoStore(
      { error: "Contribution eligibility could not be saved." },
      { status: 503 },
    );
  }
}
