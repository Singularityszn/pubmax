import { type Page } from "@playwright/test";
import type { FriendLocationRead } from "../../lib/friendLocation";
import { ACCOUNTS, accessJwt } from "./authDoubles";

export type FriendBrowserEvent = {
  kind: "watch" | "callback" | "error" | "clear" | "patch" | "visibility";
  id?: number;
  source?: "friend-watch" | "other";
  state?: DocumentVisibilityState;
};

export async function installNativeFriendWatchTrace(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const events: FriendBrowserEvent[] = [];
    const active = new Set<number>();
    const geo = navigator.geolocation;
    const watch = geo.watchPosition.bind(geo);
    const clear = geo.clearWatch.bind(geo);
    const fetch = window.fetch.bind(window);
    let source: "friend-watch" | "other" = "other";
    Object.assign(window, { __friendWatchTrace: { events, active } });

    geo.watchPosition = (success, failure, options) => {
      const friend = options?.enableHighAccuracy === true && options.maximumAge === 0;
      let id = -1;
      id = watch((position) => {
        if (friend) events.push({ kind: "callback", id });
        const previous = source;
        source = friend ? "friend-watch" : "other";
        try { success(position); } finally { source = previous; }
      }, (error) => {
        if (friend) events.push({ kind: "error", id });
        failure?.(error);
      }, options);
      if (friend) { active.add(id); events.push({ kind: "watch", id }); }
      return id;
    };
    geo.clearWatch = (id) => {
      if (active.delete(id)) events.push({ kind: "clear", id });
      clear(id);
    };
    window.fetch = (input, init) => {
      const url = new URL(typeof input === "string" ? input : input instanceof Request ? input.url : input.href, location.href);
      const method = init?.method ?? (input instanceof Request ? input.method : "GET");
      if (url.pathname === "/api/friend-locations" && method === "PATCH") events.push({ kind: "patch", source });
      return fetch(input, init);
    };
    document.addEventListener("visibilitychange", () => events.push({ kind: "visibility", state: document.visibilityState }));
  });
}

export async function readNativeFriendWatchTrace(page: Page): Promise<{ events: FriendBrowserEvent[]; active: number[] }> {
  return page.evaluate(() => {
    const trace = (window as typeof window & {
      __friendWatchTrace: { events: FriendBrowserEvent[]; active: Set<number> };
    }).__friendWatchTrace;
    return { events: trace.events, active: [...trace.active] };
  });
}

export async function installFriendLocationBrowserDoubles(page: Page) {
  const calls: Array<{ method: string; body: Record<string, unknown> | null; completed: boolean }> = [];
  let generation = 0;
  let own: FriendLocationRead["own"] = null;
  let holdReads = false;
  const heldReads = new Set<() => void>();

  await page.route("**/api/friend-locations", async (route) => {
    const request = route.request();
    const method = request.method();
    const body = request.postData() ? request.postDataJSON() as Record<string, unknown> : null;
    const call = { method, body, completed: false };
    calls.push(call);
    const bearer = request.headers().authorization;
    if (!["Bearer pubmaxx-e2e-access-token-A", `Bearer ${accessJwt(ACCOUNTS.A)}`].includes(bearer)) {
      await route.fulfill({ status: 401, json: { error: "unauthorised" } });
      call.completed = true;
      return;
    }
    if (method === "GET" && holdReads) {
      await new Promise<void>((resolve) => {
        const release = () => { heldReads.delete(release); resolve(); };
        heldReads.add(release);
      });
    }
    if (method === "POST" && body?.action !== "reconcile") {
      if (body?.expectedGeneration !== generation) {
        await route.fulfill({ status: 409, json: { error: "conflict" } });
        call.completed = true;
        return;
      }
      generation++;
      own = {
        sessionId: "00000000-0000-4000-8000-0000000000c3", revision: 1,
        recipients: [ACCOUNTS.B.id], accuracy: Number(body?.accuracy),
        expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
      };
    }
    if (method === "PATCH" && own) own = { ...own, revision: own.revision + 1, accuracy: Number(body?.accuracy) };
    if (method === "DELETE") { own = null; generation++; }
    const result: FriendLocationRead = {
      ok: true, generation, own,
      mutuals: [{ profileId: ACCOUNTS.B.id, handle: ACCOUNTS.B.handle }],
      friends: own ? [{
        profileId: ACCOUNTS.B.id, handle: ACCOUNTS.B.handle,
        latitude: 51.513, longitude: -0.124, accuracy: 110,
        updatedAt: new Date().toISOString(), expiresAt: own.expiresAt,
      }] : [],
    };
    await route.fulfill({ status: 200, headers: { "cache-control": "private, no-store" }, json: result });
    call.completed = true;
  });

  return {
    calls,
    holdReads() { holdReads = true; },
    releaseReads() { holdReads = false; for (const release of [...heldReads]) release(); },
    pendingReads() { return heldReads.size; },
  };
}
