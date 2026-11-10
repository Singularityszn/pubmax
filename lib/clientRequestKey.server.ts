import "server-only";

import { createHmac } from "node:crypto";

import { trustedSigningKey } from "@/lib/trustedSigningKey.server";

/** A request key the client minted once and resends on every retry. */
export function validClientRequestKey(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9._:-]{16,128}$/.test(value);
}

/** A UUID-shaped HMAC of `material`, under the server's signing key. */
export function signedUuid(material: string): string {
  const hex = createHmac("sha256", trustedSigningKey()).update(material).digest("hex").slice(0, 32);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20)}`;
}

export function clientRequestRowId(kind: "pint-drop" | "round", actor: string, key: unknown): string | null {
  if (!validClientRequestKey(key)) return null;
  return signedUuid(`client-request:${kind}:${actor.toLowerCase()}:${key}`);
}
