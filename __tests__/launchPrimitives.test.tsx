import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { describe, expect, it } from "vitest";

import EmptyState from "@/components/ui/empty-state";
import Kicker from "@/components/ui/kicker";
import Screen from "@/components/ui/screen";
import TrustPill from "@/components/ui/trust-pill";
import {
  HOW_WE_ESTIMATE_HREF,
  HOW_WE_ESTIMATE_LABEL,
  priceStandingFor,
  priceStandingLabel,
} from "@/lib/priceTier";
import { priceBand, priceBandClass } from "@/lib/priceBand";
import { formatTrustDay, trustPillLabel } from "@/lib/trustPill";

// The four launch primitives (issue #1354): Kicker, TrustPill, EmptyState,
// Screen. These render each one and pin the structural promises the rest of
// the relaunch builds on: a Screen carries exactly one primary action with
// its kicker above its heading; a trust pill's meaning is in its words; an
// empty state points forward with at most one way onward; and the pill re-decides
// nothing, taking a standing lib/priceTier.ts already decided.

const ROOT = process.cwd();

function walk(dir: string, out: string[]): void {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry === "node_modules") continue;
      walk(full, out);
    } else if (/\.tsx?$/.test(entry)) {
      out.push(full);
    }
  }
}

describe("Kicker", () => {
  it("renders the words untouched, sentence case, above nothing else", () => {
    const html = renderToStaticMarkup(<Kicker>Tonight in London</Kicker>);
    expect(html).toBe('<p class="kicker">Tonight in London</p>');
  });

  it("takes a muted tone and an inline element", () => {
    const html = renderToStaticMarkup(
      <Kicker tone="muted" as="span" id="k">
        PUBMAXX
      </Kicker>,
    );
    expect(html).toBe('<span class="kicker kickerMuted" id="k">PUBMAXX</span>');
  });
});

describe("TrustPill", () => {
  const day = Date.UTC(2026, 8, 3, 12);
  const at = (ms: number) => new Date(ms).toISOString();
  const render = (decision: Parameters<typeof TrustPill>[0]["decision"], basisNote?: string) =>
    renderToStaticMarkup(createElement(TrustPill, { decision, basisNote }));

  const confirmed = priceStandingFor({ confirmed: { priceGbp: 5.4, observedAt: at(day) } }, day);
  const listed = priceStandingFor(
    { listed: { priceGbp: 5.9, sourceUrl: "https://pub.example/menu", observedAt: at(day) } },
    day,
  );
  const estimate = priceStandingFor(
    { estimate: { priceGbp: 6.6, basis: "regional_baseline", sampleSize: 120, computedAt: at(day) } },
    day,
  );
  const nothing = priceStandingFor({}, day);

  it("prints the meaning in words, with the day on a confirmed price", () => {
    const html = render(confirmed);
    expect(html).toContain("Confirmed 3 Sept");
    expect(html).toContain('data-standing="confirmed"');
    expect(html).toContain('aria-hidden="true"');
  });

  it("says there is no price yet on the grey standing, and shows no figure", () => {
    const html = render(nothing);
    expect(html).toContain(priceStandingLabel("none"));
    expect(html).not.toContain("Confirmed");
    expect(html).not.toContain("£");
  });

  it("prints a published price plainly and offers no method link", () => {
    const html = render(listed);
    expect(html).toContain("£5.90");
    expect(html).toContain("Listed");
    expect(html).not.toContain("est.");
    expect(html).not.toContain(HOW_WE_ESTIMATE_HREF);
  });

  it("never prints a modelled figure as a bare price, and always offers the method", () => {
    const html = render(estimate);
    expect(html).toContain("est. £6.60");
    expect(html).not.toMatch(/>\s*£6\.60\s*</);
    expect(html).toContain(HOW_WE_ESTIMATE_HREF);
    expect(html).toContain(HOW_WE_ESTIMATE_LABEL);
  });

  it("names the sample behind an estimate when it is given one", () => {
    expect(render(estimate, "Modelled from 120 published prices (prices nearby).")).toContain(
      "Modelled from 120 published prices",
    );
  });

  it("dates only a confirmed price, because the other three have no confirmation day", () => {
    for (const decision of [listed, estimate, nothing]) {
      expect(render(decision)).not.toContain("3 Sept");
    }
  });

  it("wears the price BAND of its figure and never a tone per standing", () => {
    // Captain's law 2026-09-05: colour on a price is the band (lib/priceBand.ts).
    // A standing is a word; the same standing over a cheap and a dear figure
    // wears two colours, and no figure wears none.
    for (const decision of [confirmed, listed, estimate, nothing]) {
      expect(render(decision)).not.toMatch(/data-tone=|trustPill-(green|amber|modelled|grey)/);
    }
    const bandOf = (html: string) => /data-price-band="(\w+)"/.exec(html)?.[1] ?? null;
    expect(bandOf(render(nothing))).toBeNull();
    expect(bandOf(render(listed))).toBe(priceBand(listed.priceGbp));
    expect(bandOf(render(confirmed))).toBe(priceBand(confirmed.priceGbp));
    expect(bandOf(render(estimate))).toBe(priceBand(estimate.priceGbp));
    expect(render(listed)).toContain(`trustPill ${priceBandClass(priceBand(listed.priceGbp))}`);
  });

  it("formats the day in London time as the pill prints it", () => {
    expect(formatTrustDay(day)).toBe("3 Sept");
    expect(trustPillLabel("confirmed", day)).toBe("Confirmed 3 Sept");
    expect(trustPillLabel("confirmed")).toBe(priceStandingLabel("confirmed"));
  });

  it("re-decides nothing: the standing is the only thing any surface passes", () => {
    // The pill used to carry a second tone vocabulary of its own, and the two
    // drifted apart within a day. A surface may hand it a decision and nothing
    // else, so a `tone=` or `held` prop anywhere is the drift coming back.
    const files: string[] = [];
    walk(join(ROOT, "components"), files);
    walk(join(ROOT, "app"), files);
    const offenders = files
      .filter((file) => !file.endsWith("components/ui/trust-pill.tsx"))
      .filter((file) => /<TrustPill[^>]*\stone=/.test(readFileSync(file, "utf8")))
      .map((file) => relative(ROOT, file));
    expect(offenders).toEqual([]);
  });
});

describe("EmptyState", () => {
  it("renders a title, one line and one way onward", () => {
    const html = renderToStaticMarkup(
      createElement(
        EmptyState,
        { title: "No price logged here yet", action: createElement("a", { href: "/near" }, "Log the first") },
        "Prices here come from drinkers at the bar.",
      ),
    );
    expect(html).toBe(
      '<div class="emptyState"><p class="emptyStateTitle">No price logged here yet</p>' +
        '<p class="emptyStateLine">Prices here come from drinkers at the bar.</p>' +
        '<div class="emptyStateAction"><a href="/near">Log the first</a></div></div>',
    );
  });

  it("renders the title alone when there is nothing more to say", () => {
    const html = renderToStaticMarkup(createElement(EmptyState, { title: "Nothing on tonight" }));
    expect(html).toBe('<div class="emptyState"><p class="emptyStateTitle">Nothing on tonight</p></div>');
  });
});

describe("Screen", () => {
  const html = renderToStaticMarkup(
    createElement(
      Screen,
      {
        kicker: "Tonight in London",
        title: "What a pint costs, pub by pub.",
        primary: createElement("a", { href: "/near?locate=1" }, "Find my pint"),
        secondary: createElement("a", { href: "/map" }, "Open the map"),
        titleId: "screen-title",
      },
      createElement("p", null, "body"),
    ),
  );

  it("carries exactly one primary action", () => {
    expect(html.match(/data-primary-action/g)).toHaveLength(1);
    expect(html).toContain('<div class="screenPrimary" data-primary-action=""><a href="/near?locate=1">Find my pint</a></div>');
    expect(html).toContain('<div class="screenSecondary"><a href="/map">Open the map</a></div>');
  });

  it("puts the kicker above the heading and the heading above the action", () => {
    const kicker = html.indexOf('class="kicker"');
    const heading = html.indexOf("<h1");
    const primary = html.indexOf("data-primary-action");
    const body = html.indexOf("<p>body</p>");
    expect(kicker).toBeGreaterThan(-1);
    expect(kicker).toBeLessThan(heading);
    expect(heading).toBeLessThan(primary);
    expect(primary).toBeLessThan(body);
    expect(html).toContain('<h1 class="screenTitle" id="screen-title">What a pint costs, pub by pub.</h1>');
    expect(html).toContain('aria-labelledby="screen-title"');
  });

  it("renders no lede unless one is given", () => {
    expect(html).not.toContain("screenLede");
    const withLede = renderToStaticMarkup(
      createElement(Screen, {
        kicker: "k",
        title: "t",
        lede: "One line.",
        primary: createElement("button", { type: "button" }, "Go"),
        headingLevel: 2,
        as: "div",
      }),
    );
    expect(withLede).toContain('<p class="screenLede">One line.</p>');
    expect(withLede).toContain("<h2");
    expect(withLede.startsWith('<div class="screen">')).toBe(true);
  });
});
