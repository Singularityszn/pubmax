/**
 * An unsigned access token whose GoTrue `amr` names one sign-in method. The
 * unowned callback path reads the method from the token GoTrue just minted,
 * so its fixtures need a structurally real JWT, not an opaque string.
 */
export function accessTokenWithMethod(tag: string, method = "otp"): string {
  const encode = (value: object) =>
    Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
  return [
    encode({ alg: "HS256", typ: "JWT" }),
    encode({ tag, role: "authenticated", amr: [{ method, timestamp: 1_790_000_000 }] }),
    "unsigned",
  ].join(".");
}
