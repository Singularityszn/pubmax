import { randomInt } from "node:crypto";
import { expect, test } from "@playwright/test";

// npm run test:e2e:out-rate-limit owns the compiled keyless server and its
// production ceiling. The usual browser allowance prevents exhaustion.

for (const entry of ["api", "document"] as const) {
  test(`Out ${entry} requests exhaust the shared document and API budget`, async ({ request }) => {
    test.setTimeout(60_000);
    const headers = { "x-vercel-forwarded-for": `198.18.${randomInt(256)}.${randomInt(1, 255)}` };
    const startedAt = Date.now();
    for (let i = 0; i < 60; i++) {
      const day = ["today", "tomorrow", "weekend"][i % 3];
      const path = entry === "api" ? `/api/out?city=london&day=${day}` : `/out?day=${day}`;
      const response = await request.get(path, { headers });
      expect(response.status(), `Allowed ${entry} request ${i + 1}`).toBe(200);
      if (entry === "document") expect(await response.text()).not.toContain("Could not check listings.");
      await response.dispose();
    }
    // Requests must still belong to the same rolling minute.
    expect(Date.now() - startedAt).toBeLessThan(55_000);
    const api = await request.get("/api/out?city=london&day=today", { headers });
    expect.soft(api.status(), "The API must refuse after either entry spends 60 requests").toBe(429);
    for (const day of ["today", "tomorrow", "weekend"]) {
      const document = await request.get(`/out?day=${day}`, { headers });
      expect(document.status()).toBe(200);
      expect.soft(await document.text(), `The ${day} document must report unavailable listings`).toContain("Could not check listings.");
      await document.dispose();
    }
    expect(Date.now() - startedAt).toBeLessThan(60_000);
  });
}
