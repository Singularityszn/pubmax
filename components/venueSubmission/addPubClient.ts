"use client";

// Client plumbing for Add a pub: the account-bound proposal, one menu file per
// request, and the list of pubs the account has added.

import { accountBoundFetch, type AccountAuthSnapshot } from "@/lib/accountBoundFetch";
import { errorMessageFrom, offlineOrMessage } from "@/lib/apiErrorMessage";
import { discardBody } from "@/lib/responseBody";
import {
  readContributionGateStatus,
  type ContributionGateStatus,
} from "@/lib/contributionGateStatus";
import type { ExistingVenueMatch, VenueSubmissionOwnerDTO } from "@/lib/venueSubmissions";

export type AddPubDraft = {
  name: string;
  address: string;
  postcode: string;
  website: string;
  menuUrl: string;
  openingHours: string;
  note: string;
  prices: { drinkCategory: string; drinkName: string; priceGbp: string; measure: string }[];
};

export type AddPubResult =
  | { ok: true; submission: VenueSubmissionOwnerDTO }
  | { ok: false; kind: "matches"; matches: ExistingVenueMatch[] }
  | { ok: false; kind: "gate"; status: ContributionGateStatus; error: string }
  | { ok: false; kind: "error"; error: string; field?: string };

type ErrorBody = {
  error?: unknown;
  code?: unknown;
  status?: unknown;
  details?: { field?: unknown; matches?: unknown };
  submission?: VenueSubmissionOwnerDTO;
};

const SEND_FAILED = "Couldn't send this pub just now.";

function readMatches(value: unknown): ExistingVenueMatch[] {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (row): row is ExistingVenueMatch =>
      Boolean(row)
      && typeof (row as ExistingVenueMatch).venueId === "string"
      && typeof (row as ExistingVenueMatch).venueName === "string",
  );
}

export async function postAddPub(
  draft: AddPubDraft,
  auth: AccountAuthSnapshot,
  confirmNew: boolean,
): Promise<AddPubResult> {
  let res: Response;
  try {
    res = await accountBoundFetch(auth, "/api/venue-submissions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...draft, confirmNew }),
    });
  } catch {
    return { ok: false, kind: "error", error: offlineOrMessage(SEND_FAILED) };
  }
  const body = (await res.json().catch(() => ({}))) as ErrorBody;
  if (res.ok && body.submission) return { ok: true, submission: body.submission };
  if (body.code === "POSSIBLE_MATCH") {
    return { ok: false, kind: "matches", matches: readMatches(body.details?.matches) };
  }
  const status = readContributionGateStatus(body.status);
  if (status) return { ok: false, kind: "gate", status, error: errorMessageFrom(body, SEND_FAILED) };
  return {
    ok: false,
    kind: "error",
    error: errorMessageFrom(body, SEND_FAILED),
    ...(typeof body.details?.field === "string" ? { field: body.details.field } : {}),
  };
}

export type MenuUploadResult = { ok: true } | { ok: false; error: string };

export async function uploadMenuFile(
  submissionId: string,
  file: File,
  auth: AccountAuthSnapshot,
): Promise<MenuUploadResult> {
  const form = new FormData();
  form.set("submission", submissionId);
  form.set("file", file);
  try {
    const res = await accountBoundFetch(auth, "/api/venue-submissions", { method: "POST", body: form });
    if (res.ok) {
      discardBody(res);
      return { ok: true };
    }
    const body = (await res.json().catch(() => ({}))) as ErrorBody;
    return { ok: false, error: errorMessageFrom(body, `Couldn't add ${file.name}.`) };
  } catch {
    return { ok: false, error: offlineOrMessage(`Couldn't add ${file.name}.`) };
  }
}

export async function listMyAddedPubs(auth: AccountAuthSnapshot): Promise<VenueSubmissionOwnerDTO[]> {
  try {
    const res = await accountBoundFetch(auth, "/api/venue-submissions", { method: "GET" });
    const body = (await res.json().catch(() => ({}))) as { submissions?: VenueSubmissionOwnerDTO[] };
    return Array.isArray(body.submissions) ? body.submissions : [];
  } catch {
    return [];
  }
}
