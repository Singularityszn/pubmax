import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/supabase")>();
  return { ...actual, isSupabaseConfigured: () => false };
});

import {
  __resetNightMemoryStore,
  addNightMoment,
  confirmNightStoryPublication,
  createNightMemory,
  createNightStory,
  getNightStory,
  proposeNightStoryPublication,
  setMomentPublicationConsent,
} from "@/lib/nightMemoryStore";

describe("collaborative Night Story storage", () => {
  beforeEach(() => __resetNightMemoryStore());

  it("keeps a Memory and its Moments private until a proposal is confirmed", async () => {
    const memory = await createNightMemory("host", { title: "Friday orbit" });
    const moment = await addNightMoment("host", memory!.id, {
      kind: "photo",
      caption: "The crew at the first stop",
      mediaObjectKey: "night-media/host/photo.webp",
    });
    const story = await createNightStory("host", { memoryId: memory!.id, title: "Friday orbit" });

    expect(memory).toMatchObject({ ownerId: "host", visibility: "private" });
    expect(moment).toMatchObject({ ownerId: "host", visibility: "private" });
    expect(story).toMatchObject({ hostEditorId: "host", status: "draft", visibility: "private" });
    expect((await getNightStory(story!.id, null))).toBeNull();
  });

  it("publishes only through a short-lived proposal and separate confirmation token", async () => {
    const memory = await createNightMemory("host", { title: "Friday orbit" });
    const moment = await addNightMoment("host", memory!.id, { kind: "quote", caption: "One more side quest" });
    const story = await createNightStory("host", { memoryId: memory!.id, title: "Friday orbit" });
    const proposed = await proposeNightStoryPublication("host", story!.id, {
      momentIds: [moment!.id],
      visibility: "public",
    });

    expect(proposed).toMatchObject({ proposal: { storyId: story!.id, visibility: "public" } });
    expect(JSON.stringify(proposed!.proposal)).not.toContain(proposed!.confirmationToken);
    expect(await confirmNightStoryPublication("host", story!.id, {
      proposalId: proposed!.proposal.id,
      confirmationToken: "wrong-token",
    })).toBeNull();

    const published = await confirmNightStoryPublication("host", story!.id, {
      proposalId: proposed!.proposal.id,
      confirmationToken: proposed!.confirmationToken,
    });
    expect(published).toMatchObject({ status: "published", visibility: "public", publishedMomentIds: [moment!.id] });
    expect(await getNightStory(story!.id, null)).toMatchObject({ id: story!.id, status: "published" });
    const signedInNonContributor = await getNightStory(story!.id, "someone-else");
    expect(signedInNonContributor).not.toHaveProperty("memoryId");
    expect(signedInNonContributor).not.toHaveProperty("hostEditorId");
  });

  it("requires contributor approval and removes a withdrawn Moment from the public Story", async () => {
    const memory = await createNightMemory("host", { title: "Crew night" });
    const moment = await addNightMoment("friend", memory!.id, { kind: "photo", caption: "My photo" }, { allowContributor: true });
    const story = await createNightStory("host", { memoryId: memory!.id, title: "Crew night" });
    const proposed = await proposeNightStoryPublication("host", story!.id, { momentIds: [moment!.id], visibility: "public" });
    expect(proposed).toBeNull();

    expect(await setMomentPublicationConsent("friend", story!.id, moment!.id, "approved")).toMatchObject({ status: "approved" });
    const approved = await proposeNightStoryPublication("host", story!.id, { momentIds: [moment!.id], visibility: "public" });
    await confirmNightStoryPublication("host", story!.id, { proposalId: approved!.proposal.id, confirmationToken: approved!.confirmationToken });
    expect((await getNightStory(story!.id, null))?.publishedMomentIds).toEqual([moment!.id]);

    await setMomentPublicationConsent("friend", story!.id, moment!.id, "withdrawn");
    expect((await getNightStory(story!.id, null))?.publishedMomentIds).toEqual([]);
  });
});
