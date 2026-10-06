// CONTACT, EVENT AND POLL: what each new attachment kind stores, and what its
// card is allowed to say.
//
// Rule 5 of `lib/messageAttachments.ts` is the subject: an id is stored and a
// card is RESOLVED, so a rename reads correctly in an old thread. The two
// narrower rules that ride with it are the ones worth a fence of their own:
//
//  • A CONTACT CARD IS THE PUBLIC PROFILE. Passing somebody's handle on in a
//    message may not be a way around the owner-authenticated profile read.
//  • AN EVENT CARD IS THE PLAN'S ANONYMOUS PREVIEW. A message is not a
//    capability, so no venue, no stop and no crew member may cross.

import type { Route } from "next";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  isMessageContactHandle,
  isMessageEventPlanId,
  MESSAGE_ATTACHMENT_KINDS,
  MESSAGE_RESOLVED_CARD_KINDS,
  messageAttachmentPreview,
  messageContactCardLabel,
  messageContactProfileUrl,
  messageEventCardLabel,
  messageEventPlanUrl,
  messageEventStopLine,
  readMessageContactHandle,
  readMessageEventPlanId,
} from "@/lib/messageAttachments";
import {
  __resetMemoryMessages,
  memoryMessagesStore,
} from "@/lib/messagesStore";

const PLAN_ID = "3f1d1ad0-1111-4111-8111-111111111111";

const profiles = new Map<string, Record<string, unknown>>();
const plans = new Map<string, unknown>();

// Only the STORE is stubbed. `isProfileTombstoned` and `publicOwnedImageUrl`
// are the real ones on purpose: they are the doors the contact card has to be
// held to, and a stubbed door proves nothing about the card that walks through
// it.
vi.mock("@/lib/profileStore", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/profileStore")>()),
  profileStore: () => ({
    getByHandle: async (handle: string) => profiles.get(handle) ?? null,
  }),
}));

vi.mock("@/lib/planStore", () => ({
  planStore: () => ({
    get: async (id: string) => plans.get(id) ?? null,
  }),
}));

beforeEach(() => {
  __resetMemoryMessages();
  profiles.clear();
  plans.clear();
});

describe("the ids each kind stores", () => {
  it("previews every kind, so no inbox row is ever blank", () => {
    for (const kind of MESSAGE_ATTACHMENT_KINDS) {
      expect(messageAttachmentPreview(kind)).toBeTruthy();
    }
    expect(messageAttachmentPreview("contact")).toBe("Contact");
    expect(messageAttachmentPreview("event")).toBe("Plan");
    expect(messageAttachmentPreview("poll")).toBe("Poll");
  });

  it("names which kinds are RESOLVED on the read path", () => {
    // A photo carries its own bytes and a poll its own ballot, so neither is
    // resolved from an id.
    expect([...MESSAGE_RESOLVED_CARD_KINDS]).toEqual(["venue", "contact", "event"]);
  });

  it("takes a handle through the one handle alphabet", () => {
    expect(readMessageContactHandle("@Sam")).toBe("sam");
    expect(readMessageContactHandle("  sam  ")).toBe("sam");
    expect(readMessageContactHandle("!!!")).toBeNull();
    expect(readMessageContactHandle(42)).toBeNull();
    expect(isMessageContactHandle("sam")).toBe(true);
    expect(isMessageContactHandle("Sam Smith")).toBe(false);
  });

  it("takes a plan id as a uuid, because the column is one", () => {
    expect(isMessageEventPlanId(PLAN_ID)).toBe(true);
    expect(isMessageEventPlanId("plan-1")).toBe(false);
    expect(isMessageEventPlanId("")).toBe(false);
    expect(readMessageEventPlanId(` ${PLAN_ID.toUpperCase()} `)).toBe(PLAN_ID);
  });

  it("builds its two links through one helper each", () => {
    expect(messageContactProfileUrl("sam")).toBe("/u/sam" as Route);
    expect(messageEventPlanUrl(PLAN_ID)).toBe(`/plan/${PLAN_ID}`);
  });

  it("names a card for a reader who cannot see it", () => {
    expect(
      messageContactCardLabel({
        handle: "sam",
        displayName: "Sam",
        avatarUrl: null,
        profileUrl: "/u/sam" as Route,
      }),
    ).toBe("Sam, @sam. Open profile");
    expect(
      messageEventCardLabel({
        planId: PLAN_ID,
        hostDisplayName: "Ken",
        areaName: "Shoreditch",
        startLabel: "19:00",
        stopCount: 3,
        routeReady: true,
        planUrl: "/plan/x" as Route,
      }),
    ).toBe("Ken's plan in Shoreditch, from 19:00. Open the plan");
    // The stop COUNT is the card's own line, never part of the link name.
    expect(messageEventStopLine(1)).toBe("1 stop");
    expect(messageEventStopLine(3)).toBe("3 stops");
    expect(messageEventStopLine(0)).toBeNull();
  });
});

describe("a contact card is the PUBLIC profile and nothing else", () => {
  it("resolves the handle, the published name and the approved face", async () => {
    profiles.set("sam", {
      id: "profile-sam",
      handle: "sam",
      displayName: "Sam Smith",
      // The LEGACY hotlinked column. It crosses no other public wire, so it may
      // not cross this one either.
      avatarUrl: "https://elsewhere.example/hotlinked.jpg",
      avatarObjectKey: "avatars/profile-sam/gen-7/image.jpg",
      avatarGeneration: "gen-7",
      avatarModerationState: "approved",
      email: "sam@example.com",
      dateOfBirth: "1990-01-01",
      homeCity: "Hackney",
      fullName: "Samantha Example",
    });
    const { resolveMessageContactCard } = await import("@/lib/messageAttachmentCards.server");
    const card = await resolveMessageContactCard("@Sam");
    expect(card).toEqual({
      handle: "sam",
      displayName: "Sam Smith",
      avatarUrl: "/api/avatar/profile-sam/gen-7",
      profileUrl: "/u/sam" as Route,
    });
    // The WHOLE serialized card, not the fields somebody remembered to check.
    const serialized = JSON.stringify(card);
    for (const secret of [
      "sam@example.com",
      "1990-01-01",
      "Hackney",
      "Samantha Example",
      "elsewhere.example",
    ]) {
      expect(serialized).not.toContain(secret);
    }
  });

  it("prints NO face when the owned avatar is not approved", async () => {
    // The moderation door is the same one /u/<handle> reads a face through.
    // Handing somebody's handle on in a message may not walk around it, and a
    // refused or still-pending avatar is the case that would.
    const { resolveMessageContactCard } = await import("@/lib/messageAttachmentCards.server");
    for (const state of ["pending", "refused", undefined]) {
      profiles.set("sam", {
        id: "profile-sam",
        handle: "sam",
        displayName: "Sam Smith",
        avatarUrl: "https://elsewhere.example/hotlinked.jpg",
        avatarObjectKey: "avatars/profile-sam/gen-7/image.jpg",
        avatarGeneration: "gen-7",
        ...(state ? { avatarModerationState: state } : {}),
      });
      await expect(resolveMessageContactCard("sam")).resolves.toMatchObject({
        avatarUrl: null,
      });
    }
  });

  it("answers NOTHING for an unknown or retired handle, never a guessed name", async () => {
    profiles.set("ghost", { handle: "ghost", displayName: "Ghost", tombstonedAt: "2026-01-01" });
    const { resolveMessageContactCard } = await import("@/lib/messageAttachmentCards.server");
    await expect(resolveMessageContactCard("ghost")).resolves.toBeNull();
    await expect(resolveMessageContactCard("nobody")).resolves.toBeNull();
    await expect(resolveMessageContactCard("!!")).resolves.toBeNull();
  });

  it("does not repeat the handle as a display name", async () => {
    profiles.set("sam", { handle: "sam", displayName: "Sam" });
    const { resolveMessageContactCard } = await import("@/lib/messageAttachmentCards.server");
    // "Sam" IS the handle in different case, so printing it twice reads as a bug.
    await expect(resolveMessageContactCard("sam")).resolves.toMatchObject({
      displayName: null,
    });
  });
});

describe("an event card is the plan's ANONYMOUS preview", () => {
  const planState = {
    plan: { id: PLAN_ID, startTime: "2026-09-17T19:00:00+01:00" },
    crew: [{ name: "Ken" }],
    context: { nightArea: "shoreditch", accessibility: [] },
    stops: [
      { venueId: "venue-blackfriar", venueName: "The Blackfriar" },
      { venueId: "venue-harp", venueName: "The Harp" },
    ],
  };

  it("carries the preview's fields and NEVER a venue, a stop or the crew", async () => {
    plans.set(PLAN_ID, planState);
    const { resolveMessageEventCard } = await import("@/lib/messageAttachmentCards.server");
    const card = await resolveMessageEventCard(PLAN_ID);
    expect(card).toMatchObject({
      planId: PLAN_ID,
      hostDisplayName: "Ken",
      stopCount: 2,
      planUrl: `/plan/${PLAN_ID}`,
    });
    // A message is not a capability. The WHOLE body is checked, because a
    // reader who only looked at the fields they remembered is how a venue name
    // reaches a card nobody meant to put it on.
    const serialized = JSON.stringify(card);
    for (const withheld of ["venue-blackfriar", "The Blackfriar", "venue-harp", "The Harp"]) {
      expect(serialized).not.toContain(withheld);
    }
  });

  it("answers NOTHING for an unknown plan", async () => {
    const { resolveMessageEventCard } = await import("@/lib/messageAttachmentCards.server");
    await expect(resolveMessageEventCard(PLAN_ID)).resolves.toBeNull();
    await expect(resolveMessageEventCard("")).resolves.toBeNull();
  });

  it("fills every card in one thread, and a read that threw carries null", async () => {
    plans.set(PLAN_ID, planState);
    profiles.set("sam", { handle: "sam", displayName: "Sam Smith" });
    const { attachMessageAttachmentCards } = await import(
      "@/lib/messageAttachmentCards.server"
    );
    const resolved = await attachMessageAttachmentCards([
      {
        id: "m1",
        conversationId: "c1",
        senderHandle: "ken",
        body: "",
        createdAt: "2026-09-17T10:00:00Z",
        read: false,
        flagged: false,
        attachment: { kind: "contact", handle: "sam", card: null },
      },
      {
        id: "m2",
        conversationId: "c1",
        senderHandle: "ken",
        body: "",
        createdAt: "2026-09-17T10:01:00Z",
        read: false,
        flagged: false,
        attachment: { kind: "event", planId: PLAN_ID, card: null },
      },
      {
        id: "m3",
        conversationId: "c1",
        senderHandle: "ken",
        body: "",
        createdAt: "2026-09-17T10:02:00Z",
        read: false,
        flagged: false,
        attachment: { kind: "contact", handle: "nobody", card: null },
      },
    ]);
    expect(resolved[0]?.attachment).toMatchObject({
      kind: "contact",
      card: { handle: "sam", displayName: "Sam Smith" },
    });
    expect(resolved[1]?.attachment).toMatchObject({ kind: "event" });
    expect(resolved[2]?.attachment).toMatchObject({ kind: "contact", card: null });
  });
});

describe("the store round-trips every kind, and a report takes it down", () => {
  it("stores an id and reads back an unresolved card", async () => {
    const id = (await memoryMessagesStore.openConversation("ken", "sam"))!;
    await memoryMessagesStore.send(id, "ken", "this is her", {
      kind: "contact",
      handle: "jen",
    });
    await memoryMessagesStore.send(id, "ken", "", { kind: "event", planId: PLAN_ID });
    const thread = await memoryMessagesStore.listMessages(id, "sam");
    expect(thread?.[0]?.attachment).toEqual({ kind: "contact", handle: "jen", card: null });
    expect(thread?.[1]?.attachment).toEqual({ kind: "event", planId: PLAN_ID, card: null });
  });

  it("drops the attachment off a REPORTED message, whatever kind it was", async () => {
    const id = (await memoryMessagesStore.openConversation("ken", "sam"))!;
    const sent = await memoryMessagesStore.send(id, "ken", "look", {
      kind: "contact",
      handle: "jen",
    });
    await memoryMessagesStore.report(id, sent!.message.id, "sam");
    const thread = await memoryMessagesStore.listMessages(id, "sam");
    // The row and its provenance stay for a moderator; the card stops travelling.
    expect(thread?.[0]?.attachment).toBeUndefined();
    expect(thread?.[0]?.flagged).toBe(true);
  });

  it("previews each kind in the inbox rather than a blank row", async () => {
    const id = (await memoryMessagesStore.openConversation("ken", "sam"))!;
    await memoryMessagesStore.send(id, "ken", "", { kind: "contact", handle: "jen" });
    const afterContact = await memoryMessagesStore.listConversations("sam");
    expect(afterContact.conversations[0]?.lastBody).toBe("Contact");
    await memoryMessagesStore.send(id, "ken", "", { kind: "event", planId: PLAN_ID });
    const afterEvent = await memoryMessagesStore.listConversations("sam");
    expect(afterEvent.conversations[0]?.lastBody).toBe("Plan");
  });
});
