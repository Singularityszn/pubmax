// THREE PLACES THAT PRINTED AN ABSENCE OVER A FAILURE.
//
// PlanAstra, section 2.4: `/plan/[id]` said "This plan has closed" when the
// store could not be reached, `/near` said "We haven't mapped pubs in {area}
// yet" when the priced shard read failed, and a 4.5 MB photo passed a 5 MB
// browser gate to be refused by the platform's own 413, which the composer
// could only word as "Could not save that drop."
//
// Each is the same mistake: a fact about US, printed as a fact about the
// reader's plan, their area, or their photo. This file holds all three to the
// rule, because the rule is one rule.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { NearMeReadUnavailable } from "@/components/nearme/NearMeNow";
import { UPLOAD_PHOTO_MAX_LABEL } from "@/lib/uploadBodyLimit";

const read = (file: string): string => readFileSync(join(process.cwd(), file), "utf8");

describe("a plan we could not read has not closed", () => {
  const store = read("lib/planStore.ts");
  const page = read("app/plan/[id]/page.tsx");
  // ONE surface for the whole segment: the plan page, the recap page and both
  // sets of metadata word this outcome the same way rather than each deciding
  // again, which is how the recap was left behind when #1594 fixed the page.
  const surface = read("components/plan/PlanReadUnavailable.tsx");
  const recapPage = read("app/plan/[id]/recap/page.tsx");
  const recapView = read("lib/planRecapView.server.ts");
  const recapRoute = read("app/api/plans/[id]/recap/route.ts");

  it("gives the store read three answers rather than two", () => {
    expect(store).toContain('export type PlanReadResult =');
    expect(store).toContain('| { status: "found"; state: PlanState }');
    expect(store).toContain('| { status: "absent" }');
    expect(store).toContain('| { status: "unavailable" }');
  });

  it("answers unavailable where the Supabase read threw, and absent where it did not", () => {
    const supabaseRead = store.slice(store.indexOf("  async read(id) {"));
    const body = supabaseRead.slice(0, supabaseRead.indexOf("\n  },"));
    expect(body).toContain('return state ? { status: "found", state } : { status: "absent" };');
    expect(body).toContain('return { status: "unavailable" };');
  });

  it("keeps `get` as the two-way reading, derived from the three-way one", () => {
    expect(store).toContain('return result.status === "found" ? result.state : null;');
  });

  it("sends the page's unavailable answer somewhere other than the closed surface", () => {
    // The order is the assertion: an unavailable read must be answered BEFORE
    // notFound(), or the 404 swallows it exactly as it used to.
    const unavailable = page.indexOf('read.status === "unavailable"');
    const absent = page.indexOf('read.status === "absent"');
    expect(unavailable).toBeGreaterThan(-1);
    expect(absent).toBeGreaterThan(unavailable);
    expect(page).toContain("PlanReadUnavailable");
  });

  it("says what happened and claims nothing about the plan itself", () => {
    // The surface says what happened, and its way onward is the same address.
    expect(surface).toContain("We could not load this plan");
    expect(surface).toContain("Try again");
    // Never the not-found sentence, which is about a link that expired.
    expect(surface).not.toContain("closed");
    // AND NEVER A FACT ABOUT THE PLAN. The first cut opened "The plan is still
    // there", one clause before the sentence saying we could not read it: a
    // claim about a plan the store had just failed to read, which is the very
    // defect this file exists to refuse.
    expect(surface).not.toContain("The plan is still there");
    expect(surface).toContain("could not answer just now");
  });

  it("gives the recap page the same three answers as the plan page", () => {
    // /plan/[id]/recap sits inside the same segment, so it inherits the same
    // not-found copy: `get` collapsed absent and unavailable into one null and
    // the recap rendered the expired-link surface over a live plan the crew
    // was standing in.
    for (const source of [recapPage, recapView, recapRoute]) {
      expect(source).not.toContain("planStore().get(");
    }
    const unavailable = recapPage.indexOf('read.status === "unavailable"');
    const absent = recapPage.indexOf('read.status === "absent"');
    expect(unavailable).toBeGreaterThan(-1);
    expect(absent).toBeGreaterThan(unavailable);
    expect(recapPage).toContain("PlanReadUnavailable");
    // The retry lands on the reader's own address, not the plan's.
    expect(recapPage).toContain("/recap`");
  });

  it("makes the recap read three-way at the API too, and 503 rather than 404", () => {
    expect(recapView).toContain("export type RecapAssemblyResult");
    expect(recapView).toContain('| { status: "unavailable" }');
    expect(recapRoute).toContain("PLAN_STORE_UNAVAILABLE");
    expect(recapRoute).toContain("503");
    // Each read answers its unavailable case BEFORE its absent one, or the 404
    // keeps swallowing it. Measured from the read itself, because the handler's
    // first PLAN_NOT_FOUND is the id-shape guard and runs before any read.
    const afterRead = recapRoute.slice(recapRoute.indexOf("planStore().read(id)"));
    const unavailable = afterRead.indexOf('read.status === "unavailable"');
    const absent = afterRead.indexOf('read.status === "absent"');
    expect(unavailable).toBeGreaterThan(-1);
    expect(absent).toBeGreaterThan(unavailable);

    const afterAssembly = recapRoute.slice(recapRoute.indexOf("assembleMemberRecap(id)"));
    const assemblyUnavailable = afterAssembly.indexOf('assembled.status === "unavailable"');
    const assemblyAbsent = afterAssembly.indexOf('assembled.status === "absent"');
    expect(assemblyUnavailable).toBeGreaterThan(-1);
    expect(assemblyAbsent).toBeGreaterThan(assemblyUnavailable);
  });

  it("does not let the unfurl call it a plan that was never here", () => {
    // The refusal also carries PLAN_INVITE_ROBOTS (Astra F09), so the pin is the
    // sentence rather than the whole object literal.
    expect(page).toContain('if (read.status === "unavailable") return { title: "Plan · PUBMAXXING"');
  });
});

describe("a shard read we could not run is not an unmapped area", () => {
  const near = read("components/nearme/NearMeNow.tsx");

  it("records the failure beside the empty list rather than instead of it", () => {
    expect(near).toContain('type SlimReadState = "unknown" | "ready" | "unavailable";');
    expect(near).toContain('setSlimRead("unavailable");');
    expect(near).toContain('setSlimRead("ready");');
  });

  it("asks the read before it words the absence", () => {
    // The coverage card carries "We haven't mapped pubs in {area} yet" plus a
    // form asking us to map it. Over a borough we have mapped for a year that
    // is a claim about the AREA made from a fact about us, so the failed-read
    // branch is tested FIRST and the coverage card can never stand over one.
    const branch = near.indexOf('{cards.length === 0 && slimRead === "unavailable" ? (');
    const coverage = near.indexOf('cards.length === 0 ? (', branch);
    expect(branch).toBeGreaterThan(-1);
    expect(coverage).toBeGreaterThan(branch);
  });

  it("says what happened and offers the one thing that helps", () => {
    const markup = renderToStaticMarkup(
      createElement(NearMeReadUnavailable, {
        areaLabel: "Clapham",
        onRetry: () => undefined,
      }),
    );
    expect(markup).toContain("could not read the pub list for Clapham");
    expect(markup).toContain("Try again");
    // docs/VOICE.md: never a closed door.
    expect(markup).not.toMatch(/check back later|try again later|please try again/i);
    // And never the coverage claim, which is what this replaces.
    expect(markup).not.toContain("mapped");
  });

  it("re-answers the ask the reader made rather than dropping them on idle", () => {
    expect(near).toContain('retryTargetRef.current = { kind: "patch"');
    expect(near).toContain('retryTargetRef.current = { kind: "borough"');
    expect(near).toContain("const retrySlim = useCallback(");
  });
});

describe("a photo the platform will refuse is refused here, by size, in the browser", () => {
  it("gives both map composers the wire's own number and its own words", () => {
    // Through ONE leaf. `photoRefusal` (lib/pintDropReceipt.ts) is what both
    // composers ask, so the figure and the sentence beside it are written once
    // and cannot drift apart per picker; the leaf is where the wire is read.
    for (const file of ["components/map/usePintDrops.ts", "components/map/VenuePriceSubmit.tsx"]) {
      const source = read(file);
      expect(source, file).toContain('from "@/lib/pintDropReceipt"');
      expect(source, file).toContain("photoRefusal(file)");
    }
    const leaf = read("lib/pintDropReceipt.ts");
    expect(leaf).toContain('from "@/lib/uploadBodyLimit"');
    expect(leaf).toContain("UPLOAD_PHOTO_MAX_BYTES");
    expect(leaf).toContain("${UPLOAD_PHOTO_MAX_LABEL}.");
  });

  it("prints a figure a reader can act on, not the wrong one", () => {
    expect(UPLOAD_PHOTO_MAX_LABEL).toBe("4\u00a0MB");
    for (const file of [
      "components/map/usePintDrops.ts",
      "components/map/VenuePriceSubmit.tsx",
      "lib/pintDropsStore.ts",
    ]) {
      expect(read(file), file).not.toContain("5MB");
    }
  });
});
