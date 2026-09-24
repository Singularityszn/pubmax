import { expect, test } from "@playwright/test";

const baseUrl = process.env.PUB_PAL_PROOF_BASE_URL?.replace(/\/+$/, "");
const bearer = process.env.PUB_PAL_PROOF_BEARER?.trim();

test.describe("Pub Pal live voice", () => {
  test.skip(!baseUrl || !bearer, "needs PUB_PAL_PROOF_BASE_URL and PUB_PAL_PROOF_BEARER");

  test("voice token returns a signed session and species voice override", async ({ request }) => {
    const response = await request.post(`${baseUrl}/api/pub-pal/voice-token`, {
      headers: { authorization: `Bearer ${bearer}` },
    });
    expect(response.status()).toBe(200);
    const body = await response.json();
    expect(body.signedUrl).toBeTruthy();
    expect(body.overrides?.voiceId).toBeTruthy();
  });

  test("text ask answers through the concierge bridge", async ({ request }) => {
    const response = await request.post(`${baseUrl}/api/ask`, {
      headers: {
        authorization: `Bearer ${bearer}`,
        "content-type": "application/json",
      },
      data: {
        messages: [{ role: "user", content: "Cheapest pint near Camden tonight" }],
        surface: "pal",
      },
    });
    expect(response.status()).toBe(200);
  });
});
