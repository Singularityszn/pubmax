// The public half of the captain's ruling of 5 September 2026: "We keep the
// prices, but we remember these accounts and what they have logged in."
//
// Verification scout verify-preview-4 (sections 7.3, 10 and 13) measured the
// gap. A throwaway account deleted itself through the product, its two Pint
// Drops stayed on the map exactly as they should, and both were still printed
// under the retired handle `vp4qa39758`, one of them leading the Blackfriar
// sheet on production.
//
// Migration 0150 stamps `author_retired_at` on every lane that prints a
// contributor handle to a stranger. This file holds the READING half: each
// lane's ONE public projection, and the rule they all share
// (`lib/retiredContributor.ts`). The private ledger and the stamping itself are
// proved against a real PostgreSQL 16 in
// `__tests__/accountRetentionLedgerMigrationEffective.test.ts`.

import { describe, expect, it } from "vitest";

import { ANON_HANDLE_LABEL } from "@/lib/pintDropShared";
import {
  toDTO,
  toModeratorDTO,
  type PersistableDrop,
} from "@/lib/pintDropsStore";
import {
  RETIRED_CONTRIBUTOR_LABEL,
  authorRetiredAtFromRow,
  contributorHasRetired,
  publicContributorHandle,
} from "@/lib/retiredContributor";
import { toVisitReportDTO, type VisitReport } from "@/lib/visitReports";
import {
  published,
  type StoredWeatherRecommendation,
} from "@/lib/weatherRecommendationStore";

const RETIRED_AT = "2026-09-06T09:00:00.000Z";

function drop(overrides: Partial<PersistableDrop> = {}): PersistableDrop {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    venueId: "venue-1vle947",
    handle: "vp4qa39758",
    drink: "Lager",
    measure: "pint",
    priceGbp: 4.5,
    passedDownNote: "",
    era: "",
    provenance: "contributor",
    status: "visible",
    visibility: "public",
    createdAt: "2026-09-01T18:30:00.000Z",
    authorityKey: "venue-1vle947:abc",
    ...overrides,
  } as PersistableDrop;
}

function report(overrides: Partial<VisitReport> = {}): VisitReport {
  return {
    id: "22222222-2222-4222-8222-222222222222",
    venueId: "venue-1vle947",
    handle: "vp4qa39758",
    visitedAt: "2026-09-01",
    busyness: "steady",
    noise: null,
    seating: null,
    serviceWait: null,
    note: "Quiet corner by the window.",
    status: "visible",
    createdAt: "2026-09-01T22:10:00.000Z",
    ...overrides,
  };
}

function recommendation(
  overrides: Partial<StoredWeatherRecommendation> = {},
): StoredWeatherRecommendation {
  return {
    id: "33333333-3333-4333-8333-333333333333",
    venueId: "venue-1vle947",
    condition: "raining",
    reason: "The back room stays dry and the fire is on.",
    contributorHandle: "vp4qa39758",
    submittedAt: Date.parse("2026-09-01T19:00:00.000Z"),
    source: "community",
    actorHash: "hash",
    status: "visible",
    ...overrides,
  };
}

describe("the retirement rule", () => {
  it("spends the label an anonymous contribution already wears", () => {
    // One idea, one vocabulary: a second string would drift from this one
    // within a release.
    expect(RETIRED_CONTRIBUTOR_LABEL).toBe(ANON_HANDLE_LABEL);
  });

  it("reads absent, null and blank as a live author", () => {
    expect(contributorHasRetired(undefined)).toBe(false);
    expect(contributorHasRetired(null)).toBe(false);
    expect(contributorHasRetired("   ")).toBe(false);
    expect(contributorHasRetired(RETIRED_AT)).toBe(true);
  });

  it("substitutes the handle only for a retired author", () => {
    expect(publicContributorHandle("tester", undefined)).toBe("tester");
    expect(publicContributorHandle("tester", RETIRED_AT)).toBe(
      RETIRED_CONTRIBUTOR_LABEL,
    );
  });

  it("takes the stamp off a row, and undefined for a column that is not there", () => {
    // A cluster without 0150 answers no column at all, which is a live author.
    expect(authorRetiredAtFromRow(undefined)).toBeUndefined();
    expect(authorRetiredAtFromRow(null)).toBeUndefined();
    expect(authorRetiredAtFromRow("")).toBeUndefined();
    expect(authorRetiredAtFromRow(RETIRED_AT)).toBe(RETIRED_AT);
  });
});

describe("a Pint Drop from a departed account", () => {
  it("keeps its price, its measure and its date, and loses the handle", () => {
    const dto = toDTO(drop({ authorRetiredAt: RETIRED_AT }));
    expect(dto.handle).toBe(RETIRED_CONTRIBUTOR_LABEL);
    expect(dto.priceGbp).toBe(4.5);
    expect(dto.measure).toBe("pint");
    expect(dto.createdAt).toBe("2026-09-01T18:30:00.000Z");
    expect(dto.venueId).toBe("venue-1vle947");
    expect(dto.id).toBe("11111111-1111-4111-8111-111111111111");
  });

  it("keeps its authority key, so no trust state is demoted by a departure", () => {
    // The captain's ruling is about a NAME. A lone drop stays lone, a
    // corroborated pair stays corroborated, and the key is what the map's own
    // independence rule reads.
    const dto = toDTO(drop({ authorRetiredAt: RETIRED_AT }));
    expect(dto.authorityKey).toBe("venue-1vle947:abc");
  });

  it("does not tell the reader WHY the name is withheld", () => {
    const dto = toDTO(drop({ authorRetiredAt: RETIRED_AT })) as Record<string, unknown>;
    expect(dto.authorRetiredAt).toBeUndefined();
  });

  it("still names its author to a moderator, who has to know whose price it is", () => {
    const moderator = toModeratorDTO(drop({ authorRetiredAt: RETIRED_AT }));
    expect(moderator.handle).toBe("vp4qa39758");
  });

  it("leaves a live author alone", () => {
    expect(toDTO(drop()).handle).toBe("vp4qa39758");
  });

  it("withholds an anonymous drop by its own older rule, retired or not", () => {
    expect(toDTO(drop({ visibility: "anonymous" })).handle).toBe(ANON_HANDLE_LABEL);
    expect(
      toDTO(drop({ visibility: "anonymous", authorRetiredAt: RETIRED_AT })).handle,
    ).toBe(ANON_HANDLE_LABEL);
  });
});

describe("a Visit Report from a departed account", () => {
  it("keeps the visit date and every observation, and loses the handle", () => {
    const dto = toVisitReportDTO(report({ authorRetiredAt: RETIRED_AT }));
    expect(dto.handle).toBe(RETIRED_CONTRIBUTOR_LABEL);
    expect(dto.visitedAt).toBe("2026-09-01");
    expect(dto.busyness).toBe("steady");
    expect(dto.note).toBe("Quiet corner by the window.");
    expect(dto.createdAt).toBe("2026-09-01T22:10:00.000Z");
  });

  it("does not carry the stamp into the public shape", () => {
    const dto = toVisitReportDTO(
      report({ authorRetiredAt: RETIRED_AT }),
    ) as Record<string, unknown>;
    expect(dto.authorRetiredAt).toBeUndefined();
  });

  it("leaves a live author alone", () => {
    expect(toVisitReportDTO(report()).handle).toBe("vp4qa39758");
  });
});

describe("a Recommendation from a departed account", () => {
  it("keeps its words and its date, and loses the handle", () => {
    const dto = published(recommendation({ authorRetiredAt: RETIRED_AT }));
    expect(dto.contributorHandle).toBe(RETIRED_CONTRIBUTOR_LABEL);
    expect(dto.reason).toBe("The back room stays dry and the fire is on.");
    expect(dto.submittedAt).toBe(Date.parse("2026-09-01T19:00:00.000Z"));
  });

  it("leaves a live author alone", () => {
    expect(published(recommendation()).contributorHandle).toBe("vp4qa39758");
  });
});
