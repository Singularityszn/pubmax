import { describe, expect, it } from "vitest";

import {
  assessPubmaxxHandle,
  evaluateHandleRename,
  HANDLE_RENAME_COOLDOWN_MS,
  RESERVED_CONTRIBUTOR_HANDLES,
} from "@/lib/pubmaxxIdentity";

describe("PUBMAXX handle policy", () => {
  it("accepts a canonical case-insensitive handle", () => {
    expect(assessPubmaxxHandle("  @Night_Owl  ")).toEqual({
      ok: true,
      handle: "night_owl",
    });
  });

  it("rejects malformed, short, reserved, and impersonating handles", () => {
    expect(assessPubmaxxHandle("ab")).toMatchObject({ ok: false, reason: "invalid" });
    expect(assessPubmaxxHandle("night-owl")).toMatchObject({ ok: false, reason: "invalid" });
    expect(assessPubmaxxHandle("PUBMAXX")).toMatchObject({ ok: false, reason: "reserved" });
    expect(assessPubmaxxHandle("pubmaxx_support")).toMatchObject({ ok: false, reason: "reserved" });
    for (const handle of RESERVED_CONTRIBUTOR_HANDLES) {
      expect(assessPubmaxxHandle(handle)).toMatchObject({
        ok: false,
        reason: "reserved",
      });
    }
  });

  it("enforces a thirty-day rename cooldown and reports the exact retry time", () => {
    const now = Date.parse("2026-07-15T12:00:00.000Z");
    const changedAt = new Date(now - HANDLE_RENAME_COOLDOWN_MS + 1_000).toISOString();

    expect(evaluateHandleRename({ changedAt, now })).toEqual({
      allowed: false,
      retryAt: new Date(now + 1_000).toISOString(),
    });
    expect(
      evaluateHandleRename({
        changedAt: new Date(now - HANDLE_RENAME_COOLDOWN_MS).toISOString(),
        now,
      }),
    ).toEqual({ allowed: true });
  });
});
