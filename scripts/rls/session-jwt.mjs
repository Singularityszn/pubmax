import { createHmac } from "node:crypto";

const RLS_SESSION_JWT_LIFETIME_SECONDS = 15 * 60;

export function createRlsSessionJwt(secret, sub, role = "authenticated") {
  const encode = (value) => Buffer.from(JSON.stringify(value)).toString("base64url");
  const header = encode({ alg: "HS256", typ: "JWT" });
  const payload = encode({
    role,
    sub,
    exp: Math.floor(Date.now() / 1000) + RLS_SESSION_JWT_LIFETIME_SECONDS,
  });
  const signature = createHmac("sha256", secret)
    .update(`${header}.${payload}`)
    .digest("base64url");
  return `${header}.${payload}.${signature}`;
}
