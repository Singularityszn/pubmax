import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { describe, expect, it } from "vitest";

import EmptyState from "@/components/ui/empty-state";
import Kicker from "@/components/ui/kicker";
import Screen from "@/components/ui/screen";
import TrustPill from "@/components/ui/trust-pill";
import { PRICE_AUTHORITY_MAX_AGE_MS } from "@/lib/priceAuthorityWindow";
import {
  formatTrustDay,
  TRUST_PILL_LABEL,
  trustPillLabel,
  trustToneForConfirmation,
} from "@/lib/trustPill";

// The four launch primitives (issue #1354): Kicker, TrustPill, EmptyState,
// Screen. These render each one and pin the structural promises the rest of
// the relaunch builds on: a Screen carries exactly one primary action with
// its kicker above its heading; a trust pill's meaning is in its words; an
// empty state points forward with at most one way onward; and amber stays
// defined but unused until London is re-collected (#1329).

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

  it("prints the meaning in words, with the day on a confirmed price", () => {
    const html = renderToStaticMarkup(createElement(TrustPill, { tone: "confirmed", confirmedAt: day }));
    expect(html).toContain("Confirmed 3 Sept");
    expect(html).toContain('data-tone="confirmed"');
    expect(html).toContain('aria-hidden="true"');
  });

  it("says no price is logged on the grey tone", () => {
    const html = renderToStaticMarkup(createElement(TrustPill, { tone: "none" }));
    expect(html).toContain("No price logged");
    expect(html).not.toContain("Confirmed");
  });

  it("derives the live tone from the 30 day authority window", () => {
    const now = day;
    expect(trustToneForConfirmation(now - PRICE_AUTHORITY_MAX_AGE_MS, now)).toBe("confirmed");
    expect(trustToneForConfirmation(now - PRICE_AUTHORITY_MAX_AGE_MS - 1, now)).toBe("none");
    expect(trustToneForConfirmation(null, now)).toBe("none");
    expect(trustToneForConfirmation(now + 1, now)).toBe("none");
  });

  it("formats the day in London time as the pill prints it", () => {
    expect(formatTrustDay(day)).toBe("3 Sept");
    expect(trustPillLabel("confirmed", day)).toBe("Confirmed 3 Sept");
    expect(trustPillLabel("confirmed")).toBe(TRUST_PILL_LABEL.confirmed);
    expect(trustPillLabel("held")).toBe("Scraped");
  });

  it("keeps amber defined but passed by nothing outside the primitive", () => {
    const files: string[] = [];
    walk(join(ROOT, "components"), files);
    walk(join(ROOT, "app"), files);
    const offenders = files
      .filter((file) => !file.endsWith("components/ui/trust-pill.tsx"))
      .filter((file) => /tone\s*[=:]\s*["']held["']/.test(readFileSync(file, "utf8")))
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
