import { describe, expect, it, vi } from "vitest";

import * as contextDev from "@/lib/contextDev";
import {
  contextDevLaneStatus,
  normaliseContextDevEventRow,
  normaliseContextDevExtract,
  runContextDevEventsLane,
} from "@/lib/events/contextDevProvider";
import { allowedHarvestSources, contextDevEventSources } from "@/lib/harvest/sourcePolicy";
import { DATE_ONLY_TIME_EVIDENCE } from "@/lib/whatson/eventNormalise.mjs";
import { isValidWhatsOnRow } from "@/lib/whatsOn";

const fullers = contextDevEventSources().find((source) => source.id === "fullers-event-finder-events");
const observedAt = "2026-08-16T09:00:00.000Z";

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
  it("carries source credit on every row", () => {
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
      url: "https://www.fullers.co.uk/pubs/the-dove/event/1",
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

  it("caps a retry storm at the default budget when the caller hands none in", async () => {
    const fetchImpl = vi.fn(async () => new Response("down", { status: 503 }));

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

    expect(fetchImpl.mock.calls.length).toBeGreaterThan(0);
    expect(fetchImpl.mock.calls.length).toBeLessThanOrEqual(
      contextDev.CONTEXT_DEV_RUN_REQUEST_BUDGET,
    );
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
            sourceUrl: "https://example.com/a",
            startsAt: "2026-08-16T19:00:00Z",
          },
          {
            title: "Bad kind",
            placeName: "Pub B",
            kind: "quiz",
            sourceUrl: "https://example.com/b",
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
