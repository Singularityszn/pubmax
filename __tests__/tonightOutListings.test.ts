import { describe, expect, it } from "vitest";

import { OUT_DEGRADED_LINE, OUT_READ_FAILED_LINE } from "@/lib/out/outStatus";
import {
  TONIGHT_WHATS_ON_FAILED_LINE,
  mergeTonightListingRows,
  tonightListingsErrorLine,
  tonightListingsStatus,
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
});
