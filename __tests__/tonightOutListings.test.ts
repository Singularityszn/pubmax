import { describe, expect, it } from "vitest";

import { OUT_DEGRADED_LINE, OUT_READ_FAILED_LINE } from "@/lib/out/outStatus";
import {
  TONIGHT_WHATS_ON_FAILED_LINE,
  mergeTonightListingRows,
  tonightListingLanes,
  tonightListingsErrorLine,
  tonightListingsNoteLine,
  tonightListingsStatus,
  tonightProvenanceCredits,
  type TonightOutAnswer,
} from "@/lib/tonightOutListings";
import type { WhatsOnRow } from "@/lib/whatsOn";

function row(partial: Partial<WhatsOnRow> & Pick<WhatsOnRow, "id" | "title">): WhatsOnRow {
  return {
    placeName: "Soho Theatre",
    kind: "event",
    startsAt: "2026-08-16T19:00:00.000Z",
    source: { label: "Ticketmaster", url: "https://www.ticketmaster.co.uk/event/1" },
    observedAt: "2026-08-16T09:00:00.000Z",
    confidence: "listed",
    ...partial,
  };
}

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
    const merged = mergeTonightListingRows(
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
    expect(mergeTonightListingRows([older], [newer]).map((item) => item.title)).toEqual([
      "Quiz (updated)",
    ]);
  });
});

describe("tonight listings status", () => {
  it("is ready when Out answered with cards", () => {
    expect(tonightListingsStatus("idle", eventOut)).toBe("ready");
    expect(tonightListingsStatus("empty", eventOut)).toBe("ready");
    expect(tonightListingsStatus("error", eventOut)).toBe("ready");
  });

  it("is ready when What's-On answered with cards", () => {
    expect(tonightListingsStatus("ready", pendingOut)).toBe("ready");
    expect(tonightListingsStatus("ready", emptyReadyOut)).toBe("ready");
  });

  it("stays idle while a read is still in flight and nothing is ready", () => {
    expect(tonightListingsStatus("idle", pendingOut)).toBe("idle");
    expect(tonightListingsStatus("idle", emptyReadyOut)).toBe("idle");
    expect(tonightListingsStatus("empty", pendingOut)).toBe("idle");
    expect(tonightListingsStatus("error", pendingOut)).toBe("idle");
  });

  it("is error when a finished read failed or degraded and nothing is ready", () => {
    expect(tonightListingsStatus("empty", degradedOut)).toBe("error");
    expect(tonightListingsStatus("empty", failedOut)).toBe("error");
    expect(tonightListingsStatus("error", emptyReadyOut)).toBe("error");
  });

  it("is empty only when both reads answered with nothing", () => {
    expect(tonightListingsStatus("empty", emptyReadyOut)).toBe("empty");
  });
});

describe("tonight listings error line", () => {
  it("names the Out failure or degraded reason before the What's-On line", () => {
    expect(tonightListingsErrorLine("empty", failedOut)).toBe(OUT_READ_FAILED_LINE);
    expect(tonightListingsErrorLine("empty", degradedOut)).toBe("Out does not cover Bristol yet.");
    expect(
      tonightListingsErrorLine("empty", {
        body: { status: "degraded", events: [] },
        failed: false,
        pending: false,
      }),
    ).toBe(OUT_DEGRADED_LINE);
    expect(tonightListingsErrorLine("error", emptyReadyOut)).toBe(TONIGHT_WHATS_ON_FAILED_LINE);
  });

  it("falls back to the What's-On line when no lane named a reason", () => {
    expect(tonightListingsErrorLine("empty", emptyReadyOut)).toBe(TONIGHT_WHATS_ON_FAILED_LINE);
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
    expect(tonightListingsStatus("ready", degradedWithRows)).toBe("ready");
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
  });
});

describe("tonight lane split", () => {
  it("attributes each surviving row to the read that put it there", () => {
    const whatsOnRow = row({ id: "quiz-1", kind: "quiz", title: "Quiz" });
    const outRow = row({ id: "tm-1", title: "A Night at the Playhouse" });
    const merged = mergeTonightListingRows([whatsOnRow], [outRow]);
    const lanes = tonightListingLanes(merged, [outRow]);
    expect(lanes.whatsOnCount).toBe(1);
    expect(lanes.outRows).toEqual([outRow]);
  });

  it("counts a row both lanes carried once, under the winning observation", () => {
    const older = row({ id: "tm-1", title: "Playhouse", observedAt: "2026-08-16T08:00:00.000Z" });
    const newer = row({ id: "tm-1", title: "Playhouse", observedAt: "2026-08-16T10:00:00.000Z" });
    const merged = mergeTonightListingRows([older], [newer]);
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
      merged: mergeTonightListingRows([quiz, sport], [outRow]),
      outEvents: [outRow],
      whatsOnChecked: "Checked 15 Aug",
      outObservedAt: { ticketmaster: "2026-08-16T09:00:00.000Z" },
    });
    expect(credits.whatsOn).toBe("Checked 15 Aug · via what’s-on");
    expect(credits.out).toBe("1 listing via Ticketmaster · Checked 16 Aug");
    expect(credits.dated).toBe(true);
  });

  it("never dates an Out row to the What's-On stamp", () => {
    const credits = tonightProvenanceCredits({
      merged: mergeTonightListingRows([], [outRow]),
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
      merged: mergeTonightListingRows([], outEvents),
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
      merged: mergeTonightListingRows([], outEvents),
      outEvents,
      whatsOnChecked: null,
      outObservedAt: {},
    });
    expect(credits.out).toBe("2 listings via Ticketmaster and Skiddle");
    expect(credits.dated).toBe(false);
  });

  it("keeps the quiet night credited to What's-On when Out brought nothing", () => {
    const credits = tonightProvenanceCredits({
      merged: [],
      outEvents: [],
      whatsOnChecked: null,
    });
    expect(credits.whatsOn).toBe("via what’s-on");
    expect(credits.out).toBeNull();
    expect(credits.dated).toBe(false);
  });
});
