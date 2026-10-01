import { describe, expect, it, vi } from "vitest";

import * as contextDev from "@/lib/contextDev";
import type { ContextDevBudget } from "@/lib/contextDev";
import {
  contextDevLaneStatus,
  normaliseContextDevEventRow,
  normaliseContextDevExtract,
  runContextDevEventsLane,
} from "@/lib/events/contextDevProvider";
import { allowedHarvestSources, contextDevEventSources } from "@/lib/harvest/sourcePolicy";
import {
  DATE_ONLY_TIME_EVIDENCE,
  dedupeEventRowsBySourceId,
  type WhatsOnEventRow,
} from "@/lib/whatson/eventNormalise.mjs";
import { isValidWhatsOnRow } from "@/lib/whatsOn";

const fullers = contextDevEventSources().find((source) => source.id === "fullers-event-finder-events");
const observedAt = "2026-08-16T09:00:00.000Z";

function contextDevExtractEnvelope(
  data: Record<string, unknown>,
  options: { url?: string; partial?: boolean } = {},
) {
  const url = options.url ?? fullers?.url ?? "https://www.fullers.co.uk/event-finder";
  return {
    status: "ok",
    url,
    data,
    urls_analyzed: [url],
    request_id: "test",
    cache_metadata: { age_ms: 0, status: "miss" },
    metadata: { maxCrawlDepth: 0, numBlocked: 0, numFailed: 0, numSkipped: 0, numSuccess: 1 },
    ...(options.partial ? { partial: true } : {}),
  };
}

describe("contextDevEventSources register gate", () => {
  it("lists allowed FIRST-PARTY venue-events pages only", () => {
    const sources = contextDevEventSources();
    expect(sources.some((source) => source.id === "fullers-event-finder-events")).toBe(true);
    expect(sources.every((source) => source.firstParty)).toBe(true);
    expect(sources.every((source) => source.access.allowed)).toBe(true);
  });

  it("refuses every allowed venue-events source that is not first party", () => {
    const allowed = allowedHarvestSources("venue-events");
    const nonFirstParty = allowed.filter((source) => !source.firstParty);
    // The register holds at least one, and its narrow nonFirstPartyException is
    // a promise an extract call cannot keep.
    expect(nonFirstParty.length).toBeGreaterThan(0);
    const laneIds = new Set(contextDevEventSources().map((source) => source.id));
    for (const source of nonFirstParty) expect(laneIds.has(source.id)).toBe(false);
  });

  it("is not configured without a key", () => {
    expect(contextDevLaneStatus({} as unknown as NodeJS.ProcessEnv)).toBe("not-configured");
  });
});

describe("normaliseContextDevEventRow", () => {
  it("refuses an off-host event link instead of crediting it to the registered publisher", () => {
    if (!fullers) throw new Error("missing fullers register entry");
    const { row, drop } = normaliseContextDevEventRow(
      {
        title: "Invented quiz",
        placeName: "The Dove",
        kind: "event",
        sourceUrl: "https://example.com/event/quiz",
        startsDate: "2026-08-18",
      },
      fullers,
      { observedAt },
    );
    expect(row).toBeNull();
    expect(drop).toBe("noUrl");
  });

  it("credits the page actually scraped when no event-specific URL was stated", () => {
    if (!fullers) throw new Error("missing fullers register entry");
    const { row } = normaliseContextDevEventRow(
      { title: "Quiz", placeName: "The Dove", kind: "event", startsDate: "2026-08-18" },
      fullers,
      { observedAt },
    );
    expect(row?.source).toEqual({ label: "Fuller's", url: fullers.url });
  });

  it("credits the registered page actually scraped", () => {
    if (!fullers) throw new Error("missing fullers register entry");
    const { row } = normaliseContextDevEventRow(
      {
        title: "Live music",
        placeName: "The Dove",
        kind: "music",
        sourceUrl: "https://www.fullers.co.uk/pubs/the-dove/event/1",
        startsAt: "2026-08-16T20:00:00Z",
      },
      fullers,
      { observedAt },
    );
    expect(row?.source).toEqual({
      label: "Fuller's",
      url: fullers.url,
    });
    expect(isValidWhatsOnRow(row, Date.parse(observedAt))).toBe(true);
  });

  it("keeps date-only rows honest and never invents startsAt", () => {
    if (!fullers) throw new Error("missing fullers register entry");
    const { row } = normaliseContextDevEventRow(
      {
        title: "Comedy night",
        placeName: "The Anchor",
        kind: "event",
        sourceUrl: "https://www.fullers.co.uk/pubs/the-anchor/event/2",
        startsDate: "2026-08-17",
      },
      fullers,
      { observedAt },
    );
    expect(row?.startsAt).toBeUndefined();
    expect(row?.startsDate).toBe("2026-08-17");
    expect(row?.timeEvidence).toBe(DATE_ONLY_TIME_EVIDENCE);
  });

  it("drops rows with unknown kinds", () => {
    if (!fullers) throw new Error("missing fullers register entry");
    const { drop } = normaliseContextDevEventRow(
      {
        title: "Film night",
        placeName: "A Pub",
        kind: "film",
        sourceUrl: "https://example.com/e/3",
        startsAt: "2026-08-16T19:00:00Z",
      },
      fullers,
      { observedAt },
    );
    expect(drop).toBe("noKind");
  });
});

describe("runContextDevEventsLane", () => {
  async function capturedEvent(_markdown: string, event: Record<string, string> | Record<string, string>[]) {
    if (!fullers) throw new Error("missing fullers register entry");
    const events = Array.isArray(event) ? event : [event];
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify(
      contextDevExtractEnvelope({ events }),
    ), { status: 200, headers: { "content-type": "application/json" } }));
    return runContextDevEventsLane({
      observedAt,
      env: { CONTEXT_DEV_API_KEY: "test-key" } as unknown as NodeJS.ProcessEnv,
      callOptions: { fetchImpl: fetchImpl as unknown as typeof fetch },
      log: vi.fn(),
      logError: vi.fn(),
    });
  }

  it.each(["£40", "£4.50", "£4,000", "£4.505"])("discards a price prefix in %s", async (price) => {
    const result = await capturedEvent(`Quiz at The Dove on 18 December 2026. Tickets ${price}`, {
      title: "Quiz", placeName: "The Dove", kind: "event", startsDate: "2026-12-18", priceText: "£4",
    });
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]?.priceGbp).toBeUndefined();
  });

  it("retains complete prices and explicitly labelled publisher ids", async () => {
    const result = await capturedEvent("Quiz at The Dove on 18 December 2026. Tickets £4.50. Event ID: fullers-42", {
      title: "Quiz", placeName: "The Dove", kind: "event", startsDate: "2026-12-18",
      priceText: "£4.50", sourceId: "fullers-42",
    });
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]).toMatchObject({ priceGbp: 4.5, sourceId: "fullers-42" });
  });

  it("does not deduplicate unrelated events by an incidental year", async () => {
    const result = await capturedEvent(
      "Quiz at The Dove on 18 December 2026.\nOpen mic at The Dove on 19 December 2026.",
      [
        { title: "Quiz", placeName: "The Dove", kind: "event", startsDate: "2026-12-18", sourceId: "2026" },
        { title: "Open mic", placeName: "The Dove", kind: "music", startsDate: "2026-12-19", sourceId: "2026" },
      ],
    );
    expect(result.rows).toHaveLength(2);
    expect(dedupeEventRowsBySourceId(result.rows as unknown as WhatsOnEventRow[])).toHaveLength(2);
    for (const row of result.rows) expect(row.sourceId).toBe(row.id);
  });

  it.each([
    "Quiz at The Dove on 18 December 2026 at 20:00",
    "### Quiz\nThe Dove\n18 December 2026 at 8pm",
    "- Quiz\n  The Dove\n  18 December 2026 at 8:00PM",
  ])("rejects date-only extraction when record states a clock: %s", async (markdown) => {
    const result = await capturedEvent(markdown, {
      title: "Quiz", placeName: "The Dove", kind: "event", startsDate: "2026-12-18",
    });
    expect(result.rows).toEqual([]);
    expect(result.failures).toHaveLength(1);
  });

  it.each([
    "### Christmas 2026 quiz\nThe Dove\n18 December 2026 at 8pm",
    "- Christmas 2026 quiz\n  The Dove\n  18 December 2026 at 8pm",
    "Christmas 2026 quiz at The Dove on 18 December 2026 at 8pm",
  ])("does not count a title's year as a second date: %s", async (markdown) => {
    const result = await capturedEvent(markdown, {
      title: "Christmas 2026 quiz", placeName: "The Dove", kind: "event", startsAt: "2026-12-18T20:00:00Z",
    });
    expect(result.rows).toHaveLength(1);
  });

  it.each(["19 December", "December 19", "19/12", "19.12.2026", "19 12 2026", "2026-12-19"])(
    "rejects a card with another date represented as %s", async (otherDate) => {
      for (const markdown of [
        `### Quiz\nThe Swan on ${otherDate} at 7pm\nThe Dove on 18 December 2026 at 8pm`,
        `- Quiz\n  The Swan on ${otherDate} at 7pm\n  The Dove on 18 December 2026 at 8pm`,
        `Quiz at The Swan on ${otherDate} at 7pm and The Dove on 18 December 2026 at 8pm`,
      ]) {
        const result = await capturedEvent(markdown, {
          title: "Quiz", placeName: "The Swan", kind: "event", startsAt: "2026-12-18T20:00:00Z",
        });
        expect(result.rows).toEqual([]);
      }
    },
  );

  it("rejects abbreviated competing dates across one heading card", async () => {
    const result = await capturedEvent("### Quiz\nThe Swan on 19 Dec at 7pm\nThe Dove on 18 December 2026 at 8pm", {
      title: "Quiz", placeName: "The Swan", kind: "event", startsAt: "2026-12-18T20:00:00Z",
    });
    expect(result.rows).toEqual([]);
    expect(result.failures).toHaveLength(1);
  });

  it("does not infer an extracted year from a yearless date", async () => {
    const result = await capturedEvent("Quiz at The Dove on 19 Dec at 7pm", {
      title: "Quiz", placeName: "The Dove", kind: "event", startsAt: "2026-12-19T19:00:00Z",
    });
    expect(result.rows).toEqual([]);
  });

  it.each(["18/08/2026", "18/08/2026 and 18 August 2026"])(
    "accepts zero-padded or repeated identical date evidence: %s", async (date) => {
      const result = await capturedEvent(`### Quiz\nThe Dove on ${date} at 8pm`, {
        title: "Quiz", placeName: "The Dove", kind: "event", startsAt: "2026-08-18T19:00:00Z",
      });
      expect(result.rows).toHaveLength(1);
    },
  );

  it("does not publish the ending clock of an event range as its start", async () => {
    const markdown = "Quiz at The Dove on 18 December 2026, 20:00-22:00";
    const result = await capturedEvent(markdown, {
      title: "Quiz", placeName: "The Dove", kind: "event", startsAt: "2026-12-18T22:00:00Z",
    });
    expect(result.rows).toEqual([]);
    const start = await capturedEvent(markdown, {
      title: "Quiz", placeName: "The Dove", kind: "event", startsAt: "2026-12-18T20:00:00Z",
    });
    expect(start.rows).toHaveLength(1);
  });

  it("selects explicit start over doors and end clocks", async () => {
    const markdown = "Quiz at The Dove on 18 December 2026. Doors 7pm. Starts 8pm. Ends 10pm.";
    const event = { title: "Quiz", placeName: "The Dove", kind: "event" };
    expect((await capturedEvent(markdown, { ...event, startsAt: "2026-12-18T19:00:00Z" })).rows).toEqual([]);
    expect((await capturedEvent(markdown, { ...event, startsAt: "2026-12-18T20:00:00Z" })).rows).toHaveLength(1);
  });

  it("abstains when doors and another clock are stated without start evidence", async () => {
    const result = await capturedEvent("Quiz at The Dove on 18 December 2026. Doors 7pm, 8pm.", {
      title: "Quiz", placeName: "The Dove", kind: "event", startsAt: "2026-12-18T20:00:00Z",
    });
    expect(result.rows).toEqual([]);
  });

  it("keeps venue IDs and raffle prices out of event identity and ticket price", async () => {
    const result = await capturedEvent("Quiz at The Dove on 18 December 2026. Venue ID: dove. Tickets £40. Raffle £4.", {
      title: "Quiz", placeName: "The Dove", kind: "event", startsDate: "2026-12-18",
      sourceId: "dove", priceText: "£4",
    });
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]?.sourceId).toBe(result.rows[0]?.id);
    expect(result.rows[0]?.priceGbp).toBeUndefined();
  });

  it("accepts an ordinary at The Dove phrase after the clock", async () => {
    const result = await capturedEvent("### Quiz\n18 December 2026 at 8pm at The Dove", {
      title: "Quiz", placeName: "The Dove", kind: "event", startsAt: "2026-12-18T20:00:00Z",
    });
    expect(result.rows).toHaveLength(1);
  });

  it.each(["GMT", "UTC", "gmt", "utc"])("honours explicit %s during London summer", async (zone) => {
    const markdown = `Quiz at The Dove on 18 August 2027 at 20:00 ${zone}`;
    const event = { title: "Quiz", placeName: "The Dove", kind: "event" };
    const wrong = await capturedEvent(markdown, { ...event, startsAt: "2027-08-18T19:00:00Z" });
    expect(wrong.rows).toEqual([]);
    const correct = await capturedEvent(markdown, { ...event, startsAt: "2027-08-18T20:00:00Z" });
    expect(correct.rows).toHaveLength(1);
  });

  it("honours explicit BST during London winter", async () => {
    const markdown = "Quiz at The Dove on 18 December 2026 at 8pm BST";
    const event = { title: "Quiz", placeName: "The Dove", kind: "event" };
    expect((await capturedEvent(markdown, { ...event, startsAt: "2026-12-18T20:00:00Z" })).rows).toEqual([]);
    expect((await capturedEvent(markdown, { ...event, startsAt: "2026-12-18T19:00:00Z" })).rows).toHaveLength(1);
  });

  it.each([
    "20:00 until closing time",
    "8pm start time",
    "8PM TILL LATE",
    "20:00 London time",
    "20:00 UK time",
    "20:00 local time",
    "8pm until last orders time",
    "8PM LIVE DJ",
    "8PM PUB QUIZ",
    "8PM JAZZ",
    "8PM FRI",
    "8PM BINGO",
    "8pm happy hour time",
    "8pm Until Closing Time",
    "8pm Match Time",
    "8pm Game Time",
    "20:00 UK TIME",
  ])("reads %s as a London clock, not an unsupported zone", async (clock) => {
    const result = await capturedEvent(`Quiz at The Dove on 18 August 2027 at ${clock}`, {
      title: "Quiz", placeName: "The Dove", kind: "event", startsAt: "2027-08-18T19:00:00Z",
    });
    expect(result.rows).toHaveLength(1);
    expect(result.failures).toEqual([]);
  });

  it("counts an event the page does not ground as ungrounded", async () => {
    const result = await capturedEvent("Quiz at The Dove on 18 August 2027 at 20:00 CET", {
      title: "Quiz", placeName: "The Dove", kind: "event", startsAt: "2027-08-18T19:00:00Z",
    });
    expect(result.dropped).toMatchObject({ ungrounded: 1, noTitle: 0, total: 1 });
  });

  it("refuses an unknown lowercase place-before-time zone on a winter listing", async () => {
    const result = await capturedEvent("Quiz at The Dove on 18 December 2026 at 20:00 lagos time", {
      title: "Quiz", placeName: "The Dove", kind: "event", startsAt: "2026-12-18T20:00:00Z",
    });
    expect(result.rows).toEqual([]);
    expect(result.dropped).toMatchObject({ ungrounded: 1 });
  });

  it.each(["CET", "PST", "cet", "Europe/Paris", "Eastern Standard Time", "Paris time", "Moscow time", "Chicago time", "ET", "PT", "MSK", "SAST", "eastern time", "EASTERN TIME", "pacific time", "moscow time", "MOSCOW TIME", "central european time", "Central European Time", "lagos time", "Lagos Time"])("refuses unsupported explicit zone %s", async (zone) => {
    const result = await capturedEvent(`Quiz at The Dove on 18 August 2027 at 20:00 ${zone}`, {
      title: "Quiz", placeName: "The Dove", kind: "event", startsAt: "2027-08-18T19:00:00Z",
    });
    expect(result.rows).toEqual([]);
  });

  it("does not crossjoin compact single-newline listings", async () => {
    const result = await capturedEvent(
      "# Events\n- Open mic at The Swan on 19 August 2026, 20:00.\n- Quiz at The Dove on 18 August 2026, 20:00.",
      { title: "Open mic", placeName: "The Dove", kind: "music", startsAt: "2026-08-18T19:00:00Z" },
    );
    expect(result.rows).toEqual([]);
    expect(result.failures.some((failure) => failure.sourceId === fullers?.id)).toBe(true);
  });

  it("does not treat an ordinary section heading as one event card", async () => {
    const result = await capturedEvent(
      "## Upcoming Events\nOpen mic at The Swan on 19 August 2026 at 20:00.\nQuiz at The Dove on 18 August 2026 at 20:00.",
      { title: "Open mic", placeName: "The Dove", kind: "music", startsAt: "2026-08-18T19:00:00Z" },
    );
    expect(result.rows).toEqual([]);
    expect(result.failures.some((failure) => failure.sourceId === fullers?.id)).toBe(true);
  });

  it("accepts a complete event line beneath an ordinary section heading", async () => {
    const result = await capturedEvent(
      "## Upcoming Events\nOpen mic at The Dove on 18 August 2026 at 20:00.",
      { title: "Open mic", placeName: "The Dove", kind: "music", startsAt: "2026-08-18T19:00:00Z" },
    );
    expect(result.rows).toHaveLength(1);
  });

  it("rejects conflicting dates inside an event-title card", async () => {
    const result = await capturedEvent(
      "### Open mic\nThe Swan on 19 August 2026 at 20:00.\nThe Dove on 18 August 2026 at 20:00.",
      { title: "Open mic", placeName: "The Dove", kind: "music", startsAt: "2026-08-18T19:00:00Z" },
    );
    expect(result.rows).toEqual([]);
    expect(result.failures.some((failure) => failure.sourceId === fullers?.id)).toBe(true);
  });

  it.each([
    "# Events\n### Open mic\nThe Dove\n18 August 2026 at 8pm",
    "# Events\n### Open mic\n\nThe Dove\n18 August 2026 at 8pm",
    "# Events\n- Open mic\n  The Dove\n  18 August 2026 at 8pm",
    "# Events\n- Open mic\n\n  The Dove\n  18 August 2026 at 8pm",
  ])("keeps facts together within a multiline Markdown card: %s", async (markdown) => {
    const result = await capturedEvent(markdown, {
      title: "Open mic", placeName: "The Dove", kind: "music", startsAt: "2026-08-18T19:00:00Z",
    });
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]?.startsAt).toBe("2026-08-18T19:00:00.000Z");
  });

  it("does not crossjoin semicolon-separated event clauses", async () => {
    const result = await capturedEvent(
      "Open mic at The Swan on 19 August 2026, 20:00; Quiz at The Dove on 18 August 2026, 20:00",
      { title: "Open mic", placeName: "The Dove", kind: "music", startsAt: "2026-08-18T19:00:00Z" },
    );
    expect(result.rows).toEqual([]);
    expect(result.failures.some((failure) => failure.sourceId === fullers?.id)).toBe(true);
  });

  it.each([
    "# Events\n### Open mic\nThe Swan\n19 August 2026 at 8pm\n### Quiz\nThe Dove\n18 August 2026 at 8pm",
    "# Events\n- Open mic\n  The Swan\n  19 August 2026 at 8pm\n- Quiz\n  The Dove\n  18 August 2026 at 8pm",
  ])("does not crossjoin separate multiline cards: %s", async (markdown) => {
    const result = await capturedEvent(markdown, {
      title: "Open mic", placeName: "The Dove", kind: "music", startsAt: "2026-08-18T19:00:00Z",
    });
    expect(result.rows).toEqual([]);
  });

  it("accepts a supported event in its own semicolon clause", async () => {
    const result = await capturedEvent(
      "Open mic at The Swan on 19 August 2026, 20:00; Quiz at The Dove on 18 August 2026, 20:00",
      { title: "Quiz", placeName: "The Dove", kind: "event", startsAt: "2026-08-18T19:00:00Z" },
    );
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]?.title).toBe("Quiz");
  });

  it("finds a later recurring listing with the requested date", async () => {
    const result = await capturedEvent(
      "# Events\n\nQuiz at The Dove on 18 August 2026.\n\nQuiz at The Dove on 25 August 2026.",
      { title: "Quiz", placeName: "The Dove", kind: "event", startsDate: "2026-08-25" },
    );
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]?.startsDate).toBe("2026-08-25");
  });

  it("rejects a UTC hour that shifts a stated London summer start", async () => {
    const result = await capturedEvent(
      "Open mic at The Dove on 18 August 2026 at 20:00 London time.",
      { title: "Open mic", placeName: "The Dove", kind: "music", startsAt: "2026-08-18T20:00:00Z" },
    );
    expect(result.rows).toEqual([]);
  });

  it.each([
    ["Open mic at The Dove on 18 August 2026 at 20:00.", "2026-08-18T19:00:00Z", "2026-08-18T19:00:00.000Z"],
    ["Open mic at The Dove on 18 December 2026 at 20:00.", "2026-12-18T20:00:00Z", "2026-12-18T20:00:00.000Z"],
    ["Open mic at The Dove on 18 August 2026 at 20:00 +02:00.", "2026-08-18T20:00:00+02:00", "2026-08-18T18:00:00.000Z"],
    ["Open mic at The Dove on 18 August 2026 at 8pm.", "2026-08-18T19:00:00Z", "2026-08-18T19:00:00.000Z"],
    ["Open mic at The Dove on 18 August 2026 at 8:00pm.", "2026-08-18T19:00:00Z", "2026-08-18T19:00:00.000Z"],
  ])("grounds actual instant against stated time: %s", async (markdown, startsAt, expected) => {
    const result = await capturedEvent(markdown, {
      title: "Open mic", placeName: "The Dove", kind: "music", startsAt,
    });
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]?.startsAt).toBe(expected);
  });

  it("honours a stated offset even when London wall clock matches a different instant", async () => {
    const result = await capturedEvent(
      "Open mic at The Dove on 18 August 2026 at 20:00 +02:00.",
      { title: "Open mic", placeName: "The Dove", kind: "music", startsAt: "2026-08-18T19:00:00Z" },
    );
    expect(result.rows).toEqual([]);
  });

  it("refuses a shape-valid event whose facts are absent from scraped page text", async () => {
    if (!fullers) throw new Error("missing fullers register entry");
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify(
      contextDevExtractEnvelope({ events: [{
        title: "Invented quiz",
        placeName: "The Dove",
        kind: "event",
        startsDate: "2026-08-18",
      }] }),
    ), { status: 200, headers: { "content-type": "application/json" } }));

    const result = await runContextDevEventsLane({
      observedAt,
      env: { CONTEXT_DEV_API_KEY: "test-key" } as unknown as NodeJS.ProcessEnv,
      callOptions: { fetchImpl: fetchImpl as unknown as typeof fetch },
      log: vi.fn(),
      logError: vi.fn(),
    });

    expect(result.rows).toEqual([]);
    expect(result.failures.some((failure) => failure.sourceId === fullers.id)).toBe(true);
  });

  it("accepts a stated event and strips unstated price and publisher id", async () => {
    if (!fullers) throw new Error("missing fullers register entry");
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify(
      contextDevExtractEnvelope({ events: [{
        title: "Open mic", placeName: "The Dove", kind: "music",
        startsAt: "2026-08-18T19:00:00Z", priceText: "£40", sourceId: "fake-42",
      }] }),
    ), { status: 200, headers: { "content-type": "application/json" } }));

    const result = await runContextDevEventsLane({
      observedAt,
      env: { CONTEXT_DEV_API_KEY: "test-key" } as unknown as NodeJS.ProcessEnv,
      callOptions: { fetchImpl: fetchImpl as unknown as typeof fetch },
      log: vi.fn(),
      logError: vi.fn(),
    });

    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]).toMatchObject({ title: "Open mic", startsAt: "2026-08-18T19:00:00.000Z" });
    expect(result.rows[0]?.priceGbp).toBeUndefined();
    expect(result.rows[0]?.sourceId).toBe(result.rows[0]?.id);
  });

  it("does not combine a title from one listing with another listing's venue and date", async () => {
    if (!fullers) throw new Error("missing fullers register entry");
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify(
      contextDevExtractEnvelope({ events: [{
        title: "Open mic", placeName: "The Dove", kind: "music", startsDate: "2026-08-18",
      }] }),
    ), { status: 200, headers: { "content-type": "application/json" } }));

    const result = await runContextDevEventsLane({
      observedAt,
      env: { CONTEXT_DEV_API_KEY: "test-key" } as unknown as NodeJS.ProcessEnv,
      callOptions: { fetchImpl: fetchImpl as unknown as typeof fetch },
      log: vi.fn(),
      logError: vi.fn(),
    });

    expect(result.rows).toEqual([]);
    expect(result.failures.some((failure) => failure.sourceId === fullers.id)).toBe(true);
  });

  it("sends optional fields and refuses off-host JSON attribution through the installed SDK", async () => {
    const fetchImpl = vi.fn<(input: unknown, init?: RequestInit) => Promise<Response>>(async () =>
      new Response(JSON.stringify(
        contextDevExtractEnvelope({
          events: [{
            title: "Invented quiz",
            placeName: "The Dove",
            kind: "event",
            sourceUrl: "https://example.com/event/quiz",
            startsDate: "2026-08-18",
          }],
        }),
      ), { status: 200, headers: { "content-type": "application/json" } }),
    );

    const result = await runContextDevEventsLane({
      observedAt,
      env: { CONTEXT_DEV_API_KEY: "test-key" } as unknown as NodeJS.ProcessEnv,
      callOptions: { fetchImpl: fetchImpl as unknown as typeof fetch },
      log: vi.fn(),
      logError: vi.fn(),
    });

    expect(fetchImpl).toHaveBeenCalled();
    const request = JSON.parse(String(fetchImpl.mock.calls[0]?.[1]?.body));
    expect(request.formats).toEqual({ json: true, markdown: true });
    expect(request.jsonParams.schema.properties.events.items.required).toBeUndefined();
    expect(result.rows).toEqual([]);
    expect(result.failures).toHaveLength(contextDevEventSources().length);
  });

  it("refuses a scrape redirected off the registered publisher host", async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(JSON.stringify(
        contextDevExtractEnvelope({
          events: [{
            title: "Quiz",
            placeName: "The Dove",
            kind: "event",
            startsDate: "2026-08-18",
          }],
        }, { url: "https://example.com/unrelated" }),
      ), { status: 200, headers: { "content-type": "application/json" } }),
    );

    const result = await runContextDevEventsLane({
      observedAt,
      env: { CONTEXT_DEV_API_KEY: "test-key" } as unknown as NodeJS.ProcessEnv,
      callOptions: { fetchImpl: fetchImpl as unknown as typeof fetch },
      log: vi.fn(),
      logError: vi.fn(),
    });

    expect(result.rows).toEqual([]);
    expect(result.failures).toHaveLength(contextDevEventSources().length);
  });

  it("returns not-configured without a key and sends nothing", async () => {
    const log = vi.fn();
    const result = await runContextDevEventsLane({
      observedAt,
      env: {} as unknown as NodeJS.ProcessEnv,
      log,
    });
    expect(result.status).toBe("not-configured");
    expect(result.rows).toEqual([]);
    expect(log).toHaveBeenCalledWith(expect.stringContaining("not-configured"));
  });

  it("normalises extract payloads from registered sources", async () => {
    const extractSpy = vi.spyOn(contextDev, "extract").mockResolvedValue({
      status: "ok",
      url: "https://www.fullers.co.uk/event-finder",
      data: {
        events: [
          {
            title: "Quiz",
            placeName: "The Counting House",
            kind: "event",
            sourceUrl: "https://www.fullers.co.uk/pubs/counting-house/event/quiz",
            startsDate: "2026-08-18",
          },
        ],
      },
      markdown: "# Events\nQuiz at The Counting House on 18 August 2026.",
      urlsAnalyzed: ["https://www.fullers.co.uk/event-finder"],
    });

    const result = await runContextDevEventsLane({
      observedAt,
      env: { CONTEXT_DEV_API_KEY: "test-key" } as unknown as NodeJS.ProcessEnv,
      log: vi.fn(),
      logError: vi.fn(),
    });
    expect(result.status).toBe("ran");
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]?.startsDate).toBe("2026-08-18");
    extractSpy.mockRestore();
  });
});

describe("row identity", () => {
  const duplicatedEvent = {
    title: "Quiz night",
    placeName: "The Dove",
    kind: "event",
    sourceUrl: "https://www.fullers.co.uk/pubs/the-dove/event/quiz",
    startsAt: "2026-08-18T19:00:00Z",
  };

  it("names an id the shared dedupe can use when the page numbers nothing", () => {
    if (!fullers) throw new Error("missing fullers register entry");
    const { rows } = normaliseContextDevExtract(
      { events: [duplicatedEvent, { ...duplicatedEvent }] },
      fullers,
      { observedAt },
    );
    expect(rows).toHaveLength(2);
    expect(rows[0]?.sourceId).toBe(rows[0]?.id);
    expect(dedupeEventRowsBySourceId(rows as unknown as WhatsOnEventRow[])).toHaveLength(1);
  });

  it("keeps two events apart when the page answers a BLANK id", () => {
    if (!fullers) throw new Error("missing fullers register entry");
    const { rows } = normaliseContextDevExtract(
      {
        events: [
          { ...duplicatedEvent, sourceId: "", title: "Quiz night" },
          { ...duplicatedEvent, sourceId: "", title: "Live music" },
        ],
      },
      fullers,
      { observedAt },
    );
    expect(rows).toHaveLength(2);
    expect(rows[0]?.sourceId).not.toBe(rows[1]?.sourceId);
    expect(dedupeEventRowsBySourceId(rows as unknown as WhatsOnEventRow[])).toHaveLength(2);
  });

  it("treats a whitespace-only id the same way", () => {
    if (!fullers) throw new Error("missing fullers register entry");
    const { rows } = normaliseContextDevExtract(
      {
        events: [
          { ...duplicatedEvent, sourceId: "   ", title: "Quiz night" },
          { ...duplicatedEvent, sourceId: "   ", title: "Live music" },
        ],
      },
      fullers,
      { observedAt },
    );
    expect(dedupeEventRowsBySourceId(rows as unknown as WhatsOnEventRow[])).toHaveLength(2);
  });

  it("keeps the publisher's own id when the page states one", () => {
    if (!fullers) throw new Error("missing fullers register entry");
    const { rows } = normaliseContextDevExtract(
      { events: [{ ...duplicatedEvent, sourceId: "  fullers-42  " }] },
      fullers,
      { observedAt },
    );
    expect(rows[0]?.sourceId).toBe("fullers-42");
  });

  it("gives two different events two different identities", () => {
    if (!fullers) throw new Error("missing fullers register entry");
    const { rows } = normaliseContextDevExtract(
      {
        events: [
          duplicatedEvent,
          { ...duplicatedEvent, title: "Open mic" },
        ],
      },
      fullers,
      { observedAt },
    );
    expect(dedupeEventRowsBySourceId(rows as unknown as WhatsOnEventRow[])).toHaveLength(2);
  });
});

describe("mid-run key loss", () => {
  it("names every unread source instead of reporting the lane never configured", async () => {
    const extractSpy = vi
      .spyOn(contextDev, "extract")
      .mockResolvedValue({ status: "not-configured" });

    const result = await runContextDevEventsLane({
      observedAt,
      env: { CONTEXT_DEV_API_KEY: "test-key" } as unknown as NodeJS.ProcessEnv,
      log: vi.fn(),
      logError: vi.fn(),
    });

    expect(result.status).toBe("failed");
    expect(result.failures.map((failure) => failure.sourceId)).toEqual(
      contextDevEventSources().map((source) => source.id),
    );
    extractSpy.mockRestore();
  });
});

describe("run request budget", () => {
  it("shares ONE budget across the lane and stops sending once it is spent", async () => {
    const fetchImpl = vi.fn(async () => new Response("down", { status: 503 }));
    const budget = contextDev.createContextDevBudget(1);

    const result = await runContextDevEventsLane({
      observedAt,
      env: { CONTEXT_DEV_API_KEY: "test-key" } as unknown as NodeJS.ProcessEnv,
      callOptions: {
        budget,
        fetchImpl: fetchImpl as unknown as typeof fetch,
        sleepImpl: async () => {},
      },
      log: vi.fn(),
      logError: vi.fn(),
    });

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(budget.remaining()).toBe(0);
    expect(result.status).toBe("failed");
    expect(result.rows).toEqual([]);
    expect(result.failures).toHaveLength(contextDevEventSources().length);
  });

  it("opens a default budget when the caller hands none in, and spends it", async () => {
    const fetchImpl = vi.fn(async () => new Response("down", { status: 503 }));
    const budgetSpy = vi.spyOn(contextDev, "createContextDevBudget");

    await runContextDevEventsLane({
      observedAt,
      env: { CONTEXT_DEV_API_KEY: "test-key" } as unknown as NodeJS.ProcessEnv,
      callOptions: {
        fetchImpl: fetchImpl as unknown as typeof fetch,
        sleepImpl: async () => {},
      },
      log: vi.fn(),
      logError: vi.fn(),
    });

    expect(budgetSpy).toHaveBeenCalledTimes(1);
    const budget = budgetSpy.mock.results[0]?.value as ContextDevBudget;
    expect(budget.limit).toBe(contextDev.CONTEXT_DEV_RUN_REQUEST_BUDGET);
    // Every request this run sent came out of that one budget, so removing the
    // default - or failing to thread it into the calls - leaves it untouched.
    expect(budget.spent()).toBe(fetchImpl.mock.calls.length);
    expect(budget.spent()).toBeGreaterThan(0);
    budgetSpy.mockRestore();
  });
});

describe("normaliseContextDevExtract batching", () => {
  it("counts drops across a payload", () => {
    if (!fullers) throw new Error("missing fullers register entry");
    const { rows, dropped } = normaliseContextDevExtract(
      {
        events: [
          {
            title: "Ok row",
            placeName: "Pub A",
            kind: "event",
            sourceUrl: "https://www.fullers.co.uk/pubs/a/event/ok",
            startsAt: "2026-08-16T19:00:00Z",
          },
          {
            title: "Bad kind",
            placeName: "Pub B",
            kind: "quiz",
            sourceUrl: "https://www.fullers.co.uk/pubs/b/event/bad",
            startsAt: "2026-08-16T19:00:00Z",
          },
        ],
      },
      fullers,
      { observedAt },
    );
    expect(rows).toHaveLength(1);
    expect(dropped.noKind).toBe(1);
    expect(dropped.total).toBe(1);
  });
});
