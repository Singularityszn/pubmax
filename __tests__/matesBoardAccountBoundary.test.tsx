// @vitest-environment jsdom

import { act, createElement, useLayoutEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const session = vi.hoisted(() => ({ revision: 1, request: vi.fn() }));
vi.mock("@/components/auth/AuthProvider", () => ({
  useAuth: () => ({ accountRevision: session.revision }),
}));
vi.mock("@/lib/authedFetch", () => ({ authedActionFetch: session.request }));
vi.mock("@/components/nav/SiteNav", () => ({ default: () => null }));

import MatesBoardClient from "@/app/social/leaderboard/MatesBoardClient";

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
