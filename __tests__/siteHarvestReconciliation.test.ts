import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { defined } from "@/__tests__/helpers/defined";
import {
  parseSiteHarvestLedgerText,
  type SiteHarvestLedgerRow,
} from "@/lib/siteHarvestLedgerCore";
import { isHarvestableDrinkUpdateUrl } from "@/lib/harvest/sourcePolicy";
import { pageNamesAnotherBranch } from "@/lib/harvest/ukPriceCrawl";
import { isCategoryQuarantined, type UkPriceBundleRow } from "@/lib/ukPriceBundle";

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
  laterPublications: Array<{
    sourceEvidencePath: string;
    sourceEvidenceSha256: string;
    sourceUrl: string;
    sourceObservedAt: string;
    addedRows: number;
    currentLedger: { sha256: string; rowCount: number; rowIdentitySetSha256: string };
    currentBundle: { rowCount: number; siteHarvestRows: number };
  }>;
  /**
   * Bundle rows the builder stopped publishing under a recorded rule. Each
   * row stays in the ledger; the bundle counts are those after the withdrawal.
   */
  bundleWithdrawals?: Array<{
    decidedOn: string;
    rule: string;
    reason: "source-page-names-another-branch" | "insufficient-pint-evidence" | "truncated-menu-price";
    note: string;
    /** How many later publications were recorded when this was decided. */
    afterLaterPublications: number;
    rows: RowIdentity[];
    historicalBundle: { rowCount: number; siteHarvestRows: number };
    currentBundle: { rowCount: number; siteHarvestRows: number };
  }>;
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

describe("site-harvest withdrawal reconciliation", () => {
  const ledgerText = readFileSync(LEDGER_PATH, "utf8");
  const rows = parseSiteHarvestLedgerText(ledgerText);
  const reconciliation = JSON.parse(
    readFileSync(REPORT_PATH, "utf8"),
  ) as Reconciliation;
  const currentIdentityHashes = new Set(rows.map(rowIdentitySha256));

  it("withdraws unbound and misclassified November menu observations from every published record", () => {
    const bundleRows = JSON.parse(
      readFileSync(join(ROOT, "public/data/uk_prices/rows.json"), "utf8"),
    ) as UkPriceBundleRow[];
    const publications = reconciliation.laterPublications.filter(
      (publication) => publication.sourceObservedAt.startsWith("2026-11-22"),
    );
    const evidenceRows = publications.flatMap((publication) =>
      (JSON.parse(readFileSync(join(ROOT, publication.sourceEvidencePath), "utf8")) as {
        rows: SiteHarvestLedgerRow[];
      }).rows,
    );
    const withdrawnObservations = [
      ["crownofbromley.co.uk", "Bombay Aloo"],
      ["crownofbromley.co.uk", "Tequila Sunrise"],
      ["crownofbromley.co.uk", "Champagne Bellini"],
      ["richardthefirst.co.uk", "Blood Orange Paloma"],
      ["richardthefirst.co.uk", "Pomegranate Gin Fizz"],
      ["richardthefirst.co.uk", "Raspberry & Rose"],
      ["thealbionpub.com", "MORETTI 0.0"],
      ["thealbionpub.com", "TEQUILA ROSE"],
      ["thebearoxshott.co.uk", "Gin Fizz"],
      ["thebearoxshott.co.uk", "Raspberry & Rose"],
      ["theprincealfred.com", "Mixed Heritage Squash"],
      ["georgeanddragonacton.co.uk", "The Wrong-Un Cabernet Sauvignon / Shiraz, Australia"],
    ].map(([host, label]) => `${host}|${label?.toLowerCase()}`);
    const unboundUrl = "https://www.mr-foggs.com/mr-foggs-hat-tavern/menus/";
    expect(publications.some((publication) => publication.sourceUrl === unboundUrl)).toBe(false);
    for (const representation of [rows, bundleRows, evidenceRows]) {
      const additions = representation.filter((row) => row.observedAt?.startsWith("2026-11-22"));
      expect(additions.filter((row) => row.sourceUrl === unboundUrl)).toEqual([]);
      expect(additions.filter((row) => withdrawnObservations.includes(
        `${hostOf(row.sourceUrl ?? undefined)}|${(row.drinkLabel ?? "").replace(/\s*\|$/, "").toLowerCase()}`,
      ))).toEqual([]);
    }
  });

  it("publishes every supported George and Dragon wine column with its printed measure", () => {
    const sourceUrl = "https://georgeanddragonacton.co.uk/drinks-menu";
    const observedAt = "2026-11-22T18:02:31.584Z";
    const menu: Array<[string, number[]]> = [
      ["Rosso Babalù, Sicily, Italy", [4.5, 8.2, 24]],
      ["Beppe Morchetta Merlot, Italy", [4.55, 8.8, 25]],
      ["Cinco Fincas Malbec, Argentina", [5.45, 10.9, 31]],
      ["Acid Crat Negru de Purcari, Moldova", [5.8, 11.8, 34]],
      ["Neropasso Biscardo, Veneto, Italy", [5.8, 11.8, 34]],
      ["Burlesque Zinfandel, USA", [4.5, 8.5, 24]],
      ["Cinsault Rosé, France", [5, 9.45, 28]],
    ];
    const measures = ["125ml", "250ml", "bottle"];
    const expected = menu.flatMap(([drinkLabel, prices]) => prices.map((priceGbp, index) => ({
      drinkLabel, priceGbp, servingSize: measures[index], category: "wine",
    })));
    expected.push(
      { drinkLabel: "Le Dolci Colline Prosecco", priceGbp: 5.1, servingSize: "125ml", category: "wine" },
      { drinkLabel: "Le Dolci Colline Prosecco", priceGbp: 30, servingSize: "bottle", category: "wine" },
    );
    const publication = defined(reconciliation.laterPublications.find((item) =>
      item.sourceUrl === sourceUrl && item.sourceObservedAt === observedAt,
    ));
    const evidence = JSON.parse(readFileSync(join(ROOT, publication.sourceEvidencePath), "utf8")) as {
      rows: Array<SiteHarvestLedgerRow & { renderer: string }>;
    };
    const bundleRows = JSON.parse(
      readFileSync(join(ROOT, "public/data/uk_prices/rows.json"), "utf8"),
    ) as UkPriceBundleRow[];
    const identity = (row: Pick<SiteHarvestLedgerRow, "drinkLabel" | "priceGbp" | "servingSize" | "category">) => JSON.stringify({
      drinkLabel: row.drinkLabel, priceGbp: row.priceGbp, servingSize: row.servingSize, category: row.category,
    });
    for (const representation of [rows, bundleRows, evidence.rows]) {
      const sourceRows = representation.filter((row) => row.sourceUrl === sourceUrl && row.observedAt === observedAt);
      expect(sourceRows.map(identity).sort()).toEqual(expected.map(identity).sort());
    }
    expect(evidence.rows.every((row) => row.host === "georgeanddragonacton.co.uk" &&
      row.venueId === "venue-uk-n302172067" && row.renderer === "tavily",
    )).toBe(true);
  });

  it("preserves the Crown bottled servings in each published representation", () => {
    const sourceUrl = "https://crownofbromley.co.uk/wp-content/uploads/2025/05/Crown-of-Bromley-Menu-2025-Online.pdf";
    const publication = defined(reconciliation.laterPublications.find((item) => item.sourceUrl === sourceUrl));
    const saved = JSON.parse(readFileSync(join(ROOT, publication.sourceEvidencePath), "utf8")) as {
      rows: SiteHarvestLedgerRow[];
    };
    const bundleRows = JSON.parse(readFileSync(join(ROOT, "public/data/uk_prices/rows.json"), "utf8")) as UkPriceBundleRow[];
    for (const representation of [rows, saved.rows, bundleRows]) {
      const bottles = representation.filter((row) => row.sourceUrl === sourceUrl &&
        row.observedAt?.startsWith("2026-11-22") && ["Guiness 0%", "Heineken", "Heineken 0%", "Koppaberg 0% (500ml)", "Peroni 0%", "Stella"].includes(row.drinkLabel ?? ""));
      expect(bottles.sort((left, right) => (left.drinkLabel ?? "").localeCompare(right.drinkLabel ?? ""))
        .map((row) => [row.drinkLabel, row.priceGbp, row.servingSize])).toEqual([
        ["Guiness 0%", 4.85, "bottle"], ["Heineken", 4.35, "bottle"], ["Heineken 0%", 3.85, "bottle"],
        ["Koppaberg 0% (500ml)", 4.3, "500ml bottle"], ["Peroni 0%", 3.85, "bottle"], ["Stella", 4.35, "bottle"],
      ]);
    }
  });

  it("publishes the drinks recovered under explicit saved headings", () => {
    const expectations = [
      ["themarquess.co.uk", "Flat White", "coffee", 3.75],
      ["themarquess.co.uk", "Birchall Tea", "other", 3.5],
      ["themarquess.co.uk", "Hot Chocolate", "other", 4.25],
      ["thedukeofcambridge.com", "Winter Sangria", "cocktail", 11.5],
      ["thedukeofcambridge.com", "Yuzu Honeybee", "cocktail", 13],
      ["thedukeofcambridge.com", "Picante Spritz", "cocktail", 12.5],
      ["ballsbrothersminstercourt.co.uk", "Jungle Bird", "cocktail", 12.5],
      ["croftonparktavern.co.uk", "Golden Fig", "cocktail", 11.5],
      ["mr-foggs.com", "Manhattan", "cocktail", 14.5],
      ["richardthefirst.co.uk", "Yuzu Honeybee", "cocktail", 13],
      ["thebearoxshott.co.uk", "Winter Sangria", "cocktail", 12],
    ];
    const bundleRows = JSON.parse(readFileSync(join(ROOT, "public/data/uk_prices/rows.json"), "utf8")) as UkPriceBundleRow[];
    for (const [host, drinkLabel, category, priceGbp] of expectations) {
      for (const representation of [rows, bundleRows]) {
        expect(representation.filter((row) => hostOf(row.sourceUrl ?? undefined) === host &&
          row.observedAt?.startsWith("2026-11-22") && row.drinkLabel === drinkLabel)).toEqual([
          expect.objectContaining({ drinkLabel, category, priceGbp }),
        ]);
      }
    }
  });

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
    for (const hash of retainedHashes) {
      expect(currentIdentityHashes.has(hash)).toBe(
        hash !== reconciliation.postReconciliationPublication.supersededRowSha256,
      );
    }
    for (const row of audit.rows.filter((item) => item.disposition === "retain")) {
      expect(isHarvestableDrinkUpdateUrl(row.sourceUrl)).toBe(true);
    }
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

  it("accounts for each later publication without replacing the historical ledger", () => {
    const lines = ledgerText.trimEnd().split("\n");
    let previousCount = reconciliation.postReconciliationPublication.currentLedger.rowCount;
    for (const publication of reconciliation.laterPublications) {
      const evidenceText = readFileSync(join(ROOT, publication.sourceEvidencePath), "utf8");
      const evidence = JSON.parse(evidenceText) as { rows: SiteHarvestLedgerRow[] };
      expect(sha256(evidenceText)).toBe(publication.sourceEvidenceSha256);
      expect(publication.currentLedger.rowCount).toBe(previousCount + publication.addedRows);
      const additions = rows.slice(previousCount, publication.currentLedger.rowCount);
      expect(additions).toEqual(evidence.rows);
      expect(additions).toHaveLength(publication.addedRows);
      expect(additions.every((row) =>
        row.sourceUrl === publication.sourceUrl && row.observedAt === publication.sourceObservedAt,
      )).toBe(true);
      const publicationText = `${lines.slice(0, publication.currentLedger.rowCount).join("\n")}\n`;
      expect(publication.currentLedger).toEqual({
        sha256: sha256(publicationText),
        rowCount: parseSiteHarvestLedgerText(publicationText).length,
        rowIdentitySetSha256: identitySetSha256(parseSiteHarvestLedgerText(publicationText)),
      });
      previousCount = publication.currentLedger.rowCount;
    }
    expect(rows.length).toBe(previousCount);
    const latest = reconciliation.laterPublications.at(-1);
    expect(latest).toBeDefined();
    // A bundle withdrawal recorded after the last publication is the newest
    // record of the bundle.
    const withdrawal = reconciliation.bundleWithdrawals?.at(-1);
    const latestBundle =
      withdrawal && withdrawal.afterLaterPublications === reconciliation.laterPublications.length
        ? withdrawal.currentBundle
        : latest?.currentBundle;
    const bundleRows = JSON.parse(readFileSync(join(ROOT, "public/data/uk_prices/rows.json"), "utf8")) as Array<{ lane: string }>;
    // Only the site-harvest count is this audit's to hold. The modelled
    // estimates follow the base layer and the Guinndex lane is its own, so the
    // bundle's total moves without any site-harvest publication.
    expect(latestBundle?.siteHarvestRows).toBe(bundleRows.filter((row) => row.lane === "site-harvest").length);
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
    const historicalLines = ledgerText.trimEnd().split("\n").slice(0, publication.currentLedger.rowCount);
    const historicalRows = parseSiteHarvestLedgerText(`${historicalLines.join("\n")}\n`);
    expect(publication.currentLedger).toEqual({
      sha256: sha256(`${historicalLines.join("\n")}\n`),
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
    ) as Array<{
      sourceUrl: string | null;
      lane: string;
      drinkLabel?: string;
      servingSize?: string;
      priceGbp: number;
      observedAt: string;
    }>;
    const bundledSourceRows = bundleRows.filter(
      (row) => row.sourceUrl === publication.sourceUrl && row.lane === "site-harvest",
    );
    const identity = (row: { drinkLabel?: string; servingSize?: string; priceGbp?: number; observedAt?: string }) =>
      `${row.drinkLabel}|${row.servingSize}|${row.priceGbp}|${row.observedAt}`;
    expect(bundledSourceRows.map(identity).sort()).toEqual(sourceRows.map(identity).sort());
    // A later publication is its URL AT its observation time: a dated
    // re-observation of a historical URL leaves that URL's earlier rows historical.
    const laterSources = new Set(
      reconciliation.laterPublications.map((later) => `${later.sourceUrl}|${later.sourceObservedAt}`),
    );
    const historicalBundle = bundleRows.filter(
      (row) => !laterSources.has(`${row.sourceUrl ?? ""}|${row.observedAt}`),
    );
    // A recorded bundle withdrawal is the one way the historical bundle may
    // shrink after this publication; the publication's own counts stay as
    // they were recorded.
    const historicalCounts =
      reconciliation.bundleWithdrawals?.at(-1)?.historicalBundle ?? publication.currentBundle;
    // As above, only the site-harvest count is held to the record.
    expect(historicalCounts.siteHarvestRows).toBe(historicalBundle.filter((row) => row.lane === "site-harvest").length);
  });

  it("withdraws a bundle row only under a recorded rule, and keeps it in the ledger", () => {
    const ledgerByIdentity = new Map(rows.map((row) => [rowIdentitySha256(row), row]));
    const bundleRows = JSON.parse(
      readFileSync(join(ROOT, "public/data/uk_prices/rows.json"), "utf8"),
    ) as UkPriceBundleRow[];
    const laterSources = new Set(
      reconciliation.laterPublications.map((later) => `${later.sourceUrl}|${later.sourceObservedAt}`),
    );
    let historical = reconciliation.postReconciliationPublication.currentBundle;
    let previous: NonNullable<Reconciliation["bundleWithdrawals"]>[number] | null = null;
    for (const withdrawal of reconciliation.bundleWithdrawals ?? []) {
      expect(withdrawal.rows.length).toBeGreaterThan(0);
      for (const identity of withdrawal.rows) {
        const ledgerRow = defined(ledgerByIdentity.get(identity.sha256), `ledger row ${identity.sha256}`);
        expect(ledgerRow).toMatchObject({
          host: identity.host,
          venueId: identity.venueId,
          category: identity.category,
          priceGbp: identity.priceGbp,
          sourceUrl: identity.sourceUrl,
          observedAt: identity.observedAt,
        });
        expect(ledgerRow.drinkLabel ?? null).toBe(identity.drinkLabel);
        if (withdrawal.reason === "source-page-names-another-branch") {
          expect(pageNamesAnotherBranch(identity.sourceUrl ?? "", { name: ledgerRow.name ?? null })).toBe(true);
        } else {
          expect(["insufficient-pint-evidence", "truncated-menu-price", "category-contradicts-the-page"]).toContain(
            withdrawal.reason,
          );
          expect(isCategoryQuarantined({
            venueId: defined(ledgerRow.venueId),
            name: ledgerRow.name ?? null,
            category: defined(ledgerRow.category),
            priceGbp: defined(ledgerRow.priceGbp),
            lane: "site-harvest",
            standing: "listed",
            sourceUrl: ledgerRow.sourceUrl ?? null,
            publisher: ledgerRow.host ?? null,
            observedAt: defined(ledgerRow.observedAt),
            basis: null,
            sampleSize: null,
            drinkLabel: ledgerRow.drinkLabel,
          })).toBe(true);
        }
        expect(bundleRows.some((row) =>
          row.lane === "site-harvest" &&
          row.sourceUrl === identity.sourceUrl &&
          row.observedAt === identity.observedAt &&
          row.category === identity.category &&
          row.priceGbp === identity.priceGbp &&
          (row.drinkLabel ?? null) === identity.drinkLabel,
        )).toBe(false);
      }
      // Each recorded row was one published bundle row.
      const base =
        previous && previous.afterLaterPublications === withdrawal.afterLaterPublications
          ? previous.currentBundle
          : reconciliation.laterPublications[withdrawal.afterLaterPublications - 1]?.currentBundle ??
            reconciliation.postReconciliationPublication.currentBundle;
      expect(withdrawal.currentBundle).toEqual({
        rowCount: base.rowCount - withdrawal.rows.length,
        siteHarvestRows: base.siteHarvestRows - withdrawal.rows.length,
      });
      const historicalRows = withdrawal.rows.filter(
        (identity) => !laterSources.has(`${identity.sourceUrl ?? ""}|${identity.observedAt ?? ""}`),
      ).length;
      expect(withdrawal.historicalBundle).toEqual({
        rowCount: historical.rowCount - historicalRows,
        siteHarvestRows: historical.siteHarvestRows - historicalRows,
      });
      historical = withdrawal.historicalBundle;
      previous = withdrawal;
    }
  });
});
