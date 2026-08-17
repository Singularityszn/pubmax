import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, describe, expect, it, vi } from "vitest";

import * as contextDevServer from "@/lib/contextDev.server";
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

describe("eventsRefresh Context.dev lane", () => {
  it("runs with only CONTEXT_DEV_API_KEY and merges rows into the file", async () => {
    const extractSpy = vi.spyOn(contextDevServer, "extract").mockResolvedValue({
      status: "ok",
      url: "https://www.fullers.co.uk/event-finder",
      data: {
        events: [
          {
            title: "Open mic",
            placeName: "The Counting House",
            kind: "music",
            sourceUrl: "https://www.fullers.co.uk/pubs/counting-house/event/open-mic",
            startsAt: "2026-08-16T20:00:00Z",
          },
        ],
      },
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

  it("carries held Fuller's rows when Context.dev fails", async () => {
    const outPath = temporaryOutPath();
    const heldRow = {
      id: "events-cd-held",
      placeName: "The Dove",
      kind: "event",
      title: "Held quiz",
      source: { label: "Fuller's", url: "https://www.fullers.co.uk/pubs/the-dove/event/quiz" },
      observedAt,
      confidence: "listed",
      startsAt: "2026-08-16T19:00:00.000Z",
    };
    const { writeFileSync } = await import("node:fs");
    writeFileSync(
      outPath,
      JSON.stringify({ generatedAt: observedAt, kind: "events", city: "london", rows: [heldRow] }, null, 2),
    );

    const extractSpy = vi.spyOn(contextDevServer, "extract").mockResolvedValue({
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

    expect(result.provider.status).toBe("wrote");
    const written = JSON.parse(readFileSync(outPath, "utf8"));
    expect(written.rows.some((row: { id?: string }) => row.id === "events-cd-held")).toBe(true);
    extractSpy.mockRestore();
  });
});
