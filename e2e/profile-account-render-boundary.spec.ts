import { expect, test, type Page, type Route } from "@playwright/test";
import { ACCOUNTS, accessJwt, installAuthDoubles, seedSignedIn, type Stub } from "./helpers/authDoubles";

const OWNER = "renderboundaryowner";
const MATE = "renderboundarymate";
const LIST = "Render boundary fixture";
const NOTE = "Owner-only fixture saved note";
const PUBLIC_HEADERS = { "cache-control": "no-store" };

type Surface = "people" | "saved";
type Transition = "switch" | "sign-out";
type DomSample = { kind: "mutation" | "animation-frame"; elapsedMs: number; sameSurface: boolean; exposed: string[] };
type Probe = { samples: DomSample[]; stop: () => void };

test.use({ viewport: { width: 1440, height: 900 }, serviceWorkers: "block", storageState: { cookies: [], origins: [] } });

function isOwner(route: Route): boolean {
  const bearer = route.request().headers().authorization;
  return bearer === "Bearer pubmaxx-e2e-access-token-A" || bearer === `Bearer ${accessJwt(ACCOUNTS.A)}`;
}

async function rememberAccounts(page: Page, stub: Stub, transition: Transition): Promise<void> {
  await seedSignedIn(page, "A");
  if (transition === "switch") {
    await stub.signedInAs("B");
    await page.goto("/today");
    await expect(page.getByRole("button", { name: `Account options for ${ACCOUNTS.B.name}`, exact: true }).first()).toBeVisible();
    await stub.signedInAs("A");
  }
}

async function observeBoundary(page: Page, surface: Surface, transition: Transition): Promise<void> {
  // Read DOM only. Neither observer changes auth, component state, scheduling,
  // nor response timing. RAF is a pre-paint observation, not a pixel verdict.
  await page.evaluate(({ surface, transition, mate, note, nextName }) => {
    const scopeSelector = surface === "people" ? ".peopleDir" : ".listDetailHero";
    const firstSurface = document.querySelector(scopeSelector);
    const started = performance.now();
    const samples: DomSample[] = [];
    const newViewerVisible = () => transition === "switch"
      ? Array.from(document.querySelectorAll(`button[aria-label="Account options for ${nextName}"]`)).some((node) => node.getClientRects().length > 0)
      : Array.from(document.querySelectorAll("button[aria-label='Sign in']")).some((node) => node.getClientRects().length > 0);
    const visibleText = (selector: string, needle: string) => Array.from(document.querySelectorAll(selector)).some((node) => {
      const style = getComputedStyle(node);
      return node.getClientRects().length > 0 && style.display !== "none" && style.visibility !== "hidden"
        && (node.textContent ?? "").includes(needle);
    });
    const sample = (kind: DomSample["kind"]) => {
      if (!newViewerVisible() || samples.length >= 240) return;
      const exposed: string[] = [];
      if (surface === "people") {
        if (visibleText(".peopleDir__identity", mate)) exposed.push("former-owner person");
        if (visibleText(".peopleDir__self", "Mates")) exposed.push("former-owner mutual");
      } else {
        if (visibleText(".savedItemNote", note)) exposed.push("former-owner saved note");
        if (visibleText(".listDetailMeta span", "2 venues")) exposed.push("former-owner saved count");
        if (visibleText(".listDetailMeta span", "7 followers")) exposed.push("former-owner follower count");
        const share = document.querySelector(".listDetailShare");
        if (share && share.getClientRects().length > 0 && (share.getAttribute("aria-label") ?? "").includes("2 venues")) exposed.push("former-owner share count");
      }
      samples.push({ kind, elapsedMs: performance.now() - started, sameSurface: document.querySelector(scopeSelector) === firstSurface, exposed });
    };
    const observer = new MutationObserver(() => sample("mutation"));
    observer.observe(document.body, { subtree: true, attributes: true, childList: true, characterData: true });
    let frame = 0;
    const onFrame = () => { sample("animation-frame"); frame = requestAnimationFrame(onFrame); };
    frame = requestAnimationFrame(onFrame);
    (window as unknown as { __profileBoundaryProbe: Probe }).__profileBoundaryProbe = {
      samples,
      stop: () => { observer.disconnect(); cancelAnimationFrame(frame); },
    };
  }, { surface, transition, mate: MATE, note: NOTE, nextName: ACCOUNTS.B.name });
}

for (const surface of ["people", "saved"] as const) {
  for (const transition of ["switch", "sign-out"] as const) {
    test(`${surface} hides former owner data after UI ${transition}`, async ({ page }, testInfo) => {
      const stub = await installAuthDoubles(page);
      // This fixture models a withdrawn handle: its owner can read the graph
      // and saved list, while any other bearer or stranger receives empty data.
      // It tests rendered UI isolation, not real GoTrue or database permissions.
      await page.route("**/api/identity/handle/current", (route) => {
        const bearer = route.request().headers().authorization;
        const isOther = bearer === "Bearer pubmaxx-e2e-access-token-B" || bearer === `Bearer ${accessJwt(ACCOUNTS.B)}`;
        return route.fulfill({
          status: 200, contentType: "application/json", headers: PUBLIC_HEADERS,
          body: JSON.stringify({ handle: isOwner(route) ? OWNER : isOther ? ACCOUNTS.B.handle : null }),
        });
      });
      let releaseReplacement!: () => void;
      const replacement = new Promise<void>((resolve) => { releaseReplacement = resolve; });
      const pendingReads: Promise<void>[] = [];
      let replacementReads = 0;
      const respond = (route: Route, ownerBody: unknown, otherBody: unknown) => {
        const read = (async () => {
          const owner = isOwner(route);
          if (!owner) { replacementReads += 1; await replacement; }
          await route.fulfill({ status: 200, contentType: "application/json", headers: PUBLIC_HEADERS, body: JSON.stringify(owner ? ownerBody : otherBody) });
        })();
        pendingReads.push(read);
        return read;
      };
      await page.route(`**/api/profiles/${OWNER}/followers`, (route) => respond(route,
        { followers: [{ handle: MATE, displayName: "Owner-only fixture person" }] }, { followers: [] }));
      await page.route(`**/api/profiles/${OWNER}/lot`, (route) => respond(route, { lot: [MATE] }, { lot: [] }));
      await page.route((url) => url.pathname === "/api/saved-pubs" && url.searchParams.get("handle") === OWNER, (route) => respond(route, {
        saved: [
          { venueId: "venue-149rmv7", venueName: "Duke of York", venueMapUrl: "/map?sel=venue-149rmv7", listType: LIST, note: NOTE, savedAt: "2026-09-20T12:00:00Z" },
          { venueId: "venue-1vle947", venueName: "The Sir Christopher Hatton", venueMapUrl: "/map?sel=venue-1vle947", listType: LIST, savedAt: "2026-09-20T12:01:00Z" },
        ],
      }, { saved: [] }));
      await page.route((url) => url.pathname === "/api/saved-pubs/list-follows" && url.searchParams.get("owner") === OWNER, (route) => respond(route,
        { following: false, counts: { followers: 7, savedPubs: 2 } },
        { following: false, counts: { followers: 0, savedPubs: 0 } }));

      let probeStarted = false;
      try {
        await rememberAccounts(page, stub, transition);
        const path = surface === "people" ? `/u/${OWNER}/people/followers` : `/u/${OWNER}/lists/${encodeURIComponent(LIST)}`;
        const response = await page.goto(path);
        expect(response?.status()).toBe(200);
        const scope = page.locator(surface === "people" ? ".peopleDir" : ".listDetailHero");
        if (surface === "people") {
          await expect(page.locator(".peopleDir__identity")).toContainText(MATE);
          await expect(page.locator(".peopleDir__self")).toHaveText("Mates");
        } else {
          await expect(page.locator(".savedItemNote")).toHaveText(NOTE);
          await expect(page.getByLabel("List counts")).toContainText("2 venues");
          await expect(page.getByLabel("List counts")).toContainText("7 followers");
        }
        await expect(scope).toBeVisible();
        await expect(async () => {
          const menu = page.locator(".authAccountMenu");
          if (!(await menu.isVisible())) await page.getByRole("button", { name: `Account options for ${ACCOUNTS.A.name}`, exact: true }).first().click();
          await expect(menu).toBeVisible({ timeout: 1_000 });
        }).toPass({ timeout: 20_000 });
        if (transition === "switch") {
          await page.getByRole("button", { name: "Switch account", exact: true }).click();
          await expect(page.locator(".authSwitcherRow")).toHaveCount(1);
          await expect(page.locator(".authSwitcherRow")).toContainText(`@${ACCOUNTS.B.handle}`);
        } else {
          await stub.signedInAs(null);
        }
        await observeBoundary(page, surface, transition);
        probeStarted = true;
        if (transition === "switch") {
          await page.locator(".authSwitcherRow").click();
          await expect(page.getByRole("button", { name: `Account options for ${ACCOUNTS.B.name}`, exact: true }).first()).toBeVisible();
          await expect.poll(() => replacementReads).toBeGreaterThan(0);
        } else {
          await page.locator(".authAccountMenu").getByRole("button", { name: "Sign out", exact: true }).click();
          await expect(page.getByRole("button", { name: "Sign in", exact: true }).first()).toBeVisible();
        }
        await expect.poll(() => page.evaluate(() => (window as unknown as { __profileBoundaryProbe: Probe }).__profileBoundaryProbe.samples.filter((sample) => sample.kind === "animation-frame").length)).toBeGreaterThanOrEqual(8);
        const samples = await page.evaluate(() => (window as unknown as { __profileBoundaryProbe: Probe }).__profileBoundaryProbe.samples);
        await testInfo.attach("account-boundary-held-response", { body: await page.screenshot(), contentType: "image/png" });
        expect(samples.every((sample) => sample.sameSurface)).toBe(true);
        // Mutation overlaps are recorded separately. They cannot prove a
        // visible paint. This assertion concerns natural pre-paint RAF samples.
        expect(samples.filter((sample) => sample.kind === "animation-frame" && sample.exposed.length > 0)).toEqual([]);
        if (surface === "people") {
          await expect(page.locator(".peopleDir__identity")).toHaveCount(0);
          await expect(page.locator(".peopleDir__self")).toHaveCount(0);
        } else {
          await expect(page.locator(".savedItemNote")).toHaveCount(0);
          await expect(page.getByLabel("List counts")).not.toContainText("2 venues");
          await expect(page.getByLabel("List counts")).not.toContainText("7 followers");
        }
        releaseReplacement();
        await Promise.all(pendingReads);
      } finally {
        if (probeStarted) {
          const samples = await page.evaluate(() => {
            const probe = (window as unknown as { __profileBoundaryProbe: Probe }).__profileBoundaryProbe;
            probe.stop();
            return probe.samples;
          });
          await testInfo.attach("account-boundary-dom-observations", {
            body: JSON.stringify({ surface, transition, replacementReads, fixture: "Auth and withdrawn-owner transport doubles", proofLimit: "DOM mutations and natural pre-paint RAF samples are not proof of visible pixel paint", samples }, null, 2),
            contentType: "application/json",
          });
        }
        releaseReplacement();
        const results = await Promise.allSettled(pendingReads);
        expect(results.filter((result) => result.status === "rejected")).toEqual([]);
      }
    });
  }
}
