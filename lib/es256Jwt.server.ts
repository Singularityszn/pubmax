import "server-only";

import { createPrivateKey, sign as cryptoSign } from "node:crypto";

function base64urlJson(value: unknown): string {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
}

/**
 * A compact ES256 JWT signed with an Apple `.p8` key. The signature is JOSE raw
 * r‖s (`ieee-p1363`), not DER, which is what Apple verifies. Throws when the
 * key cannot be parsed.
 */
export function signEs256Jwt(keyId: string, claims: Record<string, unknown>, privateKey: string): string {
  const signingInput = `${base64urlJson({ alg: "ES256", kid: keyId })}.${base64urlJson(claims)}`;
  const signature = cryptoSign("sha256", Buffer.from(signingInput, "utf8"), {
    key: createPrivateKey(privateKey),
    dsaEncoding: "ieee-p1363",
  });
  return `${signingInput}.${signature.toString("base64url")}`;
}
