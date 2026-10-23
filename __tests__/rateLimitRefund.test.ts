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
let stallWrite: boolean;
let throwWriteReply: boolean;
let signals: AbortSignal[];

beforeEach(() => {
  hits = [FIRST, SECOND];
  writes = 0;
  beforeWrite = undefined;
  refuseWrites = false;
  loseWriteReply = false;
  stallWrite = false;
  throwWriteReply = false;
  signals = [];
  boundary.getClient = () => createClient<Database>("http://fixture.invalid", "fixture-key", {
    auth: { persistSession: false },
    global: { fetch: async (input, init) => {
      const url = new URL(String(input));
      if (init?.signal) signals.push(init.signal);
      if (url.href.length > 8_192) return Response.json({ message: "URI too long" }, { status: 414 });
      if (init?.method === "POST") {
        expect(url.pathname).toBe("/rest/v1/rpc/refund_rate_limit_hit");
        expect(url.search).toBe("");
        writes += 1;
        if (stallWrite) {
          const signal = init.signal;
          if (!signal) throw new Error("Missing timeout signal");
          await new Promise<void>((_, reject) => {
            if (signal.aborted) reject(signal.reason);
            else signal.addEventListener("abort", () => reject(signal.reason), { once: true });
          });
        }
        beforeWrite?.();
        beforeWrite = undefined;
        const body = JSON.parse(String(init.body)) as { p_key: string };
        expect(body.p_key).toBe(KEY);
        if (refuseWrites) return Response.json(false);
        hits = hits.slice(0, -1);
        if (throwWriteReply) throw new TypeError("connection lost");
        if (loseWriteReply) return Response.json({ message: "reply unavailable" }, { status: 500 });
        return Response.json(true);
      }
      throw new Error(`Unexpected refund request: ${init?.method} ${url.pathname}`);
    } },
  });
});

it("returns one unit through the real Supabase HTTP client", async () => {
  expect(await refundRateLimitHit(KEY)).toBe(true);
  expect(hits).toEqual([FIRST]);
  expect(writes).toBe(1);
});

it("retains a concurrent charge when the refund runs", async () => {
  beforeWrite = () => { hits.push(THIRD); };
  expect(await refundRateLimitHit(KEY)).toBe(true);
  expect(hits).toEqual([FIRST, SECOND]);
  expect(writes).toBe(1);
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

it("does not retry a refused refund or replace another writer", async () => {
  refuseWrites = true;
  expect(await refundRateLimitHit(KEY)).toBe(false);
  expect(writes).toBe(1);
  expect(new Set(signals).size).toBe(1);
  expect(hits).toEqual([FIRST, SECOND]);
});

it("refunds a 2,000-entry bucket through a bounded URL", async () => {
  hits = Array.from({ length: 2_000 }, () => FIRST);
  expect(await refundRateLimitHit(KEY)).toBe(true);
  expect(hits).toHaveLength(1_999);
  expect(writes).toBe(1);
});

it("accepts an empty bucket without charging it", async () => {
  hits = [];
  expect(await refundRateLimitHit(KEY)).toBe(true);
  expect(writes).toBe(1);
});

it("does not repeat a committed write after a network rejection", async () => {
  throwWriteReply = true;
  expect(await refundRateLimitHit(KEY)).toBe(false);
  expect(writes).toBe(1);
  expect(hits).toEqual([FIRST]);
});

it("bounds a stalled refund with the overall timeout", async () => {
  stallWrite = true;
  expect(await refundRateLimitHit(KEY)).toBe(false);
  expect(writes).toBe(1);
  expect(signals.every((signal) => signal.aborted)).toBe(true);
  expect(hits).toEqual([FIRST, SECOND]);
});
