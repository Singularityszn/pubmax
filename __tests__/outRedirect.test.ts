// Out folded into Tonight (product owner, Oct 2026 UX audit). The primary row
// is Map, Tonight, Plan, You, and /out keeps its address for old links and
// bookmarks by answering a permanent redirect at the edge, the same shape as
// the /choose-city 308 (__tests__/cityPickerRedirect.test.ts).

import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";

import { OUT_PATH, TONIGHT_PATH } from "@/lib/outRoute";
import { securityProxy } from "@/proxy";

/** What a browser sends when it navigates to a page. */
const DOCUMENT_ACCEPT =
  "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8";

function ask(path: string): Response {
  return securityProxy(
    new NextRequest(`https://pubmaxxing.com${path}`, {
      headers: { host: "pubmaxxing.com", accept: DOCUMENT_ACCEPT },
    }),
  );
}

describe("/out is the old address of Tonight's listings", () => {
  it("names the two addresses", () => {
    expect(OUT_PATH).toBe("/out");
    expect(TONIGHT_PATH).toBe("/tonight");
  });

  it("sends a reader to /tonight permanently", () => {
    const response = ask("/out");

    expect(response.status).toBe(308);
    expect(new URL(response.headers.get("location") ?? "").pathname).toBe(TONIGHT_PATH);
  });

  it("carries the query through, so a shared ?day= link keeps its day", () => {
    const response = ask("/out?day=weekend");

    expect(new URL(response.headers.get("location") ?? "").search).toBe("?day=weekend");
  });

  it("leaves /tonight and the listings API alone", () => {
    expect(ask(TONIGHT_PATH).status).not.toBe(308);
    expect(ask("/api/out?city=london").status).not.toBe(308);
  });
});
