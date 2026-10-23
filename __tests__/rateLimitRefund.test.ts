import { createClient } from "@supabase/supabase-js";
import { beforeEach, expect, it, vi } from "vitest";
import type { Database } from "@/types/database";

const boundary = vi.hoisted(() => ({ getClient: () => null as unknown }));
vi.mock("@/lib/supabase", () => ({ getSupabaseAdmin: () => boundary.getClient() }));
import { refundRateLimitHit } from "@/lib/rateLimitRefund.server";

const KEY = "ors-global:2026-10-23";
const FIRST = "2026-10-23T10:00:00+00:00";
const SECOND = "2026-10-23T10:01:00+00:00";
const THIRD = "2026-10-23T10:02:00+00:00";
let hits: string[];
let writes: number;
let beforeWrite: (() => void) | undefined;
let refuseWrites: boolean;
let loseWriteReply: boolean;

beforeEach(() => {
  hits = [FIRST, SECOND];
  writes = 0;
  beforeWrite = undefined;
  refuseWrites = false;
  loseWriteReply = false;
  boundary.getClient = () => createClient<Database>("http://fixture.invalid", "fixture-key", {
    auth: { persistSession: false },
    global: { fetch: async (input, init) => {
      const url = new URL(String(input));
      expect(url.pathname).toBe("/rest/v1/rate_limits");
      expect(url.searchParams.get("key")).toBe(`eq.${KEY}`);
      if (init?.method === "PATCH") {
        writes += 1;
        beforeWrite?.();
        beforeWrite = undefined;
        const matches = url.searchParams.get("hits") === `eq.{${hits.map((hit) => `"${hit}"`).join(",")}}`;
        if (!matches || refuseWrites) return Response.json([]);
        const body = JSON.parse(String(init.body)) as { hits: string[] };
        hits = body.hits;
        if (loseWriteReply) return Response.json({ message: "reply unavailable" }, { status: 500 });
        return Response.json([{ key: KEY }]);
      }
      return Response.json([{ hits: [...hits] }]);
    } },
  });
});

it("returns one unit through the real Supabase HTTP client", async () => {
  expect(await refundRateLimitHit(KEY)).toBe(true);
  expect(hits).toEqual([FIRST]);
  expect(writes).toBe(1);
});

it("retains a concurrent charge when its first comparison misses", async () => {
  beforeWrite = () => { hits.push(THIRD); };
  expect(await refundRateLimitHit(KEY)).toBe(true);
  expect(hits).toEqual([FIRST, SECOND]);
  expect(writes).toBe(2);
});

it("returns exactly two units for two concurrent refunds", async () => {
  hits.push(THIRD);
  expect(await Promise.all([refundRateLimitHit(KEY), refundRateLimitHit(KEY)])).toEqual([true, true]);
  expect(hits).toEqual([FIRST]);
});

it("does not retry a write whose success is unknown", async () => {
  loseWriteReply = true;
  expect(await refundRateLimitHit(KEY)).toBe(false);
  expect(writes).toBe(1);
  expect(hits).toEqual([FIRST]);
});

it("bounds definite comparison retries without replacing another writer", async () => {
  refuseWrites = true;
  expect(await refundRateLimitHit(KEY)).toBe(false);
  expect(writes).toBe(3);
  expect(hits).toEqual([FIRST, SECOND]);
});
