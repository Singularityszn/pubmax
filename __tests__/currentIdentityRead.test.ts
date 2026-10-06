import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  CURRENT_IDENTITY_READ_MS,
  forgetCurrentIdentityRead,
  keepCurrentIdentityReadDuring,
  readCurrentIdentity,
} from "@/lib/currentIdentityRead";
import {
  markResumePersisted,
  RESUME_REEXTEND_MS,
  resumeAlreadyPersisted,
} from "@/lib/authSessionResumeClient";

// One page load asked /api/identity/handle/current four to twelve times, and
// production's limiter counted each one. These are the rules of the one shared
// read: it is per account, short, dropped when identity may have changed, and
// never keeps a read that did not answer.

const answer = (body: unknown = { handle: "karan" }, status = 200) => () =>
  Promise.resolve(new Response(JSON.stringify(body), { status }));

beforeEach(() => {
  vi.stubGlobal("window", new EventTarget());
  forgetCurrentIdentityRead();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("readCurrentIdentity", () => {
  it("shares one read between surfaces that ask at once and a beat apart", async () => {
    const load = vi.fn(answer());
    const [a, b] = await Promise.all([
      readCurrentIdentity("user-1", load),
      readCurrentIdentity("user-1", load),
    ]);
    const c = await readCurrentIdentity("user-1", load);
    expect(load).toHaveBeenCalledTimes(1);
    expect([a.body, b.body, c.body]).toEqual([{ handle: "karan" }, { handle: "karan" }, { handle: "karan" }]);
  });

  it("asks again once the shared answer is older than its window", async () => {
    const load = vi.fn(answer());
    await readCurrentIdentity("user-1", load);
    await readCurrentIdentity("user-1", load, Date.now() + CURRENT_IDENTITY_READ_MS + 1);
    expect(load).toHaveBeenCalledTimes(2);
  });

  it("never lets a second account read the first one's answer", async () => {
    const load = vi.fn(answer());
    await readCurrentIdentity("user-1", load);
    await readCurrentIdentity("user-2", load);
    expect(load).toHaveBeenCalledTimes(2);
  });

  it("drops the answer when a handle is claimed or renamed", async () => {
    const load = vi.fn(answer());
    await readCurrentIdentity("user-1", load);
    window.dispatchEvent(new Event("pubmaxx:identity-handle-changed"));
    await readCurrentIdentity("user-1", load);
    expect(load).toHaveBeenCalledTimes(2);
  });

  it("keeps the answer across the write that stores what it said, but not across any other identity change", async () => {
    const load = vi.fn(answer());
    await readCurrentIdentity("user-1", load);
    keepCurrentIdentityReadDuring(() => window.dispatchEvent(new Event("pubmax:device-identity-changed")));
    await readCurrentIdentity("user-1", load);
    expect(load).toHaveBeenCalledTimes(1);
    window.dispatchEvent(new Event("pubmax:device-identity-changed"));
    await readCurrentIdentity("user-1", load);
    expect(load).toHaveBeenCalledTimes(2);
  });

  it("drops the answer when asked to forget it", async () => {
    const load = vi.fn(answer());
    await readCurrentIdentity("user-1", load);
    forgetCurrentIdentityRead();
    await readCurrentIdentity("user-1", load);
    expect(load).toHaveBeenCalledTimes(2);
  });

  it("does not keep a read that did not answer", async () => {
    const load = vi.fn(answer({ error: "busy" }, 429));
    const first = await readCurrentIdentity("user-1", load);
    expect(first.ok).toBe(false);
    await readCurrentIdentity("user-1", load);
    expect(load).toHaveBeenCalledTimes(2);
  });

  it("hands a refusal's own words to the surface that shows them", async () => {
    const refusal = { error: "Sign in to view your PUBMAXX handle.", code: "UNAUTHENTICATED" };
    const read = await readCurrentIdentity("user-1", answer(refusal, 401));
    expect(read).toEqual({ ok: false, status: 401, body: refusal });
  });

  it("does not keep a read that threw", async () => {
    const load = vi.fn<() => Promise<Response>>().mockRejectedValueOnce(new Error("offline")).mockImplementation(answer());
    await expect(readCurrentIdentity("user-1", load)).rejects.toThrow("offline");
    await expect(readCurrentIdentity("user-1", load)).resolves.toMatchObject({ ok: true });
    expect(load).toHaveBeenCalledTimes(2);
  });
});

describe("the resume cookie write", () => {
  const session = { user: { id: "user-1" }, refresh_token: "tok-abc-123" };
  const store = () => {
    const values = new Map<string, string>();
    return {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => void values.set(key, value),
    };
  };

  it("is skipped for the token the cookie already holds, and only for a while", () => {
    const storage = store();
    const now = 1_000_000;
    expect(resumeAlreadyPersisted(storage, session, now)).toBe(false);
    markResumePersisted(storage, session, now);
    expect(resumeAlreadyPersisted(storage, session, now + 1_000)).toBe(true);
    expect(resumeAlreadyPersisted(storage, session, now + RESUME_REEXTEND_MS)).toBe(false);
  });

  it("is never skipped for a rotated token or another account", () => {
    const storage = store();
    markResumePersisted(storage, session, 1_000);
    expect(resumeAlreadyPersisted(storage, { ...session, refresh_token: "tok-rotated" }, 2_000)).toBe(false);
    expect(resumeAlreadyPersisted(storage, { ...session, user: { id: "user-2" } }, 2_000)).toBe(false);
  });

  it("never stores the refresh token itself", () => {
    const storage = store();
    markResumePersisted(storage, session, 1_000);
    expect(JSON.stringify(storage.getItem("pubmax:resume-persisted:v1"))).not.toContain(session.refresh_token);
  });
});
