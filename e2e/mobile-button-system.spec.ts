import { expect, test, type Page } from "@playwright/test";

import { LANDING_FALLBACK_RECEIPT_LABEL, LANDING_QUIET_DOORS } from "@/lib/landingHero";

import { LANDING_PRIMARY_NAME } from "./helpers/landingHero";

const DEVICES = [
  { width: 390, height: 844 },
  { width: 430, height: 932 },
] as const;

const THEMES = ["light", "dark"] as const;

async function setTheme(page: Page, theme: (typeof THEMES)[number]): Promise<void> {
  await page.addInitScript((value) => {
    window.localStorage.setItem("pubmax-theme", value);
    window.localStorage.setItem("pubmax-tour-v1-done", "1");
    window.localStorage.setItem("pubmaxx.pub-pal-route-activation.v1", JSON.stringify({
      version: 1,
      activatedAt: new Date().toISOString(),
    }));
    window.sessionStorage.setItem("pubmax_onboarding_dismissed", "1");
  }, theme);
}

for (const viewport of DEVICES) {
  for (const theme of THEMES) {
    test(`${viewport.width}px ${theme}: landing and Pub Pal controls stay uniform and clear`, async ({ page }) => {
      await page.setViewportSize(viewport);
      await page.emulateMedia({ reducedMotion: "reduce" });
      await setTheme(page, theme);
      await page.goto("/");

      // ONE painted primary plus the quiet row. The row is the receipt door,
      // which components/landing/LandingHero.tsx always renders first (the
      // anchor pub's "Still £6.50?" or the fallback), then the table in
      // lib/landingHero.ts rather than a number typed here: the row carried two
      // doors from #1488 while this spec still counted for one (#1503), and it
      // counted the table alone after the receipt door left the table (#1628).
      const heroActions = page.locator(".lpHero .screenActions a");
      await expect(heroActions).toHaveCount(2 + LANDING_QUIET_DOORS.length);
      await expect(page.getByRole("link", { name: LANDING_PRIMARY_NAME }).first()).toBeVisible();
      const quietDoors = page.locator(".lpHero .screenSecondary > a");
      await expect(quietDoors).toHaveCount(1 + LANDING_QUIET_DOORS.length);
      // The receipt door names the anchor pub's figure, or is the plain price
      // door when no card backs one (components/landing/LandingHero.tsx).
      await expect(quietDoors.first()).toHaveText(
        new RegExp(`^(Still £\\d+\\.\\d{2}\\?|${LANDING_FALLBACK_RECEIPT_LABEL})$`),
      );
      for (const [index, door] of LANDING_QUIET_DOORS.entries()) {
        await expect(quietDoors.nth(index + 1)).toHaveAttribute("href", door.href);
        await expect(quietDoors.nth(index + 1)).toHaveText(door.label);
      }

      const actionGeometry = await heroActions.evaluateAll((elements) =>
        elements.map((element) => {
          const box = element.getBoundingClientRect();
          return { width: box.width, height: box.height };
        }),
      );
      expect(actionGeometry.every(({ width, height }) => width >= 44 && height >= 44)).toBe(true);

      const wordmark = page.getByRole("banner").locator(".lpWordmark .pubmaxxWordmark");
      await expect(wordmark).toBeVisible();
      await expect(wordmark.locator(".pubmaxxWordmarkAccent")).toHaveCount(1);

      await page.goto("/pal");
      // The meeting screen is painted on the SERVER, so its one primary action
      // is tappable in the document before React attaches, and a tap that lands
      // first is dropped with nothing on screen saying so. A lone click is
      // therefore not a wait for hydration: retry the tap itself until the
      // first onboarding step opens (same idiom as e2e/plan-invite.spec.ts).
      const meetPal = page.getByRole("button", { name: /Meet your Pub Pal/i });
      const eligibility = page.getByRole("heading", { name: "The grown-up bit first." });
      await expect(async () => {
        await meetPal.click();
        await expect(eligibility).toBeVisible({ timeout: 1_000 });
      }).toPass({ timeout: 20_000 });

      const palGeometry = await page.evaluate(() => {
        const actions = document.querySelector(".palOnboardingActions")?.getBoundingClientRect();
        const pal = document.querySelector(".palExperience");
        const styles = pal ? getComputedStyle(pal) : null;
        const root = getComputedStyle(document.documentElement);
        return {
          actionsRight: actions?.right ?? Number.POSITIVE_INFINITY,
          overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
          accent: styles?.getPropertyValue("--pal-accent").trim(),
          brandAccent: root.getPropertyValue("--brass").trim(),
        };
      });

      await expect(page.locator(".mobileTabBar").filter({ visible: true })).toBeHidden();
      expect(palGeometry.actionsRight).toBeLessThanOrEqual(viewport.width);
      expect(palGeometry.overflow).toBeLessThanOrEqual(1);
      expect(palGeometry.accent).toBe(palGeometry.brandAccent);

      const continueButton = page.getByRole("button", { name: /Continue/i });
      const continueBox = await continueButton.boundingBox();
      expect(continueBox?.height).toBeGreaterThanOrEqual(44);
      expect(continueBox?.width).toBeGreaterThanOrEqual(44);
    });
  }
}

// The compose action floats over the right edge of every scrolling phone
// surface, and the surfaces below print a price or a way-onward arrow in that
// cell. Each takes the control's own published lane (createFab.css); this is
// the rendered proof that nothing in the lane is painted over.
const COMPOSE_LANE_SURFACES = [
  { route: "/", row: ".lpRailLink" },
  // Tonight's soft-plans rows are time-gated; e2e/tonight.spec.ts owns that surface on the quiet night.
  { route: "/today", row: ".todayCardFootRow" },
] as const;

for (const surface of COMPOSE_LANE_SURFACES) {
  test(`390px: ${surface.route} keeps its right cell clear of the compose action`, async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.emulateMedia({ reducedMotion: "reduce" });
    await setTheme(page, "light");
    await page.goto(surface.route);

    const fab = page.locator(".createFab");
    await expect(fab).toBeVisible();
    const fabBox = await fab.boundingBox();
    expect(fabBox).not.toBeNull();

    const rows = page.locator(surface.row);
    await expect(rows.first()).toBeVisible();
    // The last painted child of each row is what the control lands on: the
    // price badge, the arrow, the provenance line.
    const rightEdges = await rows.evaluateAll((elements) =>
      elements.flatMap((element) => {
        const children = Array.from(element.children).filter((child) => {
          const box = child.getBoundingClientRect();
          return box.width > 0 && box.height > 0;
        });
        return children.map((child) => {
          const box = child.getBoundingClientRect();
          return { right: box.right, top: box.top, bottom: box.bottom };
        });
      }),
    );
    expect(rightEdges.length).toBeGreaterThan(0);
    for (const cell of rightEdges) {
      const overlapsVertically =
        cell.bottom > fabBox!.y && cell.top < fabBox!.y + fabBox!.height;
      if (!overlapsVertically) continue;
      expect(cell.right).toBeLessThanOrEqual(fabBox!.x);
    }
  });
}

// Two rules the button system states and nothing measured: a control a thumb
// uses is at least 44px tall, and the icon inside a circular control sits at
// its centre. Both are read off the rendered page rather than off a stylesheet,
// because padding, line-height and an icon's own box all decide them.
const BUTTON_SYSTEM_ROUTES = ["/", "/tonight", "/today", "/near?patch=soho", "/places", "/plan", "/social"] as const;

for (const route of BUTTON_SYSTEM_ROUTES) {
  test(`390px: ${route} buttons keep the thumb floor and centre their icons`, async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.emulateMedia({ reducedMotion: "reduce" });
    await setTheme(page, "light");
    await page.goto(route);
    await expect(page.locator("main, .appShell").first()).toBeVisible();

    const findings = await page.evaluate(() => {
      const describe = (element: Element) => {
        const classes =
          typeof element.className === "string" && element.className
            ? `.${element.className.trim().split(/\s+/).slice(0, 2).join(".")}`
            : "";
        return `${element.tagName.toLowerCase()}${classes}`;
      };
      const painted = (element: Element) => {
        const box = element.getBoundingClientRect();
        if (box.width === 0 || box.height === 0) return false;
        const styles = getComputedStyle(element);
        return (
          styles.visibility !== "hidden" &&
          styles.display !== "none" &&
          Number(styles.opacity) > 0.05 &&
          styles.pointerEvents !== "none"
        );
      };
      const short: string[] = [];
      const offCentre: string[] = [];
      const controls = Array.from(
        document.querySelectorAll('button, [role="button"]'),
      );
      for (const control of controls) {
        if (!painted(control)) continue;
        if ((control as HTMLButtonElement).disabled) continue;
        const box = control.getBoundingClientRect();
        const styles = getComputedStyle(control);
        // A control painted as a control: it carries a fill or an edge. A bare
        // text button inside a sentence keeps the inline exception.
        const paintedAsControl =
          styles.backgroundColor !== "rgba(0, 0, 0, 0)" ||
          parseFloat(styles.borderTopWidth) > 0;
        if (paintedAsControl && box.height < 44) {
          short.push(`${describe(control)} ${Math.round(box.width)}x${Math.round(box.height)}`);
        }
        const radius = parseFloat(styles.borderTopLeftRadius) || 0;
        const circular =
          Math.abs(box.width - box.height) <= 2 &&
          (styles.borderTopLeftRadius.includes("%")
            ? radius >= 40
            : radius >= box.width * 0.4);
        if (!circular) continue;
        const children = Array.from(control.children).filter(painted);
        if (children.length !== 1) continue;
        const inner = children[0].getBoundingClientRect();
        const dx = inner.left + inner.width / 2 - (box.left + box.width / 2);
        const dy = inner.top + inner.height / 2 - (box.top + box.height / 2);
        if (Math.abs(dx) > 1 || Math.abs(dy) > 1) {
          offCentre.push(`${describe(control)} dx=${dx.toFixed(1)} dy=${dy.toFixed(1)}`);
        }
      }
      return { short, offCentre };
    });

    expect(findings.short).toEqual([]);
    expect(findings.offCentre).toEqual([]);
  });
}

// ── The 5 September sweep: four things read off the page, never off a
// stylesheet. Each figure below was the defect's own measurement.

// (1) The tablet bar. At 641px the row asked for 742px inside 573px and the
// action cluster sat on top of Out, Social and You; at 768px it covered You.
// A destination is pressable when the point at its own centre belongs to it.
for (const width of [641, 700, 768, 900] as const) {
  test(`${width}px: every top-bar destination is pressable and the bar fits`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.emulateMedia({ reducedMotion: "reduce" });
    await setTheme(page, "light");
    await page.goto("/tonight");
    await expect(page.locator(".siteNavLinks .siteNavLink").first()).toBeVisible();

    const findings = await page.evaluate(() => {
      const covered: string[] = [];
      for (const link of Array.from(document.querySelectorAll(".siteNavLinks .siteNavLink"))) {
        const box = link.getBoundingClientRect();
        const hit = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
        if (!hit || !link.contains(hit)) covered.push(link.textContent?.trim() ?? "?");
      }
      const more = document.querySelector(".siteNavMoreBtn")?.getBoundingClientRect();
      return {
        covered,
        more: more ? { width: more.width, height: more.height } : null,
        overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      };
    });

    expect(findings.covered).toEqual([]);
    expect(findings.more?.width ?? 0).toBeGreaterThanOrEqual(44);
    expect(findings.more?.height ?? 0).toBeGreaterThanOrEqual(44);
    expect(findings.overflow).toBeLessThanOrEqual(0);
  });
}

// (2) The Day | Tonight segment used to sit ON the bar: 0px between the two at
// 768px and 1440px, 4px at 390px.
for (const route of ["/tonight", "/today"] as const) {
  for (const width of [390, 768, 1440] as const) {
    test(`${width}px: ${route} keeps the Now segment off the top bar`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.emulateMedia({ reducedMotion: "reduce" });
      await setTheme(page, "light");
      await page.goto(route);
      const segment = page.locator(".nowSegment");
      await expect(segment).toBeVisible();
      const gap = await page.evaluate(() => {
        const bar = document.querySelector(".siteNavBar")!.getBoundingClientRect();
        const seg = document.querySelector(".nowSegment")!.getBoundingClientRect();
        return seg.top - bar.bottom;
      });
      expect(gap).toBeGreaterThanOrEqual(12);
    });
  }
}

// (3) The docked venue drawer at desktop width. The venue name sat flush on
// the drawer's left edge (801px in an 800px drawer) while the address below
// it started at 819px. Kicker, name and body now share one left edge, and
// that edge is inset from the drawer.
test("1440px: the docked venue drawer aligns its name with its body", async ({ page }) => {
  // The map loads its shards before the drawer fills; the default budget
  // was spent on that load alone under parallel workers.
  test.setTimeout(90_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await setTheme(page, "light");
  await page.goto("/map?sel=venue-nyowgc");
  // The drawer fills from the venue read, which is load-bound: measured at
  // 3 seconds on a quiet box and past 20 under a fleet build. A wait for the
  // read, never a geometry ceiling.
  const name = page.locator(".mapDrawer.right .venueInspector > h3");
  await expect(name).toBeVisible({ timeout: 45_000 });
  const address = page.locator(".mapDrawer.right .venueAddress");
  await expect(address).toBeVisible({ timeout: 45_000 });
  const geometry = await page.evaluate(() => {
    const drawer = document.querySelector(".mapDrawer.right")!.getBoundingClientRect();
    const h3 = document.querySelector(".mapDrawer.right .venueInspector > h3")!.getBoundingClientRect();
    const kicker = document.querySelector(".mapDrawer.right .venueInspector > .inspectorTitle")!.getBoundingClientRect();
    const addr = document.querySelector(".mapDrawer.right .venueAddress")!.getBoundingClientRect();
    return { inset: h3.left - drawer.left, kickerDelta: kicker.left - h3.left, bodyDelta: addr.left - h3.left };
  });
  expect(geometry.inset).toBeGreaterThanOrEqual(16);
  expect(Math.abs(geometry.kickerDelta)).toBeLessThanOrEqual(1);
  expect(Math.abs(geometry.bodyDelta)).toBeLessThanOrEqual(1);
});

// (4) One text-button family. These controls wore five radii and four type
// sizes across the routes; every one now reads the control tokens in
// app/globals.css, and this is the rendered proof: the same radius as the
// token, the thumb floor, and one weight.
const UNIFIED_CONTROLS = [
  { route: "/tonight", selector: ".tonightShare, .tonightRetry, .tonightLocationButton" },
  { route: "/near?patch=soho", selector: ".nmnAccept" },
  { route: "/u/you", selector: ".youIdentityActions a" },
  { route: "/map?sel=venue-nyowgc", selector: ".venueSheetStickyBar button, .venueActionStrip__btn" },
] as const;

for (const surface of UNIFIED_CONTROLS) {
  test(`390px: ${surface.route} text buttons share the control tokens`, async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.emulateMedia({ reducedMotion: "reduce" });
    await setTheme(page, "light");
    await page.goto(surface.route);
    const controls = page.locator(surface.selector);
    // The venue sheet's controls arrive with the venue read (see the docked
    // drawer case above for the measured wait).
    await expect(controls.first()).toBeVisible({ timeout: 45_000 });
    const findings = await controls.evaluateAll((elements) => {
      const token = getComputedStyle(document.documentElement).getPropertyValue("--control-radius").trim();
      return elements
        .filter((element) => element.getBoundingClientRect().height > 0)
        .map((element) => {
          const styles = getComputedStyle(element);
          const box = element.getBoundingClientRect();
          return {
            text: element.textContent?.trim().slice(0, 24) ?? "",
            radiusMatchesToken: styles.borderTopLeftRadius === token,
            height: box.height,
            weight: Number(styles.fontWeight),
          };
        });
    });
    expect(findings.length).toBeGreaterThan(0);
    for (const control of findings) {
      expect(control.radiusMatchesToken, `${control.text} radius`).toBe(true);
      expect(control.height, `${control.text} height`).toBeGreaterThanOrEqual(44);
      expect(control.weight, `${control.text} weight`).toBeGreaterThanOrEqual(700);
    }
  });
}

// (5) The signed-out identity card on a phone stacks: the heading takes the
// card's width instead of a 230px column beside the face.
test("390px: /u/you stacks the identity card", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await setTheme(page, "light");
  await page.goto("/u/you");
  const heading = page.locator(".youIdentityIntro h1");
  await expect(heading).toBeVisible();
  const geometry = await page.evaluate(() => {
    const avatar = document.querySelector(".youIdentityAvatar")!.getBoundingClientRect();
    const h1 = document.querySelector(".youIdentityIntro h1")!.getBoundingClientRect();
    const card = document.querySelector(".youIdentityIntro")!.getBoundingClientRect();
    return { sameEdge: Math.abs(avatar.left - h1.left), share: h1.width / card.width };
  });
  expect(geometry.sameEdge).toBeLessThanOrEqual(1);
  expect(geometry.share).toBeGreaterThanOrEqual(0.8);
});

// (6) The tablet map. The MapLibre zoom pair sat under Show all and Reset
// view (stack 229-323, pair 248-336 at 768px), and the closure banner was
// squeezed into a 160px lane beside the location prompt. Both are read
// off the page: the zoom buttons own their own centre points, and the
// banner's copy has a sentence's width.
test("768px: the map zoom pair is pressable and the status banner keeps its width", async ({ page }) => {
  test.setTimeout(90_000);
  await page.setViewportSize({ width: 768, height: 1024 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await setTheme(page, "light");
  // The closure banner waits while the first-visit ask or the city nudge is
  // up (components/map/mapBannerStaging.css). Those stay mounted as
  // display:none, so a width read on the hidden node is 0. This case is the
  // painted lane, which is the banner after those asks are answered.
  await page.addInitScript(() => {
    window.localStorage.setItem("pubmax:map-first-visit-arrival:v1", "dismissed");
    window.sessionStorage.setItem("pubmax:citySuggestDismiss:v1", "1");
  });
  await page.goto("/map");
  const zoomIn = page.locator(".maplibregl-ctrl-zoom-in");
  // "Show all" left the map edge for the Layers popover (7 Sep 2026, B9), so
  // the zoom pair is the readiness signal here and nothing else is waited on.
  await expect(zoomIn).toBeVisible({ timeout: 30_000 });
  // Since #1631 Show all lives in the Layers popover, not beside the zoom
  // pair. It is found where a reader opens it, and the popover is shut again
  // before the zoom pair's centre points are read. The tap is retried until
  // the control says it is open, because a tap before hydration is dropped.
  const layers = page.locator(".mapLayersFab");
  await expect(async () => {
    if ((await layers.getAttribute("aria-expanded")) !== "true") await layers.click();
    await expect(layers).toHaveAttribute("aria-expanded", "true", { timeout: 1_000 });
  }).toPass({ timeout: 20_000 });
  await expect(page.locator(".mapLayersPanel .mapFitLondonBtn")).toBeVisible();
  await page.locator(".mapLayersClose").click();
  await expect(page.locator(".mapLayersPanel")).toHaveCount(0);
  const findings = await page.evaluate(() => {
    const owns = (selector: string) => {
      const element = document.querySelector(selector);
      if (!element) return false;
      const box = element.getBoundingClientRect();
      const hit = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
      return Boolean(hit && element.contains(hit));
    };
    const banner = document.querySelector(".cityStatusBanner");
    if (!banner) return { zoomIn: owns(".maplibregl-ctrl-zoom-in"), zoomOut: owns(".maplibregl-ctrl-zoom-out"), banner: null };
    // The banner's text is a live TfL headline, so its rendered width is the
    // headline's: "District line closure" is 216px by content where the Rye
    // Lane closure was a 400px sentence. What the sweep fixed was the LANE,
    // a 160px left column the banner was squeezed into beside the location
    // prompt. So the measurement is the berth, not the width: the banner is
    // centred on the map, and its headline is not broken across more than two
    // lines, which is what a squeezed lane did to "dangerous".
    const box = banner.getBoundingClientRect();
    const headline = banner.querySelector("button");
    const lineHeight = headline ? parseFloat(getComputedStyle(headline).lineHeight) : 0;
    const headlineBox = headline?.getBoundingClientRect();
    return {
      zoomIn: owns(".maplibregl-ctrl-zoom-in"),
      zoomOut: owns(".maplibregl-ctrl-zoom-out"),
      banner: {
        width: box.width,
        centreOffset: Math.abs(box.left + box.width / 2 - window.innerWidth / 2),
        headlineLines:
          headlineBox && lineHeight > 0 ? Math.round(headlineBox.height / lineHeight) : 1,
      },
    };
  });
  expect(findings.zoomIn).toBe(true);
  expect(findings.zoomOut).toBe(true);
  if (findings.banner) {
    expect(findings.banner.width).toBeGreaterThan(160);
    expect(findings.banner.centreOffset).toBeLessThanOrEqual(2);
    expect(findings.banner.headlineLines).toBeLessThanOrEqual(2);
  }
});

// ── The 13 September sweep (site audit D7, D14, D15, D16). Each figure below
// is the defect's own measurement on production that day.

// (7) The controls that still painted a look of their own: "Pick an area
// instead" at r0 and stretched to 577px with its label 218px left of centre,
// the map's first-visit pair at r6 and 600, the toolbar's Filters and Drink
// at 11.52px, Plan an outing at 900, and the phone "Sign in" pill underlined
// at 600. A control in the family takes the token radius, the token type size
// and weight, the thumb floor, no underline, and a label at its own centre.
const FAMILY_SURFACES = [
  { route: "/today", width: 1440, selector: ".todayTextButton", firstVisitMap: false },
  { route: "/today", width: 390, selector: ".todayTextButton", firstVisitMap: false },
  { route: "/", width: 390, selector: ".authCompactTrigger", firstVisitMap: false },
  {
    route: "/map",
    width: 1440,
    selector: ".mapArrivalCardActions button, .mapVenueKindFilterBtn, .mapToolbarDrinkLaneBtn, .planBtn",
    firstVisitMap: true,
  },
  { route: "/map", width: 390, selector: ".mapArrivalCardActions button", firstVisitMap: true },
  // The narrowest phone: the pair wrapped to two and three lines in halves.
  { route: "/map", width: 320, selector: ".mapArrivalCardActions button", firstVisitMap: true },
] as const;

for (const surface of FAMILY_SURFACES) {
  test(`${surface.width}px: ${surface.route} ${surface.selector.split(",")[0]} is one of the button family`, async ({ page }) => {
    test.setTimeout(120_000);
    await page.setViewportSize({ width: surface.width, height: surface.width > 640 ? 900 : 844 });
    await page.emulateMedia({ reducedMotion: "reduce" });
    await setTheme(page, "light");
    if (surface.firstVisitMap) {
      await page.addInitScript(() => {
        window.localStorage.removeItem("pubmax:map-first-visit-arrival:v1");
      });
    }
    await page.goto(surface.route);
    const controls = page.locator(surface.selector);
    // The map's controls arrive with the map chunk (see the drawer case above).
    await expect(controls.first()).toBeVisible({ timeout: 90_000 });

    const findings = await controls.evaluateAll((elements) => {
      const probe = document.createElement("span");
      probe.style.cssText =
        "position:absolute;visibility:hidden;font-size:var(--control-font-size);font-weight:var(--control-font-weight);border-radius:var(--control-radius)";
      document.body.append(probe);
      const token = getComputedStyle(probe);
      const expected = {
        radius: token.borderTopLeftRadius,
        size: token.fontSize,
        weight: token.fontWeight,
      };
      probe.remove();
      return elements
        .filter((element) => {
          const box = element.getBoundingClientRect();
          const styles = getComputedStyle(element);
          return box.width > 0 && box.height > 0 && styles.visibility !== "hidden";
        })
        .map((element) => {
          const styles = getComputedStyle(element);
          const box = element.getBoundingClientRect();
          const range = document.createRange();
          range.selectNodeContents(element);
          const content = range.getBoundingClientRect();
          return {
            name: `${element.className} "${element.textContent?.trim().slice(0, 24) ?? ""}"`,
            radius: styles.borderTopLeftRadius,
            size: styles.fontSize,
            weight: styles.fontWeight,
            decoration: styles.textDecorationLine,
            height: box.height,
            labelOffset: Math.abs(content.left + content.width / 2 - (box.left + box.width / 2)),
            expected,
          };
        });
    });

    expect(findings.length).toBeGreaterThan(0);
    for (const control of findings) {
      expect(control.radius, `${control.name} radius`).toBe(control.expected.radius);
      expect(control.size, `${control.name} type size`).toBe(control.expected.size);
      expect(control.weight, `${control.name} weight`).toBe(control.expected.weight);
      expect(control.decoration, `${control.name} underline`).toBe("none");
      expect(control.height, `${control.name} height`).toBeGreaterThanOrEqual(44);
      expect(control.labelOffset, `${control.name} label centre`).toBeLessThanOrEqual(1);
    }
  });
}

// The toolbar's Plan control is desktop chrome: a phone plans from its own
// stack pill, so no phone width may paint a toolbar Plan outside the family
// measurement above, which runs at 1440.
for (const width of [320, 390] as const) {
  test(`${width}px: /map paints no toolbar Plan control`, async ({ page }) => {
    test.setTimeout(120_000);
    await page.setViewportSize({ width, height: 844 });
    await page.emulateMedia({ reducedMotion: "reduce" });
    await setTheme(page, "light");
    await page.goto("/map");
    await expect(page.locator(".mobilePlanActivation")).toBeVisible({ timeout: 90_000 });
    await expect(page.locator(".mapToolbar .planBtn")).toHaveCount(0);
  });
}

// "Pick an area instead" follows the manual prompt in the get-there column, so
// as a ghost it may not step its label 16px in from the prompt's text edge.
for (const width of [390, 1440] as const) {
  test(`${width}px: /today keeps the area action's label on the prompt's edge`, async ({ page }) => {
    await page.setViewportSize({ width, height: width > 640 ? 900 : 844 });
    await page.emulateMedia({ reducedMotion: "reduce" });
    await setTheme(page, "light");
    await page.goto("/today");
    const action = page.locator(".todayGetThere > .todayTextButton");
    await expect(action).toBeVisible();
    const delta = await page.evaluate(() => {
      const contentLeft = (element: Element) => {
        const range = document.createRange();
        range.selectNodeContents(element);
        return range.getBoundingClientRect().left;
      };
      const prompt = document.querySelector(".todayGetThere > .todayManualPrompt")!;
      const button = document.querySelector(".todayGetThere > .todayTextButton")!;
      return contentLeft(button) - contentLeft(prompt);
    });
    expect(Math.abs(delta)).toBeLessThanOrEqual(1);
  });
}

// (8) /activity at 1440: the sign-in form sat 112px in from the heading it
// answers (heading x 180, form x 292), because the form's own column centres
// itself inside the empty state.
test("1440px: /activity starts its sign-in form on the heading's edge", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await setTheme(page, "light");
  await page.goto("/activity");
  const form = page.locator(".emptyState .authMagicLink");
  await expect(form).toBeVisible();
  const delta = await page.evaluate(() => {
    const title = document.querySelector(".emptyState .emptyStateTitle")!.getBoundingClientRect();
    const field = document.querySelector(".emptyState .authMagicLink")!.getBoundingClientRect();
    return field.left - title.left;
  });
  expect(Math.abs(delta)).toBeLessThanOrEqual(1);
});

// (9) /moment on a phone: the heading sat at x 12 where every other route
// starts at the page gutter (22px at 390).
for (const width of [320, 390] as const) {
  test(`${width}px: /moment takes the shared page gutter`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    await page.emulateMedia({ reducedMotion: "reduce" });
    await setTheme(page, "light");
    await page.goto("/moment");
    const heading = page.locator(".momentPage h1");
    await expect(heading).toBeVisible();
    const geometry = await page.evaluate(() => {
      const probe = document.createElement("div");
      probe.style.cssText = "position:absolute;visibility:hidden;width:var(--page-gutter)";
      document.body.append(probe);
      const gutter = probe.getBoundingClientRect().width;
      probe.remove();
      const h1 = document.querySelector(".momentPage h1")!.getBoundingClientRect();
      return { gutter, left: h1.left, right: window.innerWidth - h1.right };
    });
    expect(Math.abs(geometry.left - geometry.gutter)).toBeLessThanOrEqual(1);
    expect(geometry.right).toBeGreaterThanOrEqual(geometry.gutter - 1);
  });
}

// (10) The compose action's lane, for the cells a scroll carries under it:
// the "Cheapest pint" column on a borough table (head text 272 to 357). The
// cell is scrolled to the control's own band, and its content box must end
// before the control starts. The profile page hides the control, so it has no
// lane (e2e/account-password.spec.ts).
const COMPOSE_LANE_CELLS = [
  { route: "/borough/southwark", cells: ".boroughPriceHead, .boroughPriceCell" },
] as const;

for (const surface of COMPOSE_LANE_CELLS) {
  for (const width of [320, 390] as const) {
    test(`${width}px: ${surface.route} keeps ${surface.cells.split(",")[0]} out of the compose lane`, async ({ page }) => {
      await page.setViewportSize({ width, height: 844 });
      await page.emulateMedia({ reducedMotion: "reduce" });
      await setTheme(page, "light");
      await page.goto(surface.route);
      await expect(page.locator(".createFab")).toBeVisible();
      await expect(page.locator(surface.cells).first()).toBeVisible();
      const overlaps = await page.evaluate(async (selector) => {
        const fab = document.querySelector(".createFab")!.getBoundingClientRect();
        const first = document.querySelector(selector)!;
        window.scrollBy(0, first.getBoundingClientRect().top - fab.top);
        await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        const control = document.querySelector(".createFab")!.getBoundingClientRect();
        return Array.from(document.querySelectorAll(selector)).flatMap((cell) => {
          const box = cell.getBoundingClientRect();
          if (box.bottom <= control.top || box.top >= control.bottom) return [];
          const styles = getComputedStyle(cell);
          const contentRight = box.right - parseFloat(styles.paddingRight) - parseFloat(styles.borderRightWidth);
          return contentRight > control.left
            ? [`${cell.textContent?.trim().slice(0, 20)} ends at ${Math.round(contentRight)}, control at ${Math.round(control.left)}`]
            : [];
        });
      }, surface.cells);
      expect(overlaps).toEqual([]);
    });
  }
}
