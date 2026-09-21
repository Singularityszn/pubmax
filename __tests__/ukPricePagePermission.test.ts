import { afterEach, describe, expect, it, vi } from "vitest";
import { createRobotsChecker } from "@/lib/harvest/robots";
import { fetchText } from "../scripts/harvest/uk-prices/run.mjs";

afterEach(() => vi.unstubAllGlobals());
const origin = "https://audit-pub.example";
const checker = () => createRobotsChecker({ fetchImpl: async () => new Response("User-agent: *\nDisallow: /private\n") });

describe("UK harvest page permission", () => {
  it.each(["/private/menu", "/private/sitemap.xml"])("never fetches denied path %s", async (path) => {
    const fetchPage = vi.fn<typeof fetch>(async () => new Response("should not be read"));
    vi.stubGlobal("fetch", fetchPage);
    expect((await fetchText(origin + path, checker())).ok).toBe(false);
    expect(fetchPage).not.toHaveBeenCalled();
  });

  it("checks a redirect target before requesting its bytes", async () => {
    const fetchPage = vi.fn<typeof fetch>(async () => new Response(null, { status: 302, headers: { location: "/private/menu" } }));
    vi.stubGlobal("fetch", fetchPage);
    expect((await fetchText(origin + "/menu", checker())).ok).toBe(false);
    expect(fetchPage).toHaveBeenCalledTimes(1);
    expect(fetchPage.mock.calls[0]?.[1]).toMatchObject({ redirect: "manual" });
  });

  it("reads an allowed final page", async () => {
    const fetchPage = vi.fn<typeof fetch>(async () => new Response("A permitted menu"));
    vi.stubGlobal("fetch", fetchPage);
    expect(await fetchText(origin + "/menu", checker())).toMatchObject({ ok: true, body: "A permitted menu" });
    expect(fetchPage).toHaveBeenCalledTimes(1);
  });
});
