import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const access = vi.hoisted(() => ({ actor: null as unknown, limited: false }));
vi.mock("@/lib/serverEnv", () => ({ assertServerEnv: () => {} }));
vi.mock("@/lib/socialAccessServer", () => ({ requireVerifiedSocialActor: async () => access.actor }));
vi.mock("@/lib/pintDrops", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/pintDrops")>(),
  isLimited: async () => access.limited,
}));

import { GET, POST } from "@/app/api/leagues/[id]/invite/route";
import { followStore, __resetMemoryFollows } from "@/lib/followStore";
import { leagueStore } from "@/lib/leagueStore";
import { messagesStore, __resetMemoryMessages } from "@/lib/messagesStore";
import { __seedMemoryOwnedProfile, __resetMemoryProfiles } from "@/lib/profileStore";
import { clearSocialMemoryBlocks, setSocialMemoryBlock, setSocialMemoryMute } from "@/lib/socialBlockMemory";

const OWNER = "invite-owner";
const ME = "invite_me";
let id: string;
let me: ReturnType<typeof __seedMemoryOwnedProfile>;

async function mate(handle: string) {
  const profile = __seedMemoryOwnedProfile(handle, `user-${handle}`);
  await followStore().follow(ME, handle);
  await followStore().follow(handle, ME);
  return profile;
}

const context = () => ({ params: Promise.resolve({ id }) });
const request = () => new Request(`http://localhost/api/leagues/${id}/invite`);
const send = (recipient: unknown) => POST(new Request(request().url, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ recipient }),
}), context());

async function inbox(handle: string) {
  const conversation = await messagesStore().findConversation(ME, handle);
  return conversation ? await messagesStore().listMessages(conversation, handle) : [];
}

beforeEach(async () => {
  me = __seedMemoryOwnedProfile(ME, OWNER);
  access.actor = { ok: true, authUserId: OWNER, actor: { profileId: me.id, handle: ME, accountId: "invite-account" } };
  access.limited = false;
  const created = await leagueStore().create({ userId: OWNER, profileId: me.id }, "Regulars", "ABCDEFGH");
  if (created.status !== "created") throw new Error("League setup failed");
  id = created.leagueId;
});

afterEach(async () => {
  await leagueStore().remove(id, OWNER);
  __resetMemoryFollows();
  __resetMemoryMessages();
  __resetMemoryProfiles();
  clearSocialMemoryBlocks();
});

describe("league invitations", () => {
  it("lists mutual mates and delivers the current invitation to their messages", async () => {
    await mate("invite_ada");
    await mate("invite_bo");
    const listed = await GET(request(), context());
    expect(await listed.json()).toEqual({ mates: ["invite_ada", "invite_bo"] });
    await leagueStore().setInviteCode(id, OWNER, "BCDEFGHJ");
    expect((await send("invite_ada")).status).toBe(200);
    expect(await inbox("invite_ada")).toEqual([
      expect.objectContaining({ senderHandle: ME, body: "Join us in Regulars. https://pubmaxxing.com/social/leagues/join/BCDEFGHJ" }),
    ]);
    expect(await inbox("invite_bo")).toEqual([]);
  });

  it.each([
    ["block", false], ["block", true], ["mute", false], ["mute", true],
  ] as const)("checks a %s again when sending, reversed=%s", async (kind, reversed) => {
    const ada = await mate("invite_ada");
    expect((await GET(request(), context())).status).toBe(200);
    const [first, second] = reversed ? [ada.id, me.id] : [me.id, ada.id];
    (kind === "block" ? setSocialMemoryBlock : setSocialMemoryMute)(first, second, true);
    expect(await (await GET(request(), context())).json()).toEqual({ mates: [] });
    expect((await send("invite_ada")).status).toBe(400);
    expect(await inbox("invite_ada")).toEqual([]);
  });

  it("does not invite a former mutual, a stranger, or the sender", async () => {
    await mate("invite_ada");
    await followStore().unfollow("invite_ada", ME);
    __seedMemoryOwnedProfile("invite_stranger", "stranger");
    for (const handle of ["invite_ada", "invite_stranger", ME]) {
      expect((await send(handle)).status).toBe(400);
    }
    expect(await inbox("invite_ada")).toEqual([]);
    expect(await inbox("invite_stranger")).toEqual([]);
  });

  it("requires membership for listing and sending, including after leaving", async () => {
    const ada = await mate("invite_ada");
    access.actor = { ok: true, authUserId: ada.userId, actor: { profileId: ada.id, handle: ada.handle, accountId: "ada-account" } };
    expect((await GET(request(), context())).status).toBe(404);
    expect((await send(ME)).status).toBe(404);
    await leagueStore().join({ userId: ada.userId!, profileId: ada.id }, "ABCDEFGH");
    expect((await send(ME)).status).toBe(200);
    await leagueStore().leave(id, ada.userId!);
    expect((await send(ME)).status).toBe(404);
    expect(await inbox("invite_ada")).toHaveLength(1);
  });

  it("refuses rate-limited and malformed sends without delivering", async () => {
    await mate("invite_ada");
    expect((await send(null)).status).toBe(400);
    access.limited = true;
    expect((await send("invite_ada")).status).toBe(429);
    expect(await inbox("invite_ada")).toEqual([]);
  });
});
