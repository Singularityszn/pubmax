import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";

import { MAP_LIST_PATH, mapListOpenFromSearch } from "@/lib/mapListRoute";
import { securityProxy } from "@/proxy";

const DOCUMENT_ACCEPT =
  "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8";

function ask(path: string): Response {
  return securityProxy(
    new NextRequest(`https://pubmaxxing.com${path}`, {
      headers: { host: "pubmaxxing.com", accept: DOCUMENT_ACCEPT },
    }),
  );
}

describe("map list route", () => {
  it("opens list view from the list search param", () => {
    expect(mapListOpenFromSearch("?list=1")).toBe(true);
    expect(mapListOpenFromSearch("?sel=venue-1")).toBe(false);
    expect(mapListOpenFromSearch("")).toBe(false);
  });

  it("redirects /map/list to the map with list intent", () => {
    const response = ask(MAP_LIST_PATH);
    expect(response.status).toBe(308);
    const location = new URL(response.headers.get("location") ?? "");
    expect(location.pathname).toBe("/map");
    expect(location.searchParams.get("list")).toBe("1");
  });

  it("keeps the reader's query on the /map/list redirect", () => {
    const response = ask(`${MAP_LIST_PATH}?sel=venue-1&utm_source=poster`);
    expect(response.status).toBe(308);
    const location = new URL(response.headers.get("location") ?? "");
    expect(location.pathname).toBe("/map");
    expect(location.searchParams.get("list")).toBe("1");
    expect(location.searchParams.get("sel")).toBe("venue-1");
    expect(location.searchParams.get("utm_source")).toBe("poster");
  });
});
