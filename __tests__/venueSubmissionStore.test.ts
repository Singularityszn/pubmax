import { beforeEach, describe, expect, it } from "vitest";

import { defined } from "@/__tests__/helpers/defined";

import {
  __resetVenueSubmissions,
  memoryVenueSubmissionStore as store,
} from "@/lib/venueSubmissionStore";
import {
  VENUE_SUBMISSION_MAX_FILES,
  VENUE_SUBMISSION_MAX_PENDING_PER_ACCOUNT,
  venueSubmissionFileKey,
  type VenueSubmissionFields,
} from "@/lib/venueSubmissions";

const ALICE = "a1111111-1111-4111-8111-111111111111";
const BOB = "b1111111-1111-4111-8111-111111111111";

function fields(owner = ALICE, name = "The Missing Crown"): VenueSubmissionFields {
  return {
    ownerUserId: owner,
    name,
    address: "1 Example Street, London",
    postcode: "SE1 9AA",
    latitude: null,
    longitude: null,
    website: "",
    menuUrl: "",
    openingHours: "",
    note: "",
    prices: [{ drinkCategory: "beer", drinkName: "", priceGbp: 5.2, measure: "pint" }],
  };
}

async function created(owner = ALICE, name?: string) {
  const result = await store.create(fields(owner, name));
  if (result.status !== "created") throw new Error("expected a created submission");
  return result.submission;
}

function file(owner: string, submissionId: string, id: string) {
  return {
    id,
    submissionId,
    ownerUserId: owner,
    objectKey: venueSubmissionFileKey(owner, submissionId, id, "image"),
    kind: "image" as const,
    contentType: "image/jpeg" as const,
    byteSize: 1024,
    sha256: "a".repeat(64),
  };
}

beforeEach(() => {
  __resetVenueSubmissions();
});

describe("memory venue submission store", () => {
  it("creates a pending submission and lists it for its owner alone", async () => {
    const submission = await created();
    expect(submission).toMatchObject({ status: "pending", duplicateOfVenueId: null, files: [] });
    expect((await store.listForOwner(ALICE)).submissions.map((row) => row.id)).toEqual([submission.id]);
    expect((await store.listForOwner(BOB)).submissions).toEqual([]);
  });

  it("stops an account at its pending cap, and a decided one frees a slot", async () => {
    const first = await created();
    for (let i = 1; i < VENUE_SUBMISSION_MAX_PENDING_PER_ACCOUNT; i += 1) await created(ALICE, `Pub ${i}`);
    expect((await store.create(fields())).status).toBe("too_many_pending");
    expect((await store.create(fields(BOB))).status).toBe("created");
    expect(await store.decide(first.id, { status: "declined", note: null })).toBe(true);
    expect((await store.create(fields())).status).toBe("created");
  });

  it("reads a pending submission for its owner only", async () => {
    const submission = await created();
    expect(await store.getPendingForOwner(ALICE, submission.id)).not.toBeNull();
    expect(await store.getPendingForOwner(BOB, submission.id)).toBeNull();
    await store.decide(submission.id, { status: "accepted", note: null });
    expect(await store.getPendingForOwner(ALICE, submission.id)).toBeNull();
  });

  it("attaches files up to the cap, and never to another account's submission", async () => {
    const submission = await created();
    expect((await store.addFile(file(BOB, submission.id, "x"))).status).toBe("not_found");
    for (let i = 0; i < VENUE_SUBMISSION_MAX_FILES; i += 1) {
      expect((await store.addFile(file(ALICE, submission.id, `f${i}`))).status).toBe("added");
    }
    expect((await store.addFile(file(ALICE, submission.id, "extra"))).status).toBe("too_many_files");
    expect((await store.getById(submission.id))?.files).toHaveLength(VENUE_SUBMISSION_MAX_FILES);
  });

  it("decides a pending submission once, and lists it under its new status", async () => {
    const submission = await created();
    expect(await store.decide(submission.id, {
      status: "duplicate",
      duplicateOfVenueId: "venue-uk-n1",
      note: "Already on the map.",
    })).toBe(true);
    expect(await store.decide(submission.id, { status: "accepted", note: null })).toBe(false);
    expect(await store.decide("missing", { status: "accepted", note: null })).toBe(false);
    const duplicate = defined((await store.listForReview("duplicate"))[0]);
    expect(duplicate).toMatchObject({ id: submission.id, duplicateOfVenueId: "venue-uk-n1", reviewerNote: "Already on the map." });
    expect(duplicate.reviewedAt).not.toBeNull();
    expect(await store.listForReview("pending")).toEqual([]);
  });

  it("hands back copies, so a caller cannot edit stored rows", async () => {
    const submission = await created();
    defined(submission.prices[0]).priceGbp = 99;
    submission.name = "Edited";
    const stored = await store.getById(submission.id);
    expect(stored?.prices[0]?.priceGbp).toBe(5.2);
    expect(stored?.name).toBe("The Missing Crown");
  });
});
