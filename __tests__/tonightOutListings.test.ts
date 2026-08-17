import { describe, expect, it } from "vitest";

import { OUT_DEGRADED_LINE, OUT_READ_FAILED_LINE } from "@/lib/out/outStatus";
import {
  TONIGHT_OUT_NOT_CONFIGURED_LINE,
  TONIGHT_QUIET_NIGHT_SENTENCE,
  TONIGHT_WHATS_ON_CREDIT,
  TONIGHT_WHATS_ON_FAILED_LINE,
  mergeTonightListingRows,
  tonightEmptyLead,
  tonightListingLanes,
  tonightListingsNoteLine,
  tonightListingsStatus,
  tonightNoteOffersRetry,
  tonightProvenanceCredits,
  tonightRetryLanes,
  type TonightOutAnswer,
  type TonightWhatsOnStatus,
} from "@/lib/tonightOutListings";
import type { WhatsOnRow } from "@/lib/whatsOn";

const NOW = Date.parse("2026-09-01T00:00:00.000Z");
const NOW_ISO = new Date(NOW).toISOString();
const TONIGHT_START = new Date(NOW + 60 * 60_000).toISOString();

function row(partial: Partial<WhatsOnRow> & Pick<WhatsOnRow, "id" | "title">): WhatsOnRow {
  return {
    placeName: "Soho Theatre",
    kind: "event",
    startsAt: TONIGHT_START,
    source: { label: "Ticketmaster", url: "https://www.ticketmaster.co.uk/event/1" },
    observedAt: NOW_ISO,
    confidence: "listed",
    ...partial,
  };
}

function mergeWithFixture(whatsOnRows: WhatsOnRow[], outRows: WhatsOnRow[]) {
  return mergeTonightListingRows(whatsOnRows, outRows, NOW);
}

// Every status question is asked at the same instant the merge is asked at, so
// a fixture row cannot be tonight's for one and finished for the other.
function statusAtFixture(whatsOn: TonightWhatsOnStatus, out: TonightOutAnswer) {
  return tonightListingsStatus(whatsOn, out, NOW);
}

// A gig that started at 19:00 and carries the point-row grace has been over for
// hours by the fixture instant. /out is a whole-day list, so it still rides the
// response body.
const finishedOutRow = row({
  id: "tm-finished",
  title: "This Afternoon at the Playhouse",
  startsAt: new Date(NOW - 8 * 60 * 60_000).toISOString(),
});

const pendingOut: TonightOutAnswer = { body: null, failed: false, pending: true };
const emptyReadyOut: TonightOutAnswer = {
  body: { status: "ready", events: [] },
  failed: false,
  pending: false,
};
const eventOut: TonightOutAnswer = {
  body: { status: "ready", events: [row({ id: "tm-1", title: "A Night at the Playhouse" })] },
  failed: false,
  pending: false,
};
const degradedOut: TonightOutAnswer = {
  body: { status: "degraded", events: [], reason: "Out does not cover Bristol yet." },
  failed: false,
  pending: false,
};
const failedOut: TonightOutAnswer = { body: null, failed: true, pending: false };

describe("tonight Out merge", () => {
  it("keeps a ready Out event on the Tonight list", () => {
    const merged = mergeWithFixture(
      [],
      [row({ id: "tm-1", title: "A Night at the Playhouse" })],
    );
    expect(merged.map((item) => item.title)).toEqual(["A Night at the Playhouse"]);
  });

  it("dedupes the same listing and keeps the fresher observation", () => {
    const older = row({
      id: "quiz-1",
      kind: "quiz",
      title: "Quiz",
      observedAt: "2026-08-16T08:00:00.000Z",
    });
    const newer = row({
      id: "quiz-1",
      kind: "quiz",
      title: "Quiz (updated)",
      observedAt: "2026-08-16T10:00:00.000Z",
    });
    expect(mergeWithFixture([older], [newer]).map((item) => item.title)).toEqual([
      "Quiz (updated)",
    ]);
  });

  it("drops an Out listing that has already finished", () => {
    const merged = mergeWithFixture([], [finishedOutRow]);
    expect(merged).toEqual([]);
  });
});

describe("tonight listings status", () => {
  it("is ready when Out answered with cards", () => {
    expect(statusAtFixture("idle", eventOut)).toBe("ready");
    expect(statusAtFixture("empty", eventOut)).toBe("ready");
    expect(statusAtFixture("error", eventOut)).toBe("ready");
  });

  it("is ready when What's-On answered with cards", () => {
    expect(statusAtFixture("ready", pendingOut)).toBe("ready");
    expect(statusAtFixture("ready", emptyReadyOut)).toBe("ready");
  });

  it("stays idle while a read is still in flight and nothing is ready", () => {
    expect(statusAtFixture("idle", pendingOut)).toBe("idle");
    expect(statusAtFixture("idle", emptyReadyOut)).toBe("idle");
    expect(statusAtFixture("empty", pendingOut)).toBe("idle");
    expect(statusAtFixture("error", pendingOut)).toBe("idle");
  });

  it("is error when a finished read failed or degraded and nothing is ready", () => {
    expect(statusAtFixture("empty", degradedOut)).toBe("error");
    expect(statusAtFixture("empty", failedOut)).toBe("error");
    expect(statusAtFixture("error", emptyReadyOut)).toBe("error");
  });

  it("is empty only when both reads answered with nothing", () => {
    expect(statusAtFixture("empty", emptyReadyOut)).toBe("empty");
  });

  it("does not call a body of finished Out listings ready", () => {
    // The merge drops these rows, so a "ready" here paints no cards and no
    // quiet-night sentence either: the empty room this whole change exists for.
    const finishedOut: TonightOutAnswer = {
      body: { status: "ready", events: [finishedOutRow] },
      failed: false,
      pending: false,
    };
    expect(mergeWithFixture([], finishedOut.body?.events ?? [])).toEqual([]);
    expect(statusAtFixture("empty", finishedOut)).toBe("empty");
  });
});

describe("the error state always has a line to print", () => {
  it("names a reason for every answer that reaches the error state", () => {
    // The error box prints the note line, so a status that says "error" with
    // nothing to say would leave the reader an empty box.
    const errored: TonightOutAnswer[] = [failedOut, degradedOut];
    for (const out of errored) {
      expect(statusAtFixture("empty", out)).toBe("error");
      expect(tonightListingsNoteLine("empty", out)).not.toBeNull();
    }
    expect(statusAtFixture("error", emptyReadyOut)).toBe("error");
    expect(tonightListingsNoteLine("error", emptyReadyOut)).toBe(
      TONIGHT_WHATS_ON_FAILED_LINE,
    );
  });

  it("names the Out failure or degraded reason before the What's-On line", () => {
    expect(tonightListingsNoteLine("empty", failedOut)).toBe(OUT_READ_FAILED_LINE);
    expect(tonightListingsNoteLine("empty", degradedOut)).toBe(
      "Out does not cover Bristol yet.",
    );
    expect(
      tonightListingsNoteLine("empty", {
        body: { status: "degraded", events: [] },
        failed: false,
        pending: false,
      }),
    ).toBe(OUT_DEGRADED_LINE);
  });
});

describe("tonight listings note line", () => {
  const degradedWithRows: TonightOutAnswer = {
    body: {
      status: "degraded",
      events: [row({ id: "tm-1", title: "A Night at the Playhouse" })],
      reason: "Some listings could not be checked.",
    },
    failed: false,
    pending: false,
  };

  it("still names a degraded Out lane that answered with cards", () => {
    // The status is "ready" here, so the error block never renders: without a
    // note the reader sees a short list and reads it as a quiet city.
    expect(statusAtFixture("ready", degradedWithRows)).toBe("ready");
    expect(tonightListingsNoteLine("ready", degradedWithRows)).toBe(
      "Some listings could not be checked.",
    );
  });

  it("names a failed Out lane and a failed What's-On lane beside real cards", () => {
    expect(tonightListingsNoteLine("ready", failedOut)).toBe(OUT_READ_FAILED_LINE);
    expect(tonightListingsNoteLine("error", eventOut)).toBe(TONIGHT_WHATS_ON_FAILED_LINE);
  });

  it("is silent when both lanes answered", () => {
    expect(tonightListingsNoteLine("ready", eventOut)).toBeNull();
    expect(tonightListingsNoteLine("empty", emptyReadyOut)).toBeNull();
    expect(tonightNoteOffersRetry("ready", eventOut)).toBe(false);
  });

  it("keeps the What's-On lane's way back while Out's rows hold the list up", () => {
    // The page is ready off one Ticketmaster row, so the error box with its
    // Retry button never renders: without this the spine's failure is a
    // sentence and the rest of the night is unreachable short of a reload.
    expect(statusAtFixture("error", eventOut)).toBe("ready");
    expect(tonightNoteOffersRetry("error", eventOut)).toBe(true);
  });

  it("does not offer a retry for a lane asking again cannot change", () => {
    expect(tonightNoteOffersRetry("ready", degradedWithRows)).toBe(false);
    expect(tonightNoteOffersRetry("ready", failedOut)).toBe(false);
  });

  it("re-reads only the lane that reported", () => {
    // Re-reading a healthy lane drops the answer it holds, so a press meant to
    // recover the spine would replace the rendered Ticketmaster card with the
    // skeleton and could end with fewer rows than it started with.
    expect(tonightRetryLanes("error", eventOut)).toEqual({ whatsOn: true, out: false });
    expect(tonightRetryLanes("empty", failedOut)).toEqual({ whatsOn: false, out: true });
    expect(tonightRetryLanes("error", failedOut)).toEqual({ whatsOn: true, out: true });
    expect(tonightRetryLanes("ready", eventOut)).toEqual({ whatsOn: false, out: false });
  });
});

describe("an Out lane nobody switched on", () => {
  const notConfigured: TonightOutAnswer = {
    body: { status: "not-configured", listingsStatus: "not-configured", events: [] },
    failed: false,
    pending: false,
  };

  it("says the live lane was never asked instead of leaving the night quiet", () => {
    // The quiet-night sentence renders beside this, so with nothing said here
    // the page claims an absence on a read that never ran.
    expect(tonightListingsNoteLine("empty", notConfigured)).toBe(
      TONIGHT_OUT_NOT_CONFIGURED_LINE,
    );
  });

  it("is not an error and not a lane the reader can re-ask", () => {
    expect(statusAtFixture("empty", notConfigured)).toBe("empty");
    expect(tonightNoteOffersRetry("empty", notConfigured)).toBe(false);
  });

  it("names both lanes when the spine failed too", () => {
    expect(tonightListingsNoteLine("error", notConfigured)).toBe(
      `${TONIGHT_OUT_NOT_CONFIGURED_LINE} · ${TONIGHT_WHATS_ON_FAILED_LINE}`,
    );
    expect(tonightNoteOffersRetry("error", notConfigured)).toBe(true);
  });

  it("is never re-read, even beside a lane that is", () => {
    expect(tonightRetryLanes("empty", notConfigured)).toEqual({
      whatsOn: false,
      out: false,
    });
    expect(tonightRetryLanes("error", notConfigured)).toEqual({
      whatsOn: true,
      out: false,
    });
  });

  it("narrows the empty sentence to the lane that answered", () => {
    // The whole-city claim is untrue while the live lane was never asked.
    expect(tonightEmptyLead("empty", notConfigured)).toBe(
      `Nothing listed ${TONIGHT_WHATS_ON_CREDIT}.`,
    );
    expect(tonightEmptyLead("empty", notConfigured)).not.toContain("quiet one tonight");
  });
});

describe("the empty-night sentence", () => {
  it("says the city is quiet only when every lane answered", () => {
    expect(tonightEmptyLead("empty", emptyReadyOut)).toBe(TONIGHT_QUIET_NIGHT_SENTENCE);
    expect(TONIGHT_QUIET_NIGHT_SENTENCE).toContain("quiet one tonight");
  });
});

describe("tonight lane split", () => {
  it("attributes each surviving row to the read that put it there", () => {
    const whatsOnRow = row({ id: "quiz-1", kind: "quiz", title: "Quiz" });
    const outRow = row({ id: "tm-1", title: "A Night at the Playhouse" });
    const merged = mergeWithFixture([whatsOnRow], [outRow]);
    const lanes = tonightListingLanes(merged, [outRow]);
    expect(lanes.whatsOnCount).toBe(1);
    expect(lanes.outRows).toEqual([outRow]);
  });

  it("counts a row both lanes carried once, under the winning observation", () => {
    const older = row({ id: "tm-1", title: "Playhouse", observedAt: "2026-08-16T08:00:00.000Z" });
    const newer = row({ id: "tm-1", title: "Playhouse", observedAt: "2026-08-16T10:00:00.000Z" });
    const merged = mergeWithFixture([older], [newer]);
    expect(merged).toHaveLength(1);
    const lanes = tonightListingLanes(merged, [newer]);
    expect(lanes.whatsOnCount).toBe(0);
    expect(lanes.outRows).toEqual([newer]);
  });
});

describe("tonight provenance credits", () => {
  const outRow = row({
    id: "tm-1",
    title: "A Night at the Playhouse",
    source: { label: "Ticketmaster", url: "https://www.ticketmaster.co.uk/event/1" },
    observedAt: "2026-08-16T09:00:00.000Z",
  });

  it("credits and dates each lane by its own read", () => {
    const quiz = row({ id: "quiz-1", kind: "quiz", title: "Quiz" });
    const sport = row({ id: "sport-1", kind: "sport", title: "Match" });
    const credits = tonightProvenanceCredits({
      merged: mergeWithFixture([quiz, sport], [outRow]),
      outEvents: [outRow],
      whatsOnChecked: "Checked 15 Aug",
      outObservedAt: { ticketmaster: "2026-08-16T09:00:00.000Z" },
    });
    expect(credits.whatsOn).toBe("2 listings · Checked 15 Aug · via what’s-on");
    expect(credits.out).toBe("1 listing via Ticketmaster · Checked 16 Aug");
    expect(credits.dated).toBe(true);
  });

  it("never dates an Out row to the What's-On stamp", () => {
    const credits = tonightProvenanceCredits({
      merged: mergeWithFixture([], [outRow]),
      outEvents: [outRow],
      whatsOnChecked: "Checked 15 Aug",
      outObservedAt: {},
    });
    // Nothing came from What's-On, so that lane claims nothing at all, and the
    // Out line carries the row's OWN stated observation.
    expect(credits.whatsOn).toBeNull();
    expect(credits.out).toBe("1 listing via Ticketmaster · Checked 16 Aug");
  });

  it("takes the oldest of the sources one line covers and names them all", () => {
    const skiddle = row({
      id: "sk-1",
      placeName: "Village Underground",
      title: "Warehouse night",
      source: { label: "Skiddle", url: "https://www.skiddle.com/e/1" },
      observedAt: "2026-08-14T09:00:00.000Z",
    });
    const outEvents = [outRow, skiddle];
    const credits = tonightProvenanceCredits({
      merged: mergeWithFixture([], outEvents),
      outEvents,
      whatsOnChecked: null,
      outObservedAt: {},
    });
    expect(credits.out).toBe("2 listings via Ticketmaster and Skiddle · Checked 14 Aug");
    expect(credits.dated).toBe(true);
  });

  it("goes undated when a source it covers cannot be dated", () => {
    const skiddle = row({
      id: "sk-1",
      placeName: "Village Underground",
      title: "Warehouse night",
      source: { label: "Skiddle", url: "https://www.skiddle.com/e/1" },
      observedAt: "not-a-date",
    });
    const outEvents = [outRow, skiddle];
    const credits = tonightProvenanceCredits({
      merged: mergeWithFixture([], outEvents),
      outEvents,
      whatsOnChecked: null,
      outObservedAt: {},
    });
    expect(credits.out).toBe("2 listings via Ticketmaster and Skiddle");
    expect(credits.dated).toBe(false);
  });

  it("keeps the quiet night credited to What's-On when Out brought nothing", () => {
    const credits = tonightProvenanceCredits({
      merged: mergeWithFixture([], []),
      outEvents: [],
      whatsOnChecked: null,
    });
    expect(credits.whatsOn).toBe("Quiet night · undated · via what’s-on");
    expect(credits.out).toBeNull();
    expect(credits.dated).toBe(false);
  });

  it("says a dated quiet night in words rather than as a bare zero", () => {
    const credits = tonightProvenanceCredits({
      merged: [],
      outEvents: [],
      whatsOnChecked: "Checked 15 Aug",
    });
    expect(credits.whatsOn).toBe("Quiet night · Checked 15 Aug · via what’s-on");
    expect(credits.whatsOnDated).toBe(true);
  });
});

describe("tonight reads the listings lane's own health", () => {
  // /api/out widens its top-level status with the OPEN-PLANS read, so a plans
  // RPC nobody can reach (no Supabase, or migration 0110 unapplied) marks an
  // answer whose event providers both read fine.
  const plansDegradedOnly: TonightOutAnswer = {
    body: {
      status: "degraded",
      listingsStatus: "ready",
      events: [],
      reason: "Some listings could not be checked.",
    },
    failed: false,
    pending: false,
  };

  it("keeps a quiet night quiet when only the open-plans read failed", () => {
    expect(statusAtFixture("empty", plansDegradedOnly)).toBe("empty");
  });

  it("says nothing about listings that were checked", () => {
    expect(tonightListingsNoteLine("empty", plansDegradedOnly)).toBeNull();
  });

  it("still names a listings lane that really degraded", () => {
    const listingsDegraded: TonightOutAnswer = {
      body: {
        status: "degraded",
        listingsStatus: "degraded",
        listingsReason: "Some listings could not be checked.",
        events: [],
      },
      failed: false,
      pending: false,
    };
    expect(statusAtFixture("empty", listingsDegraded)).toBe("error");
    expect(tonightListingsNoteLine("empty", listingsDegraded)).toBe(
      "Some listings could not be checked.",
    );
  });
});
