// @vitest-environment jsdom

// THE SAMPLE SKELETON (components/ui/sample-skeleton.tsx): a loading state
// drawn from the real card with sample values, painted out by CSS alone.
//
// What is pinned here, because a browser that does not throttle never shows it:
//   1. The sample is inert and aria-hidden, inside a region that is busy.
//   2. The screen-reader line sits BESIDE the busy region, outside every hidden
//      subtree, and arrives after mount (the sign-in skeleton's two findings,
//      __tests__/loginSkeletonAnnouncement.test.ts).
//   3. A card asks useIsSample() and gets true only inside a sample.
//   4. The stylesheet: a 600 ms grace, the same figure the listings wait uses;
//      the one breath only under prefers-reduced-motion: no-preference, so a
//      reader who asked for less motion gets still shapes; tokens and no raw
//      colour; text painted out and pictures and controls made blocks.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import postcss, { type AtRule, type Declaration, type Rule } from "postcss";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import SampleSkeleton from "@/components/ui/sample-skeleton";
import { useIsSample } from "@/components/ui/sample-skeleton-context";

const ROOT = process.cwd();
const read = (file: string): string => readFileSync(join(ROOT, file), "utf8");

function Probe(): React.JSX.Element {
  return createElement("span", { className: "probe", "data-sampled": String(useIsSample()) }, "Probe");
}

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

function mount(): void {
  act(() => {
    root.render(
      <SampleSkeleton label="Loading the timeline" className="realList">
        <article className="realCard">
          <Probe />
        </article>
      </SampleSkeleton>,
    );
  });
}

describe("the sample", () => {
  it("sits in an inert, aria-hidden wrapper inside a busy region with the real container's class", () => {
    mount();
    const region = host.querySelector<HTMLElement>("[data-sample-skeleton]");
    expect(region?.getAttribute("aria-busy")).toBe("true");
    expect(region?.className).toBe("sampleSkeleton realList");

    const card = host.querySelector(".realCard");
    const sample = card?.parentElement;
    expect(sample?.className).toBe("sampleSkeletonSample");
    expect(sample?.hasAttribute("inert")).toBe(true);
    expect(sample?.getAttribute("aria-hidden")).toBe("true");
    expect(sample?.parentElement).toBe(region);
  });

  it("tells the card it is a sample, and nothing outside one", () => {
    mount();
    expect(host.querySelector(".probe")?.getAttribute("data-sampled")).toBe("true");

    act(() => root.render(createElement(Probe)));
    expect(host.querySelector(".probe")?.getAttribute("data-sampled")).toBe("false");
  });
});

describe("the screen-reader line", () => {
  it("is empty when the server draws it and arrives as a change after mount", () => {
    const html = renderToStaticMarkup(
      <SampleSkeleton label="Loading the timeline">
        <p>x</p>
      </SampleSkeleton>,
    );
    expect(html).toContain('<p class="sr-only" role="status"></p>');

    // A record whose TARGET is the line means the line was already in the
    // document when its words arrived; words born inside it are never spoken.
    const spoken: string[] = [];
    const observer = new MutationObserver(() => {});
    observer.observe(host, { subtree: true, childList: true, characterData: true });
    vi.useFakeTimers();
    mount();
    act(() => {
      vi.advanceTimersByTime(600);
    });
    vi.useRealTimers();
    for (const record of observer.takeRecords()) {
      const target = record.target instanceof HTMLElement ? record.target : record.target.parentElement;
      if (target?.getAttribute("role") === "status") spoken.push(target.textContent ?? "");
    }
    observer.disconnect();

    expect(spoken).toContain("Loading the timeline");
  });

  it("says nothing while a read answers inside the 600 ms grace", () => {
    vi.useFakeTimers();
    mount();
    act(() => {
      vi.advanceTimersByTime(599);
    });
    expect(host.querySelector('[role="status"]')?.textContent).toBe("");
    act(() => root.render(null));
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    vi.useRealTimers();
    expect(host.querySelector('[role="status"]')).toBeNull();
  });

  it("stands outside every busy or hidden ancestor, and the sample's words are never in it", () => {
    vi.useFakeTimers();
    mount();
    act(() => {
      vi.advanceTimersByTime(600);
    });
    vi.useRealTimers();
    const status = host.querySelector<HTMLElement>('[role="status"]');
    expect(status?.textContent).toBe("Loading the timeline");
    expect(status?.className).toBe("sr-only");
    for (let node = status?.parentElement ?? null; node && node !== document.body; node = node.parentElement) {
      expect(node.getAttribute("aria-busy")).not.toBe("true");
      expect(node.getAttribute("aria-hidden")).not.toBe("true");
    }
    expect(status?.textContent).not.toContain("Probe");
  });
});

// ── The stylesheet ──────────────────────────────────────────────────────────

type ParsedDeclaration = { selector: string; property: string; value: string; media: string[] };

function declarationsOf(file: string): ParsedDeclaration[] {
  const out: ParsedDeclaration[] = [];
  postcss.parse(read(file)).walkDecls((decl: Declaration) => {
    const media: string[] = [];
    for (let node = decl.parent; node && node.type !== "root"; node = node.parent) {
      if (node.type !== "atrule") continue;
      const atRule = node as AtRule;
      if (atRule.name === "keyframes") return;
      if (atRule.name === "media") media.push(atRule.params.replace(/\s+/g, " ").trim());
    }
    const rule = decl.parent as Rule;
    const value = decl.important ? `${decl.value} !important` : decl.value;
    out.push({ selector: rule.selector ?? "", property: decl.prop, value, media });
  });
  return out;
}

const SHEET = "components/ui/sampleSkeleton.css";
const declarations = declarationsOf(SHEET);
const NO_PREFERENCE = "(prefers-reduced-motion: no-preference)";

// The second time in an animation shorthand is its delay.
function delayOf(value: string): string | undefined {
  return value.split(",")[0]?.match(/\b\d+(?:\.\d+)?m?s\b/g)?.[1];
}

describe("the stylesheet", () => {
  it("holds the shapes back for the listings wait's own 600 ms grace", () => {
    const base = declarations.filter((d) => d.selector === ".sampleSkeleton" && d.media.length === 0);
    expect(base.find((d) => d.property === "opacity")?.value).toBe("0");
    const appear = base.find((d) => d.property === "animation")?.value ?? "";
    expect(delayOf(appear)).toBe("600ms");
    expect(appear).toContain("forwards");
    expect(appear).not.toContain("infinite");

    // One grace, two sheets: the figure is the one components/out/listingsSkeleton.css waits.
    const listings = declarationsOf("components/out/listingsSkeleton.css").find(
      (d) => d.selector === ".listingsSkeletonCard" && d.property === "animation",
    );
    expect(delayOf(listings?.value ?? "")).toBe("600ms");
  });

  it("only appears, and never moves, for a reader who asked for less motion", () => {
    // The grace only turns the shapes on; it changes opacity from 0 to 1 once.
    const keyframes: string[] = [];
    postcss.parse(read(SHEET)).walkAtRules("keyframes", (rule) => {
      keyframes.push(rule.params);
      rule.walkDecls((decl) => expect(decl.prop).toBe("opacity"));
    });
    expect(keyframes).toEqual(["sampleSkeletonAppear"]);

    const looping = declarations.filter((d) => /animation/.test(d.property) && /infinite/.test(d.value));
    expect(looping.length).toBeGreaterThan(0);
    for (const d of looping) expect(d.media, `${d.selector} ${d.value}`).toEqual([NO_PREFERENCE]);
  });

  it("breathes with the loading shell's own pulse rather than a motion of its own", () => {
    const breath = declarations.find((d) => d.media.includes(NO_PREFERENCE) && /infinite/.test(d.value));
    expect(breath?.value).toMatch(/\bpulse 1\.6s ease-in-out 600ms infinite\b/);
    expect(read("app/globals.css")).toMatch(/@keyframes pulse\s*{/);
    expect(read("app/globals.css")).toMatch(/animation:\s*pulse 1\.6s ease-in-out infinite;/);
  });

  it("paints from tokens alone, with no raw colour and no fallback", () => {
    const sheet = read(SHEET).replace(/\/\*[\s\S]*?\*\//g, "");
    expect(sheet).not.toMatch(/#[0-9a-f]{3,8}\b|\b(?:rgba?|hsla?|oklch|oklab)\(/i);
    expect(sheet).not.toMatch(/var\(--[\w-]+\s*,/);
    const tokens = new Set([...sheet.matchAll(/var\((--[\w-]+)\)/g)].map((m) => m[1]));
    expect([...tokens].sort()).toEqual(["--line", "--line-soft"]);
  });

  it("paints every word out and draws pictures, icons and controls as blocks", () => {
    const text = declarations.filter((d) => d.selector.includes(".sampleSkeletonSample *,"));
    const value = (property: string) => text.find((d) => d.property === property)?.value;
    expect(value("color")).toBe("transparent !important");
    expect(value("text-decoration-color")).toBe("var(--line) !important");

    const blocks = declarations.find(
      (d) => d.selector.includes(":is(img, svg") && d.property === "background-color",
    );
    expect(blocks?.selector).toMatch(/\bbutton\b/);
    expect(blocks?.selector).toContain("[data-sample-block]");
    expect(blocks?.value).toBe("var(--line-soft) !important");
  });
});
