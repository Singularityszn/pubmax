import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  parseSiteHarvestLedgerText,
  type SiteHarvestLedgerRow,
} from "@/lib/siteHarvestLedgerCore";
import { isHarvestableDrinkUpdateUrl } from "@/lib/harvest/sourcePolicy";

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
    const bundleRows = JSON.parse(readFileSync(join(ROOT, "public/data/uk_prices/rows.json"), "utf8")) as Array<{ lane: string }>;
    expect(latest?.currentBundle).toEqual({
      rowCount: bundleRows.length,
      siteHarvestRows: bundleRows.filter((row) => row.lane === "site-harvest").length,
    });
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
    const laterSources = new Set(reconciliation.laterPublications.map((later) => later.sourceUrl));
    const historicalBundle = bundleRows.filter((row) => !laterSources.has(row.sourceUrl ?? ""));
    expect(publication.currentBundle).toEqual({
      rowCount: historicalBundle.length,
      siteHarvestRows: historicalBundle.filter((row) => row.lane === "site-harvest").length,
    });
  });
});
