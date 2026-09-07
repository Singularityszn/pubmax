// @vitest-environment jsdom
// Render the actual thread over actual route handlers and the durable store.
import { File as NodeFile } from "node:buffer";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({ fault: "healthy", writes: 0 }));
const viewer = vi.hoisted(() => ({ user: { id: "account-ken" }, handle: "ken", accountRevision: 1 }));
vi.mock("@/lib/serverEnv", async (original) => ({
  ...(await original<typeof import("@/lib/serverEnv")>()),
  assertServerEnv: () => {},
}));
vi.mock("@/lib/supabase", async (original) => ({
  ...(await original<typeof import("@/lib/supabase")>()),
  isSupabaseConfigured: () => true,
  requireSupabaseAdmin: () => ({
    from(table: string) {
      const query: Record<string, unknown> = {};
      for (const method of ["select", "eq", "neq", "is", "or", "order", "limit", "single", "maybeSingle"]) {
        query[method] = () => query;
      }
      query.update = () => { db.writes++; return query; };
      query.then = (resolve: (value: unknown) => unknown) => {
        const error = db.fault === "schema"
          ? { message: `Could not find the table 'public.${table}' in the schema cache` }
          : db.fault === "pair-timeout" || (db.fault === "timeout" && table === "messages")
            ? { message: "canceling statement due to statement timeout" }
            : null;
        const pair = db.fault === "absent" ? null
          : db.fault === "outsider" ? { handle_a: "sam", handle_b: "jen" }
            : { handle_a: "ken", handle_b: "sam" };
        const rows = db.fault === "empty" ? [] : [{
          id: "m1", conversation_id: "11111111-1111-4111-8111-111111111111",
          sender_handle: "sam", body: "Meet at seven", created_at: "2026-09-05T10:00:00Z",
          read_at: "2026-09-05T10:01:00Z", flagged_at: null,
        }];
        return Promise.resolve({ data: error ? null : table === "conversations" ? pair : rows, error }).then(resolve);
      };
      return query;
    },
  }),
}));
vi.mock("@/lib/messageAuth", () => ({
  requireLinkedActor: async () => ({ ok: true, handle: "ken", userId: "account-ken" }),
}));
vi.mock("@/lib/profileOwnership", () => ({
  gateHandleAction: async () => ({ allowed: true }),
}));
vi.mock("@/lib/profileStore", () => ({
  profileStore: () => ({ getByHandle: async () => ({ handle: "sam", userId: "account-sam" }) }),
  isProfileTombstoned: () => false,
}));
vi.mock("@/lib/pintDrops", () => ({ isLimited: async () => false }));
vi.mock("@/lib/opsFreeze", () => ({ socialFreezeResponse: () => null }));
vi.mock("@/lib/messagesBroadcast.server", () => ({
  deferMessagesSignal: vi.fn(), broadcastMessageSent: vi.fn(), broadcastMessagesRead: vi.fn(),
}));
vi.mock("@/lib/messageVenueCards.server", () => ({ attachMessageVenueCards: async (rows: unknown[]) => rows }));


vi.mock("@/components/auth/AuthProvider", () => ({
  useAuth: () => viewer,
}));
vi.mock("@/components/auth/useViewerSession", () => ({
  useViewerSession: () => ({ phase: "signed-in", signedIn: true, signedOut: false, unresolved: false }),
}));
vi.mock("@/components/auth/SignInButton", () => ({ default: () => null }));
vi.mock("next/link", () => ({
  default: ({ href, children }: { href: string; children?: React.ReactNode }) => createElement("a", { href }, children),
}));
vi.mock("@/lib/messagesRealtime", () => ({ subscribeToMessages: () => () => {}, subscribeToInbox: () => () => {} }));
vi.mock("@/lib/analytics", () => ({ trackEvent: vi.fn() }));
vi.mock("@/lib/useDismissOnEscape", () => ({ useDismissOnEscape: vi.fn() }));
vi.mock("@/lib/useFocusTrap", () => ({ useFocusTrap: vi.fn() }));
vi.mock("@/components/profile/ProfileImageCropper", () => ({ default: () => null }));
vi.mock("@/components/messages/MessageVenuePicker", () => ({ default: () => null }));
vi.mock("@/components/messages/MessagePhoto", () => ({ default: () => null }));
vi.mock("@/components/messages/MessageVenueCard", () => ({ default: () => null }));
vi.mock("@/components/messages/MessageAvatar", () => ({ default: () => null }));
vi.mock("@/lib/keyboardInset", () => ({ useKeyboardInset: () => 0 }));
vi.mock("@/lib/authedFetch", () => ({
  authedActionFetch: (input: string) => input.startsWith("/api/messages?")
    ? Promise.resolve(Response.json({ conversations: [], status: "ready" }))
    : GET(new Request(new URL(input, BASE)), { params: Promise.resolve({ id: ID }) }),
}));

import { GET, POST } from "@/app/api/messages/[id]/route";
import MessageThread from "@/components/messages/MessageThread";
const BASE = "http://localhost";
const ID = "11111111-1111-4111-8111-111111111111";
let root: Root | undefined;
let container: HTMLDivElement;
async function flush() {
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
}
async function mount() {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => { root!.render(createElement(MessageThread, { conversationId: ID })); });
  await flush();
  await flush();
}
function read() {
  return GET(new Request(`${BASE}/api/messages/${ID}?handle=ken`), { params: Promise.resolve({ id: ID }) });
}
beforeEach(() => {
  vi.stubEnv("VERCEL_ENV", "production");
  vi.stubEnv("PUBMAX_E2E_KEYLESS", "0");
  vi.stubEnv("NEXT_PHASE", "");
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("File", NodeFile);
  Object.defineProperty(Element.prototype, "scrollIntoView", { value: () => {}, configurable: true });
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: () => ({ matches: false, addEventListener: () => {}, removeEventListener: () => {} }),
  });
  db.fault = "healthy";
  db.writes = 0;
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(async () => {
  await act(async () => { root?.unmount(); });
  root = undefined;
  container?.remove();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("thread read failure across route and rendered thread", () => {
  it("keeps loaded messages when a database timeout reaches the route", async () => {
    await mount();
    expect(container.textContent).toContain("Meet at seven");
    db.fault = "timeout";
    await act(async () => { window.dispatchEvent(new Event("focus")); });
    await flush();
    expect(container.textContent).toContain("Meet at seven");
    expect(db.writes).toBe(0);
  });
  it("uses the existing retry state when the first database read fails", async () => {
    db.fault = "timeout";
    await mount();
    expect(container.querySelector(".threadRetryBtn")?.textContent).toBe("Try again");
    db.fault = "healthy";
    await act(async () => { container.querySelector<HTMLButtonElement>(".threadRetryBtn")!.click(); });
    await flush();
    expect(container.textContent).toContain("Meet at seven");
  });
  it.each(["timeout", "pair-timeout", "schema"])("maps %s to retryable 503", async (fault) => {
    db.fault = fault;
    const response = await read();
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ code: "UNAVAILABLE", retryable: true });
    expect(db.writes).toBe(0);
  });
  it.each(["absent", "outsider"])("keeps %s as 404", async (fault) => {
    db.fault = fault;
    expect((await read()).status).toBe(404);
  });
  it("keeps a healthy empty thread as 200", async () => {
    db.fault = "empty";
    const response = await read();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ messages: [] });
  });
  it("refuses reporting when the membership read fails", async () => {
    db.fault = "timeout";
    const response = await POST(new Request(`${BASE}/api/messages/${ID}`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "report", messageId: "m1" }),
    }), { params: Promise.resolve({ id: ID }) });
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ code: "UNAVAILABLE", retryable: true });
    expect(db.writes).toBe(0);
  });
  it("refuses a photo before processing when the membership read fails", async () => {
    db.fault = "timeout";
    const body = [
      "--photo-boundary", 'Content-Disposition: form-data; name="post"', "", '{"action":"send"}',
      "--photo-boundary", 'Content-Disposition: form-data; name="photo"; filename="photo.jpg"',
      "Content-Type: image/jpeg", "", "invalid image, must never be processed", "--photo-boundary--", "",
    ].join("\r\n");
    const response = await POST(new Request(`${BASE}/api/messages/${ID}`, {
      method: "POST", headers: { "Content-Type": "multipart/form-data; boundary=photo-boundary" }, body,
    }), {
      params: Promise.resolve({ id: ID }),
    });
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ code: "UNAVAILABLE", retryable: true });
    expect(db.writes).toBe(0);
  });
});
