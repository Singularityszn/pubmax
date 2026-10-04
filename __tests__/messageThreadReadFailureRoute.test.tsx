// @vitest-environment jsdom

import { File as NodeFile } from "node:buffer";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createServer, type Server, type ServerResponse } from "node:http";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterAll, afterEach, beforeAll, beforeEach, expect, it, vi } from "vitest";

const OWNER = "11111111-1111-4111-8111-111111111111";
const PROFILE = "22222222-2222-4222-8222-222222222222";
const CONVERSATION = "33333333-3333-4333-8333-333333333333";
const MESSAGE = "44444444-4444-4444-8444-444444444444";
const HANDLE = "fixture_owner";
const FRIEND = "fixture_friend";
const AT = "2026-10-04T12:00:00Z";

const viewer = vi.hoisted(() => ({ user: { id: "11111111-1111-4111-8111-111111111111" }, handle: "fixture_owner", accountRevision: 1 }));

const bridge = vi.hoisted(() => ({
  get: null as null | ((request: Request, context: { params: Promise<{ id: string }> }) => Promise<Response>),
  pending: null as Promise<Response> | null,
  responses: [] as Array<{ status: number; body: unknown }>,
}));

// Keep the route, linked-actor gate, ownership gate, store and SDK real.
// Only client session/UI/realtime boundaries are inert. The transport bridge
// constructs the same bearer Request and calls the actual route handler.
vi.mock("@/components/auth/AuthProvider", () => ({
  useAuth: () => viewer,
}));
vi.mock("@/components/auth/useViewerSession", () => ({
  useViewerSession: () => ({ phase: "signed-in", signedIn: true, signedOut: false, unresolved: false }),
}));
vi.mock("@/components/auth/SignInButton", () => ({ default: () => null }));
vi.mock("next/link", () => ({
  default: ({ href, children, ...props }: { href: string; children?: React.ReactNode }) =>
    createElement("a", { href, ...props }, children),
}));
vi.mock("@/lib/messagesRealtime", () => ({ subscribeToMessages: () => () => {} }));
vi.mock("@/lib/analytics", () => ({ trackEvent: vi.fn() }));
vi.mock("@/components/messages/MessageAvatar", () => ({ default: () => null }));
vi.mock("@/components/messages/MessagePhoto", () => ({ default: () => null }));
vi.mock("@/components/messages/MessageVenueCard", () => ({ default: () => null }));
vi.mock("@/lib/keyboardInset", () => ({ useKeyboardInset: () => 0 }));
vi.mock("@/lib/authedFetch", () => ({
  authedActionFetch: (url: string, init?: RequestInit) => {
    if (!bridge.get) throw new Error("Route fixture is not ready");
    const pending = bridge.get(new Request(new URL(url, "http://localhost"), {
      ...init, headers: { authorization: "Bearer messages-owner" },
    }), { params: Promise.resolve({ id: "33333333-3333-4333-8333-333333333333" }) }).then(async (response) => {
      bridge.responses.push({ status: response.status, body: await response.clone().json() });
      return response;
    });
    bridge.pending = pending;
    return pending;
  },
}));

let server: Server;
let origin: string;
let root: Root | undefined;
let host: HTMLDivElement | undefined;
let MessageThread: typeof import("@/components/messages/MessageThread")["default"];
let routes: typeof import("@/app/api/messages/[id]/route");
let storeModule: typeof import("@/lib/messagesStore");
let photoDeps: typeof import("@/lib/messagePhotoRoute.server");
const state = { failRead: false, failMembership: false, schema: false, empty: false,
  unknown: false, outsider: false, group: false, failGroupMembers: false, status: 400, mutations: [] as string[], endpoints: [] as string[] };

function json(response: ServerResponse, body: unknown, status = 200): void {
  response.writeHead(status, { "Content-Type": "application/json" });
  response.end(JSON.stringify(body));
}

beforeAll(async () => {
  server = createServer((request, response) => {
    const url = new URL(request.url ?? "/", origin);
    const path = url.pathname;
    state.endpoints.push(path);
    if (request.method !== "GET" && path !== "/rest/v1/rpc/public_withdrawn_profiles") {
      state.mutations.push(`${request.method} ${path}`);
    }
    if (path === "/auth/v1/user") {
      return json(response, request.headers.authorization === "Bearer messages-owner" ? { id: OWNER } : { code: "bad_jwt" }, request.headers.authorization === "Bearer messages-owner" ? 200 : 401);
    }
    if (path === "/rest/v1/profiles") {
      return json(response, [{ id: PROFILE, user_id: OWNER, handle: HANDLE, visibility: "public", created_at: AT, updated_at: AT }]);
    }
    if (path === "/rest/v1/private_account_identities") {
      return json(response, [{ date_of_birth: "1990-01-01", created_at: AT, updated_at: AT }]);
    }
    if (["/rest/v1/adult_self_assertions", "/rest/v1/profile_handle_aliases", "/rest/v1/rpc/public_withdrawn_profiles"].includes(path)) {
      return json(response, []);
    }
    if (path === "/rest/v1/rpc/check_rate_limit") return json(response, false);
    if (path === "/rest/v1/conversations") {
      if (state.failMembership) return json(response, { code: "57014", message: "Synthetic membership read failure" }, 400);
      if (state.unknown) return json(response, []);
      const row = { id: CONVERSATION, handle_a: FRIEND, handle_b: state.outsider ? "fixture_stranger" : HANDLE, kind: state.group ? "group" : "direct", created_at: AT, last_message_at: AT };
      return json(response, request.headers.accept?.includes("application/vnd.pgrst.object+json") ? row : [row]);
    }
    if (path === "/rest/v1/conversation_members") {
      if (state.failGroupMembers) return json(response, { code: "57014", message: "Synthetic group membership failure" }, 400);
      return json(response, [HANDLE, FRIEND, "fixture_third"].map((handle) => ({ handle })));
    }
    if (path === "/rest/v1/messages" && request.method === "GET") {
      if (state.schema) return json(response, { code: "42P01", message: 'relation "public.messages" does not exist' }, 400);
      if (state.failRead) return json(response, { code: "57014", message: "Synthetic retryable read failure" }, state.status);
      if (state.empty) return json(response, []);
      return json(response, [{ id: MESSAGE, conversation_id: CONVERSATION, sender_handle: FRIEND,
        body: "Meet at seven", created_at: AT, read_at: AT, flagged_at: null,
        attachment_kind: null, attachment_payload: null }]);
    }
    return json(response, { message: `Unimplemented fixture endpoint: ${path}` }, 503);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Fixture port unavailable");
  origin = `http://127.0.0.1:${address.port}`;
  vi.stubEnv("SUPABASE_URL", origin);
  vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "fixture-key");
  const nativeFetch = globalThis.fetch;
  vi.stubGlobal("fetch", (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    if (url.origin !== origin) throw new Error("Non-loopback request refused by fixture");
    return nativeFetch(input, init);
  });
  vi.resetModules();
  routes = await import("@/app/api/messages/[id]/route");
  bridge.get = routes.GET;
  storeModule = await import("@/lib/messagesStore");
  photoDeps = await import("@/lib/messagePhotoRoute.server");
  // Prime the real loopback SDK before the store-only production fallback test.
  (await import("@/lib/supabase")).requireSupabaseAdmin();
  MessageThread = (await import("@/components/messages/MessageThread")).default;
});

beforeEach(() => {
  state.failRead = false;
  state.failMembership = false;
  state.schema = false;
  state.empty = false;
  state.unknown = false;
  state.outsider = false;
  state.group = false;
  state.failGroupMembers = false;
  state.status = 400;
  vi.stubEnv("VERCEL_ENV", "");
  storeModule.__resetMemoryMessages();
  state.mutations = [];
  state.endpoints = [];
  bridge.responses = [];
  bridge.pending = null;
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("File", NodeFile);
  window.localStorage.setItem("pubmax_handle", HANDLE);
  vi.spyOn(console, "error").mockImplementation(() => {});
  Object.defineProperty(window, "matchMedia", { configurable: true, value: () => ({ matches: false, addEventListener: () => {}, removeEventListener: () => {} }) });
  Object.defineProperty(Element.prototype, "scrollIntoView", { configurable: true, value: () => {} });
});

afterEach(async () => {
  if (root) await act(async () => { root?.unmount(); });
  root = undefined;
  host?.remove();
  host = undefined;
  photoDeps.__setMessagePhotoRouteDepsForTest(null);
  vi.restoreAllMocks();
});

afterAll(async () => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
});

it("keeps loaded messages when a transient durable read fails through the real GET", async () => {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await act(async () => { root?.render(createElement(MessageThread, { conversationId: CONVERSATION })); });
  await act(async () => { await bridge.pending; });
  expect(host.textContent).toContain("Meet at seven");
  expect(bridge.responses.at(-1)?.status).toBe(200);

  state.failRead = true;
  state.status = 503;
  await act(async () => {
    window.dispatchEvent(new Event("focus"));
    await bridge.pending;
  });
  // The user-facing assertion comes first: an outage must not erase the bubble.
  expect(host.textContent, JSON.stringify(bridge.responses.at(-1))).toContain("Meet at seven");
  expect(bridge.responses.at(-1)).toMatchObject({ status: 503, body: { code: "UNAVAILABLE", retryable: true } });
  expect(state.mutations).toEqual([]);
});


function getThread(): Promise<Response> {
  return routes.GET(new Request(`http://localhost/api/messages/${CONVERSATION}?handle=${HANDLE}`, {
    headers: { authorization: "Bearer messages-owner" },
  }), { params: Promise.resolve({ id: CONVERSATION }) });
}

it("returns retryable 503 when durable membership cannot be read", async () => {
  state.failMembership = true;
  const response = await getThread();
  expect(response.status).toBe(503);
  expect(await response.json()).toMatchObject({ code: "UNAVAILABLE", retryable: true });
  expect(state.mutations).toEqual([]);
});

it.each([false, true])("keeps a healthy empty thread as 200 (group=%s)", async (group) => {
  state.empty = true;
  state.group = group;
  const response = await getThread();
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({ messages: [] });
});

it.each(["unknown", "outsider"] as const)("keeps %s conversations as 404", async (kind) => {
  state[kind] = true;
  const response = await getThread();
  expect(response.status).toBe(404);
  expect(await response.json()).toMatchObject({ code: "NOT_FOUND" });
});

it("uses the existing retry control after a first read failure", async () => {
  state.failRead = true;
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await act(async () => { root?.render(createElement(MessageThread, { conversationId: CONVERSATION })); });
  await act(async () => { await bridge.pending; });
  const retry = host.querySelector<HTMLButtonElement>(".threadRetryBtn");
  expect(retry?.textContent).toBe("Try again");
  state.failRead = false;
  await act(async () => { retry?.click(); await bridge.pending; });
  expect(host.textContent).toContain("Meet at seven");
});

it("refuses a report before mutation when the participation read fails", async () => {
  state.failRead = true;
  const response = await routes.POST(new Request(`http://localhost/api/messages/${CONVERSATION}`, {
    method: "POST", headers: { authorization: "Bearer messages-owner", "content-type": "application/json" },
    body: JSON.stringify({ action: "report", handle: HANDLE, messageId: MESSAGE }),
  }), { params: Promise.resolve({ id: CONVERSATION }) });
  expect(response.status).toBe(503);
  expect(await response.json()).toMatchObject({ code: "UNAVAILABLE", retryable: true });
  expect(state.mutations).toEqual([]);
});

it("refuses a photo before Storage or moderation when the participation read fails", async () => {
  state.failRead = true;
  const forbidden = vi.fn(() => { throw new Error("Photo processing must not start"); });
  photoDeps.__setMessagePhotoRouteDepsForTest({
    storage: { upload: forbidden, readBack: forbidden, remove: forbidden, sign: forbidden },
    moderation: forbidden,
  });
  const bytes = await readFile(resolve(process.cwd(), "e2e/fixtures/bill.jpg"));
  const boundary = "messages-photo-fixture";
  const encoded = Buffer.concat([
    Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="post"\r\n\r\n${JSON.stringify({ action: "send", handle: HANDLE })}\r\n`),
    Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="photo"; filename="fixture.jpg"\r\nContent-Type: image/jpeg\r\n\r\n`),
    bytes,
    Buffer.from(`\r\n--${boundary}--\r\n`),
  ]);
  const response = await routes.POST(new Request(`http://localhost/api/messages/${CONVERSATION}`, {
    method: "POST", headers: { authorization: "Bearer messages-owner", "content-type": `multipart/form-data; boundary=${boundary}` },
    body: new Uint8Array(encoded),
  }), { params: Promise.resolve({ id: CONVERSATION }) });
  expect(response.status).toBe(503);
  expect(await response.json()).toMatchObject({ code: "UNAVAILABLE", retryable: true });
  expect(forbidden).not.toHaveBeenCalled();
  expect(state.mutations.filter((entry) => !entry.endsWith("/rpc/check_rate_limit"))).toEqual([]);
});

it("refuses a missing durable schema in production without falling back to memory", async () => {
  state.schema = true;
  vi.stubEnv("VERCEL_ENV", "production");
  // Store seam only: Production's HTTPS/key checks are not weakened for loopback.
  await expect(storeModule.supabaseMessagesStore.listMessages(CONVERSATION, HANDLE))
    .rejects.toBeInstanceOf(storeModule.MessageReadUnavailableError);
});

it("preserves permitted local missing-schema fallback", async () => {
  state.schema = true;
  await expect(storeModule.supabaseMessagesStore.listMessages(CONVERSATION, HANDLE)).resolves.toBeNull();
});


it("returns retryable 503 when group membership cannot be read", async () => {
  state.group = true;
  state.failGroupMembers = true;
  const response = await getThread();
  expect(response.status).toBe(503);
  expect(await response.json()).toMatchObject({ code: "UNAVAILABLE", retryable: true });
  expect(state.mutations).toEqual([]);
});

it("preserves permitted memory-minted conversations", async () => {
  const id = await storeModule.memoryMessagesStore.openConversation(HANDLE, FRIEND);
  expect(id).toBeTruthy();
  await storeModule.memoryMessagesStore.send(id!, FRIEND, "Local fixture message");
  const response = await routes.GET(new Request(`http://localhost/api/messages/${id}?handle=${HANDLE}`, {
    headers: { authorization: "Bearer messages-owner" },
  }), { params: Promise.resolve({ id: id! }) });
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({ messages: [{ body: "Local fixture message" }] });
});
