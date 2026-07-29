import {
  accountBoundFetch,
  type AccountAuthSnapshot,
  type AccountBoundRequest,
} from "@/lib/accountBoundFetch";
import {
  PRIVATE_IDENTITY_SEX_VALUES,
  type PrivateIdentitySex,
} from "@/lib/privateIdentity";

type PrivateIdentityLoadResult =
  | {
      status: "ready";
      fullName: string;
      sex: "" | PrivateIdentitySex;
    }
  | { status: "unavailable"; error: string };

export async function loadPrivateIdentity(
  auth: AccountAuthSnapshot,
  request: AccountBoundRequest = fetch,
  signal?: AbortSignal,
): Promise<PrivateIdentityLoadResult> {
  try {
    const response = await accountBoundFetch(
      auth,
      "/api/identity/onboarding",
      { cache: "no-store", signal },
      request,
    );
    const body = (await response.json().catch(() => ({}))) as {
      fullName?: unknown;
      sex?: unknown;
      error?: unknown;
    };
    if (!response.ok) {
      return {
        status: "unavailable",
        error:
          typeof body.error === "string"
            ? body.error
            : "Private details could not be loaded.",
      };
    }
    return {
      status: "ready",
      fullName: typeof body.fullName === "string" ? body.fullName : "",
      sex:
        typeof body.sex === "string" &&
        PRIVATE_IDENTITY_SEX_VALUES.includes(body.sex as PrivateIdentitySex)
          ? (body.sex as PrivateIdentitySex)
          : "",
    };
  } catch (error) {
    return {
      status: "unavailable",
      error:
        (error as { name?: unknown })?.name === "AbortError"
          ? "Private details loading was interrupted."
          : "Private details could not be loaded.",
    };
  }
}
