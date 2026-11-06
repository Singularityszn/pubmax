import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

vi.mock("@/lib/supabase", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/supabase")>();
  return {
    ...actual,
    isSupabaseConfigured: () => false,
    requiresSupabaseStore: () => false,
  };
});

import { GET } from "@/app/api/cron/purge-pub-pal-turns/route";
import {
  __resetPubPalToolTurnStore,
  hasStoredPubPalToolTurnForTest,
  PUB_PAL_TOOL_TURN_TTL_MS,
  registerPubPalToolTurn,
} from "@/lib/pubPalToolTurnStore";

const CONVERSATION_ID = "conv_purgecron01";
const OWNER_ID = "11111111-1111-4111-8111-111111111111";

function cronRequest(headers: Record<string, string> = {}): Request {
  return new Request("http://localhost/api/cron/purge-pub-pal-turns", { headers });
}

beforeEach(() => {
  vi.stubEnv("CRON_SECRET", "cron-secret");
  __resetPubPalToolTurnStore();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  __resetPubPalToolTurnStore();
});

describe("Pub Pal line purge cron", () => {
  it("refuses a caller without the cron secret", async () => {
    const response = await GET(cronRequest());
    expect(response.status).toBe(401);
  });

  it("deletes a stored line once its window has passed and keeps a live one", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-02T12:00:00.000Z"));
    await registerPubPalToolTurn(CONVERSATION_ID, {
      query: "quiet pubs in Clapham",
      cityId: "london",
      ownerId: OWNER_ID,
    });

    const early = await GET(cronRequest({ Authorization: "Bearer cron-secret" }));
    expect(early.status).toBe(200);
    expect(hasStoredPubPalToolTurnForTest(CONVERSATION_ID)).toBe(true);

    vi.setSystemTime(new Date(Date.now() + PUB_PAL_TOOL_TURN_TTL_MS + 1));
    expect(hasStoredPubPalToolTurnForTest(CONVERSATION_ID)).toBe(true);
    const late = await GET(cronRequest({ Authorization: "Bearer cron-secret" }));
    expect(late.status).toBe(200);
    await expect(late.json()).resolves.toEqual({ ok: true });
    expect(hasStoredPubPalToolTurnForTest(CONVERSATION_ID)).toBe(false);
  });

  it("runs every minute in production", () => {
    const config = JSON.parse(readFileSync(join(process.cwd(), "vercel.json"), "utf8")) as {
      crons?: Array<{ path?: string; schedule?: string }>;
    };
    expect(config.crons).toContainEqual({
      path: "/api/cron/purge-pub-pal-turns",
      schedule: "* * * * *",
    });
  });
});
