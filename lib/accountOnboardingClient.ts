import { authedFetch } from "@/lib/authedFetch";

type AccountOnboardingRequest = (
  input: string,
  init?: RequestInit,
) => Promise<Response>;

export type AccountOnboardingStatus =
  | { status: "complete" }
  | { status: "incomplete"; handle?: string }
  | { status: "unavailable"; error: string };

export type AccountHandleAvailability =
  | { status: "available" }
  | { status: "taken" }
  | { status: "unavailable"; error: string };

export async function loadAccountOnboardingStatus(
  request: AccountOnboardingRequest = authedFetch,
  signal?: AbortSignal,
): Promise<AccountOnboardingStatus> {
  try {
    const response = await request("/api/identity/onboarding", {
      cache: "no-store",
      signal,
    });
    const body = (await response.json().catch(() => ({}))) as {
      complete?: unknown;
      handle?: unknown;
      error?: unknown;
    };
    if (!response.ok) {
      return {
        status: "unavailable",
        error:
          typeof body.error === "string"
            ? body.error
            : "Account setup is unavailable right now.",
      };
    }
    return body.complete === true
      ? { status: "complete" }
      : {
          status: "incomplete",
          ...(typeof body.handle === "string" ? { handle: body.handle } : {}),
        };
  } catch (error) {
    if ((error as { name?: unknown })?.name === "AbortError") {
      return {
        status: "unavailable",
        error: "Account setup was interrupted.",
      };
    }
    return {
      status: "unavailable",
      error: "Account setup is unavailable right now.",
    };
  }
}

export async function checkAccountHandleAvailability(
  handle: string,
  request: AccountOnboardingRequest = fetch,
  signal?: AbortSignal,
): Promise<AccountHandleAvailability> {
  try {
    const query = new URLSearchParams({ handle });
    const response = await request(
      `/api/identity/handle/availability?${query.toString()}`,
      { cache: "no-store", signal },
    );
    const body = (await response.json().catch(() => ({}))) as {
      available?: unknown;
      reason?: unknown;
      error?: unknown;
    };
    if (!response.ok) {
      return {
        status: "unavailable",
        error:
          typeof body.error === "string"
            ? body.error
            : "Could not check that handle. Try again.",
      };
    }
    if (body.available === true) return { status: "available" };
    if (body.available === false && body.reason === "taken") {
      return { status: "taken" };
    }
    return {
      status: "unavailable",
      error: "Could not check that handle. Try again.",
    };
  } catch (error) {
    if ((error as { name?: unknown })?.name === "AbortError") {
      return {
        status: "unavailable",
        error: "Handle check was interrupted.",
      };
    }
    return {
      status: "unavailable",
      error: "Could not check that handle. Try again.",
    };
  }
}
