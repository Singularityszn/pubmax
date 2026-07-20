// Browser-only continuity for the push identity join. Delivery material is
// retained in volatile module memory after the anonymous registration succeeds,
// then presented only to server-authorised account/Plan join routes. No user id
// or member id is ever stored or sent by this module. Raw APNs/Web delivery
// material is never copied into localStorage or sessionStorage: Web can recover
// its subscription from the service worker and native asks APNs to re-emit an
// already-permitted token after a WebView restart.

import { getAccessToken } from "@/lib/authClient";
import { readActivePlan } from "@/lib/activePlan";
import { encodeWebPushSubscription } from "@/lib/webPushSubscription";

export type ClientPushRegistration = {
  token: string;
  platform: "ios" | "android" | "web";
};

const REGISTRATION_EVENT = "pubmax:push-registration";
let volatileRegistration: ClientPushRegistration | null = null;

function validRegistration(value: unknown): ClientPushRegistration | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  if (typeof row.token !== "string" || !row.token || row.token.length > 2_048) return null;
  if (row.platform !== "ios" && row.platform !== "android" && row.platform !== "web") return null;
  return { token: row.token, platform: row.platform };
}

function storedRegistration(): ClientPushRegistration | null {
  return volatileRegistration;
}

async function currentWebRegistration(): Promise<ClientPushRegistration | null> {
  if (typeof window === "undefined" || !("serviceWorker" in navigator)) return null;
  try {
    const registration = await navigator.serviceWorker.ready;
    const subscription = await registration.pushManager.getSubscription();
    const token = subscription ? encodeWebPushSubscription(subscription.toJSON()) : null;
    return token ? { token, platform: "web" } : null;
  } catch {
    return null;
  }
}

export async function currentPushRegistration(): Promise<ClientPushRegistration | null> {
  return storedRegistration() ?? await currentWebRegistration();
}

/** Remember only AFTER /api/push-tokens accepted the anonymous registration. */
export function rememberPushRegistration(registration: ClientPushRegistration): void {
  const value = validRegistration(registration);
  if (!value || typeof window === "undefined") return;
  volatileRegistration = value;
  try {
    window.dispatchEvent(new Event(REGISTRATION_EVENT));
  } catch {
    // The verified routes still join through the direct calls below.
  }

  // If registration happens after sign-in or while a Plan is already active,
  // close the join opportunistically. Both routes independently re-verify
  // authority and fail soft; no targeted sender is activated here.
  void linkCurrentPushToClaimedAccount();
  const activePlan = readActivePlan();
  if (activePlan?.role) void linkCurrentPushToPlan(activePlan.id);
}

/** Retry a waiting Plan join when an async native token arrives. */
export function subscribePushRegistration(onRegistration: () => void): () => void {
  if (typeof window === "undefined") return () => undefined;
  window.addEventListener(REGISTRATION_EVENT, onRegistration);
  return () => window.removeEventListener(REGISTRATION_EVENT, onRegistration);
}

/** Link after account claim, or opportunistically after registration. */
export async function linkCurrentPushToClaimedAccount(): Promise<boolean> {
  const registration = await currentPushRegistration();
  if (!registration) return false;
  let accessToken: string | null = null;
  try {
    accessToken = await getAccessToken();
  } catch {
    return false;
  }
  if (!accessToken) return false;
  try {
    const response = await fetch("/api/push-tokens/account", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify(registration),
    });
    return response.ok;
  } catch {
    return false;
  }
}

/** Logout semantics: detach this registration while the JWT still verifies. */
export async function unlinkCurrentPushFromClaimedAccount(): Promise<boolean> {
  const registration = await currentPushRegistration();
  if (!registration) return true;
  let accessToken: string | null = null;
  try {
    accessToken = await getAccessToken();
  } catch {
    return false;
  }
  if (!accessToken) return true;
  try {
    const response = await fetch("/api/push-tokens/account", {
      method: "DELETE",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify(registration),
    });
    return response.ok;
  } catch {
    return false;
  }
}

/** Account-erasure/privacy seam; callers must still hold a verified JWT. */
export async function unlinkAllPushFromClaimedAccount(): Promise<boolean> {
  let accessToken: string | null = null;
  try {
    accessToken = await getAccessToken();
  } catch {
    return false;
  }
  if (!accessToken) return false;
  try {
    const response = await fetch("/api/push-tokens/account", {
      method: "DELETE",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({ all: true }),
    });
    return response.ok;
  } catch {
    return false;
  }
}

/** Link to a Plan using either its raw in-memory capability or its existing
 * path-scoped HttpOnly cookie. */
export async function linkCurrentPushToPlan(planId: string, memberToken?: string): Promise<boolean> {
  const registration = await currentPushRegistration();
  if (!registration) return false;
  try {
    const headers = new Headers({ "content-type": "application/json" });
    if (memberToken) headers.set("authorization", `Bearer ${memberToken}`);
    const response = await fetch(`/api/plans/${encodeURIComponent(planId)}/push-tokens`, {
      method: "POST",
      headers,
      body: JSON.stringify(registration),
    });
    return response.ok;
  } catch {
    return false;
  }
}

export async function unlinkCurrentPushFromPlan(planId: string, memberToken?: string): Promise<boolean> {
  const registration = await currentPushRegistration();
  if (!registration) return true;
  try {
    const headers = new Headers({ "content-type": "application/json" });
    if (memberToken) headers.set("authorization", `Bearer ${memberToken}`);
    const response = await fetch(`/api/plans/${encodeURIComponent(planId)}/push-tokens`, {
      method: "DELETE",
      headers,
      body: JSON.stringify(registration),
    });
    return response.ok;
  } catch {
    return false;
  }
}

/** Test-only: clear volatile continuity; session storage is caller-owned. */
export function __resetPushIdentityClient(): void {
  volatileRegistration = null;
}
