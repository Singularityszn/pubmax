import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it, vi } from "vitest";

import {
  normalizeSiteHarvestLedgerRow,
  parseSiteHarvestLedgerText,
  type SiteHarvestLedgerRow,
  siteHarvestLedgerCollectKey, loadCuratedUkBaseOwners, siteHarvestLedgerDuplicateKeys,
} from "@/lib/siteHarvestLedger";
import { isHarvestableDrinkUpdateUrl } from "@/lib/harvest/sourcePolicy";
import { bundleDrinkFieldsFromPrintedName } from "@/lib/bundleDrinkFields";
import {
  bundleRowServingSize,
  isCategoryQuarantined,
  isValidUkPriceBundleRow,
  type UkPriceBundleRow,
} from "@/lib/ukPriceBundle";

vi.mock("server-only", () => ({}));

type RowIdentity = {
  sha256: string;
  host: string;
  venueId: string | null;
  category: string | null;
  drinkLabel: string | null;
  priceGbp: number | null;
  sourceUrl: string | null;
  observedAt: string | null;
};

type Decision = {
  before: RowIdentity;
  after: RowIdentity | null;
  disposition: "restore" | "reclassify" | "withdraw";
  reason: string;
  currentMainMapping: {
    status: "mapped" | "absent" | "unresolved";
    reason: string;
    candidateRows: RowIdentity[];
  };
};

type Reconciliation = {
  schemaVersion: number;
  sourceSnapshot: { sha256: string; rowCount: number };
  currentMainSnapshot: {
    commit: string;
    sha256: string;
    rowCount: number;
    preservedOutsideRepository: boolean;
  };
  currentMainComparison: {
    previousCorrectedCommit: string;
    previousCorrectedRows: number;
    previousCorrectedSha256: string;
    currentOnlyRows: number;
    oldOnlyRowsNotOverlaid: number;
    oldOnlyIdentitySha256: string[];
    noOldRowsOverlaid: boolean;
    currentOnlyAudit: {
      rowCount: number;
      retained: number;
      withdrawn: number;
      held: number;
      unexplainedLosses: number;
      rows: Array<RowIdentity & { disposition: "retain" | "withdraw"; reason: string }>;
    };
    withdrawnRows: Array<{
      identity: RowIdentity;
      reason: string;
      baselineMembership: "current-only" | "shared-with-previous-output";
    }>;
    decisionMappingCounts: { mapped: number; absent: number; unresolved: number };
  };
  publishedLanesAudit: {
    drinkPriceUpdateSnapshots: {
      files: Array<{
        path: string;
        before: { sha256: string; rowCount: number; refusedNicholsonRows: number };
        after: { sha256: string; rowCount: number; refusedNicholsonRows: number };
      }>;
      totalRefusedRowsBefore: number;
      totalRefusedRowsAfter: number;
    };
    ukPriceBundle: {
      before: { rows: number; refusedNicholsonRows: number; refusedNicholsonSoftDrinkRows: number };
      after: {
        rows: number;
        siteHarvestRows: number;
        drinkPriceUpdateRows: number;
        refusedNicholsonRows: number;
      };
    };
  };
  publishedLedger: {
    path: string;
    sha256: string;
    rowCount: number;
    rowIdentitySetSha256: string;
  };
  postReconciliationPublication: {
    sourceCaptureSha256: string;
    sourceObservedAt: string;
    sourceUrl: string;
    supersededRowSha256: string;
    currentLedger: { sha256: string; rowCount: number; rowIdentitySetSha256: string };
    currentBundle: { rowCount: number; siteHarvestRows: number };
  };
  currentPublication: {
    sourceLedger: { path: string; sha256: string; rowCount: number; rowIdentitySetSha256: string };
    currentLedger: { path: string; sha256: string; rowCount: number; rowIdentitySetSha256: string };
    currentBundle: { path: string; sha256: string; rowCount: number; siteHarvestRows: number };
    historicalLedgers: Array<{ path: string; sha256: string; rowCount: number; rowIdentitySetSha256: string }>;
    accounting: { sourceRows: number; canonicalRows: number; supersededRows: number; unexplainedLosses: number };
    supersededRows: Array<{
      sourceRowNumber: number; collectKey: string; beforeSha256: string; currentSha256: string;
      beforeObservedAt: string; currentObservedAt: string;
    }>;
  };
  publicationHistory?: Array<Reconciliation["currentPublication"]>;
  accounting: {
    refusedNicholsonRows: number;
    knownMisclassifiedWithdrawals: number;
    currentMainCrabbiesWithdrawals: number;
    additionalCurrentEquivalentWithdrawals: number;
    unchangedTrustedRestorations: number;
    alcoholFreeReclassifications: number;
    reviewedAdditionalRows: number;
    mappedPriorDecisions: number;
    absentPriorDecisions: number;
    unresolvedPriorDecisions: number;
    currentMainRows: number;
    currentOnlyRows: number;
    currentOnlyRowsRetained: number;
    currentOnlyRowsWithdrawn: number;
    sharedPreviousOutputRowsWithdrawn: number;
    oldOnlyRowsNotOverlaid: number;
    publishedRows: number;
    unexplainedLosses: number;
  };
  refusedNicholsonIdentitySha256: string[];
  knownMisclassifiedWithdrawals: Array<{
    before: RowIdentity;
    after: null;
    disposition: "withdraw";
    reason: string;
  }>;
  additionalRowDecisions: Decision[];
};

const ROOT = join(__dirname, "..");
const LEDGER_PATH = join(ROOT, "data/uk_prices/site_harvest.jsonl");
const REPORT_PATH = join(ROOT, "data/uk_prices/site_harvest_reconciliation.json");

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function rowIdentitySha256(row: SiteHarvestLedgerRow): string {
  const canonicalRow = Object.fromEntries(
    Object.entries(row).sort(([left], [right]) => left.localeCompare(right)),
  );
  return sha256(JSON.stringify(canonicalRow));
}

function identitySetSha256(rows: readonly SiteHarvestLedgerRow[]): string {
  return sha256(`${rows.map(rowIdentitySha256).sort().join("\n")}\n`);
}

function hostOf(value: string | undefined): string | null {
  try {
    return new URL(value ?? "").hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return null;
  }
}

function ledgerBundleClaim(row: SiteHarvestLedgerRow): unknown {
  return {
    venueId: row.venueId,
    name: row.name ?? null,
    category: row.category,
    priceGbp: row.priceGbp,
    lane: "site-harvest",
    standing: "listed",
    sourceUrl: row.sourceUrl ?? null,
    publisher: row.host ?? null,
    observedAt: row.observedAt,
    basis: null,
    sampleSize: null,
    ...(row.servingSize !== undefined ? { servingSize: row.servingSize } : {}),
    ...bundleDrinkFieldsFromPrintedName(row.drinkLabel ?? row.drinkName ?? null, row.category ?? ""),
  };
}

function claimIdentity(row: UkPriceBundleRow): string {
  return JSON.stringify([
    row.sourceUrl, row.category, row.priceGbp, row.drinkLabel ?? null,
    row.observedAt, row.servingSize ?? null,
  ]);
}

describe("site-harvest withdrawal reconciliation", () => {
  const ledgerText = readFileSync(LEDGER_PATH, "utf8");
  const rows = parseSiteHarvestLedgerText(ledgerText);
  const reconciliation = JSON.parse(
    readFileSync(REPORT_PATH, "utf8"),
  ) as Reconciliation;
  const currentIdentityHashes = new Set(rows.map(rowIdentitySha256));

  it("records source, output, and zero-loss accounting with stable identities", () => {
    expect(reconciliation.schemaVersion).toBe(2);
    expect(reconciliation.sourceSnapshot).toEqual(
      expect.objectContaining({
        sha256: expect.stringMatching(/^[a-f0-9]{64}$/),
        rowCount: 3315,
      }),
    );
    expect(reconciliation.currentMainSnapshot).toEqual(
      expect.objectContaining({
        commit: "2af4a308048771666308f1031e44a0932b758f89",
        sha256: expect.stringMatching(/^[a-f0-9]{64}$/),
        rowCount: 3567,
        preservedOutsideRepository: true,
      }),
    );
    expect(reconciliation.currentMainComparison).toEqual(
      expect.objectContaining({
        previousCorrectedCommit: "270a35babbc060d3e68502edf3ba4e72351cced8",
        previousCorrectedRows: 2816,
        previousCorrectedSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
        currentOnlyRows: 573,
        oldOnlyRowsNotOverlaid: 302,
        noOldRowsOverlaid: true,
        decisionMappingCounts: { mapped: 6, absent: 9, unresolved: 11 },
      }),
    );
    expect(reconciliation.publishedLedger.path).toBe(
      "data/uk_prices/site_harvest.jsonl",
    );
    expect(reconciliation.publishedLedger).toEqual({
      path: "data/uk_prices/site_harvest.jsonl",
      sha256: "d08ebb6cbc2902bcb3fff880f385ed7659aa5d0abbc4f1358b6314b7595ddd56",
      rowCount: 3083,
      rowIdentitySetSha256: "f49f615f1a3a3f9ca323b07ea0c1c43c3ce56f4bf04a6721c94252409cacd7d6",
    });
    expect(reconciliation.accounting).toEqual({
      refusedNicholsonRows: 480,
      knownMisclassifiedWithdrawals: 19,
      currentMainCrabbiesWithdrawals: 1,
      additionalCurrentEquivalentWithdrawals: 3,
      unchangedTrustedRestorations: 7,
      alcoholFreeReclassifications: 1,
      reviewedAdditionalRows: 26,
      mappedPriorDecisions: 6,
      absentPriorDecisions: 9,
      unresolvedPriorDecisions: 11,
      currentMainRows: 3567,
      currentOnlyRows: 573,
      currentOnlyRowsRetained: 570,
      currentOnlyRowsWithdrawn: 3,
      sharedPreviousOutputRowsWithdrawn: 1,
      oldOnlyRowsNotOverlaid: 302,
      publishedRows: 3083,
      unexplainedLosses: 0,
    });
    expect(reconciliation.currentMainComparison.currentOnlyAudit).toEqual(
      expect.objectContaining({
        rowCount: 573,
        retained: 570,
        withdrawn: 3,
        held: 0,
        unexplainedLosses: 0,
      }),
    );
    expect(
      reconciliation.accounting.currentMainRows -
        reconciliation.accounting.refusedNicholsonRows -
        reconciliation.accounting.currentMainCrabbiesWithdrawals -
        reconciliation.accounting.additionalCurrentEquivalentWithdrawals,
    ).toBe(reconciliation.publishedLedger.rowCount);
    expect(reconciliation.publishedLanesAudit.drinkPriceUpdateSnapshots).toEqual(
      expect.objectContaining({
        totalRefusedRowsBefore: 12962,
        totalRefusedRowsAfter: 0,
      }),
    );
    expect(
      reconciliation.publishedLanesAudit.drinkPriceUpdateSnapshots.files,
    ).toHaveLength(6);
    for (const file of reconciliation.publishedLanesAudit.drinkPriceUpdateSnapshots.files) {
      expect(file.before.sha256).toMatch(/^[a-f0-9]{64}$/);
      expect(file.after.sha256).toMatch(/^[a-f0-9]{64}$/);
      expect(file.after.refusedNicholsonRows).toBe(0);
    }
    expect(reconciliation.publishedLanesAudit.ukPriceBundle.after).toEqual(
      expect.objectContaining({ rows: 7603, siteHarvestRows: 3083, refusedNicholsonRows: 0 }),
    );
  });

  it("accounts for every one of the 26 extra before/after identities and reasons", () => {
    const decisions = reconciliation.additionalRowDecisions;
    expect(decisions).toHaveLength(26);
    expect(decisions.every((decision) => decision.reason.trim().length > 0)).toBe(
      true,
    );
    expect(new Set(decisions.map((decision) => decision.before.sha256)).size).toBe(
      26,
    );
    expect(
      decisions.filter((decision) => decision.disposition === "restore"),
    ).toHaveLength(7);
    expect(
      decisions.filter((decision) => decision.disposition === "reclassify"),
    ).toHaveLength(1);
    expect(
      decisions.filter((decision) => decision.disposition === "withdraw"),
    ).toHaveLength(18);
    expect(
      decisions.filter(
        (decision) => decision.currentMainMapping.status === "mapped",
      ),
    ).toHaveLength(6);
    expect(
      decisions.filter(
        (decision) => decision.currentMainMapping.status === "absent",
      ),
    ).toHaveLength(9);
    expect(
      decisions.filter(
        (decision) => decision.currentMainMapping.status === "unresolved",
      ),
    ).toHaveLength(11);

    for (const decision of decisions) {
      expect(decision.currentMainMapping.reason.trim().length).toBeGreaterThan(0);
      for (const candidate of decision.currentMainMapping.candidateRows) {
        expect(candidate.sha256).toMatch(/^[a-f0-9]{64}$/);
      }
      if (decision.disposition === "restore") {
        expect(decision.after?.sha256).toBe(decision.before.sha256);
        continue;
      }
      if (decision.disposition === "reclassify") {
        expect(decision.before.category).toBe("soft-drink");
        expect(decision.after?.category).toBe("alcohol-free");
        expect(decision.after?.sha256).not.toBe(decision.before.sha256);
        continue;
      }
      expect(decision.after).toBeNull();
      expect(
        reconciliation.knownMisclassifiedWithdrawals.some(
          (withdrawal) =>
            withdrawal.before.sha256 === decision.before.sha256 &&
            withdrawal.reason === decision.reason,
        ),
      ).toBe(true);
    }
  });

  it("accounts for every current-only and removed row without overlaying old-only data", () => {
    const audit = reconciliation.currentMainComparison.currentOnlyAudit;
    const auditHashes = audit.rows.map((row) => row.sha256);
    const retainedHashes = audit.rows
      .filter((row) => row.disposition === "retain")
      .map((row) => row.sha256);
    const withdrawnHashes = audit.rows
      .filter((row) => row.disposition === "withdraw")
      .map((row) => row.sha256);

    expect(audit.rows).toHaveLength(573);
    expect(new Set(auditHashes).size).toBe(573);
    expect(audit.retained).toBe(570);
    expect(audit.withdrawn).toBe(3);
    expect(audit.held).toBe(0);
    expect(audit.retained + audit.withdrawn + audit.held).toBe(audit.rowCount);
    expect(audit.unexplainedLosses).toBe(0);
    const publications = [
      ...(reconciliation.publicationHistory ?? []), reconciliation.currentPublication,
    ];
    const laterSupersessions = new Set(
      publications.flatMap((publication) => publication.supersededRows.map((row) => row.beforeSha256)),
    );
    for (const hash of retainedHashes) {
      expect(currentIdentityHashes.has(hash)).toBe(
        hash !== reconciliation.postReconciliationPublication.supersededRowSha256 &&
          !laterSupersessions.has(hash),
      );
    }
    for (const row of audit.rows.filter((item) => item.disposition === "retain")) {
      expect(isHarvestableDrinkUpdateUrl(row.sourceUrl)).toBe(true);
    }
    const bundleRows = JSON.parse(
      readFileSync(join(ROOT, "public/data/uk_prices/rows.json"), "utf8"),
    ) as UkPriceBundleRow[];
    const publishedClaims = bundleRows.filter((row) => row.lane === "site-harvest").map(claimIdentity);
    const quarantinedSourceHashes = new Set<string>();
    for (const publication of publications) {
      const sourceText = readFileSync(join(ROOT, publication.sourceLedger.path), "utf8");
      expect(sha256(sourceText)).toBe(publication.sourceLedger.sha256);
      for (const raw of parseSiteHarvestLedgerText(sourceText)) {
        const claim = ledgerBundleClaim(raw);
        expect(isValidUkPriceBundleRow(claim)).toBe(true);
        if (!isValidUkPriceBundleRow(claim) || !isCategoryQuarantined(claim)) continue;
        const hash = rowIdentitySha256(raw);
        quarantinedSourceHashes.add(hash);
        expect(currentIdentityHashes.has(hash)).toBe(!laterSupersessions.has(hash));
        expect(publishedClaims).not.toContain(claimIdentity(claim));
      }
    }
    expect(quarantinedSourceHashes.size).toBeGreaterThan(0);
    for (const hash of withdrawnHashes) {
      expect(currentIdentityHashes.has(hash)).toBe(false);
    }

    const oldOnly = reconciliation.currentMainComparison.oldOnlyIdentitySha256;
    expect(oldOnly).toHaveLength(302);
    expect(new Set(oldOnly).size).toBe(302);
    expect(reconciliation.currentMainComparison.noOldRowsOverlaid).toBe(true);
    for (const hash of oldOnly) {
      expect(currentIdentityHashes.has(hash)).toBe(false);
    }

    const removals = reconciliation.currentMainComparison.withdrawnRows;
    expect(removals).toHaveLength(4);
    expect(
      removals.filter((row) => row.baselineMembership === "current-only"),
    ).toHaveLength(3);
    expect(
      removals.filter(
        (row) => row.baselineMembership === "shared-with-previous-output",
      ),
    ).toHaveLength(1);
    for (const row of removals) {
      expect(row.identity.sha256).toMatch(/^[a-f0-9]{64}$/);
      expect(row.reason.trim().length).toBeGreaterThan(0);
      expect(currentIdentityHashes.has(row.identity.sha256)).toBe(false);
    }
  });

  it("proves all refused Nicholson identities are absent from the site lane", () => {
    expect(reconciliation.refusedNicholsonIdentitySha256).toHaveLength(480);
    expect(
      new Set(reconciliation.refusedNicholsonIdentitySha256).size,
    ).toBe(480);
    for (const identity of reconciliation.refusedNicholsonIdentitySha256) {
      expect(identity).toMatch(/^[a-f0-9]{64}$/);
      expect(currentIdentityHashes.has(identity)).toBe(false);
    }

    expect(
      rows.filter(
        (row) =>
          hostOf(row.sourceUrl) === "nicholsonspubs.co.uk" ||
          row.host?.toLowerCase().replace(/^www\./, "") ===
            "nicholsonspubs.co.uk",
      ),
    ).toHaveLength(0);
    expect(
      rows.filter((row) =>
        /Crabbies Alcoholic ginger beer 3\.4%/i.test(row.drinkLabel ?? ""),
      ),
    ).toHaveLength(0);
    expect(
      rows.filter(
        (row) =>
          row.host === "blacklionkilburn.co.uk" &&
          row.category === "soft-drink" &&
          row.priceGbp === 2 &&
          !row.drinkLabel,
      ),
    ).toHaveLength(0);
    expect(
      rows.filter(
        (row) =>
          row.host === "owlandpussycatshoreditch.com" &&
          row.category === "soft-drink" &&
          row.priceGbp === 4.5 &&
          !row.drinkLabel,
      ),
    ).toHaveLength(0);
  });

  it("withdraws each known misclassification with identity and reason", () => {
    expect(reconciliation.knownMisclassifiedWithdrawals).toHaveLength(19);
    for (const withdrawal of reconciliation.knownMisclassifiedWithdrawals) {
      expect(withdrawal.disposition).toBe("withdraw");
      expect(withdrawal.after).toBeNull();
      expect(withdrawal.reason.trim().length).toBeGreaterThan(0);
      expect(currentIdentityHashes.has(withdrawal.before.sha256)).toBe(false);
    }
    expect(
      reconciliation.knownMisclassifiedWithdrawals.filter((withdrawal) =>
        /Crabbies Alcoholic ginger beer 3\.4%/i.test(
          withdrawal.before.drinkLabel ?? "",
        ),
      ),
    ).toHaveLength(1);
  });

  it("records the later Sydney source refresh without rewriting the withdrawal audit", () => {
    const publication = reconciliation.postReconciliationPublication;
    expect(publication.sourceCaptureSha256).toBe(
      "ab30877e2c6dd5ef6559030fcbb422c4b39719818a788758dc8207a422373c9a",
    );
    expect(publication.sourceObservedAt).toBe("2026-09-29T10:40:17.846Z");
    expect(publication.supersededRowSha256).toBe(
      "fbcc91ed985cdc6506dea865b397e3b621bf731b1009043b1ea5871885a4e4b1",
    );
    const historicalLedger = reconciliation.currentPublication.historicalLedgers.find(
      (ledger) => ledger.sha256 === publication.currentLedger.sha256,
    );
    expect(historicalLedger).toBeDefined();
    const historicalText = readFileSync(join(ROOT, historicalLedger!.path), "utf8");
    const historicalRows = parseSiteHarvestLedgerText(historicalText);
    expect(publication.currentLedger).toEqual({
      sha256: sha256(historicalText),
      rowCount: historicalRows.length,
      rowIdentitySetSha256: identitySetSha256(historicalRows),
    });
    expect(historicalRows.length).toBe(reconciliation.publishedLedger.rowCount - 1 + 24);

    const sourceRows = rows.filter(
      (row) => row.sourceUrl === publication.sourceUrl,
    );
    expect(sourceRows).toHaveLength(24);
    expect(sourceRows.every(
      (row) => row.category === "wine" && row.observedAt === publication.sourceObservedAt,
    )).toBe(true);
    expect(sourceRows.filter((row) => row.servingSize === "125ml")).toHaveLength(12);
    expect(sourceRows.filter((row) => row.servingSize === "250ml")).toHaveLength(12);
    expect(new Set(sourceRows.map((row) => `${row.drinkLabel}|${row.servingSize}`)).size).toBe(24);

    const bundleRows = JSON.parse(
      readFileSync(join(ROOT, "public/data/uk_prices/rows.json"), "utf8"),
    ) as UkPriceBundleRow[];
    const bundledSourceRows = bundleRows.filter(
      (row) => row.sourceUrl === publication.sourceUrl && row.lane === "site-harvest",
    );
    const identity = (row: { drinkLabel?: string; servingSize?: string; priceGbp?: number; observedAt?: string }) =>
      `${row.drinkLabel}|${row.servingSize}|${row.priceGbp}|${row.observedAt}`;
    expect(bundledSourceRows.map(identity).sort()).toEqual(sourceRows.map(identity).sort());
    // This records the September 29 publication, not every later bundle build.
    expect(publication.currentBundle).toEqual({ rowCount: 7607, siteHarvestRows: 3087 });
    const ledgerBundleRows: unknown[] = rows.map(ledgerBundleClaim);
    const validLedgerRows = ledgerBundleRows.filter(isValidUkPriceBundleRow);
    expect(validLedgerRows).toHaveLength(rows.length);
    const quarantined = validLedgerRows.filter(isCategoryQuarantined);
    const current = reconciliation.currentPublication;
    const unresolvedVenueRows = validLedgerRows.filter((row) => row.venueId === "venue-uk-n25496840");
    expect(unresolvedVenueRows.map(claimIdentity).sort()).toEqual([
      JSON.stringify(["https://www.26furnivalstreet.com", "cocktail", 7.5, null, "2026-09-21T18:44:08.866Z", null]),
      JSON.stringify(["https://www.26furnivalstreet.com", "wine", 7.6, "175ml:", "2026-09-21T18:44:08.866Z", null]),
    ].sort());
    expect(unresolvedVenueRows.every((row) => !isCategoryQuarantined(row))).toBe(true);
    expect(loadCuratedUkBaseOwners(ROOT).has("n25496840")).toBe(false);
    for (const row of unresolvedVenueRows) {
      expect(bundleRows.filter((published) => published.lane === "site-harvest").map(claimIdentity))
        .not.toContain(claimIdentity(row));
    }
    expect(quarantined.length + unresolvedVenueRows.length)
      .toBe(current.currentLedger.rowCount - current.currentBundle.siteHarvestRows);
    const historicalQuarantineCount = publication.currentLedger.rowCount - publication.currentBundle.siteHarvestRows;
    expect(historicalQuarantineCount).toBe(19);
    const additionalQuarantines = quarantined.length - historicalQuarantineCount;
    const addedCanonicalRows = rows.length - historicalRows.length;
    const publishedSiteRows = bundleRows.filter((row) => row.lane === "site-harvest");
    const expectedSiteRows = publication.currentBundle.siteHarvestRows + addedCanonicalRows
      - additionalQuarantines - unresolvedVenueRows.length;
    expect(publishedSiteRows).toHaveLength(expectedSiteRows);
    // The October 2 base refresh changed estimates before this publication.
    // Both other lanes must retain their complete pre-publication contents.
    const otherLanes = [
      { lane: "estimate", count: 2950, sha256: "196037f89905bb0d611221677c095d6a6a2e6c91925432a48c40d04141bb4489" },
      { lane: "drink-price-update", count: 1560, sha256: "66c5b9eb3eb5589ffb89811cfc1f8be0ff4ea095b4947a52eaa3cfc3a4b62e13" },
    ];
    for (const lane of otherLanes) {
      const laneRows = bundleRows.filter((row) => row.lane === lane.lane);
      expect(laneRows).toHaveLength(lane.count);
      expect(sha256(laneRows.map((row) => JSON.stringify(row)).sort().join("\n"))).toBe(lane.sha256);
    }
    expect(bundleRows).toHaveLength(expectedSiteRows + otherLanes.reduce((sum, lane) => sum + lane.count, 0));

    // Curated aliases change venue IDs. Every other published claim must still
    // match its source, including the literal serving recovered by the builder.
    const publishedClaims = publishedSiteRows.map(claimIdentity).sort();
    for (const row of quarantined) {
      expect(publishedClaims).not.toContain(claimIdentity(row));
    }
    const unresolvedClaims = new Set(unresolvedVenueRows.map(claimIdentity));
    const retainedClaims = validLedgerRows.filter((row) =>
      !isCategoryQuarantined(row) && !unresolvedClaims.has(claimIdentity(row)),
    )
      .map((row) => {
        const normalized = normalizeSiteHarvestLedgerRow({
          category: row.category, drinkLabel: row.drinkLabel, servingSize: row.servingSize,
        });
        return { ...row,
          ...(normalized.drinkLabel !== undefined ? { drinkLabel: normalized.drinkLabel } : {}),
          ...(normalized.servingSize !== undefined ? { servingSize: normalized.servingSize } : {}),
        };
      })
      .map((row) => ({ ...row, ...bundleDrinkFieldsFromPrintedName(row.drinkLabel ?? null, row.category) }))
      .filter((row) => !isCategoryQuarantined(row))
      .map((row) => claimIdentity({ ...row, servingSize: bundleRowServingSize(row) })).sort();
    expect(publishedClaims).toEqual(retainedClaims);
  });
  it("binds every Albion refresh observation to current publication or an archived newer same-key quote", () => {
    const publications = [
      ...(reconciliation.publicationHistory ?? []), reconciliation.currentPublication,
    ].filter((publication) =>
      publication.sourceLedger.sha256 === "c309a158dc5bff241518cb826b679bc3725fdd7bc762691207b7300739ad9599",
    );
    expect(publications).toHaveLength(1);
    const publication = publications[0];
    const rawText = readFileSync(join(ROOT, publication.sourceLedger.path), "utf8");
    const rawRows = parseSiteHarvestLedgerText(rawText);
    expect(publication.sourceLedger).toEqual({
      path: "data/uk_prices/observations/c309a158dc5bff241518cb826b679bc3725fdd7bc762691207b7300739ad9599.jsonl",
      sha256: "c309a158dc5bff241518cb826b679bc3725fdd7bc762691207b7300739ad9599",
      rowCount: 3282, rowIdentitySetSha256: identitySetSha256(rawRows),
    });
    expect(sha256(rawText)).toBe(publication.sourceLedger.sha256);
    expect(rawRows).toHaveLength(3282);
    const publicationLedgerText = publication.currentLedger.sha256 === sha256(ledgerText)
      ? ledgerText
      : readFileSync(join(ROOT, "data/uk_prices/observations", `${publication.currentLedger.sha256}.jsonl`), "utf8");
    const publicationRows = parseSiteHarvestLedgerText(publicationLedgerText);
    expect(publication.currentLedger).toEqual({
      path: "data/uk_prices/site_harvest.jsonl", sha256: sha256(publicationLedgerText),
      rowCount: 3200, rowIdentitySetSha256: identitySetSha256(publicationRows),
    });
    expect(identitySetSha256(rows)).toBe(publication.currentLedger.rowIdentitySetSha256);
    expect(publication.accounting).toEqual({ sourceRows: 3282, canonicalRows: 3200, supersededRows: 82, unexplainedLosses: 0 });
    expect(publication.supersededRows).toHaveLength(82);
    const owners = loadCuratedUkBaseOwners(ROOT);
    expect(siteHarvestLedgerDuplicateKeys(rows, owners)).toEqual([]);
    const currentByIdentity = new Map(rows.map((row) => [rowIdentitySha256(row), row]));
    const superseded = new Set<string>();
    for (const binding of publication.supersededRows) {
      const before = rawRows[binding.sourceRowNumber - 1];
      const current = currentByIdentity.get(binding.currentSha256);
      expect(before).toBeDefined();
      expect(current).toBeDefined();
      expect(rowIdentitySha256(before)).toBe(binding.beforeSha256);
      expect(siteHarvestLedgerCollectKey(before, owners)).toBe(binding.collectKey);
      expect(siteHarvestLedgerCollectKey(current!, owners)).toBe(binding.collectKey);
      expect(before.observedAt).toBe(binding.beforeObservedAt);
      expect(current!.observedAt).toBe(binding.currentObservedAt);
      expect(binding.currentObservedAt > binding.beforeObservedAt).toBe(true);
      expect(currentIdentityHashes.has(binding.beforeSha256)).toBe(false);
      superseded.add(binding.beforeSha256);
    }
    expect(superseded.size).toBe(82);
    const rawIdentities = rawRows.map(rowIdentitySha256);
    expect(new Set(rawIdentities).size).toBe(3282);
    expect([...new Set([...currentIdentityHashes, ...superseded])].sort()).toEqual(rawIdentities.sort());
    expect(publication.supersededRows.filter((row) => row.beforeObservedAt === "2026-10-01T13:19:29.334Z")).toHaveLength(81);
    expect(publication.supersededRows.filter((row) => row.beforeObservedAt === "2026-09-21T18:35:11.734Z")).toHaveLength(1);
    expect(publication.supersededRows.find((row) => row.beforeSha256 === "b6857ce0558ce035e79674e39b810582c433ab57d57cbceabdd740f7aabbaeda")).toBeDefined();
    const lines = rawText.split(/(?<=\n)/);
    expect(sha256(lines.slice(0, 3198).join(""))).toBe("88bc1995f82ad87a6ebd715d18f0b12a37214b15036127d33d92e6070ec5d3f1");
    expect(sha256(lines.slice(3198).join(""))).toBe("85a7546d5eb684a2b72bf126140c7a30ec9d61bd25a7b6839935b1f828962d34");
    expect(publication.currentBundle).toEqual({
      path: "public/data/uk_prices/rows.json",
      sha256: "c85d4bfb582a5e766ee72607e1e3111485aeb88799c7aee1e299819c2f672c8c",
      rowCount: 7674, siteHarvestRows: 3154,
    });
    const current = reconciliation.currentPublication;
    const bundleText = readFileSync(join(ROOT, current.currentBundle.path), "utf8");
    const bundleRows = JSON.parse(bundleText) as UkPriceBundleRow[];
    expect(current.currentBundle).toEqual({
      path: "public/data/uk_prices/rows.json", sha256: sha256(bundleText), rowCount: bundleRows.length,
      siteHarvestRows: bundleRows.filter((row) => row.lane === "site-harvest").length,
    });
  });

});
