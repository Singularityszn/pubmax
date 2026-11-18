import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Summon your mates: the route reaches only live mates with no block or mute
// either way, and each summon lands as a direct message with the pub attached.
// These run on the keyless memory stores, so the follow graph, the profiles,
// the blocks, the mutes and the inboxes are the real ones.

const routeState = vi.hoisted(() => ({
  access: null as unknown,
  limited: false,
  detail: null as null | (() => Promise<unknown>),
  overlayStalled: false,
}));
const notifications = vi.hoisted(() => ({ work: [] as Promise<unknown>[], send: vi.fn(async () => []) }));
vi.mock("@/lib/messagesBroadcast.server", () => ({
  broadcastMessageSent: async () => true,
  deferMessagesSignal: (run: () => Promise<unknown>) => { notifications.work.push(run()); },
}));
vi.mock("@/lib/pushProvider", () => ({ selectPushProvider: () => ({ send: notifications.send }) }));

vi.mock("@/lib/serverEnv", () => ({ assertServerEnv: () => {} }));
vi.mock("@/lib/socialAccessServer", () => ({
  requireVerifiedSocialActor: async () => routeState.access,
}));
vi.mock("@/lib/pintDrops", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/pintDrops")>();
  return { ...actual, isLimited: async () => routeState.limited };
});
vi.mock("@/lib/venueIndex", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/venueIndex")>();
  return {
    ...actual,
    lookupCanonicalVenue: async (id: string) =>
      id === PUB
        ? {
            status: "found",
            canonicalId: PUB,
            venue: { id: PUB, name: "The Lamb", kind: "pub" },
            slimVenue: { id: PUB, kind: "pub" },
          }
        : actual.lookupCanonicalVenue(id),
  };
});

// The pub's public detail, as `GET /api/venue/[id]` reads it. A summon reads it
// again on the server and never takes a price from the request. A real pub with
// no injected detail reads the real artifact.
vi.mock("@/lib/venueDetailIndex", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/venueDetailIndex")>();
  return {
    ...actual,
    lookupVenueDetail: async (id: string) => routeState.detail ? routeState.detail() : actual.lookupVenueDetail(id),
  };
});

// The website and menu overlay is a network read in production. It can stall.
vi.mock("@/lib/harvestOverlayStore", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/harvestOverlayStore")>();
  return {
    ...actual,
    harvestOverlayStore: (...args: Parameters<typeof actual.harvestOverlayStore>) => routeState.overlayStalled
      ? { upsertMany: async () => ({ written: 0 }), getByVenueId: () => new Promise(() => {}) }
      : actual.harvestOverlayStore(...args),
  };
});

import { GET, POST } from "@/app/api/summon/route";
import { __resetMemoryFollows, followStore } from "@/lib/followStore";
import { SUMMON_PRICE_READ_MS } from "@/lib/summonMates.server";
import { __resetMemoryMessages, messagesStore } from "@/lib/messagesStore";
import { __resetMemoryProfiles, __seedMemoryOwnedProfile } from "@/lib/profileStore";
import { socialInteractionStore } from "@/lib/socialInteractionStore";
import { memoryMessageNotificationStore } from "@/lib/messageNotificationStore";
import { encodeWebPushSubscription } from "@/lib/webPushSubscription";
import * as supabase from "@/lib/supabase";
import * as relationships from "@/lib/socialRelationships.server";
import {
  clearSocialMemoryBlocks,
  setSocialMemoryBlock,
  setSocialMemoryMute,
} from "@/lib/socialBlockMemory";
import { resetVenueDetailCachesForTests, setVenueDetailIndexFileForTests, setVenueDetailRowsFileForTests } from "@/lib/venueDetailIndex";
import { groupVenuePrices, stableVenueIdFromKey, venueGroupingKey, type Venue, type VenuePrice } from "@/lib/venues";

const PUB = "summon-test-pub";
const ME = "summon_me_12";

let me: ReturnType<typeof __seedMemoryOwnedProfile>;

async function mate(handle: string) {
  const profile = __seedMemoryOwnedProfile(handle, `user-${handle}`);
  await followStore().follow(ME, handle);
  await followStore().follow(handle, ME);
  return profile;
}

async function mates(): Promise<string[]> {
  const response = await GET(new Request("http://localhost/api/summon"));
  expect(response.headers.get("Cache-Control")).toBe("private, no-store");
  return ((await response.json()) as { mates: string[] }).mates;
}

function summon(body: unknown): Promise<Response> {
  return POST(
    new Request("http://localhost/api/summon", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
}

async function inbox(handle: string) {
  const conversationId = await messagesStore().findConversation(ME, handle);
  if (!conversationId) return [];
  return (await messagesStore().listMessages(conversationId, handle)) ?? [];
}

const NOW = new Date("2026-11-17T12:00:00Z");
const SOURCE = "https://www.pint-prices.com/pub/94%20Lamb's%20Conduit%20Street/The%20Lamb";
const PRICED_LINE = `Pint Prices listed Amstel (pint) at £5.50, read 9 November 2026. Source: ${SOURCE}`;

/** The Lamb's public detail with one listed Amstel row, as the detail reader groups it. */
function lambDetail(overrides: Partial<VenuePrice> = {}, id = PUB): { status: "found"; venue: Venue } {
  const [venue] = groupVenuePrices([{
    app_price_id: "app_price_lamb_1",
    pub_name: "The Lamb",
    pint_name: "Amstel",
    measure: "pint",
    price_gbp: 5.5,
    price_text: "£5.50",
    address: "94 Lamb's Conduit Street, London, WC1N 3LZ",
    latitude: 51.5226,
    longitude: -0.1188,
    pub_url: SOURCE,
    scraped_at_values: "2026-11-09T13:07:13+00:00",
    ...overrides,
  } as VenuePrice]);
  return { status: "found", venue: { ...venue!, id } };
}

const WHITBY = "venue-16pnwmm";
const WHITBY_SOURCE = "https://www.pint-prices.com/pub/57%20Wapping%20Wall/Prospect%20of%20Whitby";
const artifactDirectories: string[] = [];

/** Serve this pub's detail artifact from one dated Amstel row, through the real detail files. */
function servePricedArtifact(id: string): void {
  const dataset = JSON.parse(
    readFileSync(path.join(process.cwd(), "public", "data", "pint_prices_app_dataset.json"), "utf8"),
  ) as VenuePrice[];
  const seed = dataset.find((row) => stableVenueIdFromKey(venueGroupingKey(row)) === id);
  if (!seed) throw new Error(`${id} is not in the bundled dataset`);
  const row = {
    ...seed,
    pint_name: "Amstel",
    measure: "pint",
    price_gbp: 5.5,
    price_text: "£5.50",
    pub_url: WHITBY_SOURCE,
    scraped_at_values: "2026-11-09T13:07:13+00:00",
  } as VenuePrice;
  delete row.price_superseded;
  const directory = mkdtempSync(path.join(tmpdir(), "summon-price-"));
  artifactDirectories.push(directory);
  const line = `${JSON.stringify({ id, rows: [row] })}\n`;
  writeFileSync(path.join(directory, "venue_details.jsonl"), line);
  writeFileSync(path.join(directory, "venue_detail_index.json"), JSON.stringify({
    version: 1,
    detailsFile: "venue_details.jsonl",
    count: 1,
    venues: { [id]: { offset: 0, length: Buffer.byteLength(line), rowCount: 1 } },
  }));
  setVenueDetailIndexFileForTests(path.join(directory, "venue_detail_index.json"));
  setVenueDetailRowsFileForTests(path.join(directory, "venue_details.jsonl"));
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  routeState.detail = null;
  routeState.overlayStalled = false;
  notifications.work = [];
  notifications.send.mockClear();
  me = __seedMemoryOwnedProfile(ME, "user-me-12");
  routeState.access = { ok: true, actor: { accountId: "acct-me-12", profileId: me.id, handle: ME } };
  routeState.limited = false;
});

afterEach(async () => {
  await Promise.all(notifications.work);
  vi.useRealTimers();
  vi.restoreAllMocks();
  __resetMemoryFollows();
  __resetMemoryProfiles();
  __resetMemoryMessages();
  clearSocialMemoryBlocks();
  resetVenueDetailCachesForTests();
  for (const directory of artifactDirectories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

describe("GET /api/summon", () => {
  it.each(["GET", "POST"])("returns unavailable before delivery when the live-mutual read is unavailable during %s", async (method) => {
    await mate("summon_ann_12");
    const bo = await mate("summon_bo_12");
    const profileStore = (await import("@/lib/profileStore")).profileStore();
    const mutualStore = followStore();
    const interactionStore = socialInteractionStore();
    const messageStore = messagesStore();
    vi.spyOn(await import("@/lib/profileStore"), "profileStore").mockReturnValue(profileStore);
    vi.spyOn(await import("@/lib/followStore"), "followStore").mockReturnValue(mutualStore);
    vi.spyOn(await import("@/lib/socialInteractionStore"), "socialInteractionStore").mockReturnValue(interactionStore);
    vi.spyOn(await import("@/lib/messagesStore"), "messagesStore").mockReturnValue(messageStore);
    vi.spyOn(supabase, "isSupabaseConfigured").mockReturnValue(true);
    vi.spyOn(relationships, "socialRelationshipBetweenProfiles").mockImplementation(async (_, target) =>
      target === bo.id ? "unavailable" : "mutual",
    );

    const response = method === "GET"
      ? await GET(new Request("http://localhost/api/summon"))
      : await summon({ venueId: PUB, time: "20:00", mates: ["summon_ann_12", "summon_bo_12"] });

    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ code: "UNAVAILABLE", retryable: true });
    expect(await inbox("summon_ann_12")).toEqual([]);
    expect(await inbox("summon_bo_12")).toEqual([]);
  });

  it.each([
    ["GET", "mine"], ["GET", "theirs"],
    ["POST", "mine"], ["POST", "theirs"],
  ])("returns unavailable when a relationship read fails during %s (%s)", async (method, direction) => {
    await mate("summon_ann_12");
    const bo = await mate("summon_bo_12");
    const store = socialInteractionStore();
    const relationship = store.relationship.bind(store);
    vi.spyOn(store, "relationship").mockImplementation(async (actor, target) => {
      if (direction === "mine" ? target === bo.id : actor.profileId === bo.id) {
        throw new Error("Relationship unavailable");
      }
      return relationship(actor, target);
    });

    const response = method === "GET"
      ? await GET(new Request("http://localhost/api/summon"))
      : await summon({ venueId: PUB, time: "20:00", mates: ["summon_ann_12", "summon_bo_12"] });

    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ code: "UNAVAILABLE", retryable: true });
    expect(await inbox("summon_ann_12")).toEqual([]);
    expect(await inbox("summon_bo_12")).toEqual([]);
  });

  it.each(["GET", "POST"])("preserves access recovery details during %s", async (method) => {
    for (const gate of ["onboarding_required", "adult_check_required", "adult_check_failed"]) {
      routeState.access = {
        ok: false,
        status: 403,
        code: "SOCIAL_ADULT_VERIFICATION_REQUIRED",
        error: "Adult verification is needed for Social.",
        gate,
      };
      const response = method === "GET"
        ? await GET(new Request("http://localhost/api/summon"))
        : await summon({ venueId: PUB, time: "20:00", mates: ["summon_ann_12"] });
      expect(response.status).toBe(403);
      expect(await response.json()).toMatchObject({
        code: "SOCIAL_ADULT_VERIFICATION_REQUIRED",
        details: { gate },
      });
    }
  });

  it("refuses a reader with no verified session, privately", async () => {
    routeState.access = { ok: false, error: "Sign in to use Social.", code: "SOCIAL_SIGN_IN_REQUIRED", status: 401 };
    const response = await GET(new Request("http://localhost/api/summon"));
    expect(response.status).toBe(401);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
  });

  it("lists mutual follows only, never a follower alone or a stranger", async () => {
    await mate("summon_bo_12");
    await mate("summon_ann_12");
    __seedMemoryOwnedProfile("summon_follower_12", "user-follower");
    await followStore().follow("summon_follower_12", ME);
    __seedMemoryOwnedProfile("summon_stranger_12", "user-stranger");

    expect(await mates()).toEqual(["summon_ann_12", "summon_bo_12"]);
  });

  it("leaves out a mate across a block or a mute, whichever side set it", async () => {
    const blockedByMe = await mate("summon_a_12");
    const blocksMe = await mate("summon_b_12");
    const mutedByMe = await mate("summon_c_12");
    const mutesMe = await mate("summon_d_12");
    await mate("summon_e_12");
    setSocialMemoryBlock(me.id, blockedByMe.id, true);
    setSocialMemoryBlock(blocksMe.id, me.id, true);
    setSocialMemoryMute(me.id, mutedByMe.id, true);
    setSocialMemoryMute(mutesMe.id, me.id, true);

    expect(await mates()).toEqual(["summon_e_12"]);
  });
});

describe("POST /api/summon", () => {
  it.each([true, false])("sends a private recipient alert only with consent=%s, excluding the sender", async (enabled) => {
    await mate("summon_ann_12");
    const token = encodeWebPushSubscription({ endpoint: "https://web.push.apple.com/summon-recipient", keys: { p256dh: "public_key_material", auth: "secret_auth_material" } })!;
    const senderToken = encodeWebPushSubscription({ endpoint: "https://web.push.apple.com/summon-sender", keys: { p256dh: "public_key_material", auth: "secret_auth_material" } })!;
    await memoryMessageNotificationStore.savePreferences("user-summon_ann_12", { enabled, preview: false });
    await memoryMessageNotificationStore.savePreferences("user-me-12", { enabled: true, preview: false });
    await memoryMessageNotificationStore.saveToken("user-summon_ann_12", token, "session");
    await memoryMessageNotificationStore.saveToken("user-me-12", senderToken, "session");
    try {
      expect((await summon({ venueId: PUB, time: "20:00", mates: [ME, "summon_ann_12"] })).status).toBe(201);
      await Promise.all(notifications.work);
      if (enabled) {
        expect(notifications.send).toHaveBeenCalledOnce();
        expect(notifications.send).toHaveBeenCalledWith([token], expect.objectContaining({ title: "New message", body: "Open PubMaxxing to read it.", data: expect.objectContaining({ recipientId: "user-summon_ann_12" }) }));
      } else expect(notifications.send).not.toHaveBeenCalled();
    } finally {
      await memoryMessageNotificationStore.release(token);
      await memoryMessageNotificationStore.release(senderToken);
      await memoryMessageNotificationStore.savePreferences("user-summon_ann_12", { enabled: false, preview: false });
      await memoryMessageNotificationStore.savePreferences("user-me-12", { enabled: false, preview: false });
    }
  });
  it.each(["conversation", "message", "exception"])("schedules no alert when delivery fails at %s", async failure => {
    await mate("summon_ann_12");
    if (failure === "conversation") vi.spyOn(messagesStore(), "openConversation").mockResolvedValue(null);
    else if (failure === "message") vi.spyOn(messagesStore(), "send").mockResolvedValue(null);
    else vi.spyOn(messagesStore(), "send").mockRejectedValue(new Error("Store unavailable"));
    const response = await summon({ venueId: PUB, time: "20:00", mates: ["summon_ann_12"] });
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ code: "UNAVAILABLE", retryable: true });
    expect(notifications.work).toEqual([]);
    expect(notifications.send).not.toHaveBeenCalled();
  });
  it.each([
    { label: "null", body: null },
    { label: "an array", body: [] },
    { label: "a string", body: "pub" },
    { label: "a number", body: 42 },
    { label: "a boolean", body: true },
  ])("rejects $label as a malformed request body", async ({ body }) => {
    const response = await summon(body);

    expect(response.status).toBe(400);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(await response.json()).toMatchObject({
      error: "Malformed request body.",
      code: "MALFORMED_REQUEST",
    });
  });

  it("sends each picked mate one message with the pub attached and the pub's own name", async () => {
    await mate("summon_ann_12");
    await mate("summon_bo_12");

    const response = await summon({
      venueId: PUB,
      time: "20:30",
      mates: ["summon_ann_12", "summon_bo_12"],
    });
    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({ sent: ["summon_ann_12", "summon_bo_12"], failed: [] });
    for (const handle of ["summon_ann_12", "summon_bo_12"]) {
      const messages = await inbox(handle);
      expect(messages).toHaveLength(1);
      expect(messages[0]).toMatchObject({
        senderHandle: ME,
        body: "Come to The Lamb at 8:30pm?",
        attachment: { kind: "venue", venueId: PUB },
      });
    }
  });

  it("never reaches a muted, blocked or non-mutual handle, even when the request names it", async () => {
    routeState.detail = async () => lambDetail();
    await mate("summon_ann_12");
    const mutesMe = await mate("summon_mutes_12");
    const blocksMe = await mate("summon_blocks_12");
    __seedMemoryOwnedProfile("summon_stranger_12", "user-stranger");
    setSocialMemoryMute(mutesMe.id, me.id, true);
    setSocialMemoryBlock(blocksMe.id, me.id, true);

    const response = await summon({
      venueId: PUB,
      time: "19:00",
      mates: ["summon_ann_12", "summon_mutes_12", "summon_blocks_12", "summon_stranger_12"],
    });
    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({ sent: ["summon_ann_12"], failed: [] });
    expect(await inbox("summon_mutes_12")).toEqual([]);
    expect(await inbox("summon_blocks_12")).toEqual([]);
    expect(await inbox("summon_stranger_12")).toEqual([]);
  });

  it("honours a mute made while the optional price read is pending", async () => {
    const recipient = await mate("summon_ann_12");
    let entered!: () => void;
    const reading = new Promise<void>((resolve) => { entered = resolve; });
    let release!: (detail: ReturnType<typeof lambDetail>) => void;
    routeState.detail = () => {
      entered();
      return new Promise((resolve) => { release = resolve; });
    };
    const pending = summon({ venueId: PUB, time: "19:00", mates: ["summon_ann_12"] });
    await reading;
    setSocialMemoryMute(recipient.id, me.id, true);
    release(lambDetail());
    const response = await pending;
    expect(await inbox("summon_ann_12")).toHaveLength(0);
    expect(response.status).toBe(400);
  });

  it("honours an unfollow made while the optional price read is pending", async () => {
    await mate("summon_ann_12");
    await mate("summon_bo_12");
    let entered!: () => void;
    const reading = new Promise<void>((resolve) => { entered = resolve; });
    let release!: (detail: ReturnType<typeof lambDetail>) => void;
    routeState.detail = () => {
      entered();
      return new Promise((resolve) => { release = resolve; });
    };
    const pending = summon({ venueId: PUB, time: "19:00", mates: ["summon_ann_12", "summon_bo_12"] });
    await reading;
    await followStore().unfollow("summon_ann_12", ME);
    release(lambDetail());
    const response = await pending;
    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({ sent: ["summon_bo_12"], failed: [] });
    expect(await inbox("summon_ann_12")).toEqual([]);
  });

  it("sends the price-free invite when the optional price read never answers", async () => {
    vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] });
    vi.setSystemTime(NOW);
    await mate("summon_ann_12");
    let entered!: () => void;
    const reading = new Promise<void>((resolve) => { entered = resolve; });
    routeState.detail = () => {
      entered();
      return new Promise(() => {});
    };
    let settled = false;
    const pending = summon({ venueId: PUB, time: "19:00", mates: ["summon_ann_12"] }).finally(() => { settled = true; });
    await reading;
    await vi.advanceTimersByTimeAsync(SUMMON_PRICE_READ_MS - 1);
    expect(settled).toBe(false);
    expect(await inbox("summon_ann_12")).toEqual([]);
    await vi.advanceTimersByTimeAsync(1);
    const response = await pending;
    expect(response.status).toBe(201);
    expect((await inbox("summon_ann_12"))[0]?.body).toBe("Come to The Lamb at 7pm?");
  });

  it("refuses when nobody named can be summoned, and sends nothing", async () => {
    const mutedByMe = await mate("summon_ann_12");
    setSocialMemoryMute(me.id, mutedByMe.id, true);

    const response = await summon({ venueId: PUB, time: "19:00", mates: ["summon_ann_12"] });
    expect(response.status).toBe(400);
    expect(await inbox("summon_ann_12")).toEqual([]);
  });

  it("refuses a bad time, an unknown pub, no mates, and a sender over the limit", async () => {
    await mate("summon_ann_12");
    expect((await summon({ venueId: PUB, time: "25:00", mates: ["summon_ann_12"] })).status).toBe(400);
    expect((await summon({ venueId: PUB, time: "20:00", mates: [] })).status).toBe(400);
    expect((await summon({ venueId: "nowhere-pub", time: "20:00", mates: ["summon_ann_12"] })).status).toBe(404);
    routeState.limited = true;
    expect((await summon({ venueId: PUB, time: "20:00", mates: ["summon_ann_12"] })).status).toBe(429);
    expect(await inbox("summon_ann_12")).toEqual([]);
  });

  it("adds the server's dated price to each stored message and ignores any price in the request", async () => {
    routeState.detail = async () => lambDetail();
    await mate("summon_ann_12");

    const response = await summon({
      venueId: PUB,
      time: "20:00",
      mates: ["summon_ann_12"],
      price: { drink: "Amstel", amountGbp: 1, sourceUrl: "https://evil.example/" },
      priceText: "£1 a pint",
      body: "Free pints at The Lamb",
    });

    expect(response.status).toBe(201);
    const [message] = await inbox("summon_ann_12");
    expect(message).toMatchObject({
      body: `Come to The Lamb at 8pm? ${PRICED_LINE}`,
      attachment: { kind: "venue", venueId: PUB },
    });
  });

  it("sends the evidence read at send time, not what an earlier preview showed", async () => {
    routeState.detail = async () => lambDetail();
    await mate("summon_ann_12");
    routeState.detail = async () => lambDetail({ price_gbp: 5.2, price_text: "£5.20", scraped_at_values: "2026-11-16T18:00:00Z" });

    expect((await summon({ venueId: PUB, time: "20:00", mates: ["summon_ann_12"] })).status).toBe(201);
    expect((await inbox("summon_ann_12"))[0]?.body).toBe(
      `Come to The Lamb at 8pm? Pint Prices listed Amstel (pint) at £5.20, read 16 November 2026. Source: ${SOURCE}`,
    );
  });

  it.each([
    ["the detail read throws", async () => { throw new Error("detail down"); }],
    ["the detail is unavailable", async () => ({ status: "unavailable" })],
    ["the evidence is older than 30 London days", async () => lambDetail({ scraped_at_values: "2026-10-01T12:00:00Z" })],
    ["the row states no measure", async () => lambDetail({ measure: undefined })],
    ["the detail describes another pub", async () => lambDetail({}, "another-pub")],
  ])("still sends the price-free invite when %s", async (_label, detail) => {
    routeState.detail = detail;
    await mate("summon_ann_12");

    expect((await summon({ venueId: PUB, time: "20:00", mates: ["summon_ann_12"] })).status).toBe(201);
    expect((await inbox("summon_ann_12"))[0]?.body).toBe("Come to The Lamb at 8pm?");
  });

  it("names a partial send exactly, with the price on the message that landed", async () => {
    routeState.detail = async () => lambDetail();
    await mate("summon_ann_12");
    await mate("summon_bo_12");
    const store = messagesStore();
    const send = store.send.bind(store);
    vi.spyOn(await import("@/lib/messagesStore"), "messagesStore").mockReturnValue(store);
    vi.spyOn(store, "send").mockImplementation(async (conversationId, sender, body, attachment, options) => {
      const members = await store.findConversation(ME, "summon_bo_12");
      return conversationId === members ? null : send(conversationId, sender, body, attachment, options);
    });

    const response = await summon({ venueId: PUB, time: "20:00", mates: ["summon_ann_12", "summon_bo_12"] });

    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({ sent: ["summon_ann_12"], failed: ["summon_bo_12"] });
    expect((await inbox("summon_ann_12"))[0]?.body).toBe(`Come to The Lamb at 8pm? ${PRICED_LINE}`);
    expect(await inbox("summon_bo_12")).toEqual([]);
  });

  it("quotes a real pub's listed price without waiting for its website overlay", async () => {
    servePricedArtifact(WHITBY);
    routeState.overlayStalled = true;
    await mate("summon_ann_12");

    expect((await summon({ venueId: WHITBY, time: "20:00", mates: ["summon_ann_12"] })).status).toBe(201);
    expect((await inbox("summon_ann_12"))[0]?.body).toBe(
      `Come to Prospect of Whitby at 8pm? Pint Prices listed Amstel (pint) at £5.50, read 9 November 2026. Source: ${WHITBY_SOURCE}`,
    );
  });
});
