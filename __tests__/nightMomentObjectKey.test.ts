import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * A Night Moment used to store mediaObjectKey from JSON, then sign and delete
 * that key with the service role. The probe posted keys under avatars, messages
 * and a venue receipt, read a signed URL for each, and watched DELETE hand the
 * same keys to storage.
 */

const removedKeys: string[] = [];

vi.mock("@/lib/supabase", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/supabase")>();
  return { ...actual, isSupabaseConfigured: () => false };
});
vi.mock("@/lib/authServer", () => {
  const bearer = (request: Request) =>
    request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") || null;
  return {
    callerUserId: async (request: Request) => bearer(request),
    verifyCallerAuth: async (request: Request) => {
      const id = bearer(request);
      return id
        ? { status: "verified" as const, identity: { id, email: null, createdAt: null } }
        : { status: "absent" as const };
    },
  };
});
vi.mock("@/lib/pintDropsStore", () => ({
  deletePhotos: async (keys: string[]) => {
    removedKeys.push(...keys);
  },
  uploadPhoto: async () => {
    throw new Error("this probe does not upload");
  },
}));

import { DELETE as REMOVE_MEMORY } from "@/app/api/night-memories/[id]/route";
import { GET as LIST_MOMENTS, POST as ADD_MOMENT } from "@/app/api/night-memories/[id]/moments/route";
import { DELETE as REMOVE_MOMENT } from "@/app/api/night-moments/[id]/route";
import { __resetNightMemoryStore, addNightMoment, createNightMemory } from "@/lib/nightMemoryStore";

const HOST = "host-owner";
const FOREIGN_KEYS = [
  "avatars/profile-1/photo.jpg",
  "messages/conversation-1/photo.jpg",
  "venue-1/drop-1/receipt.jpg",
] as const;

const ctx = (id: string) => ({ params: Promise.resolve({ id }) });

function jsonPost(memoryId: string, mediaObjectKey: string) {
  return new Request(`http://localhost/api/night-memories/${memoryId}/moments`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${HOST}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      kind: "photo",
      caption: "A line the probe keeps so the Moment is accepted",
      mediaObjectKey,
    }),
  });
}

describe("Night Moment storage keys stay inside the owner's prefix", () => {
  beforeEach(() => {
    __resetNightMemoryStore();
    removedKeys.length = 0;
  });

  it("drops a JSON key for an avatar, a message photo and a receipt, and signs none of them", async () => {
    const memory = await createNightMemory(HOST, { title: "Friday" });
    expect(memory).not.toBeNull();
    if (!memory) return;

    for (const key of FOREIGN_KEYS) {
      const response = await ADD_MOMENT(jsonPost(memory.id, key), ctx(memory.id));
      expect(response.status).toBe(201);
      const body = await response.json() as { moment: { mediaObjectKey: string | null; mediaUrl: string | null } };
      expect(body.moment.mediaObjectKey).toBeNull();
      expect(body.moment.mediaUrl).toBeNull();
    }

    const listed = await LIST_MOMENTS(
      new Request(`http://localhost/api/night-memories/${memory.id}/moments`, {
        headers: { authorization: `Bearer ${HOST}` },
      }),
      ctx(memory.id),
    );
    const moments = (await listed.json() as {
      moments: Array<{ mediaObjectKey: string | null; mediaUrl: string | null }>;
    }).moments;
    expect(moments).toHaveLength(FOREIGN_KEYS.length);
    expect(moments.every((moment) => moment.mediaObjectKey === null && moment.mediaUrl === null)).toBe(true);
    expect(removedKeys).toEqual([]);
  });

  it("does not delete a stored key outside the owner's prefix, and does delete one inside it", async () => {
    const memory = await createNightMemory(HOST, { title: "Friday" });
    expect(memory).not.toBeNull();
    if (!memory) return;

    const planted = [];
    for (const key of [
      ...FOREIGN_KEYS,
      `night-moments/${HOST}/../../avatars/photo.jpg`,
      `night-moments/someone-else/${memory.id}/photo.jpg`,
    ]) {
      const moment = await addNightMoment(HOST, memory.id, {
        kind: "photo",
        caption: "already stored",
      }, { mediaObjectKey: key });
      expect(moment?.mediaObjectKey).toBe(key);
      planted.push(moment!);
    }

    const listed = await LIST_MOMENTS(
      new Request(`http://localhost/api/night-memories/${memory.id}/moments`, {
        headers: { authorization: `Bearer ${HOST}` },
      }),
      ctx(memory.id),
    );
    const listedMoments = (await listed.json() as {
      moments: Array<{ id: string; mediaUrl: string | null }>;
    }).moments;
    for (const moment of planted) {
      expect(listedMoments.find((row) => row.id === moment.id)?.mediaUrl).toBeNull();
    }

    for (const moment of planted) {
      const response = await REMOVE_MOMENT(
        new Request(`http://localhost/api/night-moments/${moment.id}`, {
          method: "DELETE",
          headers: { authorization: `Bearer ${HOST}` },
        }),
        ctx(moment.id),
      );
      expect(response.status).toBe(200);
    }
    expect(removedKeys).toEqual([]);

    const ownedKey = `night-moments/${HOST}/${memory.id}/photo.jpg`;
    const owned = await addNightMoment(HOST, memory.id, {
      kind: "photo",
      caption: "mine",
    }, { mediaObjectKey: ownedKey });
    expect(owned).not.toBeNull();
    if (!owned) return;
    const removed = await REMOVE_MOMENT(
      new Request(`http://localhost/api/night-moments/${owned.id}`, {
        method: "DELETE",
        headers: { authorization: `Bearer ${HOST}` },
      }),
      ctx(owned.id),
    );
    expect(removed.status).toBe(200);
    expect(removedKeys).toEqual([ownedKey]);
  });

  it("a Memory delete does not hand a foreign key to storage", async () => {
    const memory = await createNightMemory(HOST, { title: "Friday" });
    expect(memory).not.toBeNull();
    if (!memory) return;
    await addNightMoment(HOST, memory.id, {
      kind: "photo",
      caption: "receipt",
    }, { mediaObjectKey: "venue-1/drop-1/receipt.jpg" });

    const response = await REMOVE_MEMORY(
      new Request(`http://localhost/api/night-memories/${memory.id}`, {
        method: "DELETE",
        headers: { authorization: `Bearer ${HOST}` },
      }),
      ctx(memory.id),
    );
    expect(response.status).toBe(200);
    expect(removedKeys).toEqual([]);
  });
});
