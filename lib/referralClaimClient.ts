type ReferralClaimRequest = (
  input: string,
  init: RequestInit,
) => Promise<Response>;

const MAX_CLAIM_ATTEMPTS = 3;
const MAX_RETRY_DELAY_MS = 5_000;
const FALLBACK_RETRY_DELAYS_MS = [250, 750] as const;

async function responseIsRetryable(response: Response): Promise<boolean> {
  if (response.status === 429 || response.status >= 500) return true;
  const body = await response.clone().json().catch(() => null) as
    | { retryable?: unknown }
    | null;
  return body?.retryable === true;
}

function retryAfterMs(response: Response, now: number): number | null {
  const raw = response.headers.get("retry-after")?.trim();
  if (!raw) return null;
  const seconds = Number(raw);
  const delay = Number.isFinite(seconds)
    ? seconds * 1_000
    : Date.parse(raw) - now;
  if (!Number.isFinite(delay) || delay < 0) return null;
  return Math.min(delay, MAX_RETRY_DELAY_MS);
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function claimSignupReferral(
  code: string,
  authAttemptId: string,
  signupProof: string,
  request: ReferralClaimRequest,
): Promise<void> {
  for (let attempt = 0; attempt < MAX_CLAIM_ATTEMPTS; attempt += 1) {
    let delayMs = FALLBACK_RETRY_DELAYS_MS[attempt] ?? 0;
    try {
      const response = await request("/api/referrals/claim-attribution", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ code, authAttemptId, signupProof }),
      });
      if (response.ok || !(await responseIsRetryable(response))) return;
      delayMs = retryAfterMs(response, Date.now()) ?? delayMs;
    } catch {
      if (attempt === MAX_CLAIM_ATTEMPTS - 1) return;
    }
    if (attempt < MAX_CLAIM_ATTEMPTS - 1) await wait(delayMs);
  }
}
