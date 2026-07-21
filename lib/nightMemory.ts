import { cleanText } from "@/lib/textClean";

export const NIGHT_MOMENT_KINDS = [
  "photo",
  "pint_drop",
  "event",
  "venue",
  "quote",
  "person",
  "side_quest",
] as const;

export type NightMomentKind = (typeof NIGHT_MOMENT_KINDS)[number];
export type NightStoryVisibility = "private" | "unlisted" | "public";
export type NightStoryStatus = "draft" | "published";
export type StoryContributorRole = "host" | "editor" | "contributor";
// "withdrawn" (Wayfinder 5.5) marks a contributor who has departed a published
// Story — via consent withdrawal or account deletion — so the publish gate can
// redact their content + identity. It is additive: it never frees the host slot
// (the host-uniqueness index keys off `status <> 'removed'`), and it is distinct
// from "removed" (an invitation declined / a member kicked before publish).
export type StoryContributorStatus = "invited" | "accepted" | "removed" | "withdrawn";
export type MomentConsentStatus = "pending" | "approved" | "withdrawn";

export type NightMomentDraft = {
  kind: NightMomentKind;
  caption: string;
  pintDropId: string | null;
  venueId: string | null;
  mediaObjectKey: string | null;
  occurredAt: string | null;
  visibility: "private";
};

export type NightMoment = NightMomentDraft & {
  id: string;
  memoryId: string;
  ownerId: string;
  createdAt: string;
};

export type PintDropMoment = NightMoment & {
  kind: "pint_drop";
  pintDropId: string;
};

export type NightMemory = {
  id: string;
  ownerId: string;
  title: string;
  planCompletionId: string | null;
  visibility: "private";
  createdAt: string;
  updatedAt: string;
};

export type StoryContributor = {
  storyId: string;
  profileId: string;
  role: StoryContributorRole;
  status: StoryContributorStatus;
  joinedAt: string | null;
};

export type MomentConsent = {
  storyId: string;
  momentId: string;
  ownerId: string;
  status: MomentConsentStatus;
  decidedAt: string | null;
};

export type NightStory = {
  id: string;
  memoryId: string;
  hostEditorId: string;
  title: string;
  summary: string;
  status: NightStoryStatus;
  visibility: NightStoryVisibility;
  legacyCrawlStoryId: string | null;
  publishedMomentIds: string[];
  publishedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

/** Public Story shape: private Memory and auth-account identifiers stay server-side. */
export type PublicNightStory = Omit<NightStory, "memoryId" | "hostEditorId">;

export type NightStoryPublicationProposal = {
  id: string;
  storyId: string;
  requestedBy: string;
  momentIds: string[];
  visibility: Exclude<NightStoryVisibility, "private">;
  expiresAt: string;
  confirmedAt: string | null;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function optionalText(value: unknown, max: number): string | null {
  const text = cleanText(value, max);
  return text || null;
}

function optionalDate(value: unknown): string | null {
  if (typeof value !== "string" || !value.trim()) return null;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : null;
}

/** Normalise a Moment at the trust boundary. Every accepted Moment is private. */
export function cleanNightMomentDraft(raw: unknown): NightMomentDraft | null {
  if (!raw || typeof raw !== "object") return null;
  const input = raw as Record<string, unknown>;
  if (!NIGHT_MOMENT_KINDS.includes(input.kind as NightMomentKind)) return null;
  const kind = input.kind as NightMomentKind;
  const pintDropId = optionalText(input.pintDropId, 80);
  if (kind === "pint_drop" && (!pintDropId || !UUID.test(pintDropId))) return null;
  const caption = cleanText(input.caption, 500);
  const venueId = optionalText(input.venueId, 80);
  const mediaObjectKey = optionalText(input.mediaObjectKey, 500);
  if (!caption && !venueId && !mediaObjectKey && kind !== "pint_drop") return null;
  return {
    kind,
    caption,
    pintDropId: kind === "pint_drop" ? pintDropId : null,
    venueId,
    mediaObjectKey,
    occurredAt: optionalDate(input.occurredAt),
    visibility: "private",
  };
}

export function canEditNightStory(actorId: string, contributors: StoryContributor[]): boolean {
  return contributors.some(
    (contributor) =>
      contributor.profileId === actorId &&
      contributor.status === "accepted" &&
      (contributor.role === "host" || contributor.role === "editor"),
  );
}

export function hasPublicationConsent(
  ownerId: string,
  momentId: string,
  consents: MomentConsent[],
): boolean {
  return consents.some(
    (consent) =>
      consent.ownerId === ownerId &&
      consent.momentId === momentId &&
      consent.status === "approved",
  );
}
