import { describe, it, expect } from "vitest";

import { handleWhatsOnRequest } from "@/app/api/whats-on/route";
import { loadBaselineWhatsOn, loadWhatsOn, mergeWhatsOn } from "@/lib/whatsOnStore";
import type { WhatsOnRow } from "@/lib/whatsOn";

const NOW = Date.parse("2026-07-11T20:00:00.000Z");

function makeRow(overrides: Partial<WhatsOnRow> = {}): WhatsOnRow {
  return {
    id: "r1",
    placeName: "The Test Arms",
    kind: "quiz",
    startsAt: "2026-07-11T19:30:00+01:00",
    title: "Pub quiz",
    source: { label: "Question One", url: "https://questionone.com/x/" },
    observedAt: "2026-07-11T18:00:00.000Z",
    confidence: "listed",
    ...overrides,
  };
}

function req(qs = ""): Request {
  return new Request(`http://localhost/api/whats-on${qs}`);
}

describe("loadBaselineWhatsOn", () => {
  it("loads + validates the bundled quiz_london.json baseline", () => {
    const rows = loadBaselineWhatsOn();
    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows) {
      expect(r.kind).toBe("quiz");
      expect(r.source.url).toMatch(/^https?:\/\//);
      expect(r.title.length).toBeGreaterThan(0);
    }
  });
});

describe("mergeWhatsOn precedence", () => {
  it("a confirmed baseline row beats a listed live row on collision", () => {
    const base = makeRow({ id: "base", confidence: "confirmed", title: "confirmed" });
    const live = makeRow({
      id: "live",
      confidence: "listed",
      title: "listed",
      observedAt: "2026-07-11T19:00:00.000Z",
    });
    const merged = mergeWhatsOn([base], [live]);
    expect(merged).toHaveLength(1);
    expect(merged[0].title).toBe("confirmed");
  });

  it("with equal confidence the freshest observedAt wins", () => {
    const base = makeRow({ id: "base", observedAt: "2026-07-11T10:00:00.000Z", title: "old" });
    const live = makeRow({ id: "live", observedAt: "2026-07-11T18:00:00.000Z", title: "fresh" });
    const merged = mergeWhatsOn([base], [live]);
    expect(merged).toHaveLength(1);
    expect(merged[0].title).toBe("fresh");
  });

  it("unions non-colliding rows", () => {
    const merged = mergeWhatsOn([makeRow({ id: "a" })], [makeRow({ id: "b", kind: "music" })]);
    expect(merged).toHaveLength(2);
  });
});

describe("loadWhatsOn orchestration", () => {
  it("merges live rows and applies kind + tonight + near + limit filters", async () => {
    const baseline = [
      makeRow({ id: "quiz-in", kind: "quiz", startsAt: "2026-07-11T19:30:00+01:00" }),
      makeRow({ id: "quiz-out", kind: "quiz", startsAt: "2026-07-10T19:30:00+01:00" }),
    ];
    const live = [makeRow({ id: "music-in", kind: "music", startsAt: "2026-07-11T21:00:00+01:00" })];
    const { rows } = await loadWhatsOn(
      { window: "tonight", limit: 10 },
      { now: NOW, loadBaseline: () => baseline, fetchLive: async () => live },
    );
    expect(rows.map((r) => r.id).sort()).toEqual(["music-in", "quiz-in"]);

    const musicOnly = await loadWhatsOn(
      { kind: "music" },
      { now: NOW, loadBaseline: () => baseline, fetchLive: async () => live },
    );
    expect(musicOnly.rows.map((r) => r.id)).toEqual(["music-in"]);

    const nearSorted = await loadWhatsOn(
      { near: { lat: 51.5, lng: -0.1 }, limit: 1 },
      {
        now: NOW,
        loadBaseline: () => [
          makeRow({ id: "far", lat: 51.6, lng: -0.3 }),
          makeRow({ id: "near", kind: "music", lat: 51.51, lng: -0.1 }),
        ],
        fetchLive: async () => [],
      },
    );
    expect(nearSorted.rows).toHaveLength(1);
    expect(nearSorted.rows[0].id).toBe("near");
  });

  it("fails soft to baseline when the live fetch throws", async () => {
    const { rows, asOf } = await loadWhatsOn(
      {},
      {
        now: NOW,
        loadBaseline: () => [makeRow({ id: "b1" })],
        fetchLive: async () => {
          throw new Error("live down");
        },
      },
    );
    expect(rows.map((r) => r.id)).toEqual(["b1"]);
    expect(asOf).toBe(new Date(NOW).toISOString());
  });
});

describe("GET /api/whats-on (handleWhatsOnRequest)", () => {
  it("returns rows with asOf and no-store caching", async () => {
    const res = await handleWhatsOnRequest(req(), {
      now: NOW,
      loadBaseline: () => [makeRow()],
      fetchLive: async () => [],
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.rows).toHaveLength(1);
    expect(body.asOf).toBe(new Date(NOW).toISOString());
    expect(res.headers.get("Cache-Control")).toBe("no-store");
  });

  it("applies params; unknown kind and bad near are dropped, not 400", async () => {
    const baseline = [
      makeRow({ id: "quiz1", kind: "quiz" }),
      makeRow({ id: "music1", kind: "music", lat: 51.51, lng: -0.1 }),
    ];
    const unknown = await handleWhatsOnRequest(req("?kind=bogus&near=not,coords"), {
      now: NOW,
      loadBaseline: () => baseline,
      fetchLive: async () => [],
    });
    expect(unknown.status).toBe(200);
    expect((await unknown.json()).rows).toHaveLength(2);

    const kinded = await handleWhatsOnRequest(req("?kind=music&near=51.5,-0.1&limit=1"), {
      now: NOW,
      loadBaseline: () => baseline,
      fetchLive: async () => [],
    });
    const body = await kinded.json();
    expect(body.rows).toHaveLength(1);
    expect(body.rows[0].id).toBe("music1");
  });

  it("returns { rows: [], error } (never 500) when the store throws outright", async () => {
    const res = await handleWhatsOnRequest(req(), {
      now: NOW,
      loadBaseline: () => {
        throw new Error("baseline corrupt");
      },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.rows).toEqual([]);
    expect(body.error).toBe("baseline corrupt");
  });
});
