// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { AuthContextValue } from "@/components/auth/authContext";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
  usePathname: () => "/pal/chat",
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("next/link", () => ({
  default: ({ children, prefetch: _prefetch, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement> & { prefetch?: boolean }) => createElement("a", props, children),
  useLinkStatus: () => ({ pending: false }),
}));
vi.mock("@/lib/authClient", () => ({ getAccessToken: vi.fn() }));
vi.mock("@/lib/analytics", () => ({ trackEvent: vi.fn() }));
vi.mock("@/components/map/useWhatsOnTonight", () => ({ useWhatsOnTonight: () => ({ rows: [], status: "idle" }) }));
vi.mock("@/lib/venuesSlim", () => ({
  loadSlimVenuesForCity: async () => [],
  loadSlimVenuesForCityResult: async () => ({ status: "ready", rows: [] }),
}));

import { AuthContext, useAuth } from "@/components/auth/authContext";
import { getAccessToken } from "@/lib/authClient";
import { publishAuthActionState } from "@/lib/authedFetch";
import { setProviderAuthState, setProviderIdentity } from "@/lib/authProviderRevision";
import { clearSurfaceCache } from "@/lib/surfaceDataCache";

let root: Root;
let container: HTMLDivElement;
let defaults: AuthContextValue;
let PalChat: typeof import("@/components/pal/PalChat").default;
let releasePolicy: () => void;
let policyStarted: Promise<void>;
let policyLoaded: Promise<void>;
let posts: { token: string | null; body: Record<string, unknown> }[];
let postResponse: (() => Promise<Response>) | undefined;

function json(body: unknown) { return new Response(JSON.stringify(body), { headers: { "content-type": "application/json" } }); }

async function renderAccount(id: string, token = `${id}-token`) {
  const user = { id } as AuthContextValue["user"];
  const session = { user, access_token: token } as AuthContextValue["session"];
  await act(async () => {
    setProviderIdentity("supabase", id);
    setProviderAuthState("supabase", "authenticated");
    publishAuthActionState({ status: "signed-in", identityResolved: true });
    vi.mocked(getAccessToken).mockResolvedValue(token);
    root.render(createElement(AuthContext.Provider, { value: { ...defaults, user, session, providerAuthState: "authenticated", identityResolved: true } }, createElement(PalChat)));
  });
}

async function typeQuery(text: string) {
  const input = container.querySelector<HTMLInputElement>(".palChatInput")!;
  expect(input.disabled).toBe(false);
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, text);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

async function submit(text: string) {
  await typeQuery(text);
  await act(async () => { container.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); });
}

async function expectAnswer() {
  await vi.waitFor(async () => {
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
    expect(container.textContent).toContain("Your sourced answer.");
    expect(container.querySelector(".palChatBubble--pending")).toBeNull();
  });
}

beforeEach(async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("matchMedia", (media: string) => ({
    media, matches: false, onchange: null,
    addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {}, dispatchEvent: () => true,
  }));
  clearSurfaceCache();
  sessionStorage.clear();
  posts = [];
  postResponse = undefined;
  let started!: () => void;
  let loaded!: () => void;
  policyStarted = new Promise<void>((resolve) => { started = resolve; });
  policyLoaded = new Promise<void>((resolve) => { loaded = resolve; });
  const policy = new Promise<void>((resolve) => { releasePolicy = resolve; });
  const openings = new Map<string | null, number>();
  vi.doMock("@/lib/ask/router", async (importOriginal) => {
    started();
    await policy;
    const original = await importOriginal();
    loaded();
    return original;
  });
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url === "/api/pub-pal/chat" && init?.method === "POST") {
      posts.push({ token: new Headers(init.headers).get("authorization"), body: JSON.parse(String(init.body)) });
      if (postResponse) return postResponse();
      return json({ answer: "Your sourced answer.", cards: [], conversationId: "conv_newanswer1" });
    }
    if (url === "/api/pub-pal/chat") {
      const token = new Headers(init?.headers).get("authorization");
      const opening = (openings.get(token) ?? 0) + 1;
      openings.set(token, opening);
      return json({ answer: `Private opening for ${token}`, cards: [], conversationId: `conv_${token?.includes("account-a") ? "accounta" : "accountb"}${opening}` });
    }
    if (url === "/api/pub-pal") return json({ pal: null });
    throw new Error(`Unexpected external request: ${url}`);
  }));
  PalChat = (await import("@/components/pal/PalChat")).default;
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  function ReadDefaults() { defaults = useAuth(); return null; }
  await act(async () => { root.render(createElement(ReadDefaults)); });
  await renderAccount("account-a");
});

afterEach(async () => {
  releasePolicy();
  await act(async () => { root.unmount(); });
  container.remove();
  clearSurfaceCache();
  vi.doUnmock("@/lib/ask/router");
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it("never sends the old owner's question, history or thread under the new account after a cold policy load", async () => {
  expect(container.textContent).toContain("Private opening for Bearer account-a-token");
  await submit("My private account A question");
  await policyStarted;
  expect(posts).toEqual([]);
  await renderAccount("account-b");
  await act(async () => { releasePolicy(); await policyLoaded; });
  expect(posts).toEqual([]);
  expect(container.textContent).not.toContain("My private account A question");
  await submit("My own account B question");
  await expectAnswer();
  expect(posts).toEqual([{ token: "Bearer account-b-token", body: {
    query: "My own account B question", cityId: "london", threadId: "conv_accountb1",
    turns: [{ role: "assistant", content: "Private opening for Bearer account-b-token" }],
  } }]);
  expect(container.textContent).toContain("Your sourced answer.");
  await act(async () => { container.querySelector<HTMLButtonElement>(".palChatReset")!.click(); });
  await submit("A new conversation for account B");
  await expectAnswer();
  expect(posts[1]).toEqual({ token: "Bearer account-b-token", body: {
    query: "A new conversation for account B", cityId: "london", threadId: "conv_accountb2",
    turns: [{ role: "assistant", content: "Private opening for Bearer account-b-token" }],
  } });
});

it("cancels a cold question when the chat unmounts and allows a fresh same-account conversation", async () => {
  await submit("An abandoned private question");
  await policyStarted;
  await act(async () => { root.render(null); });
  await act(async () => { releasePolicy(); await policyLoaded; });
  expect(posts).toEqual([]);
  await renderAccount("account-a");
  await submit("My new question");
  await expectAnswer();
  expect(posts[0]?.body.query).toBe("My new question");
  expect(container.textContent).toContain("Your sourced answer.");
});

it("keeps a same-account token refresh valid while policy is loading", async () => {
  await submit("My same-account question");
  await policyStarted;
  await renderAccount("account-a", "refreshed-a-token");
  await act(async () => { releasePolicy(); await policyLoaded; });
  await expectAnswer();
  expect(posts).toHaveLength(1);
  expect(posts[0]?.token).toBe("Bearer refreshed-a-token");
  expect(posts[0]?.body).toMatchObject({ query: "My same-account question", threadId: "conv_accounta1" });
  expect(container.textContent).toContain("Your sourced answer.");
});

it.each([
  { change: "sign-in", before: null, after: "clerk-account" },
  { change: "sign-out", before: "clerk-account", after: null },
])("restores Send and New conversation after Clerk $change cancels an ask without changing the chat owner", async ({ before, after }) => {
  await act(async () => { setProviderIdentity("clerk", before); });
  const input = container.querySelector<HTMLInputElement>(".palChatInput")!;
  await submit("A question cancelled by Clerk");
  await policyStarted;
  await typeQuery("My same-owner recovery question");
  expect(container.querySelector<HTMLButtonElement>(".palChatSend")!.disabled).toBe(true);
  expect(container.querySelector<HTMLButtonElement>(".palChatReset")!.disabled).toBe(true);

  await act(async () => { setProviderIdentity("clerk", after); });
  await vi.waitFor(async () => {
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
    expect(container.querySelector(".palChatBubble--pending")).toBeNull();
    expect(container.querySelector<HTMLButtonElement>(".palChatSend")!.disabled).toBe(false);
    expect(container.querySelector<HTMLButtonElement>(".palChatReset")!.disabled).toBe(false);
  });
  expect(container.querySelector(".palChatInput")).toBe(input);
  expect(input.value).toBe("My same-owner recovery question");
  await act(async () => { releasePolicy(); await policyLoaded; });
  expect(posts).toEqual([]);

  await submit("My same-owner recovery question");
  await expectAnswer();
  expect(posts).toEqual([{ token: "Bearer account-a-token", body: {
    query: "My same-owner recovery question", cityId: "london", threadId: "conv_accounta1",
    turns: [{ role: "assistant", content: "Private opening for Bearer account-a-token" }],
  } }]);
});

it("clears a cancelled partial reply and rejects its late text while the same chat owner recovers", async () => {
  await act(async () => { setProviderIdentity("clerk", null); });
  let stream!: ReadableStreamDefaultController<Uint8Array>;
  const encoder = new TextEncoder();
  postResponse = async () => new Response(new ReadableStream<Uint8Array>({
    start(controller) {
      stream = controller;
      controller.enqueue(encoder.encode(`${JSON.stringify({ type: "delta", text: "Cancelled partial reply" })}\n`));
    },
  }), { headers: { "content-type": "application/x-ndjson" } });
  await submit("An ask interrupted by Clerk");
  await policyStarted;
  await act(async () => { releasePolicy(); await policyLoaded; });
  expect(container.textContent).toContain("Cancelled partial reply");

  await act(async () => { setProviderIdentity("clerk", "clerk-account"); });
  await vi.waitFor(async () => {
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
    expect(container.querySelector(".palChatBubble--pending")).toBeNull();
    expect(container.textContent).not.toContain("Cancelled partial reply");
  });
  postResponse = undefined;
  await submit("A fresh same-owner ask");
  await expectAnswer();
  await act(async () => {
    stream.enqueue(encoder.encode(`${JSON.stringify({ type: "delta", text: "Late cancelled detail" })}\n`));
    stream.enqueue(encoder.encode(`${JSON.stringify({ type: "final", body: { answer: "Late cancelled answer", cards: [], conversationId: "conv_cancelled1" } })}\n`));
    stream.close();
  });
  expect(container.textContent).not.toContain("Late cancelled");
  expect(posts[1]).toEqual({ token: "Bearer account-a-token", body: {
    query: "A fresh same-owner ask", cityId: "london", threadId: "conv_accounta1",
    turns: [{ role: "assistant", content: "Private opening for Bearer account-a-token" }],
  } });
});

it("rejects an account change before the provider has rendered the replacement chat", async () => {
  await submit("A private question before account settlement");
  await policyStarted;
  await act(async () => {
    setProviderIdentity("supabase", "account-b");
    vi.mocked(getAccessToken).mockResolvedValue("account-b-token");
    releasePolicy();
    await policyLoaded;
  });
  expect(posts).toEqual([]);
  await renderAccount("account-b");
  await submit("Account B after settlement");
  await expectAnswer();
  expect(posts).toHaveLength(1);
  expect(posts[0]?.body.query).toBe("Account B after settlement");
  expect(container.textContent).toContain("Your sourced answer.");
});

it("does not publish late streamed text after the account changes", async () => {
  let stream!: ReadableStreamDefaultController<Uint8Array>;
  const encoder = new TextEncoder();
  postResponse = async () => new Response(new ReadableStream<Uint8Array>({
    start(controller) {
      stream = controller;
      controller.enqueue(encoder.encode(`${JSON.stringify({ type: "delta", text: "Private account A partial answer" })}\n`));
    },
  }), { headers: { "content-type": "application/x-ndjson" } });
  await submit("Account A streaming request");
  await policyStarted;
  await act(async () => { releasePolicy(); await policyLoaded; });
  expect(container.textContent).toContain("Private account A partial answer");
  await renderAccount("account-b");
  await act(async () => {
    stream.enqueue(encoder.encode(`${JSON.stringify({ type: "delta", text: " and a late private detail" })}\n`));
    stream.enqueue(encoder.encode(`${JSON.stringify({ type: "final", body: { answer: "Private account A final answer", cards: [], conversationId: "conv_accounta2" } })}\n`));
    stream.close();
  });
  expect(container.textContent).not.toContain("Private account A");
  expect(container.textContent).not.toContain("late private detail");
  postResponse = undefined;
  await submit("Account B streaming recovery");
  await expectAnswer();
  expect(posts[1]?.token).toBe("Bearer account-b-token");
  expect(posts[1]?.body).toMatchObject({ query: "Account B streaming recovery", threadId: "conv_accountb1" });
  expect(container.textContent).toContain("Your sourced answer.");
});

it("ignores an old account's late response and retains only the new account's history", async () => {
  let finish!: (response: Response) => void;
  postResponse = () => new Promise<Response>((resolve) => { finish = resolve; });
  await submit("Private account A request");
  await policyStarted;
  await act(async () => { releasePolicy(); await policyLoaded; });
  expect(posts).toHaveLength(1);
  await renderAccount("account-b");
  postResponse = undefined;
  await submit("Account B request");
  await expectAnswer();
  await act(async () => { finish(json({ answer: "Late private account A answer", cards: [], conversationId: "conv_accounta2" })); });
  expect(container.textContent).not.toContain("Late private account A answer");
  await submit("Account B follow-up");
  await expectAnswer();
  expect(posts[2]).toEqual({ token: "Bearer account-b-token", body: {
    query: "Account B follow-up", cityId: "london", threadId: "conv_newanswer1",
    turns: [
      { role: "assistant", content: "Private opening for Bearer account-b-token" },
      { role: "user", content: "Account B request" },
      { role: "assistant", content: "Your sourced answer." },
    ],
  } });
});
