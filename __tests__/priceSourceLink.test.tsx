// @vitest-environment jsdom
import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import PriceSourceName from "@/components/venue/PriceSourceName";
import { priceSourceOf, safePriceSourceHref } from "@/lib/priceSourceLink";

const HOSTILE = [
  "javascript:alert(1)",
  " JavaScript:alert(1)",
  "data:text/html,<script>alert(1)</script>",
  "vbscript:msgbox(1)",
  "/pubs/evil",
  "//evil.example/pint",
  "pint-prices.com/pub/1",
  "https://user:pass@evil.example/pint",
  "https://pint-prices.com@evil.example/pint",
  "ftp://pint-prices.com/pub",
  "",
] as const;

const SAFE = "https://www.pint-prices.com/pub/example";

describe("the price source owner", () => {
  it.each(HOSTILE)("refuses %j as a link but keeps the label", (url) => {
    expect(safePriceSourceHref(url)).toBeNull();
    expect(priceSourceOf("Pint Prices", url)).toEqual({ kind: "refused", label: "Pint Prices" });
  });

  it("links a safe http(s) URL and trims it", () => {
    expect(priceSourceOf(" Pint Prices ", ` ${SAFE} `)).toEqual({ kind: "link", label: "Pint Prices", href: SAFE });
    expect(safePriceSourceHref("http://pub.example/menu")).toBe("http://pub.example/menu");
  });

  it.each([null, undefined, "", "   "])("says no publisher was recorded for label %j, whatever the URL", (label) => {
    expect(priceSourceOf(label, SAFE)).toEqual({ kind: "missing" });
  });

  it.each([null, undefined, 4, {}])("refuses a non-string URL %j", (url) => {
    expect(safePriceSourceHref(url)).toBeNull();
  });
});

function html(element: ReactElement): HTMLElement {
  const host = document.createElement("div");
  host.innerHTML = renderToStaticMarkup(element);
  return host;
}

describe("PriceSourceName", () => {
  it("links a safe publisher URL in a new tab", () => {
    const link = html(<PriceSourceName label="Pint Prices" url={SAFE} className="x" />).querySelector("a");
    expect(link?.getAttribute("href")).toBe(SAFE);
    expect(link?.getAttribute("class")).toBe("x");
    expect(link?.getAttribute("rel")).toBe("noopener noreferrer");
  });

  it.each(HOSTILE)("keeps the label and says the link is unavailable for %j", (url) => {
    const host = html(<PriceSourceName label="Pint Prices" url={url} />);
    expect(host.querySelector("a")).toBeNull();
    expect(host.textContent).toBe("Pint Prices. Link unavailable.");
  });

  it("says no publisher was recorded when the record names none", () => {
    expect(html(<PriceSourceName label=" " url={SAFE} />).textContent).toBe("Publisher not recorded");
  });
});
