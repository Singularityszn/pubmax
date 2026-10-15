import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/supabase")>();
  return { ...actual, isSupabaseConfigured: () => false, requiresSupabaseStore: () => false };
});
vi.mock("@/lib/serverEnv", () => ({ assertServerEnv: () => {} }));
vi.mock("@/lib/authServer", () => ({
  callerUserId: async (request: Request) =>
    request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") || null,
}));

import { DELETE } from "@/app/api/profiles/[handle]/route";
import { POST as inviteLink } from "@/app/api/referrals/invite-link/route";
import {
  __resetNightMemoryStore,
  acceptStoryContribution,
  addNightMoment,
  addStoryMoment,
  confirmNightStoryPublication,
  createNightMemory,
  createNightStory,
  getPublishedRecapSource,
  getNightStory,
  listNightMoments,
  proposeNightStoryPublication,
  setMomentPublicationConsent,
  upsertStoryContributor,
} from "@/lib/nightMemoryStore";
import { __resetMemoryProfiles, profileStore } from "@/lib/profileStore";
import {
  __resetMemoryReferrals,
  memoryReferralStore,
} from "@/lib/referralStore";
import {
  __resetMemoryPrivateIdentities,
  memoryPrivateIdentityStore,
} from "@/lib/privateIdentityStore";
import { defined } from "@/__tests__/helpers/defined";

const params = (handle: string) => ({ params: Promise.resolve({ handle }) });
const del = (handle: string, token: string) =>
  DELETE(new Request(`http://localhost/api/profiles/${handle}`, {
    method: "DELETE",
    headers: { authorization: `Bearer ${token}` },
  }), params(handle));

describe("DELETE /api/profiles/[handle] triggers one-choke redaction (5.5)", () => {
  beforeEach(() => {
    __resetNightMemoryStore();
    __resetMemoryProfiles();
    __resetMemoryReferrals();
    __resetMemoryPrivateIdentities();
  });

  it.each([false, true])("redacts profile-clear names including prior withdrawal=%s", async (withdrawFirst) => {
    // A linked account 'friend' owning handle 'jordanx', contributing to a Story.
    await profileStore().createOwned("jordanx", "friend");
    await profileStore().update("jordanx", { displayName: "Jordan" });

    const memory = await createNightMemory("host", { title: "Friday orbit" });
    const hostMoment = await addNightMoment("host", memory!.id, {
      kind: "quote",
      caption: "Great night with Jordan and @jordanx",
    });
    const story = await createNightStory("host", { memoryId: memory!.id, title: "Orbit with Jordan", summary: "Jordan joined us" });
    await upsertStoryContributor("host", story!.id, { handle: "jordanx", role: "contributor" });
    await acceptStoryContribution("friend", story!.id);
    const friendMoment = await addStoryMoment("friend", story!.id, { kind: "quote", caption: "My round" });
    await setMomentPublicationConsent("friend", story!.id, friendMoment!.id, "approved");
    const proposed = await proposeNightStoryPublication("host", story!.id, {
      momentIds: [hostMoment!.id, friendMoment!.id],
      visibility: "public",
    });
    await confirmNightStoryPublication("host", story!.id, {
      proposalId: proposed!.proposal.id,
      confirmationToken: proposed!.confirmationToken,
    });

    // Sanity: both Moments live before deletion.
    const before = await getPublishedRecapSource(story!.id);
    expect(before!.moments.map((m) => m.id).sort()).toEqual([hostMoment!.id, friendMoment!.id].sort());

    if (withdrawFirst) {
      await setMomentPublicationConsent("friend", story!.id, friendMoment!.id, "withdrawn");
    }
    const refused = await del("jordanx", "stranger");
    expect(refused.status).toBe(403);
    expect((await profileStore().getByUserId("friend"))!.displayName).toBe("Jordan");

    // The owner clears their profile. Full auth-account deletion is a separate route.
    const res = await del("jordanx", "friend");
    expect(res.status).toBe(200);

    // The gate now emits only the host's Moment, with a scrubbed caption.
    const after = await getPublishedRecapSource(story!.id);
    expect(after!.moments.map((m) => m.id)).toEqual([hostMoment!.id]);
    expect(defined(after!.moments[0]).caption).toBe("Great night with a friend and a friend");
    expect(after!.story.title).toBe("Orbit with a friend");
    expect(after!.story.summary).toBe("a friend joined us");
    expect(JSON.stringify(after)).not.toMatch(/jordan/i);
    expect((await getNightStory(story!.id, null))!.title).toBe("Orbit with a friend");
    const privateMoments = await listNightMoments("host", memory!.id);
    expect(privateMoments!.find((moment) => moment.id === hostMoment!.id)!.caption)
      .toBe("Great night with Jordan and @jordanx");

    // Clearing twice must not discard the only name the first clear removed.
    expect((await del("jordanx", "friend")).status).toBe(200);
    expect((await getPublishedRecapSource(story!.id))!.story.title).toBe("Orbit with a friend");
  });

  it("still deletes (does not fail) when the account contributes to no Story", async () => {
    await profileStore().createOwned("solo", "solo-user");
    await memoryReferralStore.recordEdge("inviter", "solo-user");
    const res = await del("solo", "solo-user");
    expect(res.status).toBe(200);
    expect(await memoryReferralStore.privateStatus("inviter")).toMatchObject({
      attributedCount: 0,
      qualifiedCount: 0,
    });
    const inviteResponse = await inviteLink(
      new Request("http://localhost/api/referrals/invite-link", {
        method: "POST",
        headers: { authorization: "Bearer solo-user" },
      }),
    );
    expect(inviteResponse.status).toBe(409);
  });

  it("deletes private identity fields at the existing profile deletion boundary", async () => {
    await profileStore().createOwned("private_person", "private-user");
    expect(
      await memoryPrivateIdentityStore.completeOnboarding({
        userId: "private-user",
        handle: "private_person",
        dateOfBirth: "1990-01-01",
        fullName: "Private Person",
        sex: "female",
      }),
    ).toMatchObject({ ok: true });

    const res = await del("private_person", "private-user");

    expect(res.status).toBe(200);
    expect(await memoryPrivateIdentityStore.read("private-user")).toBeNull();
    expect(await profileStore().getByUserId("private-user")).toMatchObject({
      handle: "private_person",
      userId: "private-user",
    });
  });
});
