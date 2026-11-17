import { afterEach, beforeEach, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ revision: 1, provider: new AbortController(), fetch: vi.fn() }));
vi.mock("@/lib/authProviderRevision", () => ({
  readProviderAccountRevision: () => state.revision,
  readProviderAccountSignal: () => state.provider.signal,
}));
vi.mock("@/lib/authedFetch", () => ({ authedActionFetch: state.fetch }));
import { invalidateMessagesInbox, readMessagesInbox, markMessagesInboxVisible, invalidateMessagesInboxOnFocus } from "@/lib/messagesInboxClient";

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

it("reuses the visibility result when focus arrives after it has finished", async () => {
  state.fetch.mockResolvedValueOnce(Response.json({ conversations: [{ id: "fresh", unread: 2 }] }));
  const visibleAt = performance.now();
  const visible = readMessagesInbox("A", "reader");
  markMessagesInboxVisible("reader", visibleAt);
  await visible;
  invalidateMessagesInboxOnFocus("reader");
  expect((await readMessagesInbox("A", "reader")).conversations).toEqual([{ id: "fresh", unread: 2 }]);
  expect(state.fetch).toHaveBeenCalledOnce();
});

it("does not mark a read begun before visibility as the visibility result", async () => {
  state.fetch.mockResolvedValueOnce(Response.json({ conversations: [{ id: "before" }] }));
  await readMessagesInbox("A", "reader");
  await vi.advanceTimersByTimeAsync(1);
  markMessagesInboxVisible("reader", performance.now());
  invalidateMessagesInboxOnFocus("reader");
  state.fetch.mockResolvedValueOnce(Response.json({ conversations: [{ id: "after" }] }));
  expect((await readMessagesInbox("A", "reader")).conversations).toEqual([{ id: "after" }]);
  expect(state.fetch).toHaveBeenCalledTimes(2);
});

it.each(["response", "body"])("expires a shared stalled %s and rejects late data after recovery", async (stage) => {
  let finish!: () => void;
  let requestSignal!: AbortSignal;
  const response = Response.json({ conversations: [{ id: "late" }] });
  const json = vi.spyOn(response, "json");
  state.fetch.mockImplementationOnce((_url, init) => {
    requestSignal = init.signal;
    if (stage === "response") return new Promise<Response>((resolve) => {
      finish = () => resolve(Response.json({ conversations: [{ id: "late" }] }));
    });
    json.mockImplementationOnce(() => new Promise((resolve) => {
      finish = () => resolve({ conversations: [{ id: "late" }] });
    }));
    return Promise.resolve(response);
  });
  const departed = new AbortController();
  const first = readMessagesInbox("A", "reader");
  const second = readMessagesInbox("A", "reader");
  const cancelled = readMessagesInbox("A", "reader", departed.signal);
  const outcome = Promise.allSettled([first, second]);
  departed.abort();
  await expect(cancelled).rejects.toMatchObject({ name: "AbortError" });
  expect(requestSignal.aborted).toBe(false);
  await vi.advanceTimersByTimeAsync(2_999);
  if (stage === "body") expect(json).toHaveBeenCalledOnce();
  let completed = false;
  void outcome.then(() => { completed = true; });
  expect(completed).toBe(false);
  invalidateMessagesInbox("reader", false);
  const joined = readMessagesInbox("A", "reader");
  const joinedOutcome = Promise.allSettled([joined]);
  expect(state.fetch).toHaveBeenCalledOnce();
  await vi.advanceTimersByTimeAsync(1);
  expect(await outcome).toEqual([
    { status: "rejected", reason: expect.objectContaining({ name: "TimeoutError" }) },
    { status: "rejected", reason: expect.objectContaining({ name: "TimeoutError" }) },
  ]);
  expect(await joinedOutcome).toEqual([{ status: "rejected", reason: expect.objectContaining({ name: "TimeoutError" }) }]);
  expect(requestSignal.aborted).toBe(true);
  state.fetch.mockResolvedValueOnce(Response.json({ conversations: [{ id: "recovered" }] }));
  expect((await readMessagesInbox("A", "reader")).conversations).toEqual([{ id: "recovered" }]);
  finish();
  await Promise.resolve();
  expect((await readMessagesInbox("A", "reader")).conversations).toEqual([{ id: "recovered" }]);
  expect(state.fetch).toHaveBeenCalledTimes(2);
});
