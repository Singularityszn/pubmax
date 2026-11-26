import { beforeEach, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({ error: true }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/serverEnv", () => ({ assertServerEnv: () => {} }));
vi.mock("@/lib/supabase", async (original) => ({
  ...await original<typeof import("@/lib/supabase")>(),
  isSupabaseConfigured: () => true,
}));
vi.mock("@/lib/storeBackend", async (original) => ({
  ...await original<typeof import("@/lib/storeBackend")>(),
  admin: () => ({ from: () => {
    const query = {
      select: () => query, eq: () => query, limit: () => query,
      maybeSingle: async () => ({ data: null, error: db.error ? { message: "database unavailable" } : null }),
    };
    return query;
  } }),
}));
import { GET } from "@/app/api/crawls/[slug]/route";
import { GET as getCrawl } from "@/app/api/crawls/route";

beforeEach(() => { db.error = true; });
it("answers a failed crawl read as retryable and a missing crawl as not found", async () => {
  const request = new Request("http://localhost/api/crawls/example");
  const context = { params: Promise.resolve({ slug: "example" }) };
  const unavailable = await GET(request, context);
  expect(unavailable.status).toBe(503);
  expect(await unavailable.json()).toMatchObject({ retryable: true });
  db.error = false;
  expect((await GET(request, context)).status).toBe(404);
});

it("answers the slug query with a retryable error during an outage", async () => {
  const response = await getCrawl(new Request("http://localhost/api/crawls?slug=example"));
  expect(response.status).toBe(503);
  expect(await response.json()).toMatchObject({ retryable: true });
  db.error = false;
  expect((await getCrawl(new Request("http://localhost/api/crawls?slug=example"))).status).toBe(404);
});
