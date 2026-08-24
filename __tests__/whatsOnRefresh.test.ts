import { describe, expect, it } from "vitest";

import { refreshOfficialWhatsOnListings } from "@/lib/whatsOnRefresh.server";
import type { WhatsOnListingStore } from "@/lib/whatsOnListingStore";
import type { WhatsOnRow } from "@/lib/whatsOn";
import type { OutLiveProvider } from "@/lib/out/loadOut";

const NOW = Date.parse("2026-08-24T20:00:00.000Z");
const GENERATED = "2026-08-24T20:00:00.000Z";

function eventRow(id: string): WhatsOnRow {
  return {
    id,
    placeName: "Jazz Cafe",
    kind: "event",
    startsAt: "2026-08-24T19:00:00.000Z",
    endsAt: "2026-08-24T22:00:00.000Z",
    title: "Live jazz",
    source: { label: "Ticketmaster", url: `https://www.ticketmaster.co.uk/event/${id}` },
    observedAt: "2026-08-24T10:00:00.000Z",
    confidence: "listed",
    sourceId: id,
  };
}

function memoryStore(): WhatsOnListingStore & { kinds: string[] } {
  const rows = new Map<string, WhatsOnRow[]>();
  return {
    kinds: [],
    async replaceKind(kind, next) {
      this.kinds.push(kind);
      rows.set(kind, next);
      return { written: next.length };
    },
    async readAll() {
      return { rows: [...rows.values()].flat(), generatedAt: GENERATED };
    },
  };
}

describe("refreshOfficialWhatsOnListings", () => {
  it("writes live event rows to the durable store", async () => {
    const store = memoryStore();
    const providers: OutLiveProvider[] = [
      {
        name: "ticketmaster",
        isConfigured: () => true,
        fetchTonight: async () => [eventRow("tm-1")],
      },
    ];
    const result = await refreshOfficialWhatsOnListings({ now: NOW, store, providers });
    expect(result).toMatchObject({ ok: true, mode: "providers", written: 1 });
    expect(result.observedAt).toBeTruthy();
    const snap = await store.readAll();
    expect(snap.rows.map((row) => row.id)).toEqual(["tm-1"]);
  });

  it("drops expired provider rows before they reach the store", async () => {
    const store = memoryStore();
    const expired = eventRow("old");
    expired.startsAt = "2026-08-22T19:00:00.000Z";
    expired.endsAt = "2026-08-22T22:00:00.000Z";
    const providers: OutLiveProvider[] = [
      {
        name: "ticketmaster",
        isConfigured: () => true,
        fetchTonight: async () => [expired],
      },
    ];
    const result = await refreshOfficialWhatsOnListings({ now: NOW, store, providers });
    expect(result.written).toBe(0);
    expect((await store.readAll()).rows).toEqual([]);
  });

  it("keeps the previous store when every configured provider fails", async () => {
    const store = memoryStore();
    await store.replaceKind("event", [eventRow("kept")], GENERATED);
    const providers: OutLiveProvider[] = [
      {
        name: "ticketmaster",
        isConfigured: () => true,
        fetchTonight: async () => {
          throw new Error("Ticketmaster Discovery API returned 500");
        },
      },
    ];
    const result = await refreshOfficialWhatsOnListings({ now: NOW, store, providers });
    expect(result.ok).toBe(false);
    expect((await store.readAll()).rows.map((row) => row.id)).toEqual(["kept"]);
  });

  it("keeps the previous store when one configured provider fails", async () => {
    const store = memoryStore();
    await store.replaceKind("event", [eventRow("kept")], GENERATED);
    const providers: OutLiveProvider[] = [
      {
        name: "ticketmaster",
        isConfigured: () => true,
        fetchTonight: async () => [eventRow("new")],
      },
      {
        name: "skiddle",
        isConfigured: () => true,
        fetchTonight: async () => {
          throw new Error("Skiddle unavailable");
        },
      },
    ];
    const result = await refreshOfficialWhatsOnListings({ now: NOW, store, providers });
    expect(result).toMatchObject({ ok: false, written: 0, observedAt: null });
    expect((await store.readAll()).rows.map((row) => row.id)).toEqual(["kept"]);
  });

  it("does not invent a refresh when no provider is configured", async () => {
    const store = memoryStore();
    const providers: OutLiveProvider[] = [
      { name: "ticketmaster", isConfigured: () => false, fetchTonight: async () => [eventRow("x")] },
    ];
    const result = await refreshOfficialWhatsOnListings({ now: NOW, store, providers });
    expect(result).toMatchObject({ ok: false, mode: "no-providers", written: 0, observedAt: null });
  });
});
