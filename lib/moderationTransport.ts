import { discardBody } from "@/lib/responseBody";

type Fetcher = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

export async function fetchModerationPayload(
  fetcher: Fetcher,
  url: string,
  init: RequestInit,
  timeoutMs: number,
  provider: "OpenAI",
  error: (message: string, retryable: boolean) => Error,
): Promise<unknown> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    let response: Response;
    try {
      response = await fetcher(url, { ...init, signal: controller.signal });
    } catch {
      throw error(`${provider} moderation request failed.`, true);
    }
    if (!response.ok) {
      discardBody(response);
      throw error(
        `${provider} moderation returned ${response.status}.`,
        response.status === 408 || response.status === 429 || response.status >= 500,
      );
    }
    try {
      // Fetch resolves at headers. Keep the same deadline through the body.
      return await response.json();
    } catch {
      if (controller.signal.aborted) {
        throw error(`${provider} moderation request failed.`, true);
      }
      throw error(`${provider} moderation returned invalid JSON.`, false);
    }
  } finally {
    clearTimeout(timeout);
  }
}
