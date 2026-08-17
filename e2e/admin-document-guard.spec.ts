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
  // The cookie is Secure under `next start` while the baseURL is http, so the
  // request context's jar may drop it. Replay it by hand: the point is the
  // cookie lane, not Playwright's storage rules.
  const setCookie = login
    .headersArray()
    .filter((header) => header.name.toLowerCase() === "set-cookie")
    .map((header) => header.value.split(";")[0]?.trim())
    .filter((pair): pair is string => Boolean(pair))
    .join("; ");
  expect(setCookie).toContain("pubmax_admin_session=");
  const res = await request.get("/admin", { headers: { cookie: setCookie } });
  expect(res.status()).toBe(200);
});
