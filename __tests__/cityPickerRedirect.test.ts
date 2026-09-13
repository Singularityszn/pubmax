// One city picker, at one address. /places is the picker and the canonical
// page; /choose-city is the address it used to have.
//
// The pair moves together on purpose. A 308 from the page that carries the
// canonical to a page that ships `noindex` takes the city list out of the
// index altogether, which is the defect this lane exists to prevent, so the
// canonical, the sitemap row and this redirect are one change.

import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";

import { PLACES_PATH } from "@/lib/places";
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

describe("/choose-city is the old address of the city picker", () => {
  it("sends a reader to /places permanently", () => {
    const response = ask("/choose-city");

    expect(response.status).toBe(308);
    expect(new URL(response.headers.get("location") ?? "").pathname).toBe(PLACES_PATH);
  });

  it("carries the query through rather than dropping it at the door", () => {
    // /places reads no `focus` param; the 308 preserves the query because a
    // permanent redirect must not edit the address a reader asked for.
    const response = ask("/choose-city?focus=search");

    expect(new URL(response.headers.get("location") ?? "").search).toBe("?focus=search");
  });

  it("leaves /places alone", () => {
    expect(ask(PLACES_PATH).status).not.toBe(308);
  });
});
