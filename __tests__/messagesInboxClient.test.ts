import { afterEach, beforeEach, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ revision: 1, provider: new AbortController(), fetch: vi.fn() }));
vi.mock("@/lib/authProviderRevision", () => ({
  readProviderAccountRevision: () => state.revision,
  readProviderAccountSignal: () => state.provider.signal,
}));
vi.mock("@/lib/authedFetch", () => ({ authedActionFetch: state.fetch }));
import { invalidateMessagesInbox, readMessagesInbox } from "@/lib/messagesInboxClient";

beforeEach(() => {
  vi.useFakeTimers();
  state.fetch.mockReset();
  state.provider = new AbortController();
  state.revision++;
  invalidateMessagesInbox();
});
afterEach(() => { invalidateMessagesInbox(); vi.useRealTimers(); });

it("shares one inbox read while each viewer keeps its own cancellation", async () => {
  let finish!: (response: Response) => void;
  let requestSignal!: AbortSignal;
  state.fetch.mockImplementation((_url, init) => { requestSignal = init.signal; return new Promise<Response>((resolve) => { finish = resolve; }); });
  const navigation = new AbortController();
  const inbox = new AbortController();
  const navRead = readMessagesInbox("A", "reader", navigation.signal);
  const pageRead = readMessagesInbox("A", "reader", inbox.signal);
  navigation.abort();
  await expect(navRead).rejects.toMatchObject({ name: "AbortError" });
  expect(requestSignal.aborted).toBe(false);
  finish(Response.json({ conversations: [{ id: "thread", unread: 2 }] }));
  expect((await pageRead).conversations).toEqual([{ id: "thread", unread: 2 }]);
  expect(state.fetch).toHaveBeenCalledOnce();
});

it("invalidates on an arrival and shares the fresh unread result", async () => {
  state.fetch.mockResolvedValueOnce(Response.json({ conversations: [{ id: "thread", unread: 1 }] }));
  expect((await readMessagesInbox("A", "reader")).conversations[0]?.unread).toBe(1);
  invalidateMessagesInbox("reader");
  state.fetch.mockResolvedValueOnce(Response.json({ conversations: [{ id: "thread", unread: 2 }] }));
  const reads = await Promise.all([readMessagesInbox("A", "reader"), readMessagesInbox("A", "reader")]);
  expect(reads.map((read) => read.conversations[0]?.unread)).toEqual([2, 2]);
  expect(state.fetch).toHaveBeenCalledTimes(2);
  expect((await readMessagesInbox("A", "reader")).conversations[0]?.unread).toBe(2);
  expect(state.fetch).toHaveBeenCalledTimes(2);
  await vi.advanceTimersByTimeAsync(250);
  state.fetch.mockResolvedValueOnce(Response.json({ conversations: [] }));
  expect((await readMessagesInbox("A", "reader")).conversations).toEqual([]);
  expect(state.fetch).toHaveBeenCalledTimes(3);
});

it("never reuses another account's result, including a late response after switching", async () => {
  let finishA!: (response: Response) => void;
  state.fetch.mockImplementationOnce(() => new Promise<Response>((resolve) => { finishA = resolve; }));
  const departed = readMessagesInbox("A", "reader-a");
  const rejected = expect(departed).rejects.toMatchObject({ name: "AbortError" });
  state.provider.abort();
  state.provider = new AbortController();
  state.revision++;
  state.fetch.mockResolvedValueOnce(Response.json({ conversations: [{ id: "only-b" }] }));
  expect((await readMessagesInbox("B", "reader-b")).conversations).toEqual([{ id: "only-b" }]);
  finishA(Response.json({ conversations: [{ id: "private-a" }] }));
  await rejected;
  expect((await readMessagesInbox("B", "reader-b")).conversations).toEqual([{ id: "only-b" }]);
});

it("aborts the underlying read when its last waiting viewer leaves", async () => {
  let requestSignal!: AbortSignal;
  state.fetch.mockImplementation((_url, init) => { requestSignal = init.signal; return new Promise<Response>((_resolve, reject) => { requestSignal.addEventListener("abort", () => reject(requestSignal.reason), { once: true }); }); });
  const viewer = new AbortController();
  const read = readMessagesInbox("A", "reader", viewer.signal);
  viewer.abort();
  await expect(read).rejects.toMatchObject({ name: "AbortError" });
  expect(requestSignal.aborted).toBe(true);
});

it("does not cache a failed response when the reader retries", async () => {
  state.fetch.mockResolvedValueOnce(new Response(null, { status: 503 }));
  expect((await readMessagesInbox("A", "reader")).status).toBe(503);
  state.fetch.mockResolvedValueOnce(Response.json({ conversations: [{ id: "recovered" }] }));
  expect((await readMessagesInbox("A", "reader")).conversations).toEqual([{ id: "recovered" }]);
  expect(state.fetch).toHaveBeenCalledTimes(2);
});
