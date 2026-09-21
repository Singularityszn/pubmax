import { beforeEach, expect, it, vi } from "vitest";
vi.mock("@/lib/serverEnv", () => ({ assertServerEnv: () => {} }));
vi.mock("@/lib/supabase", () => ({ isSupabaseConfigured: () => true, clientIp: () => "local", hashIp: () => "local" }));
vi.mock("@/lib/pintDrops", () => ({ isLimited: async () => false }));
const identity = vi.hoisted(() => ({ id: null as string | null, mutual: false, fails: false }));
vi.mock("@/lib/authServer", () => ({ callerUserId: async () => { if (identity.fails) throw Error("unavailable"); return identity.id; } }));
vi.mock("@/lib/followStore", () => ({ followStore: () => ({ isFollowing: async () => identity.mutual }) }));
vi.mock("@/lib/profileStore", async (original) => ({ ...await original<typeof import("@/lib/profileStore")>(), profileStore: () => ({ getHandleByUserId: async () => "viewer" }) }));
import { handleProfileImageServe } from "@/lib/profileImageServe.server";
import { profileImageServingKey } from "@/lib/profileImageSlots";
import type { ProfileRecord } from "@/lib/profileStore";
const profileId = "11111111-1111-4111-8111-111111111111";
const generation = "22222222-2222-4222-8222-222222222222";
const profile: ProfileRecord = { id: profileId, userId: "owner", handle: "owner", visibility: "private", createdAt: "2026-01-01", updatedAt: "2026-01-01", coverGeneration: generation, coverObjectKey: profileImageServingKey("cover",profileId,generation), coverModerationState: "approved", avatarGeneration: generation, avatarObjectKey: profileImageServingKey("avatar",profileId,generation), avatarModerationState: "approved" };
const downloadObject = vi.fn(async () => ({ bytes: Buffer.from("cover"), contentType: "image/jpeg" }));
const extraServingKey = vi.fn(async () => "rotation-key");
function serve(slot: "cover" | "avatar" = "cover", row = profile, gen = generation) {
 return handleProfileImageServe(new Request(`https://example.test/api/${slot}/${profileId}/${gen}`),slot,{profileId,generation:gen},{getProfileById:async()=>row,downloadObject,extraServingKey});
}
beforeEach(()=>{ identity.id=null; identity.mutual=false; identity.fails=false; vi.clearAllMocks(); });
it.each([null,"stranger"])("denies held private cover URLs to %s before storage or rotation",async id=>{
 identity.id=id;
 expect((await serve()).status).toBe(404);
 expect((await serve("cover",profile,"33333333-3333-4333-8333-333333333333")).status).toBe(404);
 expect(downloadObject).not.toHaveBeenCalled(); expect(extraServingKey).not.toHaveBeenCalled();
});
it.each(["owner","mate"])("serves private covers to %s without a shared cache",async id=>{
 identity.id=id; identity.mutual=id==="mate";
 const res=await serve();expect(res.status).toBe(200);expect(res.headers.get("cache-control")).toBe("private, no-store");
 expect((await serve("cover",profile,"33333333-3333-4333-8333-333333333333")).status).toBe(200);
});
it("revokes a retained URL on unmate and privacy change",async()=>{
 identity.id="mate"; identity.mutual=true;expect((await serve()).status).toBe(200);
 identity.mutual=false;expect((await serve()).status).toBe(404);
 identity.id=null;const publicRow={...profile,visibility:"public" as const};
 const res=await serve("cover",publicRow);expect(res.status).toBe(200);expect(res.headers.get("cache-control")).toBe("private, no-store");
 expect((await serve()).status).toBe(404);
});
it("fails closed when identity cannot be verified while avatars stay public",async()=>{
 identity.fails=true;expect((await serve()).status).toBe(404);
 const avatar=await serve("avatar");expect(avatar.status).toBe(200);expect(avatar.headers.get("cache-control")).toContain("public");
});
