import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  client: null as unknown,
  requiresStore: false,
}));

vi.mock("@/lib/supabase", () => ({
  getSupabaseAdmin: () => state.client,
  requiresSupabaseStore: () => state.requiresStore,
}));

import { GET } from "@/app/api/health/route";
import {
  HEALTH_CACHE_MS,
  checkDatabaseHealth,
  resetDatabaseHealthCache,
} from "@/lib/healthProbe.server";

function clientAnswering(result: { error: unknown } | Error) {
  const abortSignal = vi.fn(async () => {
    if (result instanceof Error) throw result;
    return result;
  });
  const limit = vi.fn(() => ({ abortSignal }));
  const select = vi.fn(() => ({ limit }));
  const from = vi.fn(() => ({ select }));
  return { client: { from }, from, abortSignal };
}

beforeEach(() => {
  resetDatabaseHealthCache();
  state.client = null;
  state.requiresStore = false;
  process.env.NEXT_DEPLOYMENT_ID = "dpl_health";
});

afterEach(() => {
  delete process.env.NEXT_DEPLOYMENT_ID;
});

describe("GET /api/health", () => {
  it("answers 200 with the deployment id when the database answers", async () => {
    const answering = clientAnswering({ error: null });
    state.client = answering.client;
    const response = await GET();
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({ ok: true, deploymentId: "dpl_health", database: "ok" });
    expect(answering.from).toHaveBeenCalledWith("rate_limits");
  });

  it("answers 503 in the flat error envelope when the query fails, and leaks no error text", async () => {
    state.client = clientAnswering({ error: { message: "password authentication failed for user postgres" } }).client;
    const response = await GET();
    expect(response.status).toBe(503);
    const body = await response.json();
    expect(body).toMatchObject({
      ok: false,
      code: "DATABASE_UNAVAILABLE",
      retryable: true,
      deploymentId: "dpl_health",
      database: "down",
    });
    expect(JSON.stringify(body)).not.toMatch(/password|postgres/);
  });

  it("answers 503 when the query throws", async () => {
    state.client = clientAnswering(new Error("fetch failed")).client;
    expect((await GET()).status).toBe(503);
  });

  it("treats a keyless dev process as healthy and a keyless production process as down", async () => {
    expect(await (await GET()).json()).toMatchObject({ ok: true, database: "not_configured" });
    resetDatabaseHealthCache();
    state.requiresStore = true;
    expect((await GET()).status).toBe(503);
  });

  it("asks the database once per window", async () => {
    const answering = clientAnswering({ error: null });
    state.client = answering.client;
    let clock = 1_000;
    const now = () => clock;
    await checkDatabaseHealth({ now });
    await checkDatabaseHealth({ now });
    expect(answering.from).toHaveBeenCalledTimes(1);
    clock += HEALTH_CACHE_MS;
    await checkDatabaseHealth({ now });
    expect(answering.from).toHaveBeenCalledTimes(2);
  });
});
