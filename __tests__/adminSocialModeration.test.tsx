// @vitest-environment jsdom

import { createElement } from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/link", () => ({
  default: ({ href, children, ...props }: { href: string; children: React.ReactNode }) =>
    createElement("a", { href, ...props }, children),
}));
vi.mock("next/image", () => ({
  default: (props: Record<string, unknown>) => createElement("img", props),
}));
vi.mock("@/components/nav/SiteNav", () => ({
  default: () => createElement("nav", null, "Site navigation"),
}));
vi.mock("@/app/admin/VenuePhotoModeration", () => ({
  default: () => null,
}));

import AdminClient from "@/app/admin/AdminClient";

const state = vi.hoisted(() => ({
  pintDropsFail: false,
  socialPosts: [] as Array<{
    staffDisplayName: string;
    postId: string;
    mediaId: string | null;
    media?: { kind: "video"; contentType: "video/mp4" };
    revision: number;
    authorHandle: string;
    body: string;
    photoAltText: string | null;
    area: string | null;
    venueId: string | null;
    visibility: "public" | "friends" | "private";
    commentPolicy: "open" | "friends" | "locked";
    moderationClaim: string;
    moderationState: "needs_review" | "approved";
    createdAt: string;
    updatedAt: string;
  }>,
  socialUnavailable: false,
  socialUnreadable: false,
  socialMalformedBody: null as string | null,
  socialThrows: false,
  socialRefusals: 0,
  socialRefusalStatus: 503,
  socialRefusalProbeUnknown: false,
  sessionAuthenticated: true,
  sessionProbeUnknown: false,
  sessionPostResponses: [] as Array<{
    gate: Promise<void> | null;
    accepted: boolean;
  }>,
  sessionPostBodies: [] as unknown[],
  socialResponsePosts: null as unknown[] | null,
  socialGetResponses: [] as Array<{
    gate: Promise<void> | null;
    posts: unknown[];
  }>,
  fetchEvents: [] as string[],
  socialActionStatus: 200,
  socialActionGate: null as Promise<void> | null,
  socialActionBodies: [] as unknown[],
}));

let host: HTMLDivElement;
let root: Root;

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function rawResponse(body: string, status = 200): Response {
  return new Response(body, {
    status,
    headers: { "content-type": "application/json" },
  });
}

function responseFor(input: string, init?: RequestInit): Response | Promise<Response> {
  const url = new URL(input, "http://localhost");
  const method = init?.method ?? "GET";
  if (url.pathname === "/api/admin/session") {
    state.fetchEvents.push(`session:${method}`);
    if (method === "POST") {
      state.sessionPostBodies.push(JSON.parse(String(init?.body)));
      const queuedResponse = state.sessionPostResponses.shift();
      const response = () => {
        if (queuedResponse?.accepted === false) {
          return jsonResponse({ error: "refused" }, 403);
        }
        state.sessionAuthenticated = true;
        return jsonResponse({ ok: true });
      };
      return queuedResponse?.gate ? queuedResponse.gate.then(response) : response();
    }
    if (state.sessionProbeUnknown) return rawResponse("{");
    return jsonResponse({ authenticated: state.sessionAuthenticated });
  }
  if (url.pathname === "/api/admin/social-posts") {
    state.fetchEvents.push(`social:${method}`);
    if (method === "POST") {
      state.socialActionBodies.push(JSON.parse(String(init?.body)));
      const response = () => state.socialActionStatus === 200
        ? jsonResponse({ ok: true })
        : jsonResponse({ error: "unavailable" }, state.socialActionStatus);
      if (state.socialActionStatus === 403) state.sessionAuthenticated = false;
      return state.socialActionGate ? state.socialActionGate.then(response) : response();
    }
    if (state.socialThrows) throw new TypeError("Failed to fetch");
    if (state.socialMalformedBody !== null) return rawResponse(state.socialMalformedBody);
    if (state.socialUnreadable) return jsonResponse({ posts: "not-a-list" });
    const queuedResponse = state.socialGetResponses.shift();
    if (queuedResponse) {
      const response = () => jsonResponse({ posts: queuedResponse.posts });
      return queuedResponse.gate ? queuedResponse.gate.then(response) : response();
    }
    if (state.socialResponsePosts !== null) return jsonResponse({ posts: state.socialResponsePosts });
    if (state.socialRefusals > 0) {
      state.socialRefusals -= 1;
      const status = state.socialRefusalStatus;
      if (status === 403) {
        state.sessionAuthenticated = false;
        state.sessionProbeUnknown = state.socialRefusalProbeUnknown;
      }
      return jsonResponse({ error: "unavailable" }, status);
    }
    return state.socialUnavailable
      ? jsonResponse({ error: "unavailable" }, 503)
      : jsonResponse({ posts: state.socialPosts });
  }
  if (url.pathname === "/api/admin/import-notes") {
    state.fetchEvents.push(`import:${method}`);
    return jsonResponse({ notes: [] });
  }
  if (url.pathname.startsWith("/api/pint-drops")) {
    return state.pintDropsFail ? jsonResponse({ error: "unavailable" }, 503) : jsonResponse({ drops: [] });
  }
  if (url.pathname === "/api/admin/community-prices") return jsonResponse({ prices: [] });
  if (url.pathname.startsWith("/api/admin/comments")) return jsonResponse({ comments: [] });
  if (url.pathname.startsWith("/api/visit-reports")) return jsonResponse({ reports: [] });
  if (url.pathname.startsWith("/api/venue-photos")) return jsonResponse({ photos: [] });
  if (url.pathname.startsWith("/api/admin/profile-avatars")) {
    return jsonResponse({ avatars: [], rotationCovers: [] });
  }
  throw new Error(`Unexpected request: ${method} ${url.pathname}`);
}

async function loadAdmin(): Promise<void> {
  await act(async () => {
    root.render(createElement(AdminClient));
  });
  const load = [...host.querySelectorAll("button")].find((button) =>
    button.textContent?.includes("Load reported drops"),
  );
  expect(load).toBeTruthy();
  await act(async () => {
    load!.click();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
}

function enterToken(input: HTMLInputElement, token: string): void {
  const setValue = Object.getOwnPropertyDescriptor(
    window.HTMLInputElement.prototype,
    "value",
  )?.set;
  setValue?.call(input, token);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  localStorage.clear();
  sessionStorage.clear();
  state.pintDropsFail = false;
  state.socialPosts = [];
  state.socialUnavailable = false;
  state.socialUnreadable = false;
  state.socialMalformedBody = null;
  state.socialThrows = false;
  state.socialRefusals = 0;
  state.socialRefusalStatus = 503;
  state.socialRefusalProbeUnknown = false;
  state.sessionAuthenticated = true;
  state.sessionProbeUnknown = false;
  state.sessionPostResponses = [];
  state.sessionPostBodies = [];
  state.socialResponsePosts = null;
  state.socialGetResponses = [];
  state.fetchEvents = [];
  state.socialActionStatus = 200;
  state.socialActionGate = null;
  state.socialActionBodies = [];
  vi.stubGlobal("fetch", vi.fn(responseFor));
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

describe("Admin Social post moderation queue", () => {
  const heldPost = {
    staffDisplayName: "Captain",
    postId: "11111111-1111-4111-8111-111111111111",
    mediaId: "22222222-2222-4222-8222-222222222222",
    revision: 4,
    authorHandle: "alice",
    body: "Friday at the Pineapple.",
    photoAltText: "Two pints beside the window",
    area: "camden",
    venueId: "venue-pineapple",
    visibility: "friends" as const,
    commentPolicy: "friends" as const,
    moderationClaim: "Provider requested a review.",
    moderationState: "needs_review" as const,
    createdAt: "2026-08-29T12:00:00.000Z",
    updatedAt: "2026-08-29T12:05:00.000Z",
  };

  it("plays held videos behind the moderator route and refuses approval without a loaded preview", async () => {
    state.socialPosts = [{ ...heldPost, media: { kind: "video", contentType: "video/mp4" } }];
    await loadAdmin();
    const video = host.querySelector("video")!;
    expect(video).toBeTruthy();
    expect(video.getAttribute("src")).toBe(`/api/admin/social-posts/media/${heldPost.mediaId}`);
    expect(video.controls).toBe(true);
    const approve = [...host.querySelectorAll("button")].find((button) => button.textContent === "Approve")!;
    const hide = [...host.querySelectorAll("button")].find((button) => button.textContent === "Hide")!;
    expect(approve.disabled).toBe(true);
    expect(hide.disabled).toBe(false);
    await act(async () => { video.dispatchEvent(new Event("loadeddata")); });
    expect(approve.disabled).toBe(false);
    await act(async () => { video.dispatchEvent(new Event("error")); });
    expect(approve.disabled).toBe(true);
    expect(hide.disabled).toBe(false);
    expect(host.textContent).toContain("Video preview failed.");
  });

  it("removes legacy raw tokens when an authenticated console mounts", async () => {
    localStorage.setItem("pubmax_admin_token", "legacy-local-token");
    sessionStorage.setItem("pubmax_admin_token", "legacy-session-token");

    await act(async () => {
      root.render(createElement(AdminClient));
    });

    expect(localStorage.getItem("pubmax_admin_token")).toBeNull();
    expect(sessionStorage.getItem("pubmax_admin_token")).toBeNull();
  });

  it("shows empty only after a successful empty response", async () => {
    await loadAdmin();
    expect(host.textContent).toContain("No Social posts awaiting review");
    expect(host.textContent).not.toContain("Social post moderation is unavailable.");
  });

  // Four causes answered with one word, and nothing to press. A moderator could
  // not tell whose fault it was and had no way onward either, which is the
  // door-slam the friction-voice law forbids.
  it("names the cause when the server refuses the Social queue, and offers a way onward", async () => {
    state.socialUnavailable = true;
    await loadAdmin();
    expect(host.textContent).toContain("Could not load Social posts.");
    expect(host.textContent).toContain("The server refused the request.");
    expect(host.textContent).not.toContain("No Social posts awaiting review");
    const retry = [...host.querySelectorAll("button")].find(
      (button) => button.textContent?.trim() === "Try again",
    );
    expect(retry).toBeTruthy();
  });

  it("separates an answer it could not read from a refusal", async () => {
    state.socialUnreadable = true;
    await loadAdmin();
    expect(host.textContent).toContain("The answer could not be read.");
    expect(host.textContent).not.toContain("The server refused the request.");
  });

  it("names a malformed answered body as unreadable, not unreachable", async () => {
    state.socialMalformedBody = "{";
    await loadAdmin();
    expect(host.textContent).toContain("The answer could not be read.");
    expect(host.textContent).not.toContain("The server could not be reached.");
  });

  it("reports an expired session when retry has no token", async () => {
    localStorage.removeItem("pubmax_admin_token");
    state.socialRefusals = 1;
    await loadAdmin();
    expect(host.textContent).toContain("The server refused the request.");
    state.sessionAuthenticated = false;
    state.fetchEvents = [];
    const retry = [...host.querySelectorAll("button")].find(
      (button) => button.textContent?.trim() === "Try again",
    );
    expect(retry).toBeTruthy();

    await act(async () => {
      retry!.click();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(state.fetchEvents.filter((event) => event.startsWith("session:"))).toEqual(["session:GET"]);
    expect(host.textContent).toContain("The console session has expired. Re-enter the admin token.");
  });

  it("reports an expired session after a Social refusal loses the session", async () => {
    localStorage.removeItem("pubmax_admin_token");
    state.socialRefusals = 1;
    state.socialRefusalStatus = 403;
    await loadAdmin();

    expect(host.textContent).toContain("The console session has expired. Re-enter the admin token.");
    expect(host.textContent).not.toContain("The server refused the request.");
    expect(state.fetchEvents.filter((event) => event.startsWith("session:"))).toEqual([
      "session:GET",
      "session:GET",
    ]);
  });

  it("does not report expiry when the session probe is unknown", async () => {
    localStorage.removeItem("pubmax_admin_token");
    state.socialRefusals = 1;
    state.socialRefusalStatus = 403;
    state.socialRefusalProbeUnknown = true;
    await loadAdmin();

    expect(host.textContent).toContain("The server refused the request.");
    expect(host.textContent).not.toContain("The console session has expired.");
  });

  it("reuses an open session for an ordinary load", async () => {
    await loadAdmin();
    state.fetchEvents = [];
    const load = [...host.querySelectorAll("button")].find((button) =>
      button.textContent?.includes("Load reported drops"),
    );
    expect(load).toBeTruthy();

    await act(async () => {
      load!.click();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(state.fetchEvents).not.toContain("session:POST");
  });

  // Two rapid clicks are the precondition; the OUTCOME the guard promises is
  // that only one Social GET is ever issued, so a second load cannot exist to
  // race the first. An earlier version of this test released a SECOND queued
  // response and asserted its rows, which the guard makes unreachable: the
  // second click starts nothing, so nothing is ever waiting on that gate and
  // the queue sat on "Loading...". The stale-response case is covered by the
  // test below, which produces two in-flight loads through the session lane.
  it("issues one Social read for two rapid retry clicks and disables the control", async () => {
    state.socialRefusals = 1;
    await loadAdmin();

    let releaseResponse = () => {};
    const gatedResponse = new Promise<void>((resolve) => {
      releaseResponse = resolve;
    });
    const retryPost = {
      ...heldPost,
      postId: "33333333-3333-4333-8333-333333333333",
      body: "Retry response.",
    };
    state.socialGetResponses = [{ gate: gatedResponse, posts: [retryPost] }];
    const retry = [...host.querySelectorAll("button")].find(
      (button) => button.textContent?.trim() === "Try again",
    );
    expect(retry).toBeTruthy();

    const readsBefore = state.fetchEvents.filter((event) => event === "social:GET").length;

    await act(async () => {
      retry!.click();
      retry!.click();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    const busyRetry = [...host.querySelectorAll("button")].find(
      (button) => button.textContent?.trim() === "Try again",
    );
    expect(busyRetry?.disabled).toBe(true);
    const readsDuring = state.fetchEvents.filter((event) => event === "social:GET").length;
    expect(readsDuring - readsBefore).toBe(1);

    await act(async () => {
      releaseResponse();
      await gatedResponse;
      await Promise.resolve();
    });
    expect(host.textContent).toContain("Retry response.");
  });

  it("re-enters an expired Social session without retaining the raw token", async () => {
    const newerPost = {
      ...heldPost,
      postId: "44444444-4444-4444-8444-444444444444",
      body: "Newer queue response.",
    };
    localStorage.setItem("pubmax_admin_token", "legacy-local-token");
    sessionStorage.setItem("pubmax_admin_token", "legacy-session-token");
    state.sessionAuthenticated = false;
    state.sessionPostResponses = [{ gate: null, accepted: true }];
    state.socialGetResponses = [{ gate: null, posts: [newerPost] }];
    await loadAdmin();

    expect(host.textContent).toContain("The console session has expired. Re-enter the admin token.");
    expect(localStorage.getItem("pubmax_admin_token")).toBeNull();
    expect(sessionStorage.getItem("pubmax_admin_token")).toBeNull();
    const input = host.querySelector<HTMLInputElement>('input[aria-label="Admin token"]');
    const form = input?.closest("form");
    expect(input).toBeTruthy();
    expect(form).toBeTruthy();

    await act(async () => {
      enterToken(input!, "new-secret");
      form!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(state.sessionPostBodies).toEqual([{ token: "new-secret" }]);
    expect(host.textContent).toContain("Newer queue response.");
    expect(host.textContent).not.toContain("The console session has expired.");
    expect(host.querySelector('input[aria-label="Admin token"]')).toBeNull();
    expect(localStorage.getItem("pubmax_admin_token")).toBeNull();
    expect(sessionStorage.getItem("pubmax_admin_token")).toBeNull();
    expect(document.activeElement?.textContent).toContain("Social post moderation");
  });

  it("clears a refused ephemeral token and leaves the recovery door open", async () => {
    state.sessionAuthenticated = false;
    state.sessionPostResponses = [{ gate: null, accepted: false }];
    await loadAdmin();
    const input = host.querySelector<HTMLInputElement>('input[aria-label="Admin token"]');
    const form = input?.closest("form");

    await act(async () => {
      enterToken(input!, "wrong-secret");
      form!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(state.sessionPostBodies).toEqual([{ token: "wrong-secret" }]);
    expect(host.querySelector<HTMLInputElement>('input[aria-label="Admin token"]')?.value).toBe("");
    expect(host.querySelector('[role="alert"]')?.textContent).toContain(
      "Not authorised. Check the admin token.",
    );
    expect(localStorage.getItem("pubmax_admin_token")).toBeNull();
    expect(form!.closest('[role="alert"]')).toBeNull();
  });

  it("recovers when a Social decision finds an expired session", async () => {
    state.socialPosts = [heldPost];
    await loadAdmin();
    state.socialActionStatus = 403;
    state.sessionPostResponses = [{ gate: null, accepted: true }];

    const hide = [...host.querySelectorAll<HTMLButtonElement>("button")].find(
      (button) => button.textContent === "Hide",
    );
    await act(async () => {
      hide!.click();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(host.textContent).toContain("The console session has expired. Re-enter the admin token.");
    const input = host.querySelector<HTMLInputElement>('input[aria-label="Admin token"]');
    const form = input?.closest("form");
    expect(input).toBeTruthy();
    state.socialActionStatus = 200;
    state.socialGetResponses = [{ gate: null, posts: [heldPost] }];

    await act(async () => {
      enterToken(input!, "replacement-secret");
      form!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(state.sessionPostBodies).toEqual([{ token: "replacement-secret" }]);
    expect(host.textContent).toContain("Friday at the Pineapple.");
    expect(document.activeElement?.textContent).toContain("Social post moderation");
  });

  it("uses the same ephemeral recovery boundary on the Import tab", async () => {
    state.sessionAuthenticated = false;
    state.sessionPostResponses = [{ gate: null, accepted: true }];
    await act(async () => {
      root.render(createElement(AdminClient));
    });
    const importTab = [...host.querySelectorAll<HTMLButtonElement>("button")].find(
      (button) => button.textContent === "Import note",
    );

    await act(async () => {
      importTab!.click();
      await Promise.resolve();
      await Promise.resolve();
    });

    const input = host.querySelector<HTMLInputElement>('input[aria-label="Admin token"]');
    const form = input?.closest("form");
    expect(input).toBeTruthy();
    await act(async () => {
      enterToken(input!, "import-secret");
      form!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(state.sessionPostBodies).toEqual([{ token: "import-secret" }]);
    expect(state.fetchEvents).toContain("import:GET");
    expect(host.querySelector('input[aria-label="Admin token"]')).toBeNull();
  });

  it("rejects a Social row with an invalid moderation state", async () => {
    state.socialResponsePosts = [{ ...heldPost, moderationState: "pending" }];
    await loadAdmin();
    expect(host.textContent).toContain("The answer could not be read.");
    expect([...host.querySelectorAll("button")].some((button) => button.textContent === "Approve")).toBe(false);
    expect([...host.querySelectorAll("button")].some((button) => button.textContent === "Hide")).toBe(false);
  });

  it("rejects a Social row that is null", async () => {
    state.socialResponsePosts = [null];
    await loadAdmin();
    expect(host.textContent).toContain("The answer could not be read.");
    expect([...host.querySelectorAll("button")].some((button) => button.textContent === "Approve")).toBe(false);
    expect([...host.querySelectorAll("button")].some((button) => button.textContent === "Hide")).toBe(false);
  });

  it("separates a server it never reached from one that answered", async () => {
    state.socialThrows = true;
    await loadAdmin();
    expect(host.textContent).toContain("The server could not be reached.");
    expect(host.textContent).not.toContain("The server refused the request.");
  });

  it("never says the retired one-word line", async () => {
    state.socialUnavailable = true;
    await loadAdmin();
    expect(host.textContent).not.toContain("Social post moderation is unavailable.");
  });

  it("shows the exact held revision and its review context even when Pint Drop requests fail", async () => {
    state.pintDropsFail = true;
    state.socialPosts = [heldPost];
    await loadAdmin();
    expect(host.textContent).toContain("@alice");
    expect(host.textContent).not.toContain("Profile:");
    expect(host.textContent).not.toContain("profile-alice");
    expect(host.textContent).toContain("Revision 4");
    expect(host.textContent).toContain("Friday at the Pineapple.");
    expect(host.textContent).toContain("Area: camden");
    expect(host.textContent).toContain("Venue: venue-pineapple");
    expect(host.textContent).toContain("Visibility: Friends");
    expect(host.textContent).toContain("Comments: Friends");
    expect(host.textContent).toContain("State: Needs review");
    expect(host.textContent).toContain("Reason: Provider requested a review.");
    expect(host.querySelector('time[datetime="2026-08-29T12:00:00.000Z"]')).toBeTruthy();
    expect(host.querySelector('time[datetime="2026-08-29T12:05:00.000Z"]')).toBeTruthy();
    const image = host.querySelector(
      'img[src="/api/admin/social-posts/media/22222222-2222-4222-8222-222222222222"]',
    );
    expect(image?.getAttribute("alt")).toBe("Two pints beside the window");
    expect([...host.querySelectorAll("button")].some((button) => button.textContent === "Approve")).toBe(true);
    expect([...host.querySelectorAll("button")].some((button) => button.textContent === "Hide")).toBe(true);
    expect([...host.querySelectorAll("button")].some((button) => button.textContent === "Reject")).toBe(false);
    expect(
      [...host.querySelectorAll("button")].find((button) =>
        button.textContent?.includes("Load reported drops"),
      ),
    ).toBeTruthy();
  });

  it("hides a post and keeps the row disabled until the decision completes", async () => {
    state.socialPosts = [{ ...heldPost, revision: 0 }];
    let releaseAction = () => {};
    state.socialActionGate = new Promise<void>((resolve) => {
      releaseAction = resolve;
    });
    await loadAdmin();
    const hide = [...host.querySelectorAll("button")].find((button) => button.textContent === "Hide");
    expect(hide).toBeTruthy();

    await act(async () => {
      hide!.click();
      await Promise.resolve();
    });
    expect(host.textContent).toContain("Hiding…");
    const socialButtons = [...host.querySelectorAll("button")].filter((button) =>
      button.textContent === "Approve" || button.textContent === "Hiding…",
    );
    expect(socialButtons).toHaveLength(2);
    expect(socialButtons.every((button) => button.disabled)).toBe(true);

    await act(async () => {
      releaseAction();
      await state.socialActionGate;
      await Promise.resolve();
    });
    expect(state.socialActionBodies).toEqual([{
      postId: heldPost.postId,
      mediaId: heldPost.mediaId,
      expectedRevision: 0,
      action: "hide",
    }]);
    expect(host.textContent).toContain("Social post hidden.");
    expect(host.textContent).not.toContain("Friday at the Pineapple.");
  });

  it("keeps the held row and shows an error when a decision fails", async () => {
    state.socialPosts = [heldPost];
    state.socialActionStatus = 503;
    await loadAdmin();
    const hide = [...host.querySelectorAll("button")].find((button) => button.textContent === "Hide");
    await act(async () => {
      hide!.click();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(host.textContent).toContain("Friday at the Pineapple.");
    expect(host.querySelector('[role="alert"]')?.textContent).toContain(
      "Social post action failed. Try again.",
    );
  });

  it("removes a stale row and tells the moderator to reload after a conflict", async () => {
    state.socialPosts = [heldPost];
    state.socialActionStatus = 409;
    await loadAdmin();
    const hide = [...host.querySelectorAll("button")].find((button) => button.textContent === "Hide");

    await act(async () => {
      hide!.click();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(host.textContent).not.toContain("Friday at the Pineapple.");
    expect(host.querySelector('[role="alert"]')?.textContent).toContain(
      "Post changed. Reload queue.",
    );
  });
});
