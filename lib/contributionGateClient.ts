import { authedFetch } from "@/lib/authedFetch";

export type ContributionGateClientState =
  | { status: "sign_in_required"; error?: string }
  | { status: "onboarding_required"; error?: string }
  | { status: "age_required"; error?: string }
  | { status: "underage"; eligibleOn?: string; error?: string }
  | { status: "eligible" }
  | { status: "unavailable"; error: string };

export type ContributionGateRequest = (
  input: string,
  init?: RequestInit,
) => Promise<Response>;

async function readGateResponse(
  response: Response,
): Promise<ContributionGateClientState> {
  const body = (await response.json().catch(() => ({}))) as {
    status?: unknown;
    eligibleOn?: unknown;
    error?: unknown;
  };
  if (response.status === 401) {
    return {
      status: "sign_in_required",
      ...(typeof body.error === "string" ? { error: body.error } : {}),
    };
  }
  if (
    body.status === "eligible" ||
    body.status === "onboarding_required" ||
    body.status === "age_required"
  ) {
    return {
      status: body.status,
      ...(typeof body.error === "string" ? { error: body.error } : {}),
    };
  }
  if (body.status === "underage") {
    return {
      status: "underage",
      ...(typeof body.eligibleOn === "string"
        ? { eligibleOn: body.eligibleOn }
        : {}),
      ...(typeof body.error === "string" ? { error: body.error } : {}),
    };
  }
  return {
    status: "unavailable",
    error:
      typeof body.error === "string"
        ? body.error
        : "Contribution eligibility is unavailable right now.",
  };
}

export async function checkContributionGate(
  request: ContributionGateRequest = authedFetch,
): Promise<ContributionGateClientState> {
  try {
    return readGateResponse(
      await request("/api/identity/contribution-gate", {
        cache: "no-store",
      }),
    );
  } catch {
    return {
      status: "unavailable",
      error: "Could not check contribution eligibility. Try again.",
    };
  }
}

export async function submitContributionAge(
  dateOfBirth: string,
  request: ContributionGateRequest = authedFetch,
): Promise<ContributionGateClientState> {
  try {
    return readGateResponse(
      await request("/api/identity/contribution-gate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ dateOfBirth }),
      }),
    );
  } catch {
    return {
      status: "unavailable",
      error: "Could not save contribution eligibility. Try again.",
    };
  }
}
