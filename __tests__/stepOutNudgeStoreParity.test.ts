import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  __resetStepOutNudgeStore,
  memoryStepOutNudgeStore,
  supabaseStepOutNudgeStore,
} from "@/lib/stepOutNudgeStore";

const db = vi.hoisted(() => ({ rows: [] as Record<string, unknown>[] }));

vi.mock("@/lib/supabase", async () => {
  const { createClient } = await import("@supabase/supabase-js");
  const client = createClient("https://store.test", "test-service-key", {
    auth: { persistSession: false, autoRefreshToken: false },
    global: {
      // Run the real adapter and PostgREST client against local rows only.
      fetch: async (input, init) => {
        const url = new URL(input instanceof Request ? input.url : String(input));
        if (url.origin !== "https://store.test" || url.pathname !== "/rest/v1/step_out_nudge_prefs") {
          throw new Error(`Unexpected store request: ${url.pathname}`);
        }
        const matches = (row: Record<string, unknown>) =>
          [...url.searchParams].every(([column, value]) =>
            column === "select" || value === `eq.${row[column]}`,
          );
        switch (init?.method) {
          case "POST": {
            const row = JSON.parse(String(init.body)) as Record<string, unknown>;
            const index = db.rows.findIndex((stored) => stored.owner_actor === row.owner_actor);
            if (index === -1) db.rows.push(row);
            else db.rows[index] = row;
            return Response.json(row);
          }
          case "PATCH": {
            const patch = JSON.parse(String(init.body)) as Record<string, unknown>;
            db.rows = db.rows.map((row) => matches(row) ? { ...row, ...patch } : row);
            return new Response(null, { status: 204 });
          }
          case "GET":
            return Response.json(db.rows.filter(matches));
          default:
            throw new Error(`Unexpected store method: ${init?.method}`);
        }
      },
    },
  });
  return {
    isSupabaseConfigured: () => true,
    requiresSupabaseStore: () => false,
    requireSupabaseAdmin: () => client,
  };
});

const ACTOR = "profile:11111111-1111-4111-8111-111111111111";
const OTHER_ACTOR = "profile:22222222-2222-4222-8222-222222222222";
const TOKEN = "webpush:store-parity";
const EARLIER = "2026-08-08T12:00:00.000Z";
const LATER = "2026-08-08T12:05:00.000Z";

beforeEach(() => {
  db.rows = [];
  __resetStepOutNudgeStore();
  vi.useFakeTimers();
  vi.setSystemTime(new Date(EARLIER));
});

afterEach(() => {
  vi.useRealTimers();
});

describe.each([
  ["memory", memoryStepOutNudgeStore],
  ["Supabase", supabaseStepOutNudgeStore],
] as const)("%s nudge send-stamp contract", (_name, store) => {
  it("stamps enabled lanes only for the selected account", async () => {
    for (const actor of [ACTOR, OTHER_ACTOR]) {
      await store.put(actor, { enabled: true, subscriptionToken: TOKEN });
      await store.optInCheapPint(actor, TOKEN);
    }
    const other = await store.get(OTHER_ACTOR);
    await store.markSent(ACTOR, LATER);
    await store.markCheapPintSent(ACTOR, LATER);
    expect(await store.get(ACTOR)).toMatchObject({
      enabled: true,
      cheapPintEnabled: true,
      subscriptionToken: TOKEN,
      lastSentAt: LATER,
      cheapPintSentAt: LATER,
      updatedAt: LATER,
    });
    expect(await store.get(OTHER_ACTOR)).toEqual(other);
  });

  it("ignores a delayed Step Out stamp after withdrawal", async () => {
    await store.put(ACTOR, { enabled: true, subscriptionToken: TOKEN });
    await store.optInCheapPint(ACTOR, TOKEN);
    await store.markSent(ACTOR, EARLIER);
    const withdrawn = await store.withdraw(ACTOR);
    await store.markSent(ACTOR, LATER);
    expect(await store.get(ACTOR)).toEqual(withdrawn);
    expect(withdrawn).toMatchObject({
      enabled: false,
      cheapPintEnabled: true,
      subscriptionToken: TOKEN,
      lastSentAt: EARLIER,
    });
  });

  it("ignores a delayed cheap-pint stamp after decline", async () => {
    await store.put(ACTOR, { enabled: true, subscriptionToken: TOKEN });
    await store.optInCheapPint(ACTOR, TOKEN);
    const declined = await store.declineCheapPint(ACTOR);
    await store.markCheapPintSent(ACTOR, LATER);
    expect(await store.get(ACTOR)).toEqual(declined);
    expect(declined).toMatchObject({
      enabled: true,
      cheapPintEnabled: false,
      cheapPintDeclined: true,
      subscriptionToken: TOKEN,
      cheapPintSentAt: null,
    });
  });

  it("does not create preferences when a send stamp has no account row", async () => {
    await store.markSent(ACTOR, LATER);
    await store.markCheapPintSent(ACTOR, LATER);
    expect(await store.get(ACTOR)).toBeNull();
  });
});
