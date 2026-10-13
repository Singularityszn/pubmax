import { describe, expect, it } from "vitest";
import { GET } from "@/app/auth/callback/route";

const attempt = "a".repeat(32);
describe("iPhone authentication session callback", () => {
  it("returns the one-use code to the fixed native callback and clears inherited fragments", async () => {
    const response = await GET(new Request(`https://pubmaxxing.com/auth/callback?native=ios-pkce&code=one-use-code&_authAttempt=${attempt}&next=https://evil.example`));
    const location = response.headers.get("location")!;
    expect(location).toBe(`pubmaxx://native-auth/callback?code=one-use-code&_authAttempt=${attempt}#`);
    // A redirect consumer inherits the original fragment only if Location has no #.
    const original = new URL("https://pubmaxxing.com/auth/callback#access_token=private&refresh_token=private");
    const target = new URL(location, original);
    if (!location.includes("#")) target.hash = original.hash;
    expect(target.hash).toBe("");
  });
  it.each([
    "code=one-use-code&error=access_denied",
    "code=one-use-code&code=duplicate",
    "code=one-use-code&error_code=expired",
    "code=bad%0Acode",
  ])("refuses an invalid code while keeping the callback fixed: %s", async (query) => {
    const response = await GET(new Request(`https://pubmaxxing.com/auth/callback?native=ios-pkce&_authAttempt=${attempt}&${query}`));
    expect(response.headers.get("location")).toBe(`pubmaxx://native-auth/callback?_authAttempt=${attempt}#`);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("referrer-policy")).toBe("no-referrer");
  });

  it("never relays tokens or referral data into the native URL", async () => {
    const response = await GET(new Request(`https://pubmaxxing.com/auth/callback?native=ios-pkce&code=one-use-code&_authAttempt=${attempt}&access_token=secret&refresh_token=secret&_referralSignupProof=private&next=//evil.example#access_token=secret`));
    expect(response.headers.get("location")).toBe(`pubmaxx://native-auth/callback?code=one-use-code&_authAttempt=${attempt}#`);
  });

  it.each(["", "&_authAttempt=" + "b".repeat(32)])("refuses missing or duplicate attempt IDs: %s", async (extra) => {
    const query = extra ? `&_authAttempt=${attempt}${extra}` : "";
    const response = await GET(new Request(`https://pubmaxxing.com/auth/callback?native=ios-pkce&code=one-use-code${query}`));
    expect(response.headers.get("location")).toBe("pubmaxx://native-auth/callback#");
  });
});
