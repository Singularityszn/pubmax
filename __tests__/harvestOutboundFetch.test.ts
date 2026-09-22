import { lookup } from "node:dns/promises";
import { describe, expect, it, vi } from "vitest";

import {
  createPinnedHarvestLookup,
  fetchHarvestedPage,
  HarvestOutboundRefusal,
  resolvePublicHarvestAddress,
} from "@/lib/harvest/robots";

describe("harvested page transport", () => {
  it("bounds redirect loops", async () => {
    const robots = vi.fn(async () => ({ allowed: true, reason: "allowed", evidence: "fixture" } as const));
    const fetchImpl = vi.fn(async () => new Response(null, { status: 302, headers: { location: "/loop" } }));
    expect(await fetchHarvestedPage("https://menu.example/loop", robots, {}, { fetchImpl })).toMatchObject({ ok: false, reason: "redirect-limit" });
    expect(fetchImpl).toHaveBeenCalledTimes(6);
  });
  it("refuses mixed public/private DNS answers before dialing", async () => {
    const lookupImpl = vi.fn(async () => [
      { address: "8.8.8.8", family: 4 as const },
      { address: "127.0.0.1", family: 4 as const },
    ]) as unknown as typeof lookup;

    await expect(resolvePublicHarvestAddress("menu.example", lookupImpl)).rejects.toBeInstanceOf(HarvestOutboundRefusal);
    expect(lookupImpl).toHaveBeenCalledWith("menu.example", { all: true, verbatim: true });
  });

  it("pins every socket lookup to the already-vetted address", () => {
    const callback = vi.fn();
    const lookupAddress = createPinnedHarvestLookup({ address: "8.8.8.8", family: 4 });
    lookupAddress("menu.example", { all: false }, callback);
    expect(callback).toHaveBeenCalledWith(null, "8.8.8.8", 4);

    const allCallback = vi.fn();
    lookupAddress("menu.example", { all: true }, allCallback);
    expect(allCallback).toHaveBeenCalledWith(null, [{ address: "8.8.8.8", family: 4 }]);
  });

  it("checks permission for each safe redirect before reading its bytes", async () => {
    const events: string[] = [];
    const robots = vi.fn(async (url: string) => {
      events.push(`robots:${new URL(url).pathname}`);
      return { allowed: true, reason: "allowed", evidence: "fixture" } as const;
    });
    const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
      events.push(`fetch:${new URL(url).pathname}`);
      expect(init?.redirect).toBe("manual");
      if (url.endsWith("/start")) {
        return new Response(null, { status: 302, headers: { location: "/menu" } });
      }
      return new Response("menu text");
    });

    const result = await fetchHarvestedPage("https://menu.example/start", robots, {}, { fetchImpl: fetchImpl as typeof fetch });
    expect(result).toMatchObject({ ok: true, url: "https://menu.example/menu" });
    expect(await (result as Extract<typeof result, { ok: true }>).response.text()).toBe("menu text");
    expect(events).toEqual([
      "robots:/start",
      "fetch:/start",
      "robots:/menu",
      "fetch:/menu",
    ]);
  });

  it("refuses private redirect landings before robots or fetch can touch them", async () => {
    const robots = vi.fn(async () => ({ allowed: true, reason: "allowed", evidence: "fixture" } as const));
    const fetchImpl = vi.fn(async () => new Response(null, {
      status: 302,
      headers: { location: "http://169.254.169.254/latest/meta-data/" },
    }));

    const result = await fetchHarvestedPage("https://menu.example/start", robots, {}, { fetchImpl: fetchImpl as typeof fetch });
    expect(result).toMatchObject({ ok: false, reason: "source-policy" });
    expect(robots).toHaveBeenCalledTimes(1);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

});
