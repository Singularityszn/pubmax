import { afterEach, describe, expect, it, vi } from "vitest";
import { defined } from "@/__tests__/helpers/defined";

describe("PostHog AI generation capture", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
    delete process.env.POSTHOG_PROJECT_API_KEY;
    delete process.env.NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN;
  });

  it("sends metadata only on $ai_generation", async () => {
    process.env.NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN = "phc_test";
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal("fetch", fetchMock);
    const { capturePosthogAiGeneration } = await import("@/lib/posthog/posthogAiCapture");
    capturePosthogAiGeneration({
      route: "api/heritage",
      model: "anthropic/claude-sonnet-4-5",
      provider: "openrouter",
      latencyMs: 250,
      promptTokens: 10,
      completionTokens: 20,
      totalTokens: 30,
    });
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const body = JSON.parse(String(defined(fetchMock.mock.calls[0])[1]?.body));
    expect(body.event).toBe("$ai_generation");
    expect(body.properties.$ai_model).toBe("anthropic/claude-sonnet-4-5");
    expect(body.properties.$ai_input_tokens).toBe(10);
    expect(body.properties.$ai_input).toBeUndefined();
    expect(body.properties.$ai_output).toBeUndefined();
  });
});
