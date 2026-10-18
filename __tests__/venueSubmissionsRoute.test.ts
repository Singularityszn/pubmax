import sharp from "sharp";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/supabase")>();
  return { ...actual, isSupabaseConfigured: () => false, requiresSupabaseStore: () => false };
});

const identityState = vi.hoisted(() => ({
  resolution: {
    ok: true as const,
    accountId: "a1111111-1111-4111-8111-111111111111",
    actor: "profile:aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
    handle: "alice",
  } as import("@/lib/contributionIdentity.server").ContributionIdentityResolution,
}));

vi.mock("@/lib/contributionIdentity.server", () => ({
  resolveContributionIdentity: async () => identityState.resolution,
}));

const matchState = vi.hoisted(() => ({
  matches: [] as { venueId: string; venueName: string; address: string }[],
}));

vi.mock("@/lib/venueSubmissionMatch.server", () => ({
  existingVenueMatches: async () => matchState.matches,
}));

const storage = vi.hoisted(() => ({
  objects: new Map<string, { bytes: Buffer; contentType: string }>(),
  failUpload: false,
}));

vi.mock("@/lib/venueSubmissionMedia.server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/venueSubmissionMedia.server")>();
  return {
    ...actual,
    supabaseMenuFileStorage: {
      async upload(key: string, bytes: Buffer, contentType: string) {
        if (storage.failUpload) {
          throw new actual.VenueSubmissionFileError("STORAGE_UNAVAILABLE", "Menu storage is unavailable.");
        }
        storage.objects.set(key, { bytes, contentType });
      },
      async remove(keys: string[]) {
        for (const key of keys) storage.objects.delete(key);
      },
      async sign(key: string) {
        return `https://signed.example/${key}`;
      },
    },
  };
});

const moderatorState = vi.hoisted(() => ({ moderator: false }));

vi.mock("@/lib/adminAuth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/adminAuth")>();
  return { ...actual, isModerator: () => moderatorState.moderator };
});

import { GET as adminGET, POST as adminPOST } from "@/app/api/admin/venue-submissions/route";
import { GET, POST } from "@/app/api/venue-submissions/route";
import { __resetPintDrops } from "@/lib/pintDrops";
import { __resetVenueSubmissions, memoryVenueSubmissionStore } from "@/lib/venueSubmissionStore";
import { VENUE_SUBMISSION_MAX_FILES } from "@/lib/venueSubmissions";

const ALICE_ACCOUNT = "a1111111-1111-4111-8111-111111111111";
const BOB_ACCOUNT = "b1111111-1111-4111-8111-111111111111";

let ipCounter = 0;
function nextIp(): string {
  ipCounter += 1;
  return `203.0.113.${ipCounter % 250}`;
}

function postJson(body: unknown): Request {
  return new Request("http://localhost/api/venue-submissions", {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": nextIp() },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

function postFile(submissionId: string, file: File, extra?: Record<string, string>): Request {
  const form = new FormData();
  form.set("submission", submissionId);
  form.set("file", file);
  for (const [key, value] of Object.entries(extra ?? {})) form.set(key, value);
  return new Request("http://localhost/api/venue-submissions", {
    method: "POST",
    headers: { "x-forwarded-for": nextIp() },
    body: form,
  });
}

function admin(method: "GET" | "POST", body?: unknown, query = ""): Request {
  return new Request(`http://localhost/api/admin/venue-submissions${query}`, {
    method,
    headers: { "content-type": "application/json", "x-forwarded-for": nextIp() },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

function signIn(accountId: string, handle: string) {
  identityState.resolution = { ok: true, accountId, actor: `profile:${handle}`, handle };
}

const PUB = { name: "The Missing Crown", address: "1 Example Street, London", postcode: "se1 9aa" };

async function submit(body: Record<string, unknown> = {}): Promise<string> {
  const res = await POST(postJson({ ...PUB, ...body }));
  expect(res.status).toBe(201);
  return (await res.json()).submission.id as string;
}

async function pngFile(name = "menu.png"): Promise<File> {
  const bytes = await sharp({
    create: { width: 40, height: 60, channels: 3, background: { r: 200, g: 180, b: 120 } },
  }).png().toBuffer();
  return new File([new Uint8Array(bytes)], name, { type: "image/png" });
}

const PDF_BYTES = "%PDF-1.4\n%menu\n";

/** A real PDF. Refused until a PDF sanitiser exists (owner decision, 18 Oct 2026). */
function pdfFile(type = "application/pdf"): File {
  return new File([PDF_BYTES], "menu.pdf", { type });
}

beforeEach(() => {
  __resetVenueSubmissions();
  __resetPintDrops();
  storage.objects.clear();
  storage.failUpload = false;
  matchState.matches = [];
  moderatorState.moderator = false;
  signIn(ALICE_ACCOUNT, "alice");
});

describe("POST /api/venue-submissions (create)", () => {
  it("stores a pending submission for the signed-in account and lists it back", async () => {
    const res = await POST(postJson({
      ...PUB,
      website: "missingcrown.co.uk",
      prices: [{ drinkCategory: "beer", priceGbp: "5.20", measure: "pint" }],
      ownerUserId: BOB_ACCOUNT,
    }));
    expect(res.status).toBe(201);
    const { submission } = await res.json();
    expect(submission).toMatchObject({ name: "The Missing Crown", postcode: "SE1 9AA", status: "pending", priceCount: 1, fileCount: 0 });

    const [stored] = (await memoryVenueSubmissionStore.listForOwner(ALICE_ACCOUNT)).submissions;
    expect(stored).toMatchObject({ ownerUserId: ALICE_ACCOUNT, website: "https://missingcrown.co.uk/" });
    expect((await memoryVenueSubmissionStore.listForOwner(BOB_ACCOUNT)).submissions).toEqual([]);

    const list = await (await GET(new Request("http://localhost/api/venue-submissions"))).json();
    expect(list).toMatchObject({ status: "ready", submissions: [{ id: submission.id }] });
    expect(JSON.stringify(list)).not.toContain(ALICE_ACCOUNT);
  });

  it("refuses an invalid submission and names the field", async () => {
    const res = await POST(postJson({ ...PUB, address: "" }));
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ code: "INVALID_VENUE_SUBMISSION", details: { field: "address" } });
    expect((await POST(postJson("not json"))).status).toBe(400);
  });

  it("asks about a pub the map may already have, and stores it once the drinker says it is new", async () => {
    matchState.matches = [{ venueId: "venue-uk-n1", venueName: "The Missing Crown", address: "1 Example Street, SE1 9AA" }];
    const asked = await POST(postJson(PUB));
    expect(asked.status).toBe(409);
    expect(await asked.json()).toMatchObject({ code: "POSSIBLE_MATCH", details: { matches: [{ venueId: "venue-uk-n1" }] } });
    expect((await memoryVenueSubmissionStore.listForOwner(ALICE_ACCOUNT)).submissions).toEqual([]);

    const confirmed = await POST(postJson({ ...PUB, confirmNew: true }));
    expect(confirmed.status).toBe(201);
  });

  it("passes a gate refusal through for writes and answers it as data for reads", async () => {
    identityState.resolution = {
      ok: false,
      httpStatus: 401,
      body: { error: "Sign in to add a pub.", code: "UNAUTHENTICATED", retryable: false },
    } as unknown as import("@/lib/contributionIdentity.server").ContributionIdentityResolution;
    const write = await POST(postJson(PUB));
    expect(write.status).toBe(401);
    expect((await memoryVenueSubmissionStore.listForOwner(ALICE_ACCOUNT)).submissions).toEqual([]);
  });

  it("rate limits creation per account", async () => {
    let last = 0;
    for (let i = 0; i < 8; i += 1) {
      last = (await POST(postJson({ ...PUB, name: `Pub ${i}` }))).status;
    }
    expect(last).toBe(429);
  });
});

describe("POST /api/venue-submissions (menu files)", () => {
  it("stores a photo as a stripped JPEG inside the owner's folder", async () => {
    const id = await submit();
    const photo = await POST(postFile(id, await pngFile()));
    expect(photo.status).toBe(201);
    expect((await photo.json()).file.kind).toBe("image");

    const keys = [...storage.objects.keys()];
    expect(keys).toHaveLength(1);
    expect(keys[0]).toMatch(new RegExp(`^venue-submissions/${ALICE_ACCOUNT}/${id}/[0-9a-f-]+\\.jpg$`));
    const jpeg = storage.objects.get(keys[0] ?? "");
    expect(jpeg?.contentType).toBe("image/jpeg");
    expect(jpeg?.bytes.subarray(0, 3)).toEqual(Buffer.from([0xff, 0xd8, 0xff]));

    const stored = await memoryVenueSubmissionStore.getById(id);
    expect(stored?.files.map((file) => file.kind)).toEqual(["image"]);
  });

  it("refuses a PDF with the type envelope and stores nothing, until a PDF sanitiser exists", async () => {
    const id = await submit();
    const res = await POST(postFile(id, pdfFile()));
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ code: "INVALID_TYPE", retryable: false });
    expect(storage.objects.size).toBe(0);
    expect((await memoryVenueSubmissionStore.getById(id))?.files).toEqual([]);
  });

  it("refuses PDF bytes sent under a photo's type, by their magic bytes", async () => {
    const id = await submit();
    for (const type of ["image/jpeg", "image/png", "image/webp"]) {
      const res = await POST(postFile(id, pdfFile(type)));
      expect(res.status).toBe(400);
      expect(await res.json()).toMatchObject({ code: "INVALID_TYPE" });
    }
    expect(storage.objects.size).toBe(0);
    expect((await memoryVenueSubmissionStore.getById(id))?.files).toEqual([]);
  });

  it("refuses a file that is not a menu photo", async () => {
    const id = await submit();
    const html = new File(["<html></html>"], "menu.html", { type: "text/html" });
    expect((await POST(postFile(id, html))).status).toBe(400);
    expect(storage.objects.size).toBe(0);
  });

  it("refuses a file for another account's submission or an unknown one", async () => {
    const id = await submit();
    signIn(BOB_ACCOUNT, "bob");
    expect((await POST(postFile(id, await pngFile()))).status).toBe(404);
    expect((await POST(postFile("not-a-uuid", await pngFile()))).status).toBe(404);
    expect(storage.objects.size).toBe(0);
  });

  it("stops at the file cap and closes a decided submission to new files", async () => {
    const id = await submit();
    for (let i = 0; i < VENUE_SUBMISSION_MAX_FILES; i += 1) {
      expect((await POST(postFile(id, await pngFile()))).status).toBe(201);
    }
    expect((await POST(postFile(id, await pngFile()))).status).toBe(409);

    const other = await submit({ name: "Another Pub" });
    await memoryVenueSubmissionStore.decide(other, { status: "declined", note: null });
    expect((await POST(postFile(other, await pngFile()))).status).toBe(404);
  });

  it("refuses an extra form part, and answers 503 when storage refuses the bytes", async () => {
    const id = await submit();
    expect((await POST(postFile(id, await pngFile(), { owner: BOB_ACCOUNT }))).status).toBe(400);
    storage.failUpload = true;
    const res = await POST(postFile(id, await pngFile()));
    expect(res.status).toBe(503);
    expect((await memoryVenueSubmissionStore.getById(id))?.files).toEqual([]);
  });
});

describe("/api/admin/venue-submissions", () => {
  it("is closed to anybody who is not a moderator", async () => {
    expect((await adminGET(admin("GET"))).status).toBe(403);
    expect((await adminPOST(admin("POST", { action: "accept", id: "x" }))).status).toBe(403);
  });

  it("lists the queue with signed file links and without the submitter", async () => {
    const id = await submit();
    expect((await POST(postFile(id, await pngFile()))).status).toBe(201);
    moderatorState.moderator = true;
    const res = await adminGET(admin("GET"));
    expect(res.status).toBe(200);
    const { submissions } = await res.json();
    expect(submissions).toHaveLength(1);
    expect(submissions[0].files[0].url).toMatch(/^https:\/\/signed\.example\/venue-submissions\//);
    expect(submissions[0]).not.toHaveProperty("ownerUserId");
    expect((await adminGET(admin("GET", undefined, "?status=published"))).status).toBe(400);
  });

  it("decides a pending submission once", async () => {
    const id = await submit();
    moderatorState.moderator = true;
    const accepted = await adminPOST(admin("POST", { action: "accept", id, note: "Walked past it." }));
    expect(accepted.status).toBe(200);
    expect((await adminPOST(admin("POST", { action: "decline", id }))).status).toBe(409);
    expect((await memoryVenueSubmissionStore.getById(id))).toMatchObject({ status: "accepted", reviewerNote: "Walked past it." });
    expect((await adminPOST(admin("POST", { action: "accept", id: "a3333333-3333-4333-8333-333333333333" }))).status).toBe(404);
    expect((await adminPOST(admin("POST", { action: "duplicate", id }))).status).toBe(400);
  });
});
