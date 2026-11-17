// What a message may carry beside its words, and what a surface may say about
// it. The pure half of the attachment lane, plus the SQL shape the store leans
// on and the one projection both backends read.
//
// THE RULES BEING FENCED, in the order they would break:
//   - the set is closed at two, and a photo's key names its own conversation;
//   - a pub card holds no coordinate of any kind, so the viewer-coordinate
//     egress law is untouched;
//   - a figure on a card names the drink, because a bare number beside a pub
//     name reads as tonight's pint;
//   - a reported message stops carrying its photo, in the ONE projection both
//     the durable and the in-memory backend read.

import type { Route } from "next";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  isMessagePhotoServingKey,
  isMessageVenueId,
  MESSAGE_ATTACHMENT_KINDS,
  MESSAGE_ATTACH_CONTACT_LABEL,
  MESSAGE_ATTACH_EVENT_LABEL,
  MESSAGE_ATTACH_POLL_LABEL,
  MESSAGE_CONTACT_OPEN_LABEL,
  MESSAGE_EVENT_OPEN_LABEL,
  messageContactCardLabel,
  messageEventCardLabel,
  messagePhotoAltText,
  messagePhotoServePath,
  messagePhotoServingKey,
  messagePhotoStagingKey,
  messageVenueCardLabel,
  messageVenuePriceLine,
  type MessageVenueCard,
} from "@/lib/messageAttachments";
import { cleanAttachedBody, cleanBody } from "@/lib/messages";
import { __resetMemoryMessages, memoryMessagesStore } from "@/lib/messagesStore";
import { defined } from "@/__tests__/helpers/defined";

vi.mock("@/lib/venueIndex", () => ({
  lookupCanonicalVenue: async () => ({
    status: "found", canonicalId: "v1",
    venue: { id: "v1", name: "The Coach and Horses", borough: "Soho", lat: 51.514, lng: -0.132 },
    slimVenue: { kind: "pub", cheapestPrice: 5.4, lat: 51.514, lng: -0.132 },
  }),
}));

describe("the attachment set is closed at five", () => {
  it("names exactly a photo, a pub, a contact, an event and a poll", () => {
    // The set is CLOSED, so widening it is a decision somebody takes here and
    // in migration 0156 together, never a kind a route invents.
    expect([...MESSAGE_ATTACHMENT_KINDS]).toEqual([
      "photo",
      "venue",
      "contact",
      "event",
      "poll",
    ]);
  });

  it("keys a photo to its own conversation and message", () => {
    expect(messagePhotoServingKey("conv-1", "msg-9")).toBe("messages/conv-1/msg-9.jpg");
    // Siblings, not nested: a listing of the conversation prefix never confuses
    // a message's folder for a file.
    expect(messagePhotoStagingKey("conv-1", "msg-9")).toBe("messages/conv-1/msg-9.staging.jpg");
    expect(messagePhotoServePath("conv-1", "msg-9")).toBe("/api/messages/conv-1/photo/msg-9");
  });

  it("refuses a key that belongs to another conversation or the staging lane", () => {
    expect(isMessagePhotoServingKey("conv-1", "msg-9", "messages/conv-1/msg-9.jpg")).toBe(true);
    expect(isMessagePhotoServingKey("conv-1", "msg-9", "messages/conv-2/msg-9.jpg")).toBe(false);
    expect(isMessagePhotoServingKey("conv-1", "msg-9", "messages/conv-1/msg-8.jpg")).toBe(false);
    expect(
      isMessagePhotoServingKey("conv-1", "msg-9", "messages/conv-1/msg-9.staging.jpg"),
    ).toBe(false);
    expect(isMessagePhotoServingKey("conv-1", "msg-9", "avatars/conv-1/msg-9.jpg")).toBe(false);
  });


});

describe("a pub card holds a pub, never a place", () => {
  it("admits an ordinary venue id and refuses one that could walk a path", () => {
    expect(isMessageVenueId("ldn-coach-and-horses")).toBe(true);
    expect(isMessageVenueId("uk_base:osm:node:123")).toBe(true);
    expect(isMessageVenueId("../../etc/passwd")).toBe(false);
    expect(isMessageVenueId("a/b")).toBe(false);
    expect(isMessageVenueId("")).toBe(false);
    expect(isMessageVenueId("x".repeat(65))).toBe(false);
  });

  it("serializes a shared pub without coordinates from the input or resolved venue", async () => {
    __resetMemoryMessages();
    const conversationId = (await memoryMessagesStore.openConversation("ken", "sam"))!;
    const attachment = { kind: "venue" as const, venueId: "v1", lat: 51.514, lng: -0.132, point: [51.514, -0.132] };
    const sent = await memoryMessagesStore.send(conversationId, "ken", "", attachment);
    const { attachMessageAttachmentCards } = await import("@/lib/messageAttachmentCards.server");
    for (const messages of [[sent!.message], (await memoryMessagesStore.listMessages(conversationId, "sam"))!]) {
      const resolved = await attachMessageAttachmentCards(messages);
      expect(JSON.parse(JSON.stringify(resolved[0]!.attachment))).toEqual({
        kind: "venue", venueId: "v1",
        card: { venueId: "v1", name: "The Coach and Horses", area: "Soho", priceGbp: 5.4, mapUrl: "/map?sel=v1" },
      });
    }
  });

  it("names the drink beside the figure, and stays silent without one", () => {
    // A bare "£5.40" beside a pub name is the masquerade the pin label rule
    // exists to stop.
    expect(messageVenuePriceLine(5.4)).toBe("Cheapest pint £5.40");
    expect(messageVenuePriceLine(6)).toBe("Cheapest pint £6.00");
    expect(messageVenuePriceLine(null)).toBeNull();
    expect(messageVenuePriceLine(0)).toBeNull();
    expect(messageVenuePriceLine(Number.NaN)).toBeNull();
  });

  it("names the pub and where it is, and leaves the figure out of the link name", () => {
    const card = {
      venueId: "v1",
      name: "The Coach and Horses",
      area: "Soho",
      priceGbp: 5.4,
      mapUrl: "/map?sel=v1",
    } satisfies MessageVenueCard;
    expect(messageVenueCardLabel(card)).toBe("The Coach and Horses, Soho. Open on the map");
    expect(messageVenueCardLabel({ ...card, area: "" })).toBe(
      "The Coach and Horses. Open on the map",
    );
    expect(messageVenueCardLabel(card)).not.toContain("5.40");
  });

  it("names the sender in a photo's accessible name, never the file", () => {
    expect(messagePhotoAltText("sam")).toBe("Photo from @sam");
    expect(messagePhotoAltText("")).toBe("Photo in this conversation");
  });
});

describe("a body is only required when nothing else is", () => {
  it("keeps refusing an empty text-only message", () => {
    expect(cleanBody("   ")).toBeNull();
    expect(cleanBody("hi")).toBe("hi");
  });

  it("lets a photo travel without a caption", () => {
    // Refusing this would make the words the point of a picture.
    expect(cleanAttachedBody("   ")).toBe("");
    expect(cleanAttachedBody(undefined)).toBe("");
    expect(cleanAttachedBody(" hello ")).toBe("hello");
  });
});

describe("a reported message stops carrying its photo", () => {
  beforeEach(() => {
    __resetMemoryMessages();
  });

  it("drops the attachment from the read the moment the row is flagged", async () => {
    const conversationId = await memoryMessagesStore.openConversation("ken", "sam");
    expect(conversationId).toBeTruthy();
    const messageId = "11111111-2222-4333-8444-555555555555";
    const sent = await memoryMessagesStore.send(conversationId!, "ken", "", {
      kind: "photo",
      messageId,
      objectKey: messagePhotoServingKey(conversationId!, messageId),
      width: 1080,
      height: 1350,
    });
    expect(sent?.message.attachment).toEqual({
      kind: "photo",
      url: messagePhotoServePath(conversationId!, messageId),
      width: 1080,
      height: 1350,
    });
    expect(await memoryMessagesStore.photoObjectKey(conversationId!, messageId, "sam")).toBe(
      messagePhotoServingKey(conversationId!, messageId),
    );

    expect(await memoryMessagesStore.report(conversationId!, messageId, "sam")).toBe(true);

    const after = await memoryMessagesStore.listMessages(conversationId!, "sam");
    expect(defined(after?.[0]).flagged).toBe(true);
    expect(defined(after?.[0]).attachment).toBeUndefined();
    // The bytes stop being reachable at the same moment, through the same
    // projection, not through a second copy of the rule.
    expect(
      await memoryMessagesStore.photoObjectKey(conversationId!, messageId, "sam"),
    ).toBeNull();
  });

  it("hands an outsider nothing, and says nothing about whether the id exists", async () => {
    const conversationId = await memoryMessagesStore.openConversation("ken", "sam");
    const messageId = "11111111-2222-4333-8444-666666666666";
    await memoryMessagesStore.send(conversationId!, "ken", "", {
      kind: "photo",
      messageId,
      objectKey: messagePhotoServingKey(conversationId!, messageId),
      width: 1080,
      height: 1350,
    });
    expect(
      await memoryMessagesStore.photoObjectKey(conversationId!, messageId, "mallory"),
    ).toBeNull();
    expect(
      await memoryMessagesStore.photoObjectKey(conversationId!, "no-such-message", "sam"),
    ).toBeNull();
  });
});

describe("attachment card accessible names", () => {
  it("ends contact and event card labels with the shared open copy", () => {
    expect(MESSAGE_CONTACT_OPEN_LABEL).toBe("Open profile");
    expect(MESSAGE_EVENT_OPEN_LABEL).toBe("Open the plan");
    expect(messageContactCardLabel({ handle: "ada", displayName: null, avatarUrl: null, profileUrl: "/u/ada" as Route })).toContain(
      MESSAGE_CONTACT_OPEN_LABEL,
    );
    expect(
      messageEventCardLabel({
        planId: "p1",
        hostDisplayName: "Ada",
        areaName: "Clapham",
        startLabel: "Friday 8pm",
        stopCount: 2,
        routeReady: true,
        planUrl: "/plan/p1" as Route,
      }),
    ).toContain(MESSAGE_EVENT_OPEN_LABEL);
  });

  it("keeps long attach labels for non-file picker controls", () => {
    expect(MESSAGE_ATTACH_CONTACT_LABEL).toBe("Share a handle");
    expect(MESSAGE_ATTACH_EVENT_LABEL).toBe("Share a plan");
    expect(MESSAGE_ATTACH_POLL_LABEL).toBe("Start a poll");
  });
});
