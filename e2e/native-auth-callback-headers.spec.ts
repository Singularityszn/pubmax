import { expect, test } from "@playwright/test";

const attempt = "a".repeat(32);
const IPHONE_USER_AGENT = "Mozilla/5.0 (iPhone; CPU iPhone OS 19_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148";

// Exercise Next's HTTP response writer, which route-handler unit tests bypass.
for (const [mode, destination] of [
  ["ios-pkce", "pubmaxx://native-auth/callback"],
  ["ios-email-pkce", "pubmaxx://native-email/callback"],
]) {
  for (const denied of [false, true]) {
    test(`${mode} ${denied ? "refused" : "valid"} callback serves no-referrer`, async ({ request }) => {
      const response = await request.get(
        `/auth/callback?native=${mode}&code=one-use-code&_authAttempt=${attempt}${denied ? "&error=access_denied" : ""}`,
        { maxRedirects: 0, headers: { "user-agent": IPHONE_USER_AGENT } },
      );

      expect(response.status()).toBe(307);
      expect(response.headers()["location"]).toBe(
        `${destination}?${denied ? "" : "code=one-use-code&"}_authAttempt=${attempt}#`,
      );
      expect(response.headers()["cache-control"]).toBe("no-store");
      expect(response.headers()["referrer-policy"]).toBe("no-referrer");
      expect(response.headers()["x-content-type-options"]).toBe("nosniff");
      expect(response.headers()["x-frame-options"]).toBe("DENY");
    });
  }
}

for (const query of ["", "&native=unsupported"]) {
  test(`web callback retains its baseline referrer policy: ${query || "no native mode"}`, async ({ request }) => {
    const response = await request.get(
      `/auth/callback?_authAttempt=${attempt}&next=/u/you${query}`,
      { maxRedirects: 0 },
    );

    expect(response.status()).toBe(307);
    expect(new URL(response.headers()["location"]).pathname).toBe("/u/you");
    expect(response.headers()["referrer-policy"]).toBe("strict-origin-when-cross-origin");
  });
}

// Next's writer must keep the same private headers on the other-device page.
test("an iPhone email link opened on a desktop gets a no-referrer help page", async ({ request }) => {
  const response = await request.get(
    `/auth/callback?native=ios-email-pkce&code=one-use-code&_authAttempt=${attempt}`,
    { maxRedirects: 0 },
  );

  expect(response.status()).toBe(200);
  expect(response.headers()["location"]).toBeUndefined();
  expect(response.headers()["cache-control"]).toBe("no-store");
  expect(response.headers()["referrer-policy"]).toBe("no-referrer");
  expect(await response.text()).toContain("Open this link on your iPhone");
});

test("native mode on another route retains the baseline referrer policy", async ({ request }) => {
  const response = await request.get("/api/version?native=ios-email-pkce");

  expect(response.status()).toBe(200);
  expect(response.headers()["referrer-policy"]).toBe("strict-origin-when-cross-origin");
});
