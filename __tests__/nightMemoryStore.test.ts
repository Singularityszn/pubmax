import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

vi.mock("@/lib/supabase", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/supabase")>();
  return { ...actual, isSupabaseConfigured: () => false };
});

import {
  __resetNightMemoryStore,
  addNightMoment,
  acceptStoryContribution,
  confirmNightStoryPublication,
  createNightMemory,
  createNightStory,
  getNightStory,
  getNightStoryWorkspace,
  listNightStoryInbox,
  proposeNightStoryPublication,
  setMomentPublicationConsent,
  upsertStoryContributor,
} from "@/lib/nightMemoryStore";
import { __resetMemoryProfiles, profileStore } from "@/lib/profileStore";

describe("collaborative Night Story storage", () => {
  beforeEach(() => {
    __resetNightMemoryStore();
    __resetMemoryProfiles();
  });

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
    const withheld = await getNightStoryWorkspace("host", story!.id);
    expect(withheld?.moments).toEqual([]);
    expect(withheld?.caller).toEqual({ role: "host", canEdit: true });
    expect(withheld?.story).not.toHaveProperty("hostEditorId");
    expect(withheld?.story).not.toHaveProperty("memoryId");
    const proposed = await proposeNightStoryPublication("host", story!.id, { momentIds: [moment!.id], visibility: "public" });
    expect(proposed).toBeNull();

    expect(await setMomentPublicationConsent("friend", story!.id, moment!.id, "approved")).toMatchObject({ status: "approved" });
    expect((await getNightStoryWorkspace("host", story!.id))?.moments[0]).toMatchObject({ caption: "My photo", consent: "approved" });
    const approved = await proposeNightStoryPublication("host", story!.id, { momentIds: [moment!.id], visibility: "public" });
    await confirmNightStoryPublication("host", story!.id, { proposalId: approved!.proposal.id, confirmationToken: approved!.confirmationToken });
    expect((await getNightStory(story!.id, null))?.publishedMomentIds).toEqual([moment!.id]);

    await setMomentPublicationConsent("friend", story!.id, moment!.id, "withdrawn");
    expect((await getNightStory(story!.id, null))?.publishedMomentIds).toEqual([]);
  });

  it("ships an atomic configured-backend draft authorization check", () => {
    const sql = readFileSync(join(process.cwd(), "supabase/migrations/20260716150000_0032_night_story_draft_atomic.sql"), "utf8");
    expect(sql).toContain("update_night_story_draft_atomic");
    expect(sql).toContain("contributor.role in ('host', 'editor')");
    expect(sql).toContain("contributor.status = 'accepted'");
    expect(sql).toContain("create_plan_recap_atomic");
    expect(sql).toContain("pg_advisory_xact_lock");
    expect(sql).toContain("revoke all on function");
  });

  it("gives contributors consent-only workspace data without other private Moments", async () => {
    await profileStore().linkUser("friend", "friend-user");
    const memory = await createNightMemory("host", { title: "Crew night" });
    await addNightMoment("host", memory!.id, { kind: "quote", caption: "Host private note" });
    const friendMoment = await addNightMoment("friend-user", memory!.id, { kind: "photo", caption: "Friend photo" }, { allowContributor: true });
    const story = await createNightStory("host", { memoryId: memory!.id, title: "Crew night" });
    await upsertStoryContributor("host", story!.id, { handle: "friend", role: "contributor" });
    await acceptStoryContribution("friend-user", story!.id);

    const workspace = await getNightStoryWorkspace("friend-user", story!.id);
    expect(workspace?.caller).toEqual({ role: "contributor", canEdit: false });
    expect(workspace?.moments).toEqual([expect.objectContaining({ id: friendMoment!.id, caption: "Friend photo", ownedByCaller: true })]);
    expect(JSON.stringify(workspace)).not.toContain("Host private note");
  });

  it("sorts every pending invitation ahead of a long accepted Story shelf", async () => {
    await profileStore().linkUser("friend", "friend-user");
    const memory = await createNightMemory("host", { title: "Story shelf" });
    const pending = await createNightStory("host", { memoryId: memory!.id, title: "Old invitation" });
    await upsertStoryContributor("host", pending!.id, { handle: "friend", role: "contributor" });
    for (let index = 0; index < 9; index += 1) {
      const story = await createNightStory("host", { memoryId: memory!.id, title: `Accepted ${index}` });
      await upsertStoryContributor("host", story!.id, { handle: "friend", role: "contributor" });
      await acceptStoryContribution("friend-user", story!.id);
    }
    const inbox = await listNightStoryInbox("friend-user");
    expect(inbox.ok).toBe(true);
    if (!inbox.ok) return;
    expect(inbox.value).toHaveLength(10);
    expect(inbox.value[0]).toMatchObject({ id: pending!.id, membership: { status: "invited" } });
  });
});
