// @vitest-environment jsdom

import { act, createElement, useLayoutEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const session = vi.hoisted(() => ({
  revision: 1,
  user: { id: "account-1" } as { id: string } | null,
  providerAuthState: "authenticated",
  request: vi.fn(),
}));
vi.mock("@/components/auth/AuthProvider", () => ({
  useAuth: () => ({ accountRevision: session.revision }),
}));
vi.mock("@/components/auth/authContext", () => ({
  useAuth: () => session,
}));
vi.mock("@/lib/authedFetch", () => ({
  authedActionFetch: session.request,
  authedActionJson: async (...args: unknown[]) => {
    const response = (await session.request(...args)) as Response;
    return { response, body: await response.json().catch(() => null) };
  },
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: () => {} }) }));
vi.mock("@/components/nav/SiteNav", () => ({ default: () => null }));

import MatesBoardClient from "@/app/social/leaderboard/MatesBoardClient";
import LeaguesClient from "@/app/social/leagues/LeaguesClient";
import LeagueClient from "@/app/social/leagues/[id]/LeagueClient";

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function board(handle: string) {
  return { status: "ready", capped: false, rows: [{ handle, self: true, total: 120, level: 2 }] };
}

function deferredResponse() {
  let resolve!: (response: Response) => void;
  const promise = new Promise<Response>((done) => { resolve = done; });
  return { promise, resolve };
}

const outcomes = [
  ["ready", () => json(board("private-mate"))],
  ["signed out", () => json({}, 401)],
  ["forbidden", () => json({ error: "Private refusal" }, 403)],
  ["failed", () => json({}, 503)],
  ["malformed", () => json({})],
] as const;

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  session.revision = 1;
  session.user = { id: "account-1" };
  session.providerAuthState = "authenticated";
  session.request.mockReset();
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

const LEAGUE_ID = "3f2a1c4e-5b6d-4a7f-8e9d-0c1b2a3f4e5d";
const LeagueDetail = () => createElement(LeagueClient, { id: LEAGUE_ID });
const leagueBoard = { league: { id: LEAGUE_ID, name: "Thursday Regulars", code: "ABCDEFGH", owner: true }, status: "ready", rows: [{ handle: "league-mate", self: true, total: 120, level: 2, owner: true }], districts: null };
const privateBoards = [
  ["mates' board", MatesBoardClient, () => json(board("private-mate")), "@private-mate"],
  ["leagues", LeaguesClient, () => json({ leagues: [{ id: LEAGUE_ID, name: "Thursday Regulars", owner: true }] }), "Thursday Regulars"],
  ["league detail", LeagueDetail, () => json(leagueBoard), "@league-mate"],
] as const;
const sessionWaits = privateBoards.flatMap(([name, Client, ready, shown]) =>
  (["unresolved", "unavailable"] as const).map((phase) => [name, phase, Client, ready, shown] as const));
const door = () => host.querySelector('a[href^="/login"]');
const busy = () => host.querySelector("[aria-busy]")?.getAttribute("aria-busy");

it.each(sessionWaits)("%s waits for a live session answer after %s, asks nothing of a signed-out reader, and reads again on sign-in", async (_name, phase, Client, ready, shown) => {
  session.user = null;
  session.providerAuthState = phase;
  session.request.mockResolvedValue(json({}, 401));
  await act(async () => root.render(createElement(Client)));

  expect(door()).toBeNull();
  expect(busy()).toBe("true");
  expect(session.request).not.toHaveBeenCalled();

  session.providerAuthState = "signed-out";
  await act(async () => root.render(createElement(Client)));
  expect(door()).not.toBeNull();
  expect(busy()).toBe("false");
  expect(session.request).not.toHaveBeenCalled();

  session.request.mockResolvedValue(ready());
  session.user = { id: "account-2" };
  session.providerAuthState = "authenticated";
  session.revision = 2;
  await act(async () => root.render(createElement(Client)));
  expect(session.request).toHaveBeenCalledTimes(1);
  expect(door()).toBeNull();
  expect(host.textContent).toContain(shown);
});

it.each(privateBoards)("%s drops the board and asks nothing more when its reader signs out", async (_name, Client, ready, shown) => {
  session.request.mockResolvedValue(ready());
  await act(async () => root.render(createElement(Client)));
  expect(host.textContent).toContain(shown);

  session.user = null;
  session.providerAuthState = "signed-out";
  session.revision = 2;
  await act(async () => root.render(createElement(Client)));
  expect(session.request).toHaveBeenCalledTimes(1);
  expect(door()).not.toBeNull();
  expect(host.textContent).not.toContain(shown);
});

it("tells a signed-out reader a malformed league link is not a league, without a request", async () => {
  session.user = null;
  session.providerAuthState = "signed-out";
  await act(async () => root.render(createElement(LeagueClient, { id: "league-1" })));
  expect(session.request).not.toHaveBeenCalled();
  expect(door()).toBeNull();
  expect(busy()).toBe("false");
});

it.each(outcomes)("hides the previous reader's %s outcome in the first account-change commit", async (_name, response) => {
  const next = deferredResponse();
  session.request.mockResolvedValueOnce(response()).mockReturnValueOnce(next.promise);
  const commits: { revision: number; busy: string | null; text: string }[] = [];
  function Capture() {
    useLayoutEffect(() => {
      commits.push({
        revision: session.revision,
        busy: host.querySelector("section[aria-busy]")?.getAttribute("aria-busy") ?? null,
        text: host.textContent ?? "",
      });
    });
    return createElement(MatesBoardClient);
  }
  await act(async () => root.render(createElement(Capture)));
  expect(host.querySelector("section[aria-busy]")?.getAttribute("aria-busy")).toBe("false");

  session.revision = 2;
  await act(async () => root.render(createElement(Capture)));
  const changed = commits.filter((commit) => commit.revision === 2);
  expect(changed.length).toBeGreaterThan(0);
  for (const commit of changed) {
    expect(commit.busy).toBe("true");
    expect(commit.text).not.toContain("@private-mate");
    expect(commit.text).not.toContain("Private refusal");
  }

  await act(async () => next.resolve(json({}, 401)));
  expect(host.querySelector('a[href^="/login"]')).not.toBeNull();
  expect(host.querySelector("section[aria-busy]")?.getAttribute("aria-busy")).toBe("false");
});

it.each(outcomes)("ignores a previous reader's late %s response after an account switch", async (_name, response) => {
  const old = deferredResponse();
  session.request.mockReturnValueOnce(old.promise).mockResolvedValueOnce(json(board("current-mate")));
  await act(async () => root.render(createElement(MatesBoardClient)));
  session.revision = 2;
  await act(async () => root.render(createElement(MatesBoardClient)));
  expect(host.textContent).toContain("@current-mate");

  await act(async () => old.resolve(response()));
  expect(host.textContent).toContain("@current-mate");
  expect(host.textContent).not.toContain("@private-mate");
  expect(host.querySelector("section[aria-busy]")?.getAttribute("aria-busy")).toBe("false");
});
