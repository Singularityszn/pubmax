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

// An iPhone email link opened on another device cannot reach the app that
// holds its verifier, so that browser gets a plain answer instead of a
// redirect to a scheme it cannot open.
describe("iPhone email link opened on another device", () => {
  const desktop = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0 Safari/537.36";
  const iphone = "Mozilla/5.0 (iPhone; CPU iPhone OS 19_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148";
  const emailLink = `https://pubmaxxing.com/auth/callback?native=ios-email-pkce&code=one-use-code&_authAttempt=${attempt}`;
  const get = (userAgent?: string, link = emailLink) =>
    GET(new Request(link, userAgent ? { headers: { "user-agent": userAgent } } : undefined));

  it("tells a desktop browser to open the link on the iPhone that asked for it", async () => {
    const response = await get(desktop);
    expect(response.status).toBe(200);
    expect(response.headers.get("location")).toBeNull();
    expect(response.headers.get("content-type")).toBe("text/html; charset=utf-8");
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("referrer-policy")).toBe("no-referrer");
    expect(response.headers.get("x-robots-tag")).toBe("noindex, nofollow");
    const html = await response.text();
    expect(html).toContain("Open this link on your iPhone");
    expect(html).toContain('href="/login"');
    // An iPad that reports a desktop browser can still hand the link to the app.
    expect(html).toContain(`href="pubmaxx://native-email/callback?code=one-use-code&amp;_authAttempt=${attempt}#"`);
    expect(html).not.toMatch(/<script|style=/);
  });

  it.each([["an iPhone", iphone], ["no browser identity", undefined]])("still relays to the app for %s", async (_label, userAgent) => {
    const response = await get(userAgent);
    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe(`pubmaxx://native-email/callback?code=one-use-code&_authAttempt=${attempt}#`);
  });

  it("keeps the provider return a redirect, because it never leaves the iPhone sheet", async () => {
    const response = await get(desktop, `https://pubmaxxing.com/auth/callback?native=ios-pkce&code=one-use-code&_authAttempt=${attempt}`);
    expect(response.status).toBe(307);
  });
});
