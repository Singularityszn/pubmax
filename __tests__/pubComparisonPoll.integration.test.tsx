// @vitest-environment jsdom

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { MessageDTO } from "@/lib/messages";
import type { PubComparisonResultVenue } from "@/lib/pubComparison";

const state = vi.hoisted(() => ({ actor: {
  user: { id: "local-alice" }, handle: "alice", accountRevision: 0, providerAuthState: "authenticated",
} }));
vi.mock("@/components/auth/authContext", () => ({ useAuth: () => state.actor }));
vi.mock("@/lib/authClient", () => ({ getAccessToken: async () => state.actor.user.id }));
vi.mock("@/lib/authServer", async (original) => ({
  ...await original<typeof import("@/lib/authServer")>(),
  // Only the external identity verifier is replaced. Ownership, membership,
  // consent, rate limits, message storage and HTTP handlers remain real.
  callerUserId: async (request: Request) => {
    const token = request.headers.get("authorization")?.replace(/^Bearer /, "");
    return token === "local-alice" || token === "local-bob" || token === "local-charlie" ? token : null;
  },
}));
vi.mock("@/lib/supabase", async (original) => ({
  ...await original<typeof import("@/lib/supabase")>(), isSupabaseConfigured: () => false,
}));
vi.mock("@/lib/serverEnv", () => ({ assertServerEnv: () => {} }));
vi.mock("@/lib/analytics", () => ({ trackEvent: vi.fn() }));

import PubComparisonShare from "@/components/tools/PubComparisonShare";
import { GET as inbox, POST as openConversation } from "@/app/api/messages/route";
import { GET as thread, POST as send } from "@/app/api/messages/[id]/route";
import { publishAuthActionState, authedActionJson } from "@/lib/authedFetch";
import { setProviderIdentity } from "@/lib/authProviderRevision";
import { __resetMemoryMessages } from "@/lib/messagesStore";
import { __resetMemoryProfiles, __seedMemoryOwnedProfile } from "@/lib/profileStore";
import { __resetPintDrops } from "@/lib/pintDrops";
import { __resetMemoryFollows, memoryFollowStore } from "@/lib/followStore";
import { __resetMemoryAdultSelfAssertions, memoryAdultSelfAssertionStore } from "@/lib/adultSelfAssertionStore";

const venues: PubComparisonResultVenue[] = ["a", "b"].map((id) => ({
  id: `venue-${id}`, name: "The Crown", address: `${id} Street`, borough: "Islington", items: [],
  knownSubtotalPence: 500, totalPence: 500, mapHref: `/map?sel=venue-${id}`,
  walk: { status: "not-requested", minutes: null, method: null, timing: null },
}));
let container: HTMLDivElement;
let root: Root;
let conversationId: string;
let dropSendReply: boolean;
let delay: "GET" | "POST" | null;
let held: { request: Request; release: () => void } | null;
let attempts: Array<{ clientMessageId: string }>;

function as(handle: "alice" | "bob" | "charlie") {
  const id = `local-${handle}`;
  const revision = setProviderIdentity("supabase", id);
  state.actor = { user: { id }, handle, accountRevision: revision, providerAuthState: "authenticated" };
  publishAuthActionState({ status: "signed-in", identityResolved: true });
}
async function render() {
  await act(async () => root.render(createElement(PubComparisonShare, { venues })));
}
async function click(label: string) {
  const button = [...container.querySelectorAll("button")].find((node) => node.textContent?.trim() === label);
  expect(button, label).toBeTruthy();
  expect(button?.disabled).toBe(false);
  await act(async () => button!.click());
}
async function waitForText(text: string) {
  await act(async () => { await vi.waitFor(() => expect(container.textContent).toContain(text)); });
}
async function chooseConversation() {
  await click("Load my conversations");
  await act(async () => { await vi.waitFor(() => expect(container.querySelector("select")).toBeTruthy()); });
  await selectConversation(conversationId);
}
async function selectConversation(id: string) {
  await act(async () => {
    const select = container.querySelector("select")!;
    select.value = id;
    select.dispatchEvent(new Event("change", { bubbles: true }));
  });
}
async function readThread(id = conversationId) {
  const { response, body } = await authedActionJson<{ messages: MessageDTO[] }>(
    `/api/messages/${id}`, {}, { requiresIdentity: true });
  expect(response.status).toBe(200);
  expect(response.headers.get("cache-control")).toBe("no-store");
  return body.messages;
}

beforeEach(async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  __resetMemoryMessages();
  __resetMemoryProfiles();
  __resetMemoryFollows();
  __resetMemoryAdultSelfAssertions();
  __resetPintDrops();
  for (const handle of ["alice", "bob"]) {
    __seedMemoryOwnedProfile(handle, `local-${handle}`);
    await memoryAdultSelfAssertionStore.record(`local-${handle}`);
  }
  await memoryFollowStore.follow("alice", "bob");
  await memoryFollowStore.follow("bob", "alice");
  attempts = [];
  dropSendReply = false;
  delay = null;
  held = null;
  vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = new Request(new URL(String(input), "http://localhost"), init);
    const path = new URL(request.url).pathname;
    expect(path.startsWith("/api/messages")).toBe(true);
    const id = path.split("/")[3];
    const post = request.method === "POST";
    if (post && id) attempts.push(await request.clone().json());
    const response = id
      ? await (post ? send : thread)(request, { params: Promise.resolve({ id }) })
      : await (post ? openConversation : inbox)(request);
    if (id && post && dropSendReply) {
      dropSendReply = false;
      expect(response.status).toBe(201);
      throw new TypeError("Connection lost after the handler committed the poll");
    }
    // Deliberately deliver an obsolete response even after transport abort.
    // The real authenticated helper and component must refuse that response.
    if (request.method === delay) {
      delay = null;
      await new Promise<void>((release) => { held = { request, release }; });
    }
    return response;
  });
  as("alice");
  const { response, body } = await authedActionJson<{ conversationId: string }>("/api/messages", {
    method: "POST", body: JSON.stringify({ action: "open", handle: "alice", other: "bob" }),
  }, { requiresIdentity: true });
  expect(response.ok).toBe(true);
  conversationId = body.conversationId;
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  held?.release();
  await act(async () => root.unmount());
  container.remove();
  setProviderIdentity("supabase", null);
  publishAuthActionState({ status: "signed-out", identityResolved: true });
  vi.unstubAllGlobals();
});

it("delivers the private poll once after A-B-A retries and lets its recipient answer", async () => {
  // Oracle: the sharing contract permits public pub labels and links only.
  // A lost acknowledgement must not create two polls. Each viewer sees only
  // their own answer, with aggregate counts for the other participant.
  __seedMemoryOwnedProfile("charlie", "local-charlie");
  await memoryAdultSelfAssertionStore.record("local-charlie");
  await memoryFollowStore.follow("alice", "charlie");
  await memoryFollowStore.follow("charlie", "alice");
  const other = await authedActionJson<{ conversationId: string }>("/api/messages", {
    method: "POST", body: JSON.stringify({ action: "open", handle: "alice", other: "charlie" }),
  }, { requiresIdentity: true });
  expect(other.response.ok).toBe(true);
  const otherConversationId = other.body.conversationId;
  expect(otherConversationId).not.toBe(conversationId);
  await render();
  await chooseConversation();
  dropSendReply = true;
  await click("Send this poll");
  await waitForText("Check the conversation before retrying");
  await selectConversation(otherConversationId);
  dropSendReply = true;
  await click("Send this poll");
  await waitForText("Check the conversation before retrying");
  await selectConversation(conversationId);
  await click("Send this poll");
  await waitForText("Poll sent");
  expect(attempts).toHaveLength(3);
  expect(attempts[0]!.clientMessageId).toMatch(/^[a-f0-9-]{36}$/);
  expect(attempts[1]!.clientMessageId).not.toBe(attempts[0]!.clientMessageId);
  expect(attempts[2]!.clientMessageId).toBe(attempts[0]!.clientMessageId);

  as("charlie");
  expect(await readThread(otherConversationId)).toHaveLength(1);

  as("bob");
  const received = await readThread();
  expect(received).toHaveLength(1);
  expect(received[0]).toMatchObject({ senderHandle: "alice", body:
    "1. https://pubmaxxing.com/ledger/venue-a 2. https://pubmaxxing.com/ledger/venue-b",
    attachment: { kind: "poll", poll: { question: "Which pub works for us?", totalVotes: 0, viewerOptionIndex: null,
      options: [{ label: "1. The Crown, a Street", votes: 0 }, { label: "2. The Crown, b Street", votes: 0 }],
    } },
  });
  const vote = await authedActionJson(`/api/messages/${conversationId}`, {
    method: "POST", body: JSON.stringify({ action: "vote", messageId: received[0]!.id, optionIndex: 1 }),
  }, { requiresIdentity: true });
  expect(vote.response.status).toBe(200);
  expect(vote.body).toMatchObject({ poll: { totalVotes: 1, viewerOptionIndex: 1 } });
  as("alice");
  const answered = await readThread();
  expect(answered).toHaveLength(1);
  expect(answered[0]).toMatchObject({ attachment: { kind: "poll", poll: {
    totalVotes: 1, viewerOptionIndex: null, options: [{ votes: 0 }, { votes: 1 }],
  } } });
  expect(JSON.stringify(answered[0]!.attachment)).not.toContain("bob");
});

it.each(["GET", "POST"] as const)("cancels an old account's delayed %s response", async (method) => {
  await render();
  if (method === "POST") await chooseConversation();
  delay = method;
  await click(method === "GET" ? "Load my conversations" : "Send this poll");
  await act(async () => { await vi.waitFor(() => expect(held).not.toBeNull()); });
  const pending = held!;
  expect(pending.request.signal.aborted).toBe(false);
  as("bob");
  await render();
  expect(pending.request.signal.aborted).toBe(true);
  await act(async () => { pending.release(); });
  expect(container.textContent).toContain("Load my conversations");
  expect(container.querySelector("select")).toBeNull();
  expect(container.textContent).not.toContain("Poll sent");
  // Cancellation cannot retract a send already committed by the server.
  const messages = await readThread();
  expect(messages).toHaveLength(method === "POST" ? 1 : 0);
});
