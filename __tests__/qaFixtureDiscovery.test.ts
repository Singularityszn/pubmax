import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/serverEnv", () => ({ assertServerEnv: () => {} }));
vi.mock("@/lib/supabase", async (original) => ({
  ...await original<typeof import("@/lib/supabase")>(),
  isSupabaseConfigured: () => false,
  requiresSupabaseStore: () => false,
}));
const auth = vi.hoisted(() => ({ userId: null as string | null }));
vi.mock("@/lib/authServer", async (original) => ({
  ...await original<typeof import("@/lib/authServer")>(),
  callerUserId: async () => auth.userId,
}));

import { GET as directory } from "@/app/api/profiles/directory/route";
import { GET as search } from "@/app/api/profiles/search/route";
import { GET as founders } from "@/app/api/founding-members/route";
import { GET as ownerDetails } from "@/app/api/identity/onboarding/route";
import { GET as profile, PATCH as editProfile } from "@/app/api/profiles/[handle]/route";
import { __resetMemoryProfiles, __seedMemoryOwnedProfile } from "@/lib/profileStore";
import { __resetMemoryIdentityHandles } from "@/lib/identityHandleStore";
import { __resetMemoryPrivateIdentities } from "@/lib/privateIdentityStore";
import { __resetMemoryProfileWithdrawals, __setMemoryProfileWithdrawn } from "@/lib/accountPublicAccess.server";
import { __resetMemoryFollows } from "@/lib/followStore";
import { __resetPintDrops } from "@/lib/pintDrops";
import { loadStarterPacks } from "@/lib/starterPacks.server";

// Synthetic stored state only. This is not a classification of any real account.
// qaFixture is private server state. No request supplies it. Its absence means false.
function seed(handle: string, qaFixture = false) {
  const row = __seedMemoryOwnedProfile(handle, `synthetic-owner-${handle}`);
  Object.assign(row, { qaFixture, homeCity: "Camden" });
  return row;
}
async function page(after = "") {
  const response = await directory(new Request(`http://localhost/api/profiles/directory?limit=1&after=${after}`));
  expect(response.status).toBe(200);
  return response.json();
}

beforeEach(() => {
  vi.stubEnv("PUBMAX_SOCIAL_FRIENDS_LAUNCH", "1");
  auth.userId = null;
  __resetMemoryProfiles();
  __resetMemoryIdentityHandles();
  __resetMemoryPrivateIdentities();
  __resetMemoryProfileWithdrawals();
  __resetMemoryFollows();
  __resetPintDrops();
});

afterEach(() => vi.unstubAllEnvs());

describe("confirmed QA fixture discovery isolation", () => {
  it("excludes a confirmed fixture before the first page, later page and terminal cursor", async () => {
    seed("aa_fixture", true);
    seed("bb_human");
    seed("cc_fixture", true);
    seed("dd_human");
    seed("ee_fixture", true);
    const first = await page();
    expect(first.people.map((person: { handle: string }) => person.handle)).toEqual(["bb_human"]);
    expect(first.nextCursor).toBe("bb_human");
    const second = await page(first.nextCursor);
    expect(second.people.map((person: { handle: string }) => person.handle)).toEqual(["dd_human"]);
    expect(second.nextCursor).toBeNull();
  });

  it("keeps a renamed fixture excluded by its stored identity", async () => {
    const fixture = seed("aa_synthetic_fixture", true);
    const identity = fixture.id;
    // Model the persisted rename postimage. This does not claim rename-route coverage.
    fixture.handle = "zz_ordinary_spelling";
    expect(fixture.id).toBe(identity);
    seed("bb_human");
    expect((await page()).people.map((person: { handle: string }) => person.handle)).toEqual(["bb_human"]);
    const response = await search(new Request("http://localhost/api/profiles/search?q=zz"));
    expect((await response.json()).matches).toEqual([]);
  });

  it("does not infer fixture status from a QA-like human handle", async () => {
    seed("qa_ordinary_person");
    const response = await search(new Request("http://localhost/api/profiles/search?q=qa_"));
    expect(response.status).toBe(200);
    expect((await response.json()).matches.map((person: { handle: string }) => person.handle)).toEqual(["qa_ordinary_person"]);
  });

  it("omits fixtures from founders without hiding a genuine non-founder from directory", async () => {
    seed("aa_fixture", true);
    // Synthetic real-human counterexample. Founding exclusion is not QA classification.
    const human = seed("human_without_founding_mark");
    human.foundingMemberNumber = undefined;
    Object.assign(human, { foundingMemberExcluded: true });
    seed("ordinary_founder");
    const response = await founders(new Request("http://localhost/api/founding-members"));
    expect(response.status).toBe(200);
    expect((await response.json()).members.map((person: { handle: string }) => person.handle)).toEqual(["ordinary_founder"]);
    expect((await page()).people.map((person: { handle: string }) => person.handle)).toEqual(["human_without_founding_mark"]);
  });

  it("excludes fixtures from recommendation membership and member counts", async () => {
    seed("aa_fixture", true);
    seed("bb_human"); seed("cc_human"); seed("dd_human");
    const packs = await loadStarterPacks();
    const camden = packs.packs.find((pack) => pack.slug === "camden");
    expect(camden).toBeDefined();
    expect(camden?.memberCount).toBe(3);
    expect(camden?.members.map((member) => member.handle)).toEqual(["bb_human", "cc_human", "dd_human"]);
  });

  it("preserves authenticated fixture owner data without leaking classification", async () => {
    const fixture = seed("synthetic_fixture", true);
    auth.userId = fixture.userId!;
    const response = await ownerDetails(new Request("http://localhost/api/identity/onboarding"));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.handle).toBe("synthetic_fixture");
    const publicResponse = await profile(new Request("http://localhost/api/profiles/synthetic_fixture"), { params: Promise.resolve({ handle: "synthetic_fixture" }) });
    const wire = await publicResponse.text();
    for (const secret of ["qaFixture", "qa_fixture", fixture.userId!]) expect(wire).not.toContain(secret);
  });

  it("does not let a profile editor clear its server classification", async () => {
    const fixture = seed("synthetic_fixture", true);
    auth.userId = fixture.userId!;
    await editProfile(new Request("http://localhost/api/profiles/synthetic_fixture", {
      method: "PATCH", headers: { "content-type": "application/json" },
      body: JSON.stringify({ qaFixture: false, qa_fixture: false, displayName: "Fixture Person" }),
    }), { params: Promise.resolve({ handle: "synthetic_fixture" }) });
    expect((await page()).people).toEqual([]);
  });

  it("retains existing withdrawal and private-profile projection boundaries", async () => {
    const withdrawn = seed("aa_withdrawn");
    __setMemoryProfileWithdrawn(withdrawn.id, true);
    const privatePerson = seed("bb_private");
    Object.assign(privatePerson, { visibility: "private", bio: "PRIVATE_CONTENT_SENTINEL" });
    const response = await search(new Request("http://localhost/api/profiles/search?q=aa"));
    expect((await response.json()).matches).toEqual([]);
    const direct = await profile(new Request("http://localhost/api/profiles/bb_private"), { params: Promise.resolve({ handle: "bb_private" }) });
    expect((await direct.clone().json()).projection).toBe("limited");
    expect(await direct.text()).not.toContain("PRIVATE_CONTENT_SENTINEL");
  });
});
