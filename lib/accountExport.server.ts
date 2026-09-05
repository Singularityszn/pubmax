import "server-only";

// The reads behind an account's own export, assembled into the ONE document
// `lib/accountExport.ts` defines.
//
// Every lane goes through the store that already owns it, so this module is a
// second authority on nothing: Memories and Moments through `nightMemoryStore`,
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
  type AccountExportMemory,
  type AccountExportMessage,
  type AccountExportPintDrop,
  type AccountExportPrice,
} from "@/lib/accountExport";
import {
  listCommunityPriceObservationsForActor,
  type CommunityPriceObservation,
} from "@/lib/communityPriceStore";
import { normalizeHandle } from "@/lib/handleNormalize";
import type { MessageDTO } from "@/lib/messages";
import { messagesStore, type InboxRead } from "@/lib/messagesStore";
import type { NightMemory, NightMoment } from "@/lib/nightMemory";
import { listNightMemories, listNightMoments } from "@/lib/nightMemoryStore";
import { pintDropsStore, type PintDropDTO } from "@/lib/pintDropsStore";
import { profileStore } from "@/lib/profileStore";

/** The stable actor token a community price row carries for a profile. */
function profileActor(profileId: string): string {
  return `profile:${profileId}`;
}

/**
 * Everything the export reaches for, as one seam. The default is the stores;
 * a test hands in fakes and asserts the document.
 */
export type AccountExportDeps = {
  profileForUser(
    userId: string,
  ): Promise<{ id: string; handle: string; displayName: string | null } | null>;
  memories(userId: string): Promise<NightMemory[]>;
  moments(userId: string, memoryId: string): Promise<NightMoment[]>;
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
        ? { id: profile.id, handle: profile.handle, displayName: profile.displayName ?? null }
        : null;
    },
    memories: (userId) => listNightMemories(userId),
    moments: (userId, memoryId) => listNightMoments(userId, memoryId),
    prices: (actor, limit) => listCommunityPriceObservationsForActor(actor, limit),
    pintDrops: (handle) =>
      pintDropsStore().listVisible(undefined, { handle }, handle, null),
    conversations: (handle) => messagesStore().listConversations(handle),
    messages: (conversationId, handle) => messagesStore().listMessages(conversationId, handle),
  };
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

function exportMessage(message: MessageDTO): AccountExportMessage {
  const attachment = message.attachment;
  return {
    id: message.id,
    conversationId: message.conversationId,
    body: message.body,
    createdAt: message.createdAt,
    attachment: !attachment
      ? null
      : attachment.kind === "photo"
        ? { kind: "photo" }
        : { kind: "venue", venueId: attachment.venueId },
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
  const profile = await deps.profileForUser(userId).catch(() => null);
  const handle = profile ? normalizeHandle(profile.handle) || null : null;

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
    if (!profile) return boundedLane<AccountExportPrice>([]);
    try {
      const read = await deps.prices(profileActor(profile.id), ACCOUNT_EXPORT_LANE_CAP + 1);
      if (read.degraded) return unavailableLane<AccountExportPrice>();
      return boundedLane(read.observations.map(exportPrice));
    } catch {
      return unavailableLane<AccountExportPrice>();
    }
  })();

  const pintDrops = await (async () => {
    if (!handle) return boundedLane<AccountExportPintDrop>([]);
    try {
      return boundedLane((await deps.pintDrops(handle)).map(exportPintDrop));
    } catch {
      return unavailableLane<AccountExportPintDrop>();
    }
  })();

  const messages = await (async () => {
    if (!handle) return boundedLane<AccountExportConversation>([]);
    try {
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

  return {
    version: ACCOUNT_EXPORT_VERSION,
    exportedAt,
    account: {
      userId,
      handle,
      displayName: profile?.displayName ?? null,
    },
    memories,
    prices,
    pintDrops,
    messages,
  };
}
