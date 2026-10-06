import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Taking a private Memory or Moment back (D06).
 *
 * The contribution battle test of 5 September 2026 found the studio could
 * create a Memory, add a Moment and publish a Story, and never remove any of
 * it: no DELETE handler existed anywhere under `app/api/night-*`. These are the
 * three doors that matter for a private thing (the owner, somebody else, and
 * nobody), plus the two refusals that keep another person's work out of a
 * delete.
 */
vi.mock("@/lib/supabase", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/supabase")>();
  return { ...actual, isSupabaseConfigured: () => false };
});
vi.mock("@/lib/authServer", () => ({
  verifyCallerAuth: async (request: Request) => {
    const id = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
    return id
      ? { status: "verified" as const, identity: { id, email: null, createdAt: null } }
      : { status: "absent" as const };
  },
}));

const removedPhotoKeys: string[] = [];
vi.mock("@/lib/nightMomentMedia", () => ({
  removeNightMomentPhoto: async (key: string) => {
    removedPhotoKeys.push(key);
  },
  signedNightMomentPhotoUrl: async () => null,
  uploadNightMomentPhoto: async () => "night-moments/host/photo.webp",
}));

import { DELETE as REMOVE_MEMORY } from "@/app/api/night-memories/[id]/route";
import { DELETE as REMOVE_MOMENT } from "@/app/api/night-moments/[id]/route";
import {
  __resetNightMemoryStore,
  acceptStoryContribution,
  addNightMoment,
  addStoryMoment,
  confirmNightStoryPublication,
  createNightMemory,
  createNightStory,
  listNightMemories,
  listNightMoments,
  proposeNightStoryPublication,
  setMomentPublicationConsent,
  upsertStoryContributor,
} from "@/lib/nightMemoryStore";
import { __resetMemoryProfiles, profileStore } from "@/lib/profileStore";

const remove = (path: string, token?: string) =>
  new Request(`http://localhost${path}`, {
    method: "DELETE",
    headers: token ? { authorization: `Bearer ${token}` } : {},
  });
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });

async function seedMemoryWithPhoto(owner = "host") {
  const memory = await createNightMemory(owner, { title: "Friday orbit" });
  const moment = await addNightMoment(owner, memory!.id, {
    kind: "photo",
    caption: "The crew at the first stop",
    // Publication needs an author-confirmed description, so a Memory seeded
    // here can reach the published state the two refusals are about.
    altText: "Four of us at the bar, first stop of the night.",
  }, { mediaObjectKey: `night-moments/${owner}/${memory!.id}/photo.webp` });
  return { memory: memory!, moment: moment! };
}

describe("removing a private Memory", () => {
  beforeEach(() => {
    __resetNightMemoryStore();
    __resetMemoryProfiles();
    removedPhotoKeys.length = 0;
  });

  it("removes the Memory, its Moments and their photos for its owner", async () => {
    const { memory, moment } = await seedMemoryWithPhoto();

    const response = await REMOVE_MEMORY(remove(`/api/night-memories/${memory.id}`, "host"), ctx(memory.id));

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ removed: true });
    expect(await listNightMemories("host")).toEqual([]);
    expect(await listNightMoments("host", memory.id)).toEqual([]);
    expect(removedPhotoKeys).toEqual([`night-moments/host/${memory.id}/photo.webp`]);
    expect(moment.mediaObjectKey).toBe(`night-moments/host/${memory.id}/photo.webp`);
  });

  it("tells another account nothing and leaves the Memory alone", async () => {
    const { memory } = await seedMemoryWithPhoto();

    const response = await REMOVE_MEMORY(remove(`/api/night-memories/${memory.id}`, "stranger"), ctx(memory.id));

    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({ code: "NOT_FOUND" });
    expect(await listNightMemories("host")).toHaveLength(1);
    expect(removedPhotoKeys).toEqual([]);
  });

  it("refuses an anonymous caller", async () => {
    const { memory } = await seedMemoryWithPhoto();

    const response = await REMOVE_MEMORY(remove(`/api/night-memories/${memory.id}`), ctx(memory.id));

    expect(response.status).toBe(401);
    expect(await listNightMemories("host")).toHaveLength(1);
    expect(removedPhotoKeys).toEqual([]);
  });

  it("refuses while a published Story stands on the Memory", async () => {
    const { memory, moment } = await seedMemoryWithPhoto();
    const story = await createNightStory("host", { memoryId: memory.id, title: "Friday orbit" });
    const proposal = await proposeNightStoryPublication("host", story!.id, {
      momentIds: [moment.id],
      visibility: "unlisted",
    });
    await confirmNightStoryPublication("host", story!.id, {
      proposalId: proposal!.proposal.id,
      confirmationToken: proposal!.confirmationToken,
    });

    const response = await REMOVE_MEMORY(remove(`/api/night-memories/${memory.id}`, "host"), ctx(memory.id));

    expect(response.status).toBe(409);
    expect(await response.text()).toContain("Withdraw the Story first");
    expect(await listNightMemories("host")).toHaveLength(1);
  });

  it("refuses to take a contributor's Moment with it", async () => {
    await profileStore().createOwned("guest", "guest");
    const { memory } = await seedMemoryWithPhoto();
    const story = await createNightStory("host", { memoryId: memory.id, title: "Friday orbit" });
    await upsertStoryContributor("host", story!.id, { handle: "guest", role: "contributor" });
    await acceptStoryContribution("guest", story!.id);
    const guestMoment = await addStoryMoment("guest", story!.id, {
      kind: "quote",
      caption: "One more detour",
    });
    expect(guestMoment).not.toBeNull();

    const response = await REMOVE_MEMORY(remove(`/api/night-memories/${memory.id}`, "host"), ctx(memory.id));

    expect(response.status).toBe(409);
    expect(await response.text()).toContain("somebody else owns");
    expect(await listNightMemories("host")).toHaveLength(1);
  });
});

describe("removing a private Moment", () => {
  beforeEach(() => {
    __resetNightMemoryStore();
    __resetMemoryProfiles();
    removedPhotoKeys.length = 0;
  });

  it("removes the Moment and its photo for its owner", async () => {
    const { memory, moment } = await seedMemoryWithPhoto();

    const response = await REMOVE_MOMENT(remove(`/api/night-moments/${moment.id}`, "host"), ctx(moment.id));

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ removed: true });
    expect(await listNightMoments("host", memory.id)).toEqual([]);
    expect(await listNightMemories("host")).toHaveLength(1);
    expect(removedPhotoKeys).toEqual([`night-moments/host/${memory.id}/photo.webp`]);
  });

  it("tells another account nothing and leaves the Moment alone", async () => {
    const { memory, moment } = await seedMemoryWithPhoto();

    const response = await REMOVE_MOMENT(remove(`/api/night-moments/${moment.id}`, "stranger"), ctx(moment.id));

    expect(response.status).toBe(404);
    expect(await listNightMoments("host", memory.id)).toHaveLength(1);
    expect(removedPhotoKeys).toEqual([]);
  });

  it("refuses an anonymous caller", async () => {
    const { memory, moment } = await seedMemoryWithPhoto();

    const response = await REMOVE_MOMENT(remove(`/api/night-moments/${moment.id}`), ctx(moment.id));

    expect(response.status).toBe(401);
    expect(await listNightMoments("host", memory.id)).toHaveLength(1);
    expect(removedPhotoKeys).toEqual([]);
  });

  it("refuses while the Moment is in a published Story, and allows it once consent is withdrawn", async () => {
    const { memory, moment } = await seedMemoryWithPhoto();
    const story = await createNightStory("host", { memoryId: memory.id, title: "Friday orbit" });
    const proposal = await proposeNightStoryPublication("host", story!.id, {
      momentIds: [moment.id],
      visibility: "unlisted",
    });
    await confirmNightStoryPublication("host", story!.id, {
      proposalId: proposal!.proposal.id,
      confirmationToken: proposal!.confirmationToken,
    });

    const refused = await REMOVE_MOMENT(remove(`/api/night-moments/${moment.id}`, "host"), ctx(moment.id));
    expect(refused.status).toBe(409);
    expect(await refused.text()).toContain("Withdraw your approval first");

    await setMomentPublicationConsent("host", story!.id, moment.id, "withdrawn");
    const removed = await REMOVE_MOMENT(remove(`/api/night-moments/${moment.id}`, "host"), ctx(moment.id));

    expect(removed.status).toBe(200);
    expect(await listNightMoments("host", memory.id)).toEqual([]);
  });
});
