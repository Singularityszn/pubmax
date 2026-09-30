import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, describe, expect, it, vi } from "vitest";

import * as contextDev from "@/lib/contextDev";
import { runEventsRefresh } from "../scripts/whatson/eventsRefresh.mjs";

const temporaryDirs: string[] = [];
afterAll(() => {
  for (const dir of temporaryDirs) rmSync(dir, { recursive: true, force: true });
});

const observedAt = "2026-08-16T09:00:00.000Z";
const nowMs = Date.parse(observedAt);

function temporaryOutPath() {
  const dir = mkdtempSync(join(tmpdir(), "contextdev-events-refresh-"));
  temporaryDirs.push(dir);
  return join(dir, "events_london.json");
}

const heldFullersRow = (id: string) => ({
  id,
  placeName: "The Dove",
  kind: "event",
  title: "Held quiz",
  source: { label: "Fuller's", url: "https://www.fullers.co.uk/pubs/the-dove/event/quiz" },
  observedAt,
  confidence: "listed",
  startsAt: "2026-08-16T19:00:00.000Z",
});

const heldGeneratedAt = "2026-08-15T09:00:00.000Z";

function writeHeldFile(outPath: string, rows: unknown[]) {
  writeFileSync(
    outPath,
    JSON.stringify({ generatedAt: heldGeneratedAt, kind: "events", city: "london", rows }, null, 2),
  );
}

const ticketmasterEvent = {
  id: "tm-theatre-1",
  name: "A Night at the Playhouse",
  url: "https://www.ticketmaster.co.uk/event/tm-theatre-1",
  dates: { start: { dateTime: "2026-08-16T19:00:00Z" } },
  classifications: [{ segment: { name: "Arts & Theatre" }, genre: { name: "Theatre" } }],
  _embedded: { venues: [{ name: "Soho Theatre" }] },
};

const answeringTicketmaster = (async () =>
  new Response(JSON.stringify({ _embedded: { events: [ticketmasterEvent] } }), {
    status: 200,
  })) as unknown as typeof fetch;

describe("eventsRefresh Context.dev lane", () => {
  it("runs with only CONTEXT_DEV_API_KEY and merges rows into the file", async () => {
    const extractSpy = vi.spyOn(contextDev, "extract").mockResolvedValue({
      status: "ok",
      url: "https://www.fullers.co.uk/event-finder",
      data: {
        events: [
          {
            title: "Open mic",
            placeName: "The Counting House",
            kind: "music",
            sourceUrl: "https://www.fullers.co.uk/pubs/counting-house/event/open-mic",
            startsAt: "2026-08-16T19:00:00Z",
          },
        ],
      },
      markdown: "# Events\nOpen mic at The Counting House on 16 August 2026 at 20:00.",
      urlsAnalyzed: ["https://www.fullers.co.uk/event-finder"],
    });

    const outPath = temporaryOutPath();
    const result = await runEventsRefresh({
      argv: ["node", "eventsRefresh.mjs", "--allow-empty"],
      env: { CONTEXT_DEV_API_KEY: "test-key" },
      nowMs,
      fetchImpl: (async () => new Response("{}", { status: 500 })) as unknown as typeof fetch,
      outPath,
      loadVenueIndex: () => null,
      runCommonLane: async () => ({ rows: [] }),
      log: () => {},
      logError: () => {},
    });

    expect(result.provider.status).toBe("wrote");
    expect(extractSpy).toHaveBeenCalled();
    const written = JSON.parse(readFileSync(outPath, "utf8"));
    expect(written.rows.some((row: { id?: string }) => String(row.id).startsWith("events-cd-"))).toBe(true);
    extractSpy.mockRestore();
  });

  it("refuses the write when Context.dev is the only lane and it fails", async () => {
    const outPath = temporaryOutPath();
    writeHeldFile(outPath, [heldFullersRow("events-cd-held")]);

    const extractSpy = vi.spyOn(contextDev, "extract").mockResolvedValue({
      status: "error",
      error: { code: "PROVIDER_UNAVAILABLE", message: "upstream down", retryable: true, statusCode: 503 },
    });

    const result = await runEventsRefresh({
      argv: ["node", "eventsRefresh.mjs", "--allow-empty"],
      env: { CONTEXT_DEV_API_KEY: "test-key" },
      nowMs,
      fetchImpl: (async () => new Response("{}", { status: 500 })) as unknown as typeof fetch,
      outPath,
      loadVenueIndex: () => null,
      runCommonLane: async () => ({ rows: [] }),
      log: () => {},
      logError: () => {},
    });

    expect(result.provider.status).toBe("failed");
    expect(result.provider.wrote).toBe(false);
    const written = JSON.parse(readFileSync(outPath, "utf8"));
    expect(written.rows.map((row: { id?: string }) => row.id)).toEqual(["events-cd-held"]);
    expect(written.generatedAt).toBe(heldGeneratedAt);
    extractSpy.mockRestore();
  });

  it("carries held Fuller's rows when Context.dev fails and another lane answers", async () => {
    const outPath = temporaryOutPath();
    writeHeldFile(outPath, [heldFullersRow("events-cd-held")]);

    const extractSpy = vi.spyOn(contextDev, "extract").mockResolvedValue({
      status: "error",
      error: { code: "PROVIDER_UNAVAILABLE", message: "upstream down", retryable: true, statusCode: 503 },
    });

    const result = await runEventsRefresh({
      argv: ["node", "eventsRefresh.mjs"],
      env: { CONTEXT_DEV_API_KEY: "test-key", TICKETMASTER_API_KEY: "tm-key" },
      nowMs,
      fetchImpl: answeringTicketmaster,
      outPath,
      loadVenueIndex: () => null,
      runCommonLane: async () => ({ rows: [] }),
      log: () => {},
      logError: () => {},
    });

    expect(result.provider.status).toBe("wrote");
    const written = JSON.parse(readFileSync(outPath, "utf8"));
    expect(written.rows.some((row: { id?: string }) => row.id === "events-cd-held")).toBe(true);
    expect(written.generatedAt).toBe(observedAt);
    extractSpy.mockRestore();
  });

  it.each([
    ["blank", {}],
    ["malformed", { events: "not an array" }],
    ["empty", { events: [] }],
    ["unusable", { events: [{ title: "Undated quiz", placeName: "The Dove", kind: "event", sourceUrl: "https://www.fullers.co.uk/pubs/the-dove/event/quiz" }] }],
    ["cross-record", { events: [{ title: "Open mic", placeName: "The Dove", kind: "music", startsAt: "2026-08-18T19:00:00Z" }] },
      "## Upcoming Events\nOpen mic at The Swan on 19 August 2026 at 20:00.\nQuiz at The Dove on 18 August 2026 at 20:00."],
    ["partially grounded", { events: [
      { title: "Quiz", placeName: "The Dove", kind: "event", startsAt: "2026-08-18T19:00:00Z" },
      { title: "Open mic", placeName: "The Dove", kind: "music", startsAt: "2026-08-18T19:00:00Z" },
    ] }, "Quiz at The Dove on 18 August 2026 at 20:00.\nOpen mic at The Swan on 19 August 2026 at 20:00."],
    ["partially malformed", { events: [
      { title: "Quiz", placeName: "The Dove", kind: "event", startsAt: "2026-08-18T19:00:00Z" },
      { title: "Open mic", placeName: "The Dove", kind: "music" },
    ] }, "Quiz at The Dove on 18 August 2026 at 20:00."],
    ["partially off-host", { events: [
      { title: "Quiz", placeName: "The Dove", kind: "event", startsAt: "2026-08-18T19:00:00Z" },
      { title: "Open mic", placeName: "The Dove", kind: "music", startsDate: "2026-08-19", sourceUrl: "https://example.com/event" },
    ] }, "Quiz at The Dove on 18 August 2026 at 20:00.\nOpen mic at The Dove on 19 August 2026."],
  ])("retains held Fuller's rows when its JSON capture is %s while Ticketmaster updates", async (_case, data, markdown = "") => {
    const outPath = temporaryOutPath();
    const held = [
      { ...heldFullersRow("events-cd-blank-held"), observedAt: heldGeneratedAt },
      { ...heldFullersRow("events-cd-mic-held"), title: "Held open mic", observedAt: heldGeneratedAt },
    ];
    writeHeldFile(outPath, held);
    const fetched = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.startsWith("https://api.context.dev/")) {
        return new Response(
          JSON.stringify({
            url: "https://www.fullers.co.uk/event-finder",
            json: { requested: true, success: true, data },
            markdown: { requested: true, success: true, data: markdown },
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      return answeringTicketmaster(url);
    });

    const result = await runEventsRefresh({
      argv: ["node", "eventsRefresh.mjs"],
      env: { CONTEXT_DEV_API_KEY: "test-key", TICKETMASTER_API_KEY: "tm-key" },
      nowMs,
      fetchImpl: fetched as unknown as typeof fetch,
      outPath,
      loadVenueIndex: () => null,
      runCommonLane: async () => ({ rows: [] }),
      log: () => {},
      logError: () => {},
    });

    expect(result.provider.status).toBe("wrote");
    expect(fetched.mock.calls.some(([url]) => String(url).startsWith("https://api.context.dev/"))).toBe(true);
    const written = JSON.parse(readFileSync(outPath, "utf8"));
    expect(written.rows.map((row: { id: string }) => row.id)).toContain("events-cd-blank-held");
    expect(written.rows.some((row: { source: { label: string } }) => row.source.label === "Ticketmaster")).toBe(true);
    expect(written.rows.find((row: { id: string }) => row.id === "events-cd-blank-held")?.observedAt).toBe(heldGeneratedAt);
    expect(written.rows.filter((row: { source: { label: string } }) => row.source.label === "Fuller's")).toEqual(held);
    expect(result.provider.failures).toEqual([expect.stringContaining("fullers-event-finder-events: Extract returned")]);
  });

  it("leaves held bytes and timestamps untouched when a partial capture is the only lane", async () => {
    const outPath = temporaryOutPath();
    writeHeldFile(outPath, [heldFullersRow("held-quiz"), { ...heldFullersRow("held-mic"), title: "Open mic" }]);
    const before = readFileSync(outPath, "utf8");
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({
      url: "https://www.fullers.co.uk/event-finder",
      markdown: { requested: true, success: true, data: "Quiz at The Dove on 18 August 2026.\nOpen mic at The Swan on 19 August 2026." },
      json: { requested: true, success: true, data: { events: [
        { title: "Quiz", placeName: "The Dove", kind: "event", startsDate: "2026-08-18" },
        { title: "Open mic", placeName: "The Dove", kind: "music", startsDate: "2026-08-18" },
      ] } },
    }), { status: 200, headers: { "content-type": "application/json" } }));
    const result = await runEventsRefresh({
      argv: ["node", "eventsRefresh.mjs", "--allow-empty"],
      env: { CONTEXT_DEV_API_KEY: "test-key" },
      nowMs,
      fetchImpl,
      outPath,
      loadVenueIndex: () => null,
      runCommonLane: async () => ({ rows: [] }),
      log: () => {},
      logError: () => {},
    });
    expect(result.provider.status).toBe("failed");
    expect(result.provider.wrote).toBe(false);
    expect(readFileSync(outPath, "utf8")).toBe(before);
  });

  it("retains both held records and observation times when SDK marks one captured event partial", async () => {
    const outPath = temporaryOutPath();
    const held = [
      { ...heldFullersRow("held-quiz"), observedAt: heldGeneratedAt },
      { ...heldFullersRow("held-mic"), title: "Open mic", observedAt: heldGeneratedAt },
    ];
    writeHeldFile(outPath, held);
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      if (String(input).startsWith("https://api.context.dev/")) {
        return new Response(JSON.stringify({
          url: "https://www.fullers.co.uk/event-finder",
          isPartial: true,
          markdown: { requested: true, success: true, data: "Quiz at The Dove on 18 August 2026." },
          json: { requested: true, success: true, data: { events: [
            { title: "Quiz", placeName: "The Dove", kind: "event", startsDate: "2026-08-18" },
          ] } },
        }), { status: 200, headers: { "content-type": "application/json" } });
      }
      return answeringTicketmaster(String(input));
    });
    const result = await runEventsRefresh({
      argv: ["node", "eventsRefresh.mjs"],
      env: { CONTEXT_DEV_API_KEY: "test-key", TICKETMASTER_API_KEY: "tm-key" },
      nowMs,
      fetchImpl: fetchImpl as unknown as typeof fetch,
      outPath,
      loadVenueIndex: () => null,
      runCommonLane: async () => ({ rows: [] }),
      log: () => {},
      logError: () => {},
    });
    expect(result.provider.status).toBe("wrote");
    const written = JSON.parse(readFileSync(outPath, "utf8"));
    expect(written.rows.filter((row: { source: { label: string } }) => row.source.label === "Fuller's")
      .sort((a: { id: string }, b: { id: string }) => a.id.localeCompare(b.id)))
      .toEqual([...held].sort((a, b) => a.id.localeCompare(b.id)));
    expect(written.rows.some((row: { source: { label: string } }) => row.source.label === "Ticketmaster")).toBe(true);
    expect(result.provider.failures).toEqual([expect.stringContaining("fullers-event-finder-events")]);
  });

  it("counts the drops of a source that yielded no rows at all", async () => {
    const extractSpy = vi.spyOn(contextDev, "extract").mockResolvedValue({
      status: "ok",
      url: "https://www.fullers.co.uk/event-finder",
      data: {
        events: [
          {
            title: "Film screening",
            placeName: "The Dove",
            kind: "film",
            sourceUrl: "https://www.fullers.co.uk/pubs/the-dove/event/film",
            startsAt: "2026-08-16T20:00:00Z",
          },
          {
            title: "Undated quiz",
            placeName: "The Dove",
            kind: "event",
            sourceUrl: "https://www.fullers.co.uk/pubs/the-dove/event/quiz",
          },
        ],
      },
      markdown: "# Events\nFilm screening at The Dove on 16 August 2026 at 20:00.",
      urlsAnalyzed: ["https://www.fullers.co.uk/event-finder"],
    });

    const lines: string[] = [];
    const errors: string[] = [];
    const result = await runEventsRefresh({
      argv: ["node", "eventsRefresh.mjs", "--allow-empty"],
      env: { CONTEXT_DEV_API_KEY: "test-key" },
      nowMs,
      fetchImpl: (async () => new Response("{}", { status: 500 })) as unknown as typeof fetch,
      outPath: temporaryOutPath(),
      loadVenueIndex: () => null,
      runCommonLane: async () => ({ rows: [] }),
      log: (line: string) => lines.push(line),
      logError: (line: string) => errors.push(line),
    });

    expect(result.provider.status).toBe("failed");
    expect(lines.some((line) => line.startsWith("eventsRefresh: wrote"))).toBe(false);
    expect(errors).toEqual(expect.arrayContaining([expect.stringContaining("dropped 2")]));
    extractSpy.mockRestore();
  });

  it("carries held rows across a lane-level crash", async () => {
    const outPath = temporaryOutPath();
    writeHeldFile(outPath, [heldFullersRow("events-cd-crash-held")]);

    const extractSpy = vi.spyOn(contextDev, "extract").mockImplementation(() => {
      throw new Error("lane blew up");
    });

    const result = await runEventsRefresh({
      argv: ["node", "eventsRefresh.mjs"],
      env: { CONTEXT_DEV_API_KEY: "test-key", TICKETMASTER_API_KEY: "tm-key" },
      nowMs,
      fetchImpl: answeringTicketmaster,
      outPath,
      loadVenueIndex: () => null,
      runCommonLane: async () => ({ rows: [] }),
      log: () => {},
      logError: () => {},
    });

    expect(result.provider.status).toBe("wrote");
    const written = JSON.parse(readFileSync(outPath, "utf8"));
    expect(written.rows.some((row: { id?: string }) => row.id === "events-cd-crash-held")).toBe(true);
    extractSpy.mockRestore();
  });
});
