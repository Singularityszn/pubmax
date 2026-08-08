import { afterEach, describe, expect, it, vi } from "vitest";

import {
  evaluateSocialModerationFindings,
  notifySocialModerationFindings,
  SOCIAL_MODERATION_PENDING_AGE_ALERT_MS,
  SOCIAL_MODERATION_PENDING_ALERT_FLOOR,
} from "@/lib/socialModerationNotify";
import type { SocialPostFields } from "@/lib/socialPosts";
import {
  createMemorySocialPostStore,
  type SocialPostActor,
} from "@/lib/socialPostStore";

const actor: SocialPostActor = {
  accountId: "acct-alice",
  profileId: "11111111-1111-4111-8111-111111111111",
  handle: "alice",
};

function baseFields(body: string): SocialPostFields {
  return {
    kind: "standard",
    body,
    visibility: "friends",
    area: null,
    venueId: null,
    hashtags: [],
    commentPolicy: "open",
    photo: null,
  };
}

describe("social moderation operator alert", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("stays quiet when the queue is empty and the last drain was clean", () => {
    expect(
      evaluateSocialModerationFindings(
        { pending: 0, strandedTerminal: 0, oldestPendingAgeMs: null },
        { terminalErrors: 0, retried: 0 },
      ),
    ).toEqual({ findings: [] });
  });

  it("reports stranded pending posts as their own named finding", () => {
    const { findings } = evaluateSocialModerationFindings({
      pending: 2,
      strandedTerminal: 2,
      oldestPendingAgeMs: 5_000,
    });
    expect(findings.some((f) => f.kind === "stranded_terminal")).toBe(true);
    expect(findings.find((f) => f.kind === "stranded_terminal")?.detail).toMatch(
      /nothing to review/i,
    );
  });

  it("reports a growing pending backlog above the floor", () => {
    const { findings } = evaluateSocialModerationFindings({
      pending: SOCIAL_MODERATION_PENDING_ALERT_FLOOR,
      strandedTerminal: 0,
      oldestPendingAgeMs: 1_000,
    });
    expect(findings.some((f) => f.kind === "pending_backlog")).toBe(true);
  });

  it("reports an aged pending backlog even below the count floor", () => {
    const { findings } = evaluateSocialModerationFindings({
      pending: 1,
      strandedTerminal: 0,
      oldestPendingAgeMs: SOCIAL_MODERATION_PENDING_AGE_ALERT_MS,
    });
    expect(findings.some((f) => f.kind === "pending_backlog")).toBe(true);
  });

  it("reports repeated terminal failures from the latest drain", () => {
    const { findings } = evaluateSocialModerationFindings(
      { pending: 1, strandedTerminal: 0, oldestPendingAgeMs: 1_000 },
      { terminalErrors: 3, retried: 0 },
    );
    expect(findings.some((f) => f.kind === "repeated_failures")).toBe(true);
    expect(findings.find((f) => f.kind === "repeated_failures")?.terminalErrors).toBe(3);
  });

  it("logs ALERT lines when notify is called with stranded pending", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const result = notifySocialModerationFindings({
      pending: 1,
      strandedTerminal: 1,
      oldestPendingAgeMs: 60_000,
    });
    expect(result.findings.length).toBeGreaterThan(0);
    expect(
      error.mock.calls.some((call) => String(call[0]).includes("[social-moderation][ALERT]")),
    ).toBe(true);
  });

  it("inspectModerationBacklog counts stranded terminal jobs in memory", async () => {
    const store = createMemorySocialPostStore({
      now: () => new Date("2026-08-08T12:00:00.000Z"),
    });
    await store.create(actor, baseFields("held one"));
    await store.create(actor, baseFields("held two"));

    // Non-retryable failures strand immediately (exhausted / terminal hold).
    const failing = {
      moderate: async () => {
        throw Object.assign(new Error("OpenAI down"), { retryable: false });
      },
    };
    const drain = await store.processModerationQueue(failing, 20);
    expect(drain.terminalErrors).toBe(2);

    const backlog = await store.inspectModerationBacklog(
      Date.parse("2026-08-08T12:45:00.000Z"),
    );
    expect(backlog.pending).toBe(2);
    expect(backlog.strandedTerminal).toBe(2);
    expect(backlog.oldestPendingAgeMs).toBeGreaterThan(0);

    const { findings } = evaluateSocialModerationFindings(backlog, {
      terminalErrors: 2,
      retried: 0,
    });
    expect(findings.some((f) => f.kind === "stranded_terminal")).toBe(true);
    expect(findings.some((f) => f.kind === "repeated_failures")).toBe(true);
  });
});
