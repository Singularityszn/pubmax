// @vitest-environment jsdom

import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import postcss from "postcss";
import { afterEach, describe, expect, it } from "vitest";

import EmptyState from "@/components/ui/empty-state";
import Kicker from "@/components/ui/kicker";
import Screen from "@/components/ui/screen";
import TrustPill from "@/components/ui/trust-pill";
import { priceStandingFor } from "@/lib/priceTier";

export const LAUNCH_TOKENS = [
  // Surfaces: the elevation ladder and its semantic names.
  "--paper", "--panel", "--panel-raised", "--panel-overlay", "--ink-deep",
  "--color-surface", "--color-surface-panel", "--color-surface-raised",
  "--color-surface-overlay", "--color-surface-inverse",
  // Text: three inks and what sits on a painted fill.
  "--ink", "--ink-soft", "--muted",
  "--color-text", "--color-text-soft", "--color-text-muted",
  "--color-on-accent", "--color-on-accent-strong", "--color-on-inverse", "--color-on-photo",
  // Edges.
  "--line", "--line-soft", "--hairline", "--hairline-strong",
  "--color-border", "--color-border-soft",
  // Accent: one coral, the light-only ink for coral WORDS, and the action aliases.
  "--brass", "--brass-bright", "--brass-ink",
  "--color-accent", "--color-accent-strong", "--color-accent-ink",
  "--accent-action", "--accent-action-strong",
  // Status and price: semantic hues, never decoration.
  "--pint", "--amber", "--brick", "--river",
  "--color-positive", "--color-caution", "--color-negative", "--color-info",
  "--accent-price", "--accent-price-ink",
  // Price band (lib/priceBand.ts): the hue paints a fill, the ink reads as text.
  "--price-band-cheap", "--price-band-average", "--price-band-expensive",
  "--price-band-cheap-ink", "--price-band-average-ink", "--price-band-expensive-ink",
  // Set on the element by the .priceBand-* class family; read by badge, figure and pill.
  "--price-band-hue", "--price-band-ink", "--price-band-surface", "--price-band-border",
  "--badge-surface", "--badge-border", "--badge-ink",
  "--state-active-surface", "--state-active-border", "--state-active-ink",
  // Selected: a chosen tab, chip or segment reads in ink, never coral.
  "--state-selected-surface", "--state-selected-border", "--state-selected-ink",
  // Type.
  "--font-display", "--font-body", "--font-data",
  "--text-2xs", "--text-xs", "--text-sm", "--text-base", "--text-md",
  "--text-lg", "--text-xl", "--text-2xl", "--text-3xl",
  "--leading-tight", "--leading-snug", "--leading-normal", "--tracking-tight",
  // Space and measure.
  "--space-1", "--space-2", "--space-3", "--space-4", "--space-5", "--space-6",
  "--space-8", "--space-10", "--space-12",
  "--page-gutter", "--content-max", "--content-max-wide",
  // Shape and depth.
  "--radius", "--radius-sm", "--radius-lg", "--radius-pill", "--control-radius",
  "--shadow", "--shadow-sm",
  // Motion.
  "--duration-fast", "--duration-base", "--duration-slow",
  "--ease-out", "--ease-out-strong", "--press-scale",
  // Stacking.
  "--z-float", "--z-nav", "--z-tabbar", "--z-modal", "--z-overlay-top",
] as const;

const PRIMITIVE_STYLESHEETS = [
  "components/ui/kicker.css",
  "components/ui/trustPill.css",
  "components/ui/emptyState.css",
  "components/ui/screen.css",
] as const;

const read = (file: string): string => readFileSync(join(process.cwd(), file), "utf8");
const tokenize = createRequire(import.meta.url)("postcss/lib/tokenize") as (
  input: InstanceType<typeof postcss.Input>,
) => { endOfFile(): boolean; nextToken(): [string, string] | undefined };

function valueWords(value: string): string[] {
  const scanner = tokenize(new postcss.Input(value));
  const words: string[] = [];
  while (!scanner.endOfFile()) {
    const token = scanner.nextToken();
    if (token?.[0] === "word") words.push(token[1]);
    if (token?.[0] === "brackets") words.push(...valueWords(token[1].slice(1, -1)));
  }
  return words;
}

const globals = read("app/globals.css");
const primitiveCss = PRIMITIVE_STYLESHEETS.map(read).join("\n");
const launch: readonly string[] = LAUNCH_TOKENS;

// CSS declaration policy, from docs/DESIGN_SYSTEM.md "Launch tokens".
describe("launch token policy", () => {
  it("declares the complete launch vocabulary as CSS custom properties", () => {
    const declared = new Set<string>();
    postcss.parse(globals).walkDecls((declaration) => {
      if (declaration.prop.startsWith("--")) declared.add(declaration.prop);
    });
    expect(launch.filter((token) => !declared.has(token))).toEqual([]);
  });

  for (const file of PRIMITIVE_STYLESHEETS) {
    it(`${file} uses launch dependencies without literal colours`, () => {
      const offences: string[] = [];
      postcss.parse(read(file)).walkDecls((declaration) => {
        for (const word of valueWords(declaration.value)) {
          if (word.startsWith("--") && !launch.includes(word)) offences.push(word);
          if (word.startsWith("#") || ["rgb", "rgba", "hsl", "hsla"].includes(word.toLowerCase())) {
            offences.push(word);
          }
        }
      });
      expect(offences).toEqual([]);
    });
  }
});

// Rendered contracts from docs/DESIGN_SYSTEM.md: Caps policy, control radius,
// and the Screen primary versus the quiet EmptyState and secondary actions.
describe("rendered launch primitives", () => {
  afterEach(() => {
    document.head.replaceChildren();
    document.body.replaceChildren();
    document.documentElement.removeAttribute("data-theme");
  });

  for (const theme of ["light", "dark"]) {
    for (const actionTag of ["a", "button"] as const) {
      it(`${theme} ${actionTag}: preserves sentence case and the primary hierarchy`, () => {
        document.documentElement.dataset.theme = theme;
        const style = document.createElement("style");
        style.textContent = [globals, read("app/theme.css"), primitiveCss].join("\n");
        document.head.append(style);
        document.body.innerHTML = renderToStaticMarkup(createElement(Screen, {
          kicker: "Tonight in London",
          title: "Choose your night",
          primary: createElement(actionTag, { href: "/plan" }, "Plan a night"),
          secondary: createElement(actionTag, { href: "/map" }, "Open the map"),
        },
        <Kicker as="span">Nearby pubs</Kicker>,
        createElement(TrustPill, { decision: priceStandingFor({}, Date.UTC(2026, 10, 23)) }),
        createElement(EmptyState, {
          title: "Your list starts here",
          action: createElement(actionTag, { href: "/pubs" }, "Find a pub"),
        }, "Save a pub to start your list")));

        const computed = (selector: string) => {
          const element = document.querySelector(selector);
          expect(element, selector).not.toBeNull();
          return getComputedStyle(element!);
        };
        const probe = document.createElement("span");
        probe.style.cssText = "background:var(--accent-action);color:var(--color-on-accent);border-radius:var(--control-radius)";
        document.body.append(probe);
        const expectedPrimary = getComputedStyle(probe);
        const primary = computed(`.screenPrimary > ${actionTag}`);
        expect(primary.backgroundColor).toBe(expectedPrimary.backgroundColor);
        expect(primary.color).toBe(expectedPrimary.color);
        expect(primary.borderTopLeftRadius).toBe(expectedPrimary.borderTopLeftRadius);
        expect(primary.fontWeight).toBe("700");
        expect(primary.minHeight).toBe("52px");

        const emptyAction = computed(`.emptyStateAction > ${actionTag}`);
        expect(emptyAction.borderTopLeftRadius).toBe(expectedPrimary.borderTopLeftRadius);
        expect(emptyAction.backgroundColor).not.toBe(primary.backgroundColor);
        expect(computed(`.screenSecondary > ${actionTag}`).backgroundColor).toBe("rgba(0, 0, 0, 0)");
        for (const element of document.querySelectorAll(".screen, .screen *")) {
          expect(getComputedStyle(element).textTransform, element.className).not.toBe("uppercase");
        }
      });
    }
  }
});
