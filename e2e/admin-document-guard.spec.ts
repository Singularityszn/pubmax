import { expect, test } from "@playwright/test";

const ADMIN_TOKEN = process.env.PW_E2E_ADMIN_TOKEN ?? "pubmax-e2e-admin-token";

test("anonymous GET /admin is not a 200", async ({ request }) => {
  const res = await request.get("/admin", { maxRedirects: 0 });
  expect(res.status()).not.toBe(200);
});

test("a moderator session cookie opens /admin", async ({ request }) => {
  const login = await request.post("/api/admin/session", {
    data: { token: ADMIN_TOKEN },
  });
  expect(login.ok()).toBeTruthy();
  const res = await request.get("/admin");
  expect(res.status()).toBe(200);
});
