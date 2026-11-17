// @vitest-environment jsdom

// "Rank it" on a pub page. Only a settled signed-out session may paint the
// sign-in door. A read that fails, answers late or answers nonsense stays a
// retry, and a read or a list from an account that has left never opens.

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const session = vi.hoisted(() => ({
  phase: "signed-in" as "unresolved" | "signed-in" | "signed-out",
  userId: "account-a" as string | null,
}));
vi.mock("@/components/auth/useViewerSession", () => ({
  useViewerSession: () => ({
    phase: session.phase,
    signedIn: session.phase === "signed-in",
    signedOut: session.phase === "signed-out",
    unresolved: session.phase === "unresolved",
  }),
}));
vi.mock("@/components/auth/AuthProvider", () => ({
  useAuth: () => ({ user: session.userId ? { id: session.userId } : null }),
}));

// One network double for both transports: the read answers the same whichever
// helper the component uses, so a red run shows the behaviour, not the wiring.
const net = vi.hoisted(() => ({ read: vi.fn<() => Promise<Response>>(), pending: undefined as Promise<void> | undefined }));
vi.mock("@/lib/authedFetch", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/authedFetch")>();
  return {
    AuthActionSessionError: actual.AuthActionSessionError,
    AuthActionJsonParseError: actual.AuthActionJsonParseError,
    authedFetch: () => net.read(),
    authedActionJson: async () => {
      const response = await net.read();
      try { return { response, body: await response.json() }; }
      catch { throw new actual.AuthActionJsonParseError(response.status); }
    },
  };
});

vi.mock("@/components/social/ComparePubFlow", () => ({
  default: ({ entries, startVenue, onSaved, onClose }: {
    entries: Array<{ venueId: string }>;
    startVenue?: { id: string; name: string };
    onSaved: (entries: Array<{ venueId: string; place: number }>) => void;
    onClose: (value?: unknown, reason?: "refused") => void;
  }) => (
    <div data-testid="compare">
      <output>{`${startVenue?.id}:${entries.map((entry) => entry.venueId).join(",")}`}</output>
      <button type="button" onClick={() => onSaved([{ venueId: "lamb", place: 1 }, { venueId: "seven-stars", place: 2 }])}>Save compare</button>
      <button type="button" onClick={(event) => onClose(event)}>Close compare</button>
      <button type="button" onClick={() => onClose(net.pending)}>Close pending save</button>
      <button type="button" onClick={() => onClose(undefined, "refused")}>Close refused flow</button>
    </div>
  ),
}));

import { AuthActionSessionError } from "@/lib/authedFetch";
import RankThisPub from "@/components/pubs/RankThisPub";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const ENTRY = { venueId: "lamb", venueName: "The Lamb", band: "loved", place: 1, score: 10, listedPrice: 5.5 };

let host: HTMLDivElement;
let root: Root | null = null;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

async function flush() {
  await act(async () => {});
}

async function render() {
  await act(async () => {
    root!.render(<RankThisPub venueId="seven-stars" venueName="The Seven Stars" returnTo="/pubs/seven-stars" />);
  });
  await flush();
}

function rankButton(): HTMLButtonElement | null {
  return [...host.querySelectorAll("button")].find((button) => /^Rank it$|^Try ranking again$|^Ranked #/.test(button.textContent ?? "")) ?? null;
}

async function clickRank() {
  const button = rankButton();
  if (!button) throw new Error("missing Rank it");
  await act(async () => {
    button.click();
  });
  await flush();
}

function signInDoor(): HTMLAnchorElement | null {
  return [...host.querySelectorAll("a")].find((link) => link.textContent === "Sign in to rank it") ?? null;
}

function compare(): string | null {
  return host.querySelector("[data-testid=compare] output")?.textContent ?? null;
}

function notice(): string | null {
  return host.querySelector("[role=status]")?.textContent || null;
}

beforeEach(() => {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  session.phase = "signed-in";
  session.userId = "account-a";
  net.read.mockReset();
  net.pending = undefined;
});

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  host.remove();
});

describe("RankThisPub", () => {
  it("offers the sign-in door only once the session has settled signed out", async () => {
    session.phase = "signed-out";
    session.userId = null;
    await render();
    expect(signInDoor()?.getAttribute("href")).toBe("/login?mode=signin&from=%2Fpubs%2Fseven-stars");
    expect(rankButton()).toBeNull();
  });

  it("keeps an unresolved session neutral and turns a session still waking into a retry", async () => {
    session.phase = "unresolved";
    session.userId = null;
    await render();
    expect(signInDoor()).toBeNull();

    net.read.mockRejectedValueOnce(new AuthActionSessionError());
    await clickRank();
    expect(signInDoor()).toBeNull();
    expect(compare()).toBeNull();
    expect(notice()).toBe("Still waking your session. Try again.");
    expect(rankButton()?.disabled).toBe(false);

    session.phase = "signed-in";
    session.userId = "account-a";
    net.read.mockResolvedValueOnce(json({ entries: [ENTRY] }));
    await render();
    await clickRank();
    expect(compare()).toBe("seven-stars:lamb");
    expect(notice()).toBeNull();
  });

  it("keeps a signed-in reader on a retry when the ranking read is temporarily unavailable", async () => {
    await render();
    net.read.mockResolvedValueOnce(json({ error: { message: "Your ranking is unavailable right now." }, code: "RANKING_UNAVAILABLE", retryable: true }, 503));
    await clickRank();
    expect(signInDoor()).toBeNull();
    expect(compare()).toBeNull();
    expect(notice()).toBe("Your ranking is unavailable right now.");

    net.read.mockResolvedValueOnce(json({ entries: [ENTRY] }));
    await clickRank();
    expect(compare()).toBe("seven-stars:lamb");
  });

  it("never asks a signed-in reader to sign in when the server did not see their session", async () => {
    await render();
    net.read.mockResolvedValueOnce(json({ error: { message: "Sign in to use Social." }, code: "SOCIAL_SIGN_IN_REQUIRED" }, 401));
    await clickRank();
    expect(signInDoor()).toBeNull();
    expect(notice()).toBe("We could not confirm access to your ranking.");
  });

  it("says why Social refused instead of opening the compare flow", async () => {
    await render();
    net.read.mockResolvedValueOnce(json({ error: { message: "Adult verification is needed for Social." }, code: "SOCIAL_ADULT_VERIFICATION_REQUIRED" }, 403));
    await clickRank();
    expect(compare()).toBeNull();
    expect(signInDoor()).toBeNull();
    expect(notice()).toBe("Adult verification is needed for Social.");
  });

  it.each([401, 403, 503])("retires the last confirmed position after an access refusal (%s)", async (status) => {
    await render();
    net.read.mockResolvedValueOnce(json({ entries: [ENTRY, { ...ENTRY, venueId: "seven-stars", place: 2 }] }));
    await clickRank();
    await act(async () => [...host.querySelectorAll("button")].find((button) => button.textContent === "Close compare")!.click());
    expect(rankButton()?.textContent).toBe("Ranked #2");
    net.read.mockResolvedValueOnce(json({ code: "SOCIAL_ACCESS_UNAVAILABLE", error: "Access is not available." }, status));
    await clickRank();
    expect(compare()).toBeNull();
    expect(rankButton()?.textContent).toBe("Rank it");
    net.read.mockReturnValueOnce(new Promise<Response>(() => {}));
    await clickRank();
    expect(rankButton()?.textContent).toBe("Rank it");
    expect(rankButton()?.getAttribute("aria-busy")).toBe("true");
  });

  it.each([401, 403])("retires a confirmed position after an unreadable HTTP %s refusal", async (status) => {
    await render();
    net.read.mockResolvedValueOnce(json({ entries: [ENTRY, { ...ENTRY, venueId: "seven-stars", place: 2 }] }));
    await clickRank();
    await act(async () => [...host.querySelectorAll("button")].find((button) => button.textContent === "Close compare")!.click());
    expect(rankButton()?.textContent).toBe("Ranked #2");
    net.read.mockResolvedValueOnce(new Response("", { status }));
    await clickRank();
    expect(compare()).toBeNull();
    expect(rankButton()?.textContent).toBe("Rank it");
  });

  it("retires the checkpoint when the comparison reports an access refusal", async () => {
    await render();
    net.read.mockResolvedValueOnce(json({ entries: [ENTRY, { ...ENTRY, venueId: "seven-stars", place: 2 }] }));
    await clickRank();
    await act(async () => [...host.querySelectorAll("button")].find((button) => button.textContent === "Close refused flow")!.click());
    expect(compare()).toBeNull();
    expect(rankButton()?.textContent).toBe("Rank it");
    expect(notice()).toBe("We could not confirm access to your ranking.");
  });

  it("keeps a confirmed save when its follow-up read is temporarily unavailable", async () => {
    await render();
    net.read.mockResolvedValueOnce(json({ entries: [ENTRY] }));
    await clickRank();
    await act(async () => [...host.querySelectorAll("button")].find((button) => button.textContent === "Save compare")!.click());
    net.pending = Promise.resolve();
    net.read.mockResolvedValueOnce(json({ code: "SOCIAL_ACCESS_UNAVAILABLE", retryable: true }, 503));
    await act(async () => [...host.querySelectorAll("button")].find((button) => button.textContent === "Close pending save")!.click());
    await flush();
    expect(compare()).toBeNull();
    expect(rankButton()?.textContent).toBe("Ranked #2");
    expect(notice()).toBe("Your ranking is unavailable right now.");
  });

  it("does not open a false empty ranking from a malformed answer", async () => {
    await render();
    net.read.mockResolvedValueOnce(json({}));
    await clickRank();
    expect(compare()).toBeNull();
    expect(notice()).toBe("Your ranking is unavailable right now.");

    net.read.mockResolvedValueOnce(json({ entries: [{ venueId: 7 }] }));
    await clickRank();
    expect(compare()).toBeNull();

    net.read.mockResolvedValueOnce(json({ entries: [] }));
    await clickRank();
    expect(compare()).toBe("seven-stars:");
  });

  it("drops a read that lands after the account changed", async () => {
    await render();
    let answer!: (response: Response) => void;
    net.read.mockReturnValueOnce(new Promise<Response>((resolve) => { answer = resolve; }));
    await clickRank();
    await clickRank();
    expect(net.read).toHaveBeenCalledTimes(1);

    session.userId = "account-b";
    await render();
    await act(async () => {
      answer(json({ entries: [ENTRY] }));
    });
    await flush();
    expect(compare()).toBeNull();
    expect(rankButton()?.disabled).toBe(false);
  });

  it("closes the previous account's list and its placing when the account changes", async () => {
    await render();
    net.read.mockResolvedValueOnce(json({ entries: [ENTRY] }));
    await clickRank();
    expect(compare()).toBe("seven-stars:lamb");
    const save = [...host.querySelectorAll("button")].find((button) => button.textContent === "Save compare");
    await act(async () => {
      save?.click();
    });
    expect(rankButton()?.textContent).toBe("Ranked #2");

    session.userId = "account-b";
    await render();
    expect(compare()).toBeNull();
    expect(rankButton()?.textContent).toBe("Rank it");
  });

  it("accepts a click event from the older comparison without treating it as a write", async () => {
    await render();
    net.read.mockResolvedValueOnce(json({ entries: [ENTRY] }));
    await clickRank();
    const close = [...host.querySelectorAll("button")].find((button) => button.textContent === "Close compare")!;
    await act(async () => close.click());
    expect(compare()).toBeNull();
    expect(net.read).toHaveBeenCalledTimes(1);
  });

  it("closes an acknowledged comparison without another read and keeps the saved position", async () => {
    net.read.mockResolvedValueOnce(json({ entries: [ENTRY] }));
    await render();
    await clickRank();
    await act(async () => [...host.querySelectorAll("button")].find((button) => button.textContent === "Save compare")!.click());
    await act(async () => [...host.querySelectorAll("button")].find((button) => button.textContent === "Close compare")!.click());
    expect(compare()).toBeNull();
    expect(rankButton()?.textContent).toBe("Ranked #2");
    expect(net.read).toHaveBeenCalledOnce();
  });

  it("reconciles a closed write after its promise rejects", async () => {
    net.read.mockResolvedValueOnce(json({ entries: [ENTRY] }));
    await render();
    await clickRank();
    let rejectWrite!: (error: Error) => void;
    net.pending = new Promise<void>((_resolve, reject) => { rejectWrite = reject; });
    await act(async () => [...host.querySelectorAll("button")].find((button) => button.textContent === "Close pending save")!.click());
    expect(net.read).toHaveBeenCalledOnce();
    net.read.mockResolvedValueOnce(json({ entries: [ENTRY, { ...ENTRY, venueId: "seven-stars", place: 2 }] }));
    await act(async () => rejectWrite(new Error("The answer was lost")));
    expect(compare()).toBeNull();
    expect(rankButton()?.textContent).toBe("Ranked #2");
    expect(net.read).toHaveBeenCalledTimes(2);
  });

  it("reads the saved position after the newer comparison's outstanding write settles", async () => {
    await render();
    net.read.mockResolvedValueOnce(json({ entries: [ENTRY] }));
    await clickRank();
    let finish!: () => void;
    net.pending = new Promise<void>((resolve) => { finish = resolve; });
    const close = [...host.querySelectorAll("button")].find((button) => button.textContent === "Close pending save")!;
    await act(async () => close.click());
    expect(notice()).toBe("Checking your ranking…");
    await clickRank();
    expect(net.read).toHaveBeenCalledTimes(1);
    net.read.mockResolvedValueOnce(json({ entries: [ENTRY, { ...ENTRY, venueId: "seven-stars", place: 2 }] }));
    await act(async () => finish());
    await flush();
    expect(compare()).toBeNull();
    expect(rankButton()?.textContent).toBe("Ranked #2");
  });

  it("does not start a closed session's refresh after its account departs", async () => {
    await render();
    net.read.mockResolvedValueOnce(json({ entries: [ENTRY] }));
    await clickRank();
    let finish!: () => void;
    net.pending = new Promise<void>((resolve) => { finish = resolve; });
    const close = [...host.querySelectorAll("button")].find((button) => button.textContent === "Close pending save")!;
    await act(async () => close.click());
    session.userId = "account-b";
    await render();
    await act(async () => finish());
    await flush();
    expect(net.read).toHaveBeenCalledTimes(1);
    expect(rankButton()?.textContent).toBe("Rank it");
  });
  it("updates the saved position from a retry read without another save", async () => {
    await render();
    net.read.mockResolvedValueOnce(json({ error: { message: "Your ranking is unavailable right now." } }, 503));
    await clickRank();
    expect(compare()).toBeNull();
    net.read.mockResolvedValueOnce(json({ entries: [ENTRY, { ...ENTRY, venueId: "seven-stars", place: 2 }] }));
    await clickRank();
    const close = [...host.querySelectorAll("button")].find((button) => button.textContent === "Close compare")!;
    await act(async () => close.click());
    expect(rankButton()?.textContent).toBe("Ranked #2");
  });

});
