type Fetcher = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

const DEFAULT_MODERATION_TIMEOUT_MS = 10_000;

export class ProfileAvatarModerationError extends Error {
  constructor(message: string, public readonly retryable: boolean) {
    super(message);
  }
}

export type ProfileAvatarModerationAdapter = {
  moderate(imageUrl: string): Promise<{ decision: "approved" | "needs_review" }>;
};

/**
 * Image-only OpenAI omni-moderation for owned profile avatars.
 * Reuses the Social post adapter call shape (same model + endpoint) but never
 * sends text or any account identifier in the request body.
 */
export class OpenAIProfileAvatarModerationAdapter implements ProfileAvatarModerationAdapter {
  private readonly apiKey: string;
  private readonly fetcher: Fetcher;
  private readonly timeoutMs: number;

  constructor(options: { apiKey?: string; fetcher?: Fetcher; timeoutMs?: number } = {}) {
    this.apiKey = (options.apiKey ?? process.env.OPENAI_API_KEY ?? "").trim();
    if (!this.apiKey) {
      throw new ProfileAvatarModerationError("OpenAI moderation is not configured.", false);
    }
    this.fetcher = options.fetcher ?? fetch;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_MODERATION_TIMEOUT_MS;
  }

  async moderate(imageUrl: string): Promise<{ decision: "approved" | "needs_review" }> {
    if (typeof imageUrl !== "string" || !imageUrl.trim()) {
      throw new ProfileAvatarModerationError("OpenAI moderation returned no decision.", false);
    }
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    let response: Response;
    try {
      response = await this.fetcher("https://api.openai.com/v1/moderations", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "omni-moderation-latest",
          input: [{ type: "image_url", image_url: { url: imageUrl } }],
        }),
        signal: controller.signal,
      });
    } catch {
      throw new ProfileAvatarModerationError("OpenAI moderation request failed.", true);
    } finally {
      clearTimeout(timeout);
    }
    if (!response.ok) {
      const retryable = response.status === 408 || response.status === 429 || response.status >= 500;
      throw new ProfileAvatarModerationError(
        `OpenAI moderation returned ${response.status}.`,
        retryable,
      );
    }
    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      throw new ProfileAvatarModerationError("OpenAI moderation returned invalid JSON.", false);
    }
    const result = payload && typeof payload === "object" &&
      Array.isArray((payload as { results?: unknown }).results)
      ? (payload as { results: unknown[] }).results[0]
      : null;
    if (!result || typeof result !== "object" || typeof (result as { flagged?: unknown }).flagged !== "boolean") {
      throw new ProfileAvatarModerationError("OpenAI moderation returned no decision.", false);
    }
    return {
      decision: (result as { flagged: boolean }).flagged ? "needs_review" : "approved",
    };
  }
}
