import { createHmac, timingSafeEqual } from "node:crypto";

export type ElevenLabsSignature = { timestamp: number; digest: string };

export function parseElevenLabsSignature(value: string | null | undefined): ElevenLabsSignature | null {
  if (!value || value.length > 512) return null;
  let timestamp: string | undefined;
  let digest: string | undefined;
  for (const pair of value.split(",")) {
    const separator = pair.indexOf("=");
    if (separator < 1) return null;
    const key = pair.slice(0, separator).trim();
    const item = pair.slice(separator + 1).trim();
    if (key === "t") {
      if (timestamp !== undefined) return null;
      timestamp = item;
    } else if (key === "v0") {
      if (digest !== undefined) return null;
      digest = item;
    }
  }
  if (!timestamp || !/^\d{1,12}$/.test(timestamp) || !digest || !/^[a-f\d]{64}$/i.test(digest)) return null;
  const parsed = Number(timestamp);
  return Number.isSafeInteger(parsed) && parsed > 0
    ? { timestamp: parsed, digest: digest.toLowerCase() }
    : null;
}

/** Verifies the provider's t={unix},v0={hex} signature over `t.rawBody`. */
export function verifyElevenLabsWebhookSignature(
  rawBody: string,
  signature: string | null | undefined,
  secret: string,
  nowMs: number = Date.now(),
  maxAgeSeconds = 60 * 60,
): boolean {
  if (!secret.trim()) return false;
  const parsed = parseElevenLabsSignature(signature);
  if (!parsed || !Number.isFinite(nowMs) || !Number.isFinite(maxAgeSeconds) || maxAgeSeconds <= 0) return false;
  if (Math.abs(Math.floor(nowMs / 1000) - parsed.timestamp) > maxAgeSeconds) return false;
  const expected = createHmac("sha256", secret)
    .update(`${parsed.timestamp}.${rawBody}`, "utf8")
    .digest();
  const supplied = Buffer.from(parsed.digest, "hex");
  return expected.length === supplied.length && timingSafeEqual(expected, supplied);
}
