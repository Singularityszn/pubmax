type ReferralClaimRequest = (
  input: string,
  init: RequestInit,
) => Promise<Response>;

const MAX_CLAIM_ATTEMPTS = 3;

async function responseIsRetryable(response: Response): Promise<boolean> {
  if (response.status === 429 || response.status >= 500) return true;
  const body = await response.clone().json().catch(() => null) as
    | { retryable?: unknown }
    | null;
  return body?.retryable === true;
}

export async function claimSignupReferral(
  code: string,
  request: ReferralClaimRequest,
): Promise<void> {
  for (let attempt = 0; attempt < MAX_CLAIM_ATTEMPTS; attempt += 1) {
    try {
      const response = await request("/api/referrals/claim-attribution", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ code }),
      });
      if (response.ok || !(await responseIsRetryable(response))) return;
    } catch {
      if (attempt === MAX_CLAIM_ATTEMPTS - 1) return;
    }
  }
}
