import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";
import { defined } from "@/__tests__/helpers/defined";

// THE STORE INVENTORY (#727, section 1). One row per `lib/*Store*.ts` module,
// naming how it chooses between process-memory and Supabase and which class it
// belongs to. It is a TEST FIXTURE, never a runtime registry: nothing imports
// it, and the assertions below hold each module's SOURCE to its row.
//
// The dual-backend seam is `lib/storeBackend.ts` (`selectStore`,
// `createDualBackendStore`, `admin`, `createFailSoftGuard`,
// `onMissingDurableWrite`, `missingTables`). A store may not redeclare what the
// seam already owns. A store that still branches on `isSupabaseConfigured()`
// by hand declares EVERY such call site here with a reason, and that count may
// only ever go DOWN: a new hand-rolled branch fails this test until its row
// says why it cannot ride the seam. Migrating a policy-heavy store is a
// slice of its own with a contract test, never a by-product of this fence.

type StoreClass =
  /** Memory and Supabase implementations of one interface, chosen at the seam, nothing else. */
  | "plain-dual-backend"
  /** Same seam, plus schema-miss fallback, production strictness, column ladders or authorization at the store boundary. */
  | "policy-heavy"
  /** The durable side is a cache or an overlay over a source that exists without it. */
  | "cache-backed"
  /** Backend chosen inline per operation. Named here so the exception is visible, not hidden. */
  | "legacy-exception"
  /** Holds no memory-versus-Supabase choice at all (durable-only RPC, or no Supabase in the module). */
  | "not-dual-backend";

type Selector =
  /** `selectStore(memory, supabase)` or `createDualBackendStore(memory, supabase)` from the seam. */
  | "selectStore"
  /** `isSupabaseConfigured()` ternaries or guards written by hand. */
  | "inline"
  /** No backend choice in the module. */
  | "none";

type StoreRow = {
  class: StoreClass;
  selector: Selector;
  /**
   * Exact number of `isSupabaseConfigured()` call sites the module keeps
   * besides the seam. Omitted means zero. Every non-zero count carries a reason.
   */
  inlineBranches?: number;
  /** Required for `inline`, `legacy-exception`, `not-dual-backend` and any non-zero `inlineBranches`. */
  reason?: string;
};

const STORE_INVENTORY: Record<string, StoreRow> = {
  "lib/adultSelfAssertionStore.ts": { class: "policy-heavy", selector: "selectStore" },
  "lib/analyticsReceiptStore.ts": { class: "plain-dual-backend", selector: "selectStore" },
  "lib/areaDemandStore.ts": { class: "policy-heavy", selector: "selectStore" },
  "lib/checkInStore.ts": { class: "plain-dual-backend", selector: "selectStore" },
  "lib/cityEnrichmentCheckpointStore.server.ts": {
    class: "policy-heavy",
    selector: "selectStore",
    inlineBranches: 1,
    reason: "cityEnrichmentCheckpointIsDurable() tells the cron whether a checkpoint exists at all.",
  },
  "lib/commentsStore.ts": { class: "plain-dual-backend", selector: "selectStore" },
  "lib/communityPriceStore.ts": { class: "policy-heavy", selector: "selectStore" },
  "lib/contributorLeaderboardStore.ts": {
    class: "legacy-exception",
    selector: "inline",
    inlineBranches: 1,
    reason: "Read seam with no memory implementation of the all-time aggregate; keyless answers the demo tally.",
  },
  "lib/crawlStoryStore.ts": {
    class: "legacy-exception",
    selector: "inline",
    inlineBranches: 6,
    reason: "Per-operation branching over two tables with fail-soft reads; no single interface to select.",
  },
  "lib/diaryStore.ts": { class: "policy-heavy", selector: "selectStore" },
  "lib/feedFreshnessStore.ts": { class: "policy-heavy", selector: "selectStore" },
  "lib/followStore.ts": { class: "plain-dual-backend", selector: "selectStore" },
  "lib/freshnessStoreOverlay.ts": {
    class: "cache-backed",
    selector: "inline",
    inlineBranches: 3,
    reason:
      "One per store-stamped feed (feed_freshness, What's-On listings, weather snapshots): each answers an explicit `unconfigured` kind so the freshness spine can name the absence rather than read an unmeasured feed as fresh.",
  },
  "lib/harvestOverlayStore.ts": {
    class: "policy-heavy",
    selector: "selectStore",
    inlineBranches: 1,
    reason: "`requireDurable` refuses a non-dry harvest fold with no Supabase rather than folding into memory.",
  },
  "lib/identityHandleStore.ts": { class: "plain-dual-backend", selector: "selectStore" },
  "lib/importNotesStore.ts": {
    class: "not-dual-backend",
    selector: "none",
    reason: "JSON file under .data/ with an in-memory fallback; no Supabase in the module.",
  },
  "lib/messagesStore.ts": { class: "policy-heavy", selector: "selectStore" },
  "lib/nightMemoryStore.ts": {
    class: "legacy-exception",
    selector: "selectStore",
    inlineBranches: 24,
    reason:
      "Every legacy operation branches inline over several tables and maps; the largest hand-rolled exception. The removal pair (D06) rides selectStore, so the 24 may only shrink from here.",
  },
  "lib/nightProfileStore.ts": { class: "plain-dual-backend", selector: "selectStore" },
  "lib/nightSignalStore.server.ts": {
    class: "policy-heavy",
    selector: "selectStore",
    inlineBranches: 1,
    reason: "nightSignalStoreIsDurable() tells the sweep whether a candidate outlives one invocation.",
  },
  "lib/notificationsStore.ts": {
    class: "policy-heavy",
    selector: "selectStore",
    inlineBranches: 2,
    reason: "Two pint-drop lookups read the durable table only when configured, beside the selected store.",
  },
  "lib/occupancyStore.ts": { class: "policy-heavy", selector: "selectStore" },
  "lib/operatorProposalsStore.ts": { class: "policy-heavy", selector: "selectStore" },
  "lib/pendingPlanRecapStore.ts": { class: "policy-heavy", selector: "selectStore" },
  "lib/pintDropsStore.ts": { class: "policy-heavy", selector: "selectStore" },
  "lib/planCollaborationStore.ts": { class: "policy-heavy", selector: "selectStore" },
  "lib/planGroupPrefsStore.ts": { class: "plain-dual-backend", selector: "selectStore" },
  "lib/planInviteRsvpStore.ts": { class: "plain-dual-backend", selector: "selectStore" },
  "lib/planStore.ts": {
    class: "legacy-exception",
    selector: "selectStore",
    inlineBranches: 13,
    reason: "Capability, invite and idempotency lanes branch per operation; the store getter alone rides the seam.",
  },
  "lib/presenceStore.ts": {
    class: "policy-heavy",
    selector: "selectStore",
    inlineBranches: 1,
    reason: "Ambient demo presence is blended in only where no durable store answers.",
  },
  "lib/priceTrustEventStore.ts": { class: "policy-heavy", selector: "selectStore" },
  "lib/privateIdentityStore.ts": { class: "plain-dual-backend", selector: "selectStore" },
  "lib/profileCoverPhotoStore.ts": {
    class: "policy-heavy",
    selector: "selectStore",
    inlineBranches: 1,
    reason: "The cross-store moderation RPC has no memory equivalent and answers null without Supabase.",
  },
  "lib/profileStore.ts": { class: "policy-heavy", selector: "selectStore" },
  "lib/pubPalStore.ts": {
    class: "legacy-exception",
    selector: "inline",
    inlineBranches: 8,
    reason: "Result-typed operations branch inline over two maps; no interface pair to select.",
  },
  "lib/pubPalToolTurnStore.ts": { class: "plain-dual-backend", selector: "selectStore" },
  "lib/pushTokenStore.ts": { class: "plain-dual-backend", selector: "selectStore" },
  "lib/ratingsStore.ts": { class: "policy-heavy", selector: "selectStore" },
  "lib/reactionsStore.ts": { class: "plain-dual-backend", selector: "selectStore" },
  "lib/referralStore.ts": { class: "policy-heavy", selector: "selectStore" },
  "lib/roundsStore.ts": { class: "plain-dual-backend", selector: "selectStore" },
  "lib/savedPubsStore.ts": { class: "plain-dual-backend", selector: "selectStore" },
  "lib/socialConnectionStore.ts": { class: "plain-dual-backend", selector: "selectStore" },
  "lib/socialCrewStore.ts": {
    class: "not-dual-backend",
    selector: "none",
    reason: "RPC-only durable store with injectable dependencies; no memory implementation.",
  },
  "lib/socialInteractionStore.ts": { class: "policy-heavy", selector: "selectStore" },
  "lib/socialPostConsentStore.ts": {
    class: "not-dual-backend",
    selector: "none",
    reason: "RPC-only durable store; no memory implementation.",
  },
  "lib/socialPostStore.ts": { class: "policy-heavy", selector: "selectStore" },
  "lib/stepOutNudgeStore.ts": { class: "policy-heavy", selector: "selectStore" },
  "lib/venueOperatorsStore.ts": { class: "policy-heavy", selector: "selectStore" },
  "lib/venuePhotoStore.ts": { class: "policy-heavy", selector: "selectStore" },
  "lib/visitReportsStore.ts": { class: "policy-heavy", selector: "selectStore" },
  "lib/walkRouteStore.ts": { class: "cache-backed", selector: "selectStore" },
  "lib/wantedStore.ts": { class: "policy-heavy", selector: "selectStore" },
  "lib/weatherRecommendationStore.ts": { class: "policy-heavy", selector: "selectStore" },
  "lib/weatherSnapshotStore.ts": { class: "cache-backed", selector: "selectStore" },
  "lib/whatsOnListingStore.ts": {
    class: "policy-heavy",
    selector: "selectStore",
    inlineBranches: 1,
    reason: "A process that requires a durable store and has no Supabase answers an unavailable store instead of throwing.",
  },
  "lib/whatsOnStore.ts": {
    class: "not-dual-backend",
    selector: "none",
    reason: "Bundled baseline files plus an injectable live merge; no Supabase in the module.",
  },
};

const SEAM = "lib/storeBackend.ts";

function storeModules(): string[] {
  return readdirSync(join(process.cwd(), "lib"))
    .filter((name) => /Store.*\.ts$/.test(name) && !name.endsWith(".d.ts"))
    .map((name) => `lib/${name}`)
    .filter((path) => path !== SEAM)
    .sort();
}

function source(path: string): string {
  return readFileSync(join(process.cwd(), path), "utf8");
}

function count(src: string, needle: string): number {
  return src.split(needle).length - 1;
}

const SEAM_SELECTORS = ["selectStore(", "createDualBackendStore("];

describe("store inventory (#727)", () => {
  const modules = storeModules();

  it("names every lib/*Store*.ts module, and nothing else", () => {
    expect(Object.keys(STORE_INVENTORY).sort()).toEqual(modules);
  });

  it("every exception carries a reason", () => {
    for (const [path, row] of Object.entries(STORE_INVENTORY)) {
      const needsReason =
        row.selector !== "selectStore" ||
        row.class === "legacy-exception" ||
        (row.inlineBranches ?? 0) > 0;
      if (needsReason) {
        expect(row.reason?.trim(), `${path} needs a reason`).toBeTruthy();
      }
    }
  });

  it.each(modules)("%s matches its inventory row", (path) => {
    const row = defined(STORE_INVENTORY[path]);
    const src = source(path);
    const usesSeam = SEAM_SELECTORS.some((needle) => src.includes(needle));
    const inline = count(src, "isSupabaseConfigured()");

    if (row.selector === "selectStore") {
      expect(usesSeam, `${path} declares selector selectStore but does not call it`).toBe(true);
    } else if (row.selector === "inline") {
      expect(usesSeam, `${path} calls the seam; move its row to selector selectStore`).toBe(false);
      expect(inline, `${path} declares inline selection but never asks isSupabaseConfigured()`).toBeGreaterThan(0);
    } else {
      expect(usesSeam, `${path} selects a backend; its row says none`).toBe(false);
      expect(inline, `${path} branches on isSupabaseConfigured(); its row says none`).toBe(0);
    }

    expect(
      inline,
      `${path} has ${inline} isSupabaseConfigured() call site(s); its row declares ${row.inlineBranches ?? 0}. Ride the seam or say why in the row.`,
    ).toBe(row.inlineBranches ?? 0);
  });

  it.each(modules)("%s redeclares nothing the seam owns", (path) => {
    const src = source(path);
    expect(src, `${path}: import admin from lib/storeBackend`).not.toMatch(
      /^(?:export )?function admin\(\)/m,
    );
    expect(src, `${path}: import errorMessage from lib/storeBackend`).not.toMatch(
      /^(?:export )?function errorMessage\(/m,
    );
    expect(src, `${path}: use missingTables(...) from lib/storeBackend`).not.toContain(
      "Could not find the table",
    );
    expect(src, `${path}: use selectStore from lib/storeBackend`).not.toMatch(
      /isSupabaseConfigured\(\)\s*\?\s*\w+\s*:\s*\w+;/,
    );
  });

  it("the seam imports no domain module", () => {
    const imports = [...source(SEAM).matchAll(/from "([^"]+)"/g)].map((m) => m[1]);
    expect(imports.sort()).toEqual(
      ["@/lib/deploymentEnv", "@/lib/supabase", "@supabase/supabase-js"].sort(),
    );
  });
});
