import { readdirSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it, vi } from "vitest";

// The account export: its shape (`lib/accountExport.ts`) and its assembly
// (`lib/accountExport.server.ts`, over fake stores).
//
// What is pinned: every lane the promise names is present; the caller's OWN
// messages are exported and the other side's words are not; a read that could
// not be run is `unavailable` rather than an empty lane; an account with no
// handle still gets its Memories; and the cap says so when it bites.

vi.mock("server-only", () => ({}));

import {
  ACCOUNT_EXPORT_LANE_CAP,
  ACCOUNT_EXPORT_LANES,
  accountExportFilename,
  boundedLane,
  unavailableExportLanes,
  unavailableLane,
  type AccountExportLaneName,
} from "@/lib/accountExport";
import { MessageReadUnavailableError } from "@/lib/messagesStore";

import {
  buildAccountExport,
  type AccountExportDeps,
} from "@/lib/accountExport.server";
import type { CommunityPriceObservation } from "@/lib/communityPriceStore";
import type { ConversationDTO, MessageDTO } from "@/lib/messages";
import type { CheckIn } from "@/lib/checkIn";
import type { NightMemory, NightMoment } from "@/lib/nightMemory";
import type { NightProfile } from "@/lib/nightProfile";
import type { PintDropDTO } from "@/lib/pintDropsStore";
import type { SocialPostDTO } from "@/lib/socialPosts";
import type { ProfileCoverPhoto } from "@/lib/profileCovers";
import type { SavedPubDTO } from "@/lib/savedPubs";
import type { PublicSocialConnection } from "@/lib/socialConnections";
import type { VenuePhoto } from "@/lib/venuePhotos";
import type { VisitReportDTO } from "@/lib/visitReports";
import type { DiaryEntryDTO } from "@/lib/diary";
import type { VenueSubmission } from "@/lib/venueSubmissions";
import type { TableRequest } from "@/lib/tableRequests";
import type { WantedDTO } from "@/lib/wanted";

const USER = "u0000000-0000-4000-8000-000000000001";
const PROFILE = "p0000000-0000-4000-8000-000000000002";
const NOW = new Date("2026-09-05T18:30:00.000Z");

const memory: NightMemory = {
  id: "mem-1",
  ownerId: USER,
  title: "Friday",
  planCompletionId: null,
  visibility: "private",
  createdAt: "2026-09-04T22:00:00.000Z",
  updatedAt: "2026-09-04T23:00:00.000Z",
};

const moment: NightMoment = {
  id: "mom-1",
  memoryId: "mem-1",
  ownerId: USER,
  kind: "photo",
  caption: "first pint",
  pintDropId: null,
  venueId: "venue-1f5ygjb",
  mediaObjectKey: `night-moments/${USER}/mem-1/photo.jpg`,
  occurredAt: null,
  visibility: "private",
  altText: null,
  createdAt: "2026-09-04T22:30:00.000Z",
  altTextConfirmedAt: null,
};

const price: CommunityPriceObservation = {
  id: "price-1",
  venueId: "venue-1f5ygjb",
  drinkCategory: "beer",
  priceGbp: 4.8,
  submittedAt: Date.parse("2026-09-05T12:00:00.000Z"),
  actor: `profile:${PROFILE}`,
  hidden: false,
};

const drop = {
  id: "drop-1",
  venueId: "venue-1f5ygjb",
  handle: "night_owl",
  drink: "Beer",
  priceGbp: 4.8,
  passedDownNote: "",
  era: "",
  provenance: "own",
  status: "visible",
  visibility: "public",
  createdAt: "2026-09-05T12:00:00.000Z",
  pintPhotoUrl: null,
  venuePhotoUrl: null,
  confirmation: { confirmedAt: "2026-09-05T13:00:00.000Z" },
} as unknown as PintDropDTO;

const conversation: ConversationDTO = {
  id: "conv-1",
  otherHandle: "bobpm",
  lastAt: "2026-09-05T12:05:00.000Z",
  lastFromMe: false,
  unread: 0,
};

const thread: MessageDTO[] = [
  {
    id: "msg-1",
    conversationId: "conv-1",
    senderHandle: "night_owl",
    body: "see you at eight",
    createdAt: "2026-09-05T12:00:00.000Z",
    read: true,
    flagged: false,
  },
  {
    id: "msg-2",
    conversationId: "conv-1",
    senderHandle: "bobpm",
    body: "bob's own words, not the caller's to export",
    createdAt: "2026-09-05T12:05:00.000Z",
    read: true,
    flagged: false,
  },
  {
    id: "msg-3",
    conversationId: "conv-1",
    senderHandle: "Night_Owl",
    body: "",
    createdAt: "2026-09-05T12:06:00.000Z",
    read: false,
    flagged: false,
    attachment: { kind: "venue", venueId: "venue-xjf3n0", card: null },
  },
];

const identity = {
  dateOfBirth: "1994-03-02",
  fullName: "Nadia Owl",
  sex: "female",
  gender: null,
  genderSelfDescribed: null,
  createdAt: "2026-08-01T10:00:00.000Z",
  updatedAt: "2026-08-02T10:00:00.000Z",
};

const visitReport = {
  id: "visit-1",
  venueId: "venue-1f5ygjb",
  handle: "night_owl",
  visitedAt: "2026-09-01",
  createdAt: "2026-09-01T22:00:00.000Z",
  note: "quiet on a Tuesday",
} as unknown as VisitReportDTO;

const wallPhoto = {
  id: "photo-1",
  venueId: "venue-1f5ygjb",
  wallCategory: "pint",
  placeLabel: "",
  authorActor: `profile:${PROFILE}`,
  authorProfileId: PROFILE,
  objectKey: "venue-photos/venue-1f5ygjb/photo-1.jpg",
  drinkCategory: null,
  caption: "the snug",
  width: 900,
  height: 1200,
  moderationState: "approved",
  createdAt: "2026-09-02T20:00:00.000Z",
} as unknown as VenuePhoto;

const coverPhoto = {
  id: "cover-1",
  profileId: PROFILE,
  position: 1,
  generation: "gen-1",
  objectKey: `covers/${PROFILE}/gen-1/cover.jpg`,
  moderationState: "approved",
  createdAt: "2026-08-20T10:00:00.000Z",
} as unknown as ProfileCoverPhoto;

const checkIn = {
  id: "checkin-1",
  handle: "night_owl",
  areaSlug: null,
  venueId: "venue-1f5ygjb",
  note: null,
  visibility: "public",
  createdAt: "2026-09-05T17:00:00.000Z",
  expiresAt: "2026-09-05T21:00:00.000Z",
} as unknown as CheckIn;

const savedPub = {
  venueId: "venue-1f5ygjb",
  venueName: "The Blackfriar",
  venueMapUrl: "/map?sel=venue-1f5ygjb",
  listType: "Sunday roast",
  savedAt: "2026-09-03T09:00:00.000Z",
} as unknown as SavedPubDTO;

const wantedRow = {
  id: "wanted-1",
  ownerActor: `profile:${PROFILE}`,
  venueId: "venue-xjf3n0",
  status: "open",
  createdAt: "2026-09-03T10:00:00.000Z",
  fulfilledAt: null,
  promotedListType: null,
  promotedAt: null,
} as unknown as WantedDTO;

const venueSubmissionRow = {
  id: "submission-1",
  ownerUserId: USER,
  name: "The Missing Crown",
  address: "1 Example Street, London",
  postcode: "SE1 9AA",
  latitude: null,
  longitude: null,
  website: "",
  menuUrl: "",
  openingHours: "",
  note: "",
  prices: [{ drinkCategory: "beer", drinkName: "", priceGbp: 5.2, measure: "pint" }],
  status: "pending",
  duplicateOfVenueId: null,
  reviewerNote: null,
  reviewedAt: null,
  createdAt: "2026-10-17T12:00:00.000Z",
  files: [{
    id: "file-1",
    submissionId: "submission-1",
    ownerUserId: USER,
    objectKey: `venue-submissions/${USER}/submission-1/file-1.jpg`,
    kind: "image",
    contentType: "image/jpeg",
    byteSize: 2048,
    sha256: "a".repeat(64),
    createdAt: "2026-10-17T12:01:00.000Z",
  }],
} as unknown as VenueSubmission;

const diaryRow = {
  id: "diary-1",
  ownerUserId: USER,
  venueId: "venue-xjf3n0",
  venueName: "The Blackfriar",
  visitedOn: "2026-09-04",
  rating: 4.5,
  review: "Back room was calm.",
  visibility: "private",
  createdAt: "2026-09-04T21:00:00.000Z",
} as unknown as DiaryEntryDTO;

const socialLink = {
  provider: "instagram",
  mode: "manual",
  accountKind: "personal",
  status: "connected",
  username: "nightowl",
  scopes: [],
} as unknown as PublicSocialConnection;

const nightProfileRow = {
  version: 1,
  cityId: "london",
  pubPalId: null,
  createdAt: "2026-08-10T10:00:00.000Z",
  updatedAt: "2026-08-10T10:00:00.000Z",
} as unknown as NightProfile;

const profileRow = {
  id: PROFILE,
  handle: "night_owl",
  displayName: "Night Owl",
  bio: "Cask ale, quiet snugs.",
  homeCity: "London",
  favouriteDrink: "Best bitter",
  interests: "pub quizzes, folk sessions",
  workplace: "A bakery in Peckham",
  foundingMemberNumber: 42,
  visibility: "public",
  createdAt: "2026-08-01T10:00:00.000Z",
  updatedAt: "2026-08-03T10:00:00.000Z",
};

const socialPost = {
  id: "post-1",
  kind: "standard",
  visibility: "friends",
  body: "Back room at the Blackfriar is calm tonight #snug",
  area: "soho",
  venueId: "venue-1f5ygjb",
  venueName: "The Blackfriar",
  venueProjected: true,
  hashtags: ["snug"],
  commentPolicy: "open",
  photo: { mediaId: "media-1", altText: "A back room with a fire" },
  moderationState: "approved",
  featureRequest: null,
  revision: 1,
  mutationVersion: 2,
  editedAt: "2026-09-04T22:00:00.000Z",
  createdAt: "2026-09-04T21:00:00.000Z",
  updatedAt: "2026-09-04T22:00:00.000Z",
  author: { handle: "night_owl", avatarUrl: "https://example.com/not-for-the-file.jpg" },
  ownedByViewer: true,
} as unknown as SocialPostDTO;

const crowdReport = {
  id: "crowd-1",
  venueId: "venue-1f5ygjb",
  level: "some-seats",
  reportedAt: "2026-09-05T19:00:00.000Z",
  reporterUserId: USER,
  source: "crowd",
  hiddenAt: null,
} as const;

/** A table request the caller sent: their own words, crew and the contact they gave. */
const ownTableRequest: TableRequest = {
  id: "table-1",
  venueId: "venue-2",
  requesterUserId: USER,
  name: "Night Owl",
  partySize: 8,
  date: "2026-11-14",
  time: "19:30",
  note: "A birthday, nothing loud.",
  contactKind: "email",
  contactValue: "owl@example.com",
  delivery: "emailed",
  createdAt: "2026-11-02T18:00:00.000Z",
  deliveredAt: "2026-11-02T18:00:01.000Z",
};

/** Another account's request for the same pub. It may never reach this file. */
const strangerTableRequest: TableRequest = {
  ...ownTableRequest,
  id: "table-stranger",
  requesterUserId: "stranger-account",
  name: "Somebody Else",
  contactKind: "phone",
  contactValue: "+447700900999",
  note: null,
};

function fakeDeps(overrides: Partial<AccountExportDeps> = {}): AccountExportDeps {
  return {
    profileForUser: async () => profileRow,
    identity: async () => identity,
    memories: async () => [memory],
    moments: async () => [moment],
    visitReports: async () => ({ status: "ready" as const, reports: [visitReport] }),
    socialPosts: async () => [socialPost],
    crowdReports: async () => ({ degraded: false, reports: [crowdReport] }),
    wallPhotos: async () => ({ status: "ready" as const, photos: [wallPhoto] }),
    coverPhotos: async () => [coverPhoto],
    checkIns: async () => [checkIn],
    follows: async () => ["bobpm"],
    savedPubs: async () => ({ status: "ready" as const, rows: [savedPub] }),
    wanted: async () => ({ status: "ready" as const, wanteds: [wantedRow] }),
    diary: async (userId) => ({ status: "ready" as const, entries: userId === USER ? [diaryRow] : [] }),
    pubRankings: async () => [
      { venueId: "venue-2", band: "fine" as const, rankKey: 1, updatedAt: "2026-09-05T21:00:00.000Z" },
      { venueId: "venue-1f5ygjb", band: "loved" as const, rankKey: 1, updatedAt: "2026-09-05T21:00:00.000Z" },
    ],
    venueCorrections: async () => ({ status: "ready" as const, corrections: [] }),
    regularNightReports: async () => ({ status: "ready" as const, reports: [] }),
    kitchenReports: async (userId) => ({
      status: "ready" as const,
      reports:
        userId === USER
          ? [
              {
                id: "kitchen-1",
                venueId: "venue-2",
                state: "open" as const,
                reporterUserId: USER,
                reportedAt: "2026-10-30T19:00:00.000Z",
                confirmedBy: "other-account",
                confirmedAt: "2026-10-30T19:10:00.000Z",
              },
            ]
          : [],
    }),
    tableRequests: async (userId) => ({
      status: "ready" as const,
      requests: userId === USER ? [ownTableRequest, strangerTableRequest] : [strangerTableRequest],
    }),
    pubListNightDrafts: async () => [],
    venueSubmissions: async (userId) => ({
      status: "ready" as const,
      submissions: userId === USER ? [venueSubmissionRow] : [],
    }),
    socialLinks: async () => [socialLink],
    nightProfile: async () => nightProfileRow,
    prices: async () => ({ observations: [price], degraded: false }),
    pintDrops: async () => [drop],
    conversations: async () => ({ conversations: [conversation], status: "ready" as const }),
    messages: async () => thread,
    handlesForProfile: async () => ["night_owl"],
    ownMessageIds: async () => null,
    ...overrides,
  };
}

describe("buildAccountExport", () => {
  it("carries every lane the promise names, with the caller's own rows", async () => {
    const document = await buildAccountExport(USER, fakeDeps(), NOW);

    expect(document.version).toBe(1);
    expect(document.exportedAt).toBe("2026-09-05T18:30:00.000Z");
    expect(document.account).toEqual({ userId: USER, handle: "night_owl", displayName: "Night Owl" });
    for (const lane of ACCOUNT_EXPORT_LANES) expect(document[lane].status).toBe("complete");

    expect(document.memories.items).toEqual([{ ...memory, moments: [moment] }]);
    expect(document.prices.items).toEqual([
      {
        id: "price-1",
        venueId: "venue-1f5ygjb",
        drinkCategory: "beer",
        priceGbp: 4.8,
        submittedAt: "2026-09-05T12:00:00.000Z",
        hidden: false,
      },
    ]);
    expect(document.pintDrops.items).toEqual([
      {
        id: "drop-1",
        venueId: "venue-1f5ygjb",
        drink: "Beer",
        priceGbp: 4.8,
        passedDownNote: "",
        era: "",
        visibility: "public",
        createdAt: "2026-09-05T12:00:00.000Z",
        confirmedAt: "2026-09-05T13:00:00.000Z",
      },
    ]);
    expect(unavailableExportLanes(document)).toEqual([]);
  });

  it("carries the lanes the first cut of this door left out", async () => {
    // The private card is the row a person is most obviously owed, and the
    // visit reports, the photos, the saved pubs, the Wanted list, the linked
    // socials, the check-ins, the follow list and the Night Profile are the
    // rest of what "your data" claims on the surface.
    const document = await buildAccountExport(USER, fakeDeps(), NOW);

    expect(document.identity.items).toEqual([identity]);
    expect(document.visitReports.items).toEqual([visitReport]);
    expect(document.wallPhotos.items).toEqual([
      {
        id: "photo-1",
        venueId: "venue-1f5ygjb",
        wallCategory: "pint",
        placeLabel: "",
        objectKey: "venue-photos/venue-1f5ygjb/photo-1.jpg",
        caption: "the snug",
        drinkCategory: null,
        moderationState: "approved",
        createdAt: "2026-09-02T20:00:00.000Z",
      },
    ]);
    expect(document.coverPhotos.items).toEqual([
      {
        id: "cover-1",
        position: 1,
        objectKey: `covers/${PROFILE}/gen-1/cover.jpg`,
        createdAt: "2026-08-20T10:00:00.000Z",
      },
    ]);
    expect(document.checkIns.items).toEqual([checkIn]);
    expect(document.follows.items).toEqual(["bobpm"]);
    expect(document.savedPubs.items).toEqual([savedPub]);
    expect(document.wanted.items).toEqual([wantedRow]);
    expect(document.diary.items).toEqual([diaryRow]);
    expect(document.venueSubmissions.items).toEqual([
      expect.objectContaining({
        id: "submission-1",
        name: "The Missing Crown",
        files: [{ kind: "image", byteSize: 2048, createdAt: "2026-10-17T12:01:00.000Z" }],
      }),
    ]);
    expect(JSON.stringify(document.venueSubmissions)).not.toContain("venue-submissions/");
    expect(document.venueSubmissions.items[0]).not.toHaveProperty("ownerUserId");
    // A kitchen tap: the word, the minute and whether one other confirmed it,
    // never who that other account was.
    expect(document.kitchenReports.items).toEqual([
      { id: "kitchen-1", venueId: "venue-2", state: "open", reportedAt: "2026-10-30T19:00:00.000Z", confirmed: true },
    ]);
    expect(JSON.stringify(document.kitchenReports)).not.toContain("other-account");
    // A table request: the caller's own name, crew, day, time, note, the contact
    // they gave and where it got to. Never the operator, never the account id.
    expect(document.tableRequests.items).toEqual([
      {
        id: "table-1",
        venueId: "venue-2",
        name: "Night Owl",
        partySize: 8,
        date: "2026-11-14",
        time: "19:30",
        note: "A birthday, nothing loud.",
        contactKind: "email",
        contactValue: "owl@example.com",
        status: "emailed",
        createdAt: "2026-11-02T18:00:00.000Z",
      },
    ]);
    expect(document.socialLinks.items).toEqual([socialLink]);
    expect(document.nightProfile.items).toEqual([nightProfileRow]);
  });

  it("carries the caller's own table request and never another account's", async () => {
    const document = await buildAccountExport(USER, fakeDeps(), NOW);
    expect(document.tableRequests.status).toBe("complete");
    expect(document.tableRequests.truncated).toBe(false);
    expect(document.tableRequests.items.map((item) => item.id)).toEqual(["table-1"]);
    const lane = JSON.stringify(document.tableRequests);
    for (const stranger of ["table-stranger", "stranger-account", "Somebody Else", "+447700900999"]) {
      expect(lane).not.toContain(stranger);
    }
    expect(document.tableRequests.items[0]).not.toHaveProperty("requesterUserId");
    expect(document.tableRequests.items[0]).not.toHaveProperty("deliveredAt");

    // Another account's export carries none of the caller's request either.
    const other = await buildAccountExport("stranger-account", fakeDeps({
      profileForUser: async () => null,
    }), NOW);
    expect(JSON.stringify(other.tableRequests)).not.toContain("table-1");
    expect(JSON.stringify(other.tableRequests)).not.toContain("owl@example.com");
  });

  it("carries the profile fields, the posts and the crowd reports the file used to leave out (F15)", async () => {
    // Public QA pass, Lane M: the file held identity, prices, drops, reports,
    // photos, saves, Wanted, diary, Night Profile and messages, and omitted the
    // bio, home city, favourite drink, interests and workplace, the account's
    // own posts and its crowd readings.
    const document = await buildAccountExport(USER, fakeDeps(), NOW);

    expect(document.profile.items).toEqual([
      {
        bio: "Cask ale, quiet snugs.",
        homeCity: "London",
        favouriteDrink: "Best bitter",
        interests: "pub quizzes, folk sessions",
        workplace: "A bakery in Peckham",
        foundingMemberNumber: 42,
        visibility: "public",
        createdAt: "2026-08-01T10:00:00.000Z",
        updatedAt: "2026-08-03T10:00:00.000Z",
      },
    ]);
    expect(document.socialPosts.items).toEqual([
      {
        id: "post-1",
        kind: "standard",
        visibility: "friends",
        body: "Back room at the Blackfriar is calm tonight #snug",
        areaSlug: "soho",
        venueId: "venue-1f5ygjb",
        hashtags: ["snug"],
        commentPolicy: "open",
        photo: { mediaId: "media-1", altText: "A back room with a fire" },
        review: null,
        extraPhotos: [],
        video: null,
        moderationState: "approved",
        createdAt: "2026-09-04T21:00:00.000Z",
        editedAt: "2026-09-04T22:00:00.000Z",
      },
    ]);
    expect(document.crowdReports.items).toEqual([
      {
        id: "crowd-1",
        venueId: "venue-1f5ygjb",
        level: "some-seats",
        reportedAt: "2026-09-05T19:00:00.000Z",
        hidden: false,
      },
    ]);
    // The viewer-shaped parts of a post DTO are not the account's data.
    expect(JSON.stringify(document.socialPosts)).not.toContain("not-for-the-file");
  });

  it("carries the account's own compared pub order with the place and score it derives", async () => {
    const document = await buildAccountExport(USER, fakeDeps(), NOW);
    expect(document.pubRankings.items).toEqual([
      { venueId: "venue-1f5ygjb", band: "loved", place: 1, score: 10 },
      { venueId: "venue-2", band: "fine", place: 2, score: 6.7 },
    ]);
  });

  it("marks a crowd report a moderator hid as hidden, and still exports it", async () => {
    const document = await buildAccountExport(
      USER,
      fakeDeps({
        crowdReports: async () => ({
          degraded: false,
          reports: [{ ...crowdReport, hiddenAt: "2026-09-05T20:00:00.000Z" }],
        }),
      }),
      NOW,
    );
    expect(document.crowdReports.items[0]?.hidden).toBe(true);
  });

  it("gives an account with no profile an empty profile lane, and asks no post read", async () => {
    const document = await buildAccountExport(
      USER,
      fakeDeps({
        profileForUser: async () => null,
        socialPosts: async () => {
          throw new Error("must not be asked without a profile");
        },
      }),
      NOW,
    );
    expect(document.profile).toEqual({ status: "complete", truncated: false, items: [] });
    expect(document.socialPosts).toEqual({ status: "complete", truncated: false, items: [] });
  });

  it("marks every profile- and handle-keyed lane unavailable when the profile read failed", async () => {
    const document = await buildAccountExport(
      USER,
      fakeDeps({
        profileForUser: async () => {
          throw new Error("profiles unreadable");
        },
      }),
      NOW,
    );

    expect(document.account).toEqual({ userId: USER, handle: null, displayName: null });
    expect(unavailableExportLanes(document).sort()).toEqual(
      [
        "profile",
        "prices",
        "pintDrops",
        "messages",
        "visitReports",
        "wallPhotos",
        "socialPosts",
        "coverPhotos",
        "checkIns",
        "follows",
        "savedPubs",
        "wanted",
        "pubRankings",
      ].sort(),
    );
    for (const lane of ["identity", "memories", "crowdReports", "diary", "socialLinks", "nightProfile"] as const) {
      expect(document[lane].status).toBe("complete");
    }
  });

  it("carries a Drink Wall photo's category and the place its author typed", async () => {
    const cityPhoto = {
      ...wallPhoto,
      id: "photo-2",
      venueId: null,
      wallCategory: "london",
      placeLabel: "Outside my flat, Tooley St",
      objectKey: "drink-wall/photo-2.jpg",
    } as unknown as VenuePhoto;
    const document = await buildAccountExport(
      USER,
      fakeDeps({ wallPhotos: async () => ({ status: "ready" as const, photos: [cityPhoto] }) }),
      NOW,
    );
    expect(document.wallPhotos.items).toEqual([
      expect.objectContaining({
        id: "photo-2",
        venueId: null,
        wallCategory: "london",
        placeLabel: "Outside my flat, Tooley St",
        objectKey: "drink-wall/photo-2.jpg",
      }),
    ]);
  });

  it("never carries a linked social's stored tokens", async () => {
    // `socialConnectionStore` rows hold `accessTokenCiphertext` and
    // `refreshTokenCiphertext`. The lane is the PUBLIC projection, so the
    // ciphertext cannot reach a file a person downloads and forwards.
    const document = await buildAccountExport(USER, fakeDeps(), NOW);
    const file = JSON.stringify(document);
    expect(file).not.toContain("accessTokenCiphertext");
    expect(file).not.toContain("refreshTokenCiphertext");
  });

  it("marks each new lane unavailable when its own read could not be run", async () => {
    const lanesUnderTest = {
      identity: { identity: async () => { throw new Error("private card unreadable"); } },
      visitReports: { visitReports: async () => ({ status: "degraded" as const, reports: [] }) },
      wallPhotos: { wallPhotos: async () => ({ status: "degraded" as const, photos: [] }) },
      savedPubs: { savedPubs: async () => ({ status: "unavailable" as const }) },
      wanted: { wanted: async () => ({ status: "degraded" as const, wanteds: [] }) },
      diary: { diary: async () => ({ status: "degraded" as const, entries: [] }) },
      pubRankings: { pubRankings: async () => { throw new Error("rankings unreadable"); } },
      socialLinks: { socialLinks: async () => { throw new Error("connections unreadable"); } },
      nightProfile: { nightProfile: async () => { throw new Error("night profile unreadable"); } },
      coverPhotos: { coverPhotos: async () => { throw new Error("covers unreadable"); } },
      checkIns: { checkIns: async () => { throw new Error("check-ins unreadable"); } },
      follows: { follows: async () => { throw new Error("follow graph unreadable"); } },
      socialPosts: { socialPosts: async () => { throw new Error("posts unreadable"); } },
      crowdReports: { crowdReports: async () => ({ degraded: true, reports: [] }) },
      tableRequests: { tableRequests: async () => ({ status: "degraded" as const, requests: [] }) },
    } satisfies Record<string, Partial<AccountExportDeps>>;

    for (const [lane, override] of Object.entries(lanesUnderTest)) {
      const document = await buildAccountExport(USER, fakeDeps(override), NOW);
      expect(unavailableExportLanes(document), `${lane} must refuse rather than empty`).toEqual([lane]);
    }
  });

  it("exports a GROUP as a group, never as a DM with whoever sorts first", async () => {
    // `otherHandle` on a group row is the first OTHER member. A file carrying
    // that alone hands somebody their nine-person thread back as a one-to-one,
    // which is a portable copy saying something untrue about their own record.
    const group: ConversationDTO = {
      id: "conv-2",
      otherHandle: "bobpm",
      kind: "group",
      title: "Friday session",
      memberHandles: ["night_owl", "bobpm", "jen"],
      lastAt: "2026-09-05T12:06:00.000Z",
      lastFromMe: true,
      unread: 0,
    };
    const document = await buildAccountExport(
      USER,
      fakeDeps({
        conversations: async () => ({
          conversations: [group],
          status: "ready" as const,
        }),
        messages: async () => thread,
      }),
      NOW,
    );
    expect(document.messages.items[0]).toMatchObject({
      id: "conv-2",
      kind: "group",
      title: "Friday session",
      memberHandles: ["night_owl", "bobpm", "jen"],
    });
  });

  it("says nothing about a KIND on a direct thread, so an old file still reads", async () => {
    const document = await buildAccountExport(USER, fakeDeps(), NOW);
    expect(document.messages.items[0]).not.toHaveProperty("kind");
    expect(document.messages.items[0]).not.toHaveProperty("memberHandles");
  });

  it("exports the caller's own messages and never the other side's words", async () => {
    const document = await buildAccountExport(USER, fakeDeps(), NOW);

    expect(document.messages.items).toEqual([
      {
        id: "conv-1",
        otherHandle: "bobpm",
        messages: [
          {
            id: "msg-1",
            conversationId: "conv-1",
            body: "see you at eight",
            createdAt: "2026-09-05T12:00:00.000Z",
            attachment: null,
          },
          {
            id: "msg-3",
            conversationId: "conv-1",
            body: "",
            createdAt: "2026-09-05T12:06:00.000Z",
            attachment: { kind: "venue", venueId: "venue-xjf3n0" },
          },
        ],
      },
    ]);
    expect(JSON.stringify(document)).not.toContain("bob's own words");
  });

  it("asks the stores for the caller as author and viewer, under the profile's actor", async () => {
    const asked: string[] = [];
    const deps = fakeDeps({
      prices: async (actor) => {
        asked.push(`prices:${actor}`);
        return { observations: [], degraded: false };
      },
      pintDrops: async (handle) => {
        asked.push(`drops:${handle}`);
        return [];
      },
      conversations: async (handle) => {
        asked.push(`inbox:${handle}`);
        return { conversations: [], status: "ready" as const };
      },
    });

    await buildAccountExport(USER, deps, NOW);

    expect(asked).toEqual([`prices:profile:${PROFILE}`, "drops:night_owl", "inbox:night_owl"]);
  });

  it("still exports Memories for an account that never claimed a handle, and asks no handle lane", async () => {
    const deps = fakeDeps({
      profileForUser: async () => null,
      prices: async () => {
        throw new Error("must not be asked without a profile");
      },
      pintDrops: async () => {
        throw new Error("must not be asked without a handle");
      },
      conversations: async () => {
        throw new Error("must not be asked without a handle");
      },
    });

    const document = await buildAccountExport(USER, deps, NOW);

    expect(document.account).toEqual({ userId: USER, handle: null, displayName: null });
    expect(document.memories.items).toHaveLength(1);
    expect(document.prices).toEqual({ status: "complete", truncated: false, items: [] });
    expect(document.pintDrops).toEqual({ status: "complete", truncated: false, items: [] });
    expect(document.messages).toEqual({ status: "complete", truncated: false, items: [] });
  });

  it("marks a lane unavailable when its read could not be run, rather than emptying it", async () => {
    const degraded = await buildAccountExport(
      USER,
      fakeDeps({ prices: async () => ({ observations: [], degraded: true }) }),
      NOW,
    );
    expect(degraded.prices).toEqual(unavailableLane());
    expect(unavailableExportLanes(degraded)).toEqual(["prices"]);

    const threw = await buildAccountExport(
      USER,
      fakeDeps({
        memories: async () => {
          throw new Error("night_memories unreadable");
        },
      }),
      NOW,
    );
    expect(unavailableExportLanes(threw)).toEqual(["memories"]);

    // The inbox named the thread as the caller's, so a refused thread read is
    // a failed read and not "not theirs".
    const refused = await buildAccountExport(USER, fakeDeps({ messages: async () => null }), NOW);
    expect(unavailableExportLanes(refused)).toEqual(["messages"]);
  });

  it("marks messages unavailable when a durable thread read fails", async () => {
    const document = await buildAccountExport(USER, fakeDeps({
      messages: async () => { throw new MessageReadUnavailableError(); },
    }), NOW);
    expect(document.messages).toEqual(unavailableLane());
    expect(unavailableExportLanes(document)).toEqual(["messages"]);
  });

  it("says when the cap bit rather than presenting a window as the whole", async () => {
    const many = Array.from({ length: ACCOUNT_EXPORT_LANE_CAP + 1 }, (_, i) => ({
      ...price,
      id: `price-${i}`,
    }));
    const document = await buildAccountExport(
      USER,
      fakeDeps({ prices: async () => ({ observations: many, degraded: false }) }),
      NOW,
    );

    expect(document.prices.truncated).toBe(true);
    expect(document.prices.items).toHaveLength(ACCOUNT_EXPORT_LANE_CAP);
    expect(document.pintDrops.truncated).toBe(false);
  });
});

describe("the export's own helpers", () => {
  it("names the file after the handle and the day, and falls back to the account", () => {
    expect(accountExportFilename("Night_Owl", "2026-09-05T18:30:00.000Z")).toBe(
      "pubmaxx-night_owl-2026-09-05.json",
    );
    expect(accountExportFilename(null, "2026-09-05T18:30:00.000Z")).toBe(
      "pubmaxx-account-2026-09-05.json",
    );
  });

  it("bounds a lane to the cap and says so", () => {
    expect(boundedLane([1, 2, 3])).toEqual({ status: "complete", truncated: false, items: [1, 2, 3] });
    const over = boundedLane(Array.from({ length: ACCOUNT_EXPORT_LANE_CAP + 5 }, (_, i) => i));
    expect(over.truncated).toBe(true);
    expect(over.items).toHaveLength(ACCOUNT_EXPORT_LANE_CAP);
  });
});

// ── The coverage fence ───────────────────────────────────────────────────────
//
// EVERY OWNER-KEYED STORE IS A LANE OR A NAMED EXCLUSION. The first cut of this
// door shipped four lanes and left the private card, the visit reports, the
// wall photos, the cover rotation, the saved pubs, the Wanted list, the linked
// socials, the check-ins, the follow list and the Night Profile out of a file
// the surface calls "your data". A list of lanes cannot catch that; a list of
// STORES can, so this walks every `lib/*Store*.ts` module in the tree (the same
// enumeration `__tests__/storeInventory.test.ts` runs on) and fails on one that
// is neither exported nor argued about.
//
// A row is a lane name, or a sentence saying why the store's rows are not the
// account's own content to take away. A NAMED GAP is the third answer and the
// only dishonest-looking one, so it is spelled out and the list may only ever
// SHRINK: it names content that IS the person's and has no owner-keyed read to
// export it through yet.
type ExportCoverage =
  | { lane: AccountExportLaneName }
  | { excluded: string }
  | { gap: string };

const STORE_EXPORT_COVERAGE: Record<string, ExportCoverage> = {
  "lib/adultSelfAssertionStore.ts": {
    excluded:
      "One timestamp recording that the account tapped the 18-or-over confirmation. It is a gate answer we wrote down, not something the person composed, and `identity` already carries the date of birth the same question reads.",
  },
  "lib/analyticsReceiptStore.ts": {
    excluded: "Keyed on an event id and a token digest; no account id is stored.",
  },
  "lib/areaDemandStore.ts": { excluded: "Per-area demand counters, keyed on a night area rather than on any account." },
  "lib/checkInStore.ts": { lane: "checkIns" },
  "lib/cityEnrichmentCheckpointStore.server.ts": {
    excluded: "The nightly enrichment cursor, keyed on a city rather than on any account.",
  },
  "lib/commentsStore.ts": {
    excluded:
      "A Pint Drop comment carries a typed handle beside an IP hash and proves no account (migration 0150 leaves it out of the retention ledger for the same reason), so no row here can be shown to be this caller's.",
  },
  "lib/communityPriceStore.ts": { lane: "prices" },
  "lib/contributorLeaderboardStore.ts": {
    excluded: "An aggregate derived from the price, visit report and recommendation rows the lanes already carry.",
  },
  "lib/crawlStoryStore.ts": { excluded: "Editorial crawl stories, keyed on a crawl rather than on any account." },
  "lib/feedFreshnessStore.ts": { excluded: "Feed collection stamps, keyed on a dataset rather than on any account." },
  "lib/followStore.ts": { lane: "follows" },
  "lib/freshnessStoreOverlay.ts": { excluded: "An overlay over the freshness registry; the module holds no account rows at all." },
  "lib/harvestOverlayStore.ts": { excluded: "Harvested venue facts, keyed on an OSM id rather than on any account." },
  "lib/identityHandleStore.ts": {
    excluded:
      "The claimed handle is in the export's own `account` block. The alias table behind it is the rename ledger, keyed on the profile, and has no owner read.",
  },
  "lib/importNotesStore.ts": { excluded: "A developer import log under .data/; the module holds no account rows at all." },
  "lib/messagesStore.ts": { lane: "messages" },
  "lib/nightMemoryStore.ts": { lane: "memories" },
  "lib/nightProfileStore.ts": { lane: "nightProfile" },
  "lib/nightSignalStore.server.ts": { excluded: "Night signal ingest candidates, keyed on a venue rather than on any account." },
  "lib/notificationsStore.ts": {
    excluded: "Notifications we generated for the account out of other people's actions; nothing here was written by them.",
  },
  "lib/occupancyStore.ts": { lane: "crowdReports" },
  "lib/operatorFactsStore.ts": {
    excluded: "What a moderator published from a venue operator's proposal, keyed on a venue and shown as the pub's word, not a drinker's.",
  },
  "lib/operatorProposalsStore.ts": { excluded: "Venue operator proposals, keyed on a venue and answered by a moderator." },
  "lib/pendingPlanRecapStore.ts": {
    excluded: "A queue of recaps waiting to be written; a published recap rides its Plan, and the queue row is ours.",
  },
  "lib/pintDropsStore.ts": { lane: "pintDrops" },
  "lib/pintDropWithTagsStore.ts": {
    excluded:
      "A With tag is a consent record between two accounts: the proposal names another person and the approval is that person's, so no row here is this caller's alone.",
  },
  "lib/planBeaconStore.ts": { excluded: "An expiring table sign belongs to a shared Plan and can contain another member's private note, not this account's data." },
  "lib/planCollaborationStore.ts": { excluded: "A Plan is shared: its crew rows name other people." },
  "lib/planGroupPrefsStore.ts": { excluded: "Group preferences on a shared Plan, named by other members." },
  "lib/planInviteRsvpStore.ts": { excluded: "RSVPs on a shared Plan, named by other members." },
  "lib/planPresentationStore.ts": { excluded: "Mystery settings belong to a shared Plan and its host member capability, not an account. Device reveals are not stored here." },
  "lib/planStore.ts": { excluded: "A Plan is shared with the crew that joined it, so its rows are not one account's to take away." },
  "lib/presenceStore.ts": { excluded: "Ambient presence expires within the night and is never a durable record." },
  "lib/priceTrustEventStore.ts": {
    excluded: "Credit events derived from the price rows the `prices` lane already carries.",
  },
  "lib/privateIdentityStore.ts": { lane: "identity" },
  "lib/profileCoverPhotoStore.ts": { lane: "coverPhotos" },
  "lib/profileStore.ts": { lane: "profile" },
  "lib/pubPalStore.ts": {
    excluded: "Pal memories have their own export door, `/api/pub-pal/memories/export`.",
  },
  "lib/pubPalToolTurnStore.ts": {
    excluded:
      "Ephemeral ElevenLabs tool-turn correlation rows, keyed on a provider conversation id with no account id and service-role access only.",
  },
  "lib/diaryStore.ts": { lane: "diary" },
  "lib/pushTokenStore.ts": {
    excluded: "A live push endpoint for one device. It is a credential rather than content, and handing it back hands back a way to reach the device.",
  },
  "lib/ratingsStore.ts": { excluded: "Ratings are keyed on an actor hash, which proves no account." },
  "lib/reactionsStore.ts": { excluded: "Reactions are keyed on an actor hash, which proves no account." },
  "lib/referralStore.ts": {
    excluded: "Recognition marks derived from other accounts' arrivals; the invite code is minted on demand rather than stored as content.",
  },
  "lib/roundsStore.ts": { excluded: "A Round is shared with everybody who bought one; its rows name them." },
  "lib/savedPubsStore.ts": { lane: "savedPubs" },
  "lib/socialConnectionStore.ts": { lane: "socialLinks" },
  "lib/socialCrewStore.ts": { excluded: "A Crew is shared and its rows name its other members." },
  "lib/socialInteractionStore.ts": {
    gap: "A cheer, a save and a comment are the account's own actions, and every read here is keyed on a POST rather than on the actor.",
  },
  "lib/socialPostConsentStore.ts": {
    excluded: "One consent stamp per post, read back through the post itself.",
  },
  "lib/socialPostExtraPhotoStore.ts": { lane: "socialPosts" },
  "lib/socialPostReviewStore.ts": { lane: "socialPosts" },
  "lib/socialPostStore.ts": { lane: "socialPosts" },
  "lib/socialPostVideoStore.ts": { lane: "socialPosts" },
  "lib/socialPubRankingStore.ts": { lane: "pubRankings" },
  "lib/stepOutNudgeStore.ts": {
    excluded: "Push preferences and the day each nudge was last sent: a delivery record we keep, changed from the account's own settings surface.",
  },
  "lib/venueOperatorsStore.ts": { excluded: "Venue operator claims, keyed on a venue rather than on a drinker's own account." },
  "lib/venuePhotoStore.ts": { lane: "wallPhotos" },
  "lib/venueSubmissionStore.ts": { lane: "venueSubmissions" },
  "lib/venueCorrectionsStore.ts": { lane: "venueCorrections" },
  "lib/regularNightReportsStore.ts": { lane: "regularNightReports" },
  "lib/kitchenReportsStore.ts": { lane: "kitchenReports" },
  "lib/tableRequestsStore.ts": { lane: "tableRequests" },
  "lib/pubListImportDraftStore.server.ts": { lane: "pubListNightDrafts" },
  "lib/visitReportsStore.ts": { lane: "visitReports" },
  "lib/walkRouteStore.ts": { excluded: "Cached walking routes between two points, shared by every reader who asks for them." },
  "lib/wantedStore.ts": { lane: "wanted" },
  "lib/weatherRecommendationStore.ts": {
    gap: "A weather recommendation is the account's own contribution and, like the visit reports beside it, needs an owner-keyed read to export.",
  },
  "lib/weatherSnapshotStore.ts": { excluded: "Cached weather forecasts, keyed on a point rather than on any account." },
  "lib/whatsOnListingStore.ts": { excluded: "Listings we harvested from a public source, keyed on that source rather than on any account." },
  "lib/whatsOnStore.ts": { excluded: "Bundled baseline listings plus a live merge; the module holds no account rows at all." },
};

/**
 * The stores whose rows ARE the account's own content and are still not in the
 * file. Shrink-only: closing one is deleting its line here.
 */
const NAMED_GAPS = [
  "lib/socialInteractionStore.ts",
  "lib/weatherRecommendationStore.ts",
];

function storeModules(): string[] {
  return readdirSync(join(process.cwd(), "lib"))
    .filter((name) => /Store.*\.ts$/.test(name) && !name.endsWith(".d.ts"))
    .map((name) => `lib/${name}`)
    .filter((path) => path !== "lib/storeBackend.ts")
    .sort();
}

describe("every store is a lane or a named exclusion", () => {
  it("names every lib/*Store*.ts module, and nothing else", () => {
    expect(Object.keys(STORE_EXPORT_COVERAGE).sort()).toEqual(storeModules());
  });

  it("every lane row names a lane the document actually carries", () => {
    const lanes = new Set<string>(ACCOUNT_EXPORT_LANES);
    for (const [path, row] of Object.entries(STORE_EXPORT_COVERAGE)) {
      if ("lane" in row) expect(lanes.has(row.lane), `${path} names an unknown lane`).toBe(true);
    }
  });

  it("every lane in the document is fed by a store that says so", () => {
    const claimed = new Set(
      Object.values(STORE_EXPORT_COVERAGE)
        .filter((row): row is { lane: AccountExportLaneName } => "lane" in row)
        .map((row) => row.lane),
    );
    expect([...ACCOUNT_EXPORT_LANES].filter((lane) => !claimed.has(lane))).toEqual([]);
  });

  it("every exclusion and every gap argues itself in a sentence", () => {
    for (const [path, row] of Object.entries(STORE_EXPORT_COVERAGE)) {
      if ("lane" in row) continue;
      const reason = "excluded" in row ? row.excluded : row.gap;
      expect(reason.trim().length, `${path} needs a reason`).toBeGreaterThan(40);
    }
  });

  it("keeps the named-gap list to the ones argued for, and it may only shrink", () => {
    const gaps = Object.entries(STORE_EXPORT_COVERAGE)
      .filter(([, row]) => "gap" in row)
      .map(([path]) => path)
      .sort();
    expect(gaps).toEqual([...NAMED_GAPS].sort());
  });
});

describe("buildAccountExport reads every handle the account has held (LIB-S5)", () => {
  // A handle is text stamped on a row when it is written, and a rename never
  // rewrites an authored row. The export used to read every handle-keyed lane
  // by the CURRENT handle alone and still label each one `complete`, so a
  // person who had ever renamed was handed a subject-access file that silently
  // left out everything they wrote before it.
  const OLD = "old_owl";
  const oldDrop = { ...drop, id: "drop-old", handle: OLD } as unknown as PintDropDTO;
  const oldReport = { ...visitReport, id: "visit-old", handle: OLD } as unknown as VisitReportDTO;
  const oldCheckIn = { ...checkIn, id: "checkin-old", handle: OLD } as unknown as CheckIn;
  const oldSave = { ...savedPub, venueId: "venue-xjf3n0", venueName: "The Harp" } as unknown as SavedPubDTO;
  const oldConversation: ConversationDTO = {
    id: "conv-old",
    otherHandle: "jen",
    lastAt: "2026-08-01T12:05:00.000Z",
    lastFromMe: true,
    unread: 0,
  };
  const oldThread: MessageDTO[] = [
    {
      id: "msg-old-1",
      conversationId: "conv-old",
      senderHandle: OLD,
      body: "written before the rename",
      createdAt: "2026-08-01T12:00:00.000Z",
      read: true,
      flagged: false,
    },
    {
      id: "msg-old-2",
      conversationId: "conv-old",
      senderHandle: "jen",
      body: "jen's own words, not the caller's to export",
      createdAt: "2026-08-01T12:05:00.000Z",
      read: true,
      flagged: false,
    },
  ];

  const renamedDeps = (overrides: Partial<AccountExportDeps> = {}): AccountExportDeps =>
    fakeDeps({
      handlesForProfile: async (profileId) => (profileId === PROFILE ? ["night_owl", OLD] : []),
      pintDrops: async (handle) => (handle === OLD ? [oldDrop] : handle === "night_owl" ? [drop] : []),
      visitReports: async (handle) => ({
        status: "ready" as const,
        reports: handle === OLD ? [oldReport] : [visitReport],
      }),
      checkIns: async (handle) => (handle === OLD ? [oldCheckIn] : [checkIn]),
      follows: async (handle) => (handle === OLD ? ["jen", "bobpm"] : ["bobpm"]),
      savedPubs: async (handle) => ({
        status: "ready" as const,
        rows: handle === OLD ? [oldSave, savedPub] : [savedPub],
      }),
      conversations: async (handle) => ({
        conversations: handle === OLD ? [oldConversation, conversation] : [conversation],
        status: "ready" as const,
      }),
      messages: async (conversationId, handle) =>
        conversationId === "conv-old" ? (handle === OLD ? oldThread : null) : thread,
      ...overrides,
    });

  it("exports the rows written under an earlier handle in every handle-keyed lane", async () => {
    const document = await buildAccountExport(USER, renamedDeps(), NOW);

    expect(document.account.handle).toBe("night_owl");
    expect(document.pintDrops.items.map((item) => item.id).sort()).toEqual(["drop-1", "drop-old"]);
    expect(document.visitReports.items.map((item) => item.id).sort()).toEqual(["visit-1", "visit-old"]);
    expect(document.checkIns.items.map((item) => item.id).sort()).toEqual(["checkin-1", "checkin-old"]);
    // One follow held under both handles is one follow.
    expect([...document.follows.items].sort()).toEqual(["bobpm", "jen"]);
    expect(document.savedPubs.items.map((item) => item.venueId).sort()).toEqual([
      "venue-1f5ygjb",
      "venue-xjf3n0",
    ]);
    for (const lane of ACCOUNT_EXPORT_LANES) expect(document[lane].status).toBe("complete");
  });

  it("exports a conversation joined under an earlier handle, with the account's own words only", async () => {
    const document = await buildAccountExport(USER, renamedDeps(), NOW);

    // conv-1 is listed under both handles and exported once.
    expect(document.messages.items.map((item) => item.id).sort()).toEqual(["conv-1", "conv-old"]);
    const old = document.messages.items.find((item) => item.id === "conv-old");
    expect(old?.messages.map((message) => message.body)).toEqual(["written before the rename"]);
    expect(JSON.stringify(document)).not.toContain("jen's own words");
  });

  it("keeps a message the account sent by its profile id, whatever handle text it carries", async () => {
    const stray: MessageDTO = {
      id: "msg-stray",
      conversationId: "conv-1",
      senderHandle: "handle_nobody_recorded",
      body: "sent by this account",
      createdAt: "2026-09-05T12:07:00.000Z",
      read: true,
      flagged: false,
    };
    const document = await buildAccountExport(
      USER,
      renamedDeps({
        messages: async (conversationId, handle) =>
          conversationId === "conv-old" ? (handle === OLD ? oldThread : null) : [...thread, stray],
        ownMessageIds: async (profileId, conversationIds) => {
          expect(profileId).toBe(PROFILE);
          expect([...conversationIds].sort()).toEqual(["conv-1", "conv-old"]);
          return new Set(["msg-stray"]);
        },
      }),
      NOW,
    );
    const current = document.messages.items.find((item) => item.id === "conv-1");
    expect(current?.messages.map((message) => message.body)).toContain("sent by this account");
    expect(JSON.stringify(document)).not.toContain("bob's own words");
  });

  it("refuses every handle-keyed lane when the handles it held cannot be read", async () => {
    const document = await buildAccountExport(
      USER,
      renamedDeps({
        handlesForProfile: async () => {
          throw new Error("alias table unreadable");
        },
      }),
      NOW,
    );
    expect([...unavailableExportLanes(document)].sort()).toEqual(
      ["checkIns", "follows", "messages", "pintDrops", "savedPubs", "visitReports"].sort(),
    );
  });

  it("refuses the messages lane when the sender read fails, rather than handing over a partial thread", async () => {
    const document = await buildAccountExport(
      USER,
      renamedDeps({
        ownMessageIds: async () => {
          throw new Error("messages unreadable");
        },
      }),
      NOW,
    );
    expect(unavailableExportLanes(document)).toEqual(["messages"]);
  });

  it("refuses the lane when any one handle's read is degraded", async () => {
    const document = await buildAccountExport(
      USER,
      renamedDeps({
        visitReports: async (handle) =>
          handle === OLD
            ? { status: "degraded" as const, reports: [] }
            : { status: "ready" as const, reports: [visitReport] },
        conversations: async (handle) =>
          handle === OLD
            ? { conversations: [], status: "degraded" as const }
            : { conversations: [conversation], status: "ready" as const },
      }),
      NOW,
    );
    expect([...unavailableExportLanes(document)].sort()).toEqual(["messages", "visitReports"]);
  });
});
