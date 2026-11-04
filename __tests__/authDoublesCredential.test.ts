import { describe, expect, it } from "vitest";
import type { Page, Route } from "@playwright/test";
import { ACCOUNTS, accessJwt, installAuthDoubles, type AccountKey } from "../e2e/helpers/authDoubles";

type Handler = (route: Route) => unknown;
type Reply = { status?: number; body?: string; json?: unknown };

async function fixture() {
  const handlers = new Map<string, Handler>();
  const page = {
    route: async (pattern: string, handler: Handler) => { handlers.set(pattern, handler); },
    addInitScript: async () => {},
    evaluate: async () => {},
  } as unknown as Page;
  const auth = await installAuthDoubles(page);

  async function request(pattern: string, path: string, bearer: string | null, refreshToken?: string) {
    let reply: Reply | undefined;
    const headers = bearer ? { authorization: bearer } : {};
    const route = {
      request: () => ({
        url: () => "https://pubmaxx-e2e.supabase.co" + path,
        method: () => refreshToken ? "POST" : "GET",
        // Playwright permits this view to omit security-related headers.
        // The complete header APIs still expose the request's credential.
        headers: () => ({}),
        allHeaders: async () => headers,
        headerValue: async (name: string) => name.toLowerCase() === "authorization" ? bearer : null,
        postDataJSON: () => ({ refresh_token: refreshToken }),
      }),
      fulfill: async (value: Reply) => { reply = value; },
    } as unknown as Route;
    const handler = handlers.get(pattern);
    if (!handler) throw new Error("The requested fixture route was not registered");
    await handler(route);
    if (!reply) throw new Error("The fixture did not answer the request");
    const response = reply as Reply;
    return {
      status: response.status ?? 200,
      body: (response.json ?? (response.body ? JSON.parse(response.body) : null)) as Record<string, unknown>,
    };
  }
  return { auth, request };
}

const routes = [
  ["GoTrue user", "https://pubmaxx-e2e.supabase.co/**", "/auth/v1/user", "id"],
  ["canonical handle", "**/api/identity/handle/current", "/api/identity/handle/current", "handle"],
  ["onboarding", "**/api/identity/onboarding", "/api/identity/onboarding", "handle"],
] as const;

describe.each(routes)("credential-bound %s double", (_name, pattern, path, field) => {
  for (const key of ["A", "B"] as const) {
    for (const form of ["seeded", "minted"] as const) {
      it("answers for " + key + "'s " + form + " credential despite a different seeded account", async () => {
        const { auth, request } = await fixture();
        await auth.signedInAs(key === "A" ? "B" : "A");
        const token = form === "seeded" ? "pubmaxx-e2e-access-token-" + key : accessJwt(ACCOUNTS[key]);
        const result = await request(pattern, path, "Bearer " + token);
        expect(result.status).toBe(200);
        expect(result.body[field]).toBe(field === "id" ? ACCOUNTS[key].id : ACCOUNTS[key].handle);
      });
    }
  }

  it.each([null, "Bearer unknown-fixture-token"])("refuses an unknown owner instead of inventing account A: %s", async (bearer) => {
    const { request } = await fixture();
    const result = await request(pattern, path, bearer);
    expect(result.status).toBe(401);
    expect(result.body).not.toHaveProperty("id");
    expect(result.body).not.toHaveProperty("handle");
  });
});

describe("credential-bound refresh double", () => {
  for (const key of ["A", "B"] satisfies AccountKey[]) {
    it.each(["", "-rotated"])("keeps " + key + "'s refresh identity for suffix %s", async (suffix) => {
      const { auth, request } = await fixture();
      await auth.signedInAs(key === "A" ? "B" : "A");
      const result = await request("https://pubmaxx-e2e.supabase.co/**", "/auth/v1/token?grant_type=refresh_token", null, ACCOUNTS[key].refreshToken + suffix);
      expect(result.status).toBe(200);
      expect(result.body.user).toMatchObject({ id: ACCOUNTS[key].id });
    });
  }
});
