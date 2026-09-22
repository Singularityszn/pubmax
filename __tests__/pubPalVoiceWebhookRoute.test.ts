import { createHmac } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const voiceWebhookState = vi.hoisted(() => ({
  configured: true,
  rpc: vi.fn(),
}));

vi.mock("@/lib/supabase", () => ({
  isSupabaseConfigured: () => voiceWebhookState.configured,
  requireSupabaseAdmin: () => ({ rpc: voiceWebhookState.rpc }),
}));

import { POST } from "@/app/api/webhooks/elevenlabs/pub-pal/route";

const SECRET = "webhook-test-secret";
const AGENT = "pub-pal-test-agent";

function makeRequest(payload: unknown, timestamp = Math.floor(Date.now() / 1000), secret = SECRET) {
  const body = JSON.stringify(payload);
  const digest = createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex");
  return new Request("https://example.test/api/webhooks/elevenlabs/pub-pal", {
    method: "POST",
    headers: { "content-type": "application/json", "elevenlabs-signature": `t=${timestamp},v0=${digest}` },
    body,
  });
}

function payload(overrides: Record<string, unknown> = {}) {
  return {
    type: "post_call_transcription",
    event_timestamp: 1_790_000_000,
    data: {
      agent_id: AGENT,
      conversation_id: "conv-123",
      status: "done",
      transcript: [{ message: "must not persist" }],
      metadata: { call_duration_secs: 75 },
      ...overrides,
    },
  };
}

describe("Pub Pal provider reconciliation callback", () => {
  beforeEach(() => {
    voiceWebhookState.configured = true;
    voiceWebhookState.rpc.mockReset().mockResolvedValue({ data: true, error: null });
    vi.stubEnv("ELEVENLABS_PUB_PAL_WEBHOOK_SECRET", SECRET);
    vi.stubEnv("ELEVENLABS_PUB_PAL_AGENT_ID", AGENT);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("authenticates the raw callback and reconciles duration without forwarding transcript", async () => {
    const response = await POST(makeRequest(payload()));

    expect(response.status).toBe(200);
    expect(voiceWebhookState.rpc).toHaveBeenCalledOnce();
    expect(voiceWebhookState.rpc).toHaveBeenCalledWith("reconcile_pub_pal_voice_conversation", {
      p_conversation_id: "conv-123",
      p_event_timestamp: 1_790_000_000,
      p_status: "done",
      p_duration_seconds: 75,
    });
    expect(JSON.stringify(voiceWebhookState.rpc.mock.calls)).not.toContain("must not persist");
  });

  it("rejects invalid signature and agent before database writes", async () => {
    const invalid = await POST(makeRequest(payload(), undefined, "wrong-secret"));
    const wrongAgent = await POST(makeRequest(payload({ agent_id: "other-agent" })));

    expect(invalid.status).toBe(401);
    expect(wrongAgent.status).toBe(500);
    expect(voiceWebhookState.rpc).not.toHaveBeenCalled();
  });

  it("fails closed if durable callback storage is unavailable", async () => {
    voiceWebhookState.configured = false;
    const response = await POST(makeRequest(payload()));

    expect(response.status).toBe(503);
    expect(voiceWebhookState.rpc).not.toHaveBeenCalled();
  });

  it("acknowledges other authenticated provider events without writing them", async () => {
    const response = await POST(makeRequest({
      type: "post_call_audio",
      event_timestamp: 1_790_000_000,
      data: { agent_id: AGENT, conversation_id: "conv-123" },
    }));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ received: true, ignored: true });
    expect(voiceWebhookState.rpc).not.toHaveBeenCalled();
  });
});
