import "server-only";

// The reads behind an account's own export, assembled into the ONE document
// `lib/accountExport.ts` defines.
//
// EVERY OWNER-KEYED STORE IS A LANE OR A NAMED EXCLUSION, and the table is
// `ACCOUNT_EXPORT_LANES` with `__tests__/accountExport.test.ts` as the fence.
//
// Every lane goes through the store that already owns it, so this module is a
// second authority on nothing: the private card through `privateIdentityStore`,
// visit reports and wall photos through their own owner-keyed reads (hidden
// rows included, because a row a moderator took down is still the person's own
// account of their own night), saved pubs, the Wanted list, the Diary, the
// linked socials and the Night Profile through theirs, Memories and Moments through
// `nightMemoryStore`,
// prices through the community price store's per-actor read, Pint Drops
// through `pintDropsStore().listVisible` with the caller as author AND viewer
// (so their own anonymous and friends-only drops are theirs to export, while a
// hidden drop stays under moderation), and messages through the messages
// store's participant-gated thread read, keeping the caller's OWN messages
// and dropping the other side's words.
//
// A lane that could not be run is `unavailable` and the route refuses the
// whole export; a lane that answered nothing is `complete` with no items.
// The two are different findings and only the store can tell them apart, so
// the seams below carry the store's own degraded flag where it has one.

import {
  ACCOUNT_EXPORT_LANE_CAP,
  ACCOUNT_EXPORT_VERSION,
  boundedLane,
  unavailableLane,
  type AccountExport,
  type AccountExportConversation,
  type AccountExportCoverPhoto,
  type AccountExportCrowdReport,
  type AccountExportIdentity,
  type AccountExportLane,
  type AccountExportMemory,
  type AccountExportMessage,
  type AccountExportPintDrop,
  type AccountExportPrice,
  type AccountExportProfile,
  type AccountExportSocialPost,
  type AccountExportWallPhoto,
} from "@/lib/accountExport";
import {
  listCommunityPriceObservationsForActor,
  type CommunityPriceObservation,
} from "@/lib/communityPriceStore";
import type { CheckIn } from "@/lib/checkIn";
import { checkInStore } from "@/lib/checkInStore";
import { followStore } from "@/lib/followStore";
import { normalizeHandle } from "@/lib/handleNormalize";
import type { MessageDTO } from "@/lib/messages";
import { messagesStore, type InboxRead } from "@/lib/messagesStore";
import { occupancyStore } from "@/lib/occupancyStore";
import type { OccupancyReport } from "@/lib/occupancy";
import type { NightMemory, NightMoment } from "@/lib/nightMemory";
import { listNightMemories, listNightMoments } from "@/lib/nightMemoryStore";
import type { NightProfile } from "@/lib/nightProfile";
import { nightProfileStore } from "@/lib/nightProfileStore";
import { pintDropsStore, type PintDropDTO } from "@/lib/pintDropsStore";
import type { ProfileCoverPhoto } from "@/lib/profileCovers";
import { profileCoverPhotoStore } from "@/lib/profileCoverPhotoStore";
import { privateIdentityStore } from "@/lib/privateIdentityStore";
import { profileStore } from "@/lib/profileStore";
import type { SavedPubDTO } from "@/lib/savedPubs";
import { savedPubsStore, type SavedPubsRead } from "@/lib/savedPubsStore";
import { publicSocialConnection, type PublicSocialConnection } from "@/lib/socialConnections";
import { socialConnectionStore } from "@/lib/socialConnectionStore";
import type { SocialPostDTO } from "@/lib/socialPosts";
import { socialPostStore } from "@/lib/socialPostStore";
import { venuePhotoStore } from "@/lib/venuePhotoStore";
import type { VenuePhoto } from "@/lib/venuePhotos";
import type { VisitReportDTO } from "@/lib/visitReports";
import { visitReportsStore, type VisitReportReadResult } from "@/lib/visitReportsStore";
import type { DiaryEntryDTO } from "@/lib/diary";
import { diaryStore } from "@/lib/diaryStore";
import type { WantedDTO } from "@/lib/wanted";
import { wantedStore } from "@/lib/wantedStore";

/** The stable actor token a community price row carries for a profile. */
function profileActor(profileId: string): string {
  return `profile:${profileId}`;
}

/** The profile row as the export reads it: the identity block plus the fields the account filled in. */
export type AccountExportProfileRow = {
  id: string;
  handle: string;
  displayName: string | null;
  bio?: string;
  homeCity?: string;
  favouriteDrink?: string;
  interests?: string;
  workplace?: string;
  foundingMemberNumber?: number;
  visibility?: string;
  createdAt?: string;
  updatedAt?: string;
};

/**
 * Everything the export reaches for, as one seam. The default is the stores;
 * a test hands in fakes and asserts the document.
 */
export type AccountExportDeps = {
  profileForUser(userId: string): Promise<AccountExportProfileRow | null>;
  /** The private card, or null for an account that never saved one. */
  identity(userId: string): Promise<AccountExportIdentity | null>;
  memories(userId: string): Promise<NightMemory[]>;
  moments(userId: string, memoryId: string): Promise<NightMoment[]>;
  /** Every visit report this handle wrote, hidden rows included. */
  visitReports(handle: string): Promise<VisitReportReadResult>;
  /** Every Social post this account still has, newest first, at most `limit`. */
  socialPosts(
    owner: { accountId: string; profileId: string; handle: string },
    limit: number,
  ): Promise<SocialPostDTO[]>;
  /** Every crowd report this account made, hidden rows included. */
  crowdReports(
    userId: string,
    limit: number,
  ): Promise<{ degraded: boolean; reports: Array<OccupancyReport & { id: string; hiddenAt: string | null }> }>;
  /** Every wall photo this profile authored, hidden rows included. */
  wallPhotos(profileId: string): Promise<{ status: "ready" | "degraded"; photos: VenuePhoto[] }>;
  /** The account's own cover rotation, in the order it chose. */
  coverPhotos(profileId: string): Promise<ProfileCoverPhoto[]>;
  /** The account's own live check-ins. They expire on their own; this is what is left. */
  checkIns(handle: string): Promise<CheckIn[]>;
  /** The handles this account follows. */
  follows(handle: string): Promise<string[]>;
  savedPubs(handle: string): Promise<SavedPubsRead>;
  wanted(ownerActor: string): Promise<{ status: "ready" | "degraded"; wanteds: WantedDTO[] }>;
  diary(userId: string): Promise<{ status: "ready" | "degraded"; entries: DiaryEntryDTO[] }>;
  socialLinks(userId: string): Promise<PublicSocialConnection[]>;
  nightProfile(userId: string): Promise<NightProfile | null>;
  prices(
    actor: string,
    limit: number,
  ): Promise<{ observations: CommunityPriceObservation[]; degraded: boolean }>;
  pintDrops(handle: string): Promise<PintDropDTO[]>;
  conversations(handle: string): Promise<InboxRead>;
  /** Null when the caller is not a participant, which for their own inbox row is a read that failed. */
  messages(conversationId: string, handle: string): Promise<MessageDTO[] | null>;
};

function storeDeps(): AccountExportDeps {
  return {
    async profileForUser(userId) {
      const profile = await profileStore().getByUserId(userId);
      return profile
        ? {
            id: profile.id,
            handle: profile.handle,
            displayName: profile.displayName ?? null,
            bio: profile.bio,
            homeCity: profile.homeCity,
            favouriteDrink: profile.favouriteDrink,
            interests: profile.interests,
            workplace: profile.workplace,
            foundingMemberNumber: profile.foundingMemberNumber,
            visibility: profile.visibility,
            createdAt: profile.createdAt,
            updatedAt: profile.updatedAt,
          }
        : null;
    },
    async identity(userId) {
      const row = await privateIdentityStore().read(userId);
      return row ? exportIdentity(row) : null;
    },
    memories: (userId) => listNightMemories(userId),
    moments: (userId, memoryId) => listNightMoments(userId, memoryId),
    visitReports: (handle) => visitReportsStore().listForContributor(handle),
    socialPosts: (owner, limit) => socialPostStore().listOwned(owner, limit),
    crowdReports: (userId, limit) => occupancyStore().listForReporter(userId, limit),
    wallPhotos: (profileId) => venuePhotoStore().listForAuthor(profileId),
    coverPhotos: (profileId) => profileCoverPhotoStore().listApproved(profileId),
    checkIns: (handle) => checkInStore().listByHandles([handle]),
    follows: (handle) => followStore().listFollowing(handle),
    savedPubs: (handle) => savedPubsStore().readSaved({ handle }),
    wanted: (ownerActor) => wantedStore().listForOwner(ownerActor),
    diary: (userId) => diaryStore().listForOwner(userId),
    async socialLinks(userId) {
      return (await socialConnectionStore().list(userId)).map(publicSocialConnection);
    },
    nightProfile: (userId) => nightProfileStore().get(userId),
    prices: (actor, limit) => listCommunityPriceObservationsForActor(actor, limit),
    pintDrops: (handle) =>
      pintDropsStore().listVisible(undefined, { handle }, handle, null),
    conversations: (handle) => messagesStore().listConversations(handle),
    messages: (conversationId, handle) => messagesStore().listMessages(conversationId, handle),
  };
}

/** The private card, field by field, so nothing a store adds later leaks unread. */
function exportIdentity(row: {
  dateOfBirth?: string;
  fullName?: string;
  sex?: string;
  gender?: string;
  genderSelfDescribed?: string;
  createdAt?: string;
  updatedAt?: string;
}): AccountExportIdentity {
  return {
    dateOfBirth: row.dateOfBirth ?? null,
    fullName: row.fullName ?? null,
    sex: row.sex ?? null,
    gender: row.gender ?? null,
    genderSelfDescribed: row.genderSelfDescribed ?? null,
    createdAt: row.createdAt ?? null,
    updatedAt: row.updatedAt ?? null,
  };
}

/** The profile fields, as filled in, so nothing a store adds later leaks unread. */
function exportProfile(row: AccountExportProfileRow): AccountExportProfile {
  return {
    bio: row.bio ?? null,
    homeCity: row.homeCity ?? null,
    favouriteDrink: row.favouriteDrink ?? null,
    interests: row.interests ?? null,
    workplace: row.workplace ?? null,
    foundingMemberNumber: row.foundingMemberNumber ?? null,
    visibility: row.visibility ?? null,
    createdAt: row.createdAt ?? null,
    updatedAt: row.updatedAt ?? null,
  };
}

/** A post, field by field: its words and settings, never the viewer-shaped parts of the DTO. */
function exportSocialPost(post: SocialPostDTO): AccountExportSocialPost {
  return {
    id: post.id,
    kind: post.kind,
    visibility: post.visibility,
    body: post.body,
    areaSlug: post.area,
    venueId: post.venueId,
    hashtags: [...post.hashtags],
    commentPolicy: post.commentPolicy,
    photo: post.photo ? { mediaId: post.photo.mediaId, altText: post.photo.altText } : null,
    moderationState: post.moderationState,
    createdAt: post.createdAt,
    editedAt: post.editedAt,
  };
}

/** A wall photo named by its key. No bytes cross this door, by rule (4). */
function exportWallPhoto(photo: VenuePhoto): AccountExportWallPhoto {
  return {
    id: photo.id,
    venueId: photo.venueId,
    wallCategory: photo.wallCategory,
    placeLabel: photo.placeLabel,
    objectKey: photo.objectKey,
    caption: photo.caption,
    drinkCategory: photo.drinkCategory,
    moderationState: photo.moderationState,
    createdAt: photo.createdAt,
  };
}

/**
 * One lane, from a read that either answered or did not. `read` throwing is the
 * same finding as a degraded status: a lane we could not run.
 */
async function lane<T>(read: () => Promise<{ degraded: boolean; items: T[] }>): Promise<AccountExportLane<T>> {
  try {
    const answer = await read();
    return answer.degraded ? unavailableLane<T>() : boundedLane(answer.items);
  } catch {
    return unavailableLane<T>();
  }
}

function exportPrice(row: CommunityPriceObservation): AccountExportPrice {
  return {
    id: row.id,
    venueId: row.venueId,
    drinkCategory: row.drinkCategory,
    priceGbp: row.priceGbp,
    submittedAt: new Date(row.submittedAt).toISOString(),
    hidden: row.hidden,
  };
}

function exportPintDrop(drop: PintDropDTO): AccountExportPintDrop {
  return {
    id: drop.id,
    venueId: drop.venueId,
    drink: drop.drink,
    priceGbp: drop.priceGbp,
    passedDownNote: drop.passedDownNote,
    era: drop.era,
    visibility: drop.visibility ?? "public",
    createdAt: drop.createdAt,
    confirmedAt: drop.confirmation?.confirmedAt ?? null,
  };
}

function exportAttachment(
  attachment: MessageDTO["attachment"],
): AccountExportMessage["attachment"] {
  if (!attachment) return null;
  switch (attachment.kind) {
    case "photo":
      return { kind: "photo" };
    case "venue":
      return { kind: "venue", venueId: attachment.venueId };
    case "contact":
      return { kind: "contact", handle: attachment.handle };
    case "event":
      return { kind: "event", planId: attachment.planId };
    case "poll":
      // The ballot and the exporter's OWN answer. No other voter is named here
      // for the reason no reader is ever told who voted.
      return {
        kind: "poll",
        question: attachment.poll.question,
        options: attachment.poll.options.map((option) => option.label),
        yourAnswer: attachment.poll.viewerOptionIndex,
      };
  }
}

function exportMessage(message: MessageDTO): AccountExportMessage {
  return {
    id: message.id,
    conversationId: message.conversationId,
    body: message.body,
    createdAt: message.createdAt,
    attachment: exportAttachment(message.attachment),
  };
}

/**
 * The caller's own export. Throws nothing: a lane that could not be read is
 * marked `unavailable` and the route decides what a partial answer is worth.
 */
export async function buildAccountExport(
  userId: string,
  deps: AccountExportDeps = storeDeps(),
  now: Date = new Date(),
): Promise<AccountExport> {
  const exportedAt = now.toISOString();
  // Every profile- and handle-keyed lane awaits this inside its own read, so a
  // profile read that failed marks each of them unavailable rather than empty:
  // an account with no profile and one we could not look up are not one answer.
  const owner = deps.profileForUser(userId).then((profile) => ({
    profile,
    handle: profile ? normalizeHandle(profile.handle) || null : null,
  }));
  owner.catch(() => undefined);

  const memories = await (async () => {
    try {
      const rows = await deps.memories(userId);
      const out: AccountExportMemory[] = [];
      for (const memory of rows.slice(0, ACCOUNT_EXPORT_LANE_CAP + 1)) {
        out.push({ ...memory, moments: await deps.moments(userId, memory.id) });
      }
      return boundedLane(out);
    } catch {
      return unavailableLane<AccountExportMemory>();
    }
  })();

  const prices = await (async () => {
    try {
      const { profile } = await owner;
      if (!profile) return boundedLane<AccountExportPrice>([]);
      const read = await deps.prices(profileActor(profile.id), ACCOUNT_EXPORT_LANE_CAP + 1);
      if (read.degraded) return unavailableLane<AccountExportPrice>();
      return boundedLane(read.observations.map(exportPrice));
    } catch {
      return unavailableLane<AccountExportPrice>();
    }
  })();

  const pintDrops = await (async () => {
    try {
      const { handle } = await owner;
      if (!handle) return boundedLane<AccountExportPintDrop>([]);
      return boundedLane((await deps.pintDrops(handle)).map(exportPintDrop));
    } catch {
      return unavailableLane<AccountExportPintDrop>();
    }
  })();

  const messages = await (async () => {
    try {
      const { handle } = await owner;
      if (!handle) return boundedLane<AccountExportConversation>([]);
      const inbox = await deps.conversations(handle);
      // A DEGRADED inbox read may have missed conversations entirely, and a
      // portable copy that quietly omits a thread is a partial file handed over
      // as a complete one. The lane refuses instead.
      if (inbox.status === "degraded") return unavailableLane<AccountExportConversation>();
      const out: AccountExportConversation[] = [];
      for (const conversation of inbox.conversations.slice(0, ACCOUNT_EXPORT_LANE_CAP + 1)) {
        const thread = await deps.messages(conversation.id, handle);
        // The inbox named this thread as the caller's, so a refused read is a
        // read that failed rather than a thread that is not theirs.
        if (thread === null) return unavailableLane<AccountExportConversation>();
        out.push({
          id: conversation.id,
          otherHandle: conversation.otherHandle,
          // A GROUP says so, and says who was in it. `otherHandle` is only the
          // first other member on a group row, so a file carrying that alone
          // would hand somebody their nine-person thread back as a DM.
          ...(conversation.kind === "group"
            ? {
                kind: "group" as const,
                ...(conversation.title ? { title: conversation.title } : {}),
                ...(conversation.memberHandles
                  ? { memberHandles: [...conversation.memberHandles] }
                  : {}),
              }
            : {}),
          messages: thread
            .filter((message) => normalizeHandle(message.senderHandle) === handle)
            .map(exportMessage),
        });
      }
      return boundedLane(out);
    } catch {
      return unavailableLane<AccountExportConversation>();
    }
  })();

  // The lanes with one owner-keyed read each. Every one of them separates an
  // account that holds nothing from a read we could not run, which is what
  // lets the route refuse a partial file rather than hand it over as complete.
  const identity = await lane(async () => ({
    degraded: false,
    items: await deps
      .identity(userId)
      .then((row) => (row ? [row] : []))
      .catch((err: unknown) => {
        throw err;
      }),
  }));

  const visitReports = await lane<VisitReportDTO>(async () => {
    const { handle } = await owner;
    if (!handle) return { degraded: false, items: [] };
    const read = await deps.visitReports(handle);
    return { degraded: read.status === "degraded", items: read.reports };
  });

  const wallPhotos = await lane<AccountExportWallPhoto>(async () => {
    const { profile } = await owner;
    if (!profile) return { degraded: false, items: [] };
    const read = await deps.wallPhotos(profile.id);
    return { degraded: read.status === "degraded", items: read.photos.map(exportWallPhoto) };
  });

  const profileLane = await lane<AccountExportProfile>(async () => {
    const { profile } = await owner;
    return { degraded: false, items: profile ? [exportProfile(profile)] : [] };
  });

  const socialPosts = await lane<AccountExportSocialPost>(async () => {
    const { profile, handle } = await owner;
    if (!profile || !handle) return { degraded: false, items: [] };
    const posts = await deps.socialPosts(
      { accountId: userId, profileId: profile.id, handle },
      ACCOUNT_EXPORT_LANE_CAP + 1,
    );
    return { degraded: false, items: posts.map(exportSocialPost) };
  });

  const crowdReports = await lane<AccountExportCrowdReport>(async () => {
    const read = await deps.crowdReports(userId, ACCOUNT_EXPORT_LANE_CAP + 1);
    return {
      degraded: read.degraded,
      items: read.reports.map((report) => ({
        id: report.id,
        venueId: report.venueId,
        level: report.level,
        reportedAt: report.reportedAt,
        hidden: Boolean(report.hiddenAt),
      })),
    };
  });

  const coverPhotos = await lane<AccountExportCoverPhoto>(async () => {
    const { profile } = await owner;
    if (!profile) return { degraded: false, items: [] };
    const rows = await deps.coverPhotos(profile.id);
    return {
      degraded: false,
      items: rows.map((row) => ({
        id: row.id,
        position: row.position,
        objectKey: row.objectKey,
        createdAt: row.createdAt,
      })),
    };
  });

  const checkIns = await lane<CheckIn>(async () => {
    const { handle } = await owner;
    if (!handle) return { degraded: false, items: [] };
    return { degraded: false, items: await deps.checkIns(handle) };
  });

  const follows = await lane<string>(async () => {
    const { handle } = await owner;
    if (!handle) return { degraded: false, items: [] };
    return { degraded: false, items: await deps.follows(handle) };
  });

  const savedPubs = await lane<SavedPubDTO>(async () => {
    const { handle } = await owner;
    if (!handle) return { degraded: false, items: [] };
    const read = await deps.savedPubs(handle);
    return read.status === "ready"
      ? { degraded: false, items: read.rows }
      : { degraded: true, items: [] };
  });

  const wanted = await lane<WantedDTO>(async () => {
    const { profile } = await owner;
    if (!profile) return { degraded: false, items: [] };
    const read = await deps.wanted(profileActor(profile.id));
    return { degraded: read.status === "degraded", items: read.wanteds };
  });

  const diary = await lane<DiaryEntryDTO>(async () => {
    const read = await deps.diary(userId);
    return { degraded: read.status === "degraded", items: read.entries };
  });

  const socialLinks = await lane<PublicSocialConnection>(async () => ({
    degraded: false,
    items: await deps.socialLinks(userId),
  }));

  const nightProfile = await lane<NightProfile>(async () => {
    const row = await deps.nightProfile(userId);
    return { degraded: false, items: row ? [row] : [] };
  });

  const account = await owner.catch(() => ({ profile: null, handle: null }));

  return {
    version: ACCOUNT_EXPORT_VERSION,
    exportedAt,
    account: {
      userId,
      handle: account.handle,
      displayName: account.profile?.displayName ?? null,
    },
    profile: profileLane,
    identity,
    memories,
    prices,
    pintDrops,
    visitReports,
    crowdReports,
    socialPosts,
    wallPhotos,
    coverPhotos,
    checkIns,
    follows,
    savedPubs,
    wanted,
    diary,
    socialLinks,
    nightProfile,
    messages,
  };
}
