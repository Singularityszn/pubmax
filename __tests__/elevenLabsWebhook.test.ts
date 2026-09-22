import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";

import { parseElevenLabsSignature, verifyElevenLabsWebhookSignature } from "@/lib/elevenLabsWebhook";

const SECRET = "provider-webhook-secret";
const RAW = '{"type":"post_call_transcription"}';

function signature(rawBody: string, timestamp: number): string {
  const digest = createHmac("sha256", SECRET)
    .update(`${timestamp}.${rawBody}`)
    .digest("hex");
  return `t=${timestamp},v0=${digest}`;
}

describe("ElevenLabs callback authentication", () => {
  it("verifies HMAC over timestamp and exact raw request bytes", () => {
    const timestamp = 1_790_000_000;
    expect(verifyElevenLabsWebhookSignature(RAW, signature(RAW, timestamp), SECRET, timestamp * 1000)).toBe(true);
    expect(verifyElevenLabsWebhookSignature(`${RAW} `, signature(RAW, timestamp), SECRET, timestamp * 1000)).toBe(false);
  });

  it("rejects malformed and stale signatures", () => {
    const timestamp = 1_790_000_000;
    expect(parseElevenLabsSignature("v0=bad,t=nope")).toBeNull();
    expect(verifyElevenLabsWebhookSignature(RAW, signature(RAW, timestamp), SECRET, (timestamp + 3_601) * 1000)).toBe(false);
  });
});
