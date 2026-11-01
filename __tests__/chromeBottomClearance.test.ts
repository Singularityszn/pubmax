// The foot of every scrolling page on a phone: one token, one reserve.
//
// DEFECT (taste pass, 18 Oct 2026, 390x844): the create disc and the tab bar
// stand over the bottom of every page, and the pages had answered that one at
// a time. The body reserved the bar and the disc, and then /tonight, /social,
// /u/<handle>, /feed, /discover, /pint-index, /places, /we-are-out and
// /add/<handle> each added the bar's height to their own bottom padding again.
// The last line was clear, but under it sat a second empty band, up to 200px
// deep, and every new page had to guess which of the two lanes it owed.
//
// The rule now: components/nav/mobileNav.css publishes
// --chrome-bottom-clearance beside --tabbar-h, the body pads its foot by that
// token and nothing else, and a page's own bottom padding is reading room.
// The create disc left with the five-tab dock (captain, 1 Nov 2026), so the
// bar's lane is the whole foot. The rendered proof (the last line ends above
// the bar when the page is scrolled to the very bottom) is
// e2e/mobile-v1-obstructions.spec.ts.

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

import { describe, expect, it } from "vitest";

const REPO_ROOT = join(__dirname, "..");
const read = (file: string) => readFileSync(join(REPO_ROOT, file), "utf8");
const mobileNavCss = read("components/nav/mobileNav.css");

/** The body of the first rule whose selector line is exactly `selector`. */
function ruleBody(css: string, selector: string): string {
  const start = css.indexOf(`${selector} {`);
  expect(start, `${selector} is declared`).toBeGreaterThan(-1);
  const open = css.indexOf("{", start);
  return css.slice(open + 1, css.indexOf("}", open));
}

function cssFilesUnder(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(join(REPO_ROOT, dir))) {
    const path = join(REPO_ROOT, dir, entry);
    if (statSync(path).isDirectory()) out.push(...cssFilesUnder(relative(REPO_ROOT, path)));
    else if (entry.endsWith(".css")) out.push(relative(REPO_ROOT, path));
  }
  return out;
}

describe("the chrome's bottom clearance is one token", () => {
  it("is declared beside the tab bar's own height, and is nothing off the phone", () => {
    const root = ruleBody(mobileNavCss, ":root");
    const height = root.indexOf("--tabbar-h: 64px;");
    const token = root.indexOf("--chrome-bottom-clearance: 0px;");
    expect(height).toBeGreaterThan(-1);
    expect(token).toBeGreaterThan(height);
  });

  it("is the bar's lane, the home indicator and one gap on a phone", () => {
    const rule = ruleBody(
      mobileNavCss,
      "  :root:has(.mobileTabBar, .mobileTabBarClearance):not(:has(.mapStage))",
    );
    expect(rule.replace(/\s+/g, " ")).toContain(
      "--chrome-bottom-clearance: calc( var(--tabbar-h) + env(safe-area-inset-bottom, 0px) + var(--float-stack-gap) );",
    );
  });

  it("reserves nothing for a floating create disc, which left with the five-tab dock", () => {
    // Captain, 1 Nov 2026 (launch plan decision 13): the + button is gone, so
    // the bar's lane is the whole foot and no rule lifts it to a disc's edge.
    expect(mobileNavCss).not.toMatch(/createFabRoot|--float-stack-top-create|--create-fab-/);
  });

  it("is the one thing the body pads its foot by, and the map shell keeps its own geometry", () => {
    const rule = ruleBody(
      mobileNavCss,
      "  body:has(.mobileTabBar, .mobileTabBarClearance):not(:has(.mapStage))",
    );
    expect(rule.trim()).toBe("padding-bottom: var(--chrome-bottom-clearance);");
    // No second body reserve restates the bar.
    expect(mobileNavCss).not.toMatch(
      /body:has\([^{]*\{\s*padding-bottom:\s*calc\(var\(--tabbar-h\)/,
    );
  });
});

describe("a page never reserves the bar a second time", () => {
  // Surfaces whose padding answers something other than the page's foot: the
  // map shell and the consent card (globals.css), the message crop overlay,
  // which is a fixed layer over the page (messages.css), and the Pub Pal
  // intro, which hides the bar and the disc and draws its own stage (pal.css).
  const OWN_GEOMETRY = new Set(["app/globals.css", "app/messages/messages.css", "app/pal/pal.css"]);

  it("keeps --tabbar-h and --mobile-tab-clearance out of every route's padding", () => {
    const offenders: string[] = [];
    for (const file of cssFilesUnder("app")) {
      if (OWN_GEOMETRY.has(file)) continue;
      const css = read(file);
      for (const match of css.matchAll(/(?:scroll-)?padding(?:-bottom|-block)?\s*:[^;]*;/g)) {
        if (/--tabbar-h|--mobile-tab-clearance/.test(match[0])) {
          offenders.push(`${file}: ${match[0].replace(/\s+/g, " ")}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it("lets the loading shell fill the screen down to the chrome, never under it", () => {
    const rule = ruleBody(mobileNavCss, ".routeLoadingShell");
    expect(rule).toContain("min-height: calc(100svh - var(--chrome-bottom-clearance));");
    expect(rule).not.toContain("var(--tabbar-h)");
  });
});
