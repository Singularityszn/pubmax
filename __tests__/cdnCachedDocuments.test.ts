import { NextRequest } from "next/server";
import { describe, expect, it, vi } from "vitest";

import { securityProxy } from "@/proxy";

vi.mock("server-only", () => ({}));

type RouteModule = { dynamic?: string; revalidate?: number | false };
type DocumentCase = { pathname: string; load: () => Promise<unknown>; maxAge: number };

const PUBLIC_DOCUMENTS: DocumentCase[] = [
  { pathname: "/", load: () => import("@/app/page"), maxAge: 3600 },
  { pathname: "/map", load: () => import("@/app/map/page"), maxAge: 3600 },
  { pathname: "/tonight", load: () => import("@/app/tonight/page"), maxAge: 300 },
  { pathname: "/today", load: () => import("@/app/today/page"), maxAge: 300 },
  { pathname: "/near", load: () => import("@/app/near/page"), maxAge: 3600 },
  { pathname: "/plan", load: () => import("@/app/plan/page"), maxAge: 3600 },
  { pathname: "/pal", load: () => import("@/app/pal/page"), maxAge: 3600 },
  { pathname: "/historic/the-gun", load: () => import("@/app/historic/[slug]/page"), maxAge: 3600 },
  { pathname: "/borough/haringey", load: () => import("@/app/borough/[slug]/page"), maxAge: 3600 },
  { pathname: "/landmark/big-ben", load: () => import("@/app/landmark/[id]/page"), maxAge: 3600 },
  { pathname: "/drink/guinness", load: () => import("@/app/drink/[slug]/page"), maxAge: 3600 },
  { pathname: "/area/piccadilly-soho", load: () => import("@/app/area/[slug]/page"), maxAge: 3600 },
  { pathname: "/area/clapham/drink/guinness", load: () => import("@/app/area/[slug]/drink/[brand]/page"), maxAge: 3600 },
  { pathname: "/ledger/venue-xjf3n0", load: () => import("@/app/ledger/[id]/page"), maxAge: 3600 },
  { pathname: "/routes/victorian-soho", load: () => import("@/app/routes/[slug]/page"), maxAge: 3600 },
];

const PRIVATE_DOCUMENTS: Array<Omit<DocumentCase, "maxAge">> = [
  { pathname: "/u/you", load: () => import("@/app/u/[handle]/page") },
  { pathname: "/messages", load: () => import("@/app/messages/page") },
  { pathname: "/admin", load: () => import("@/app/admin/page") },
  { pathname: "/onboarding", load: () => import("@/app/onboarding/page") },
  { pathname: "/social", load: () => import("@/app/social/page") },
  { pathname: "/p/drop-1", load: () => import("@/app/p/[id]/page") },
];

function documentResponse(pathname: string) {
  return securityProxy(new NextRequest(`https://pubmaxxing.com${pathname}`, {
    headers: { host: "pubmaxxing.com" },
  }));
}

describe("CDN document configuration", () => {
  it.each(PUBLIC_DOCUMENTS)("$pathname supplies static rendering and bounded revalidation to Next", async ({ pathname, load, maxAge }) => {
    const config = await load() as RouteModule;
    expect(config.dynamic).toBe("force-static");
    expect(config.revalidate).toBeTypeOf("number");
    expect(config.revalidate).toBeGreaterThan(0);
    expect(config.revalidate).toBeLessThanOrEqual(maxAge);
    const response = documentResponse(pathname);
    expect(response.headers.get("Content-Security-Policy")).toContain("'unsafe-inline'");
    expect(response.headers.get("x-middleware-request-x-nonce")).toBeNull();
  });

  it.each(PRIVATE_DOCUMENTS)("$pathname keeps request rendering and a fresh nonce", async ({ pathname, load }) => {
    const config = await load() as RouteModule;
    expect(config.dynamic).not.toBe("force-static");
    const first = documentResponse(pathname);
    const second = documentResponse(pathname);
    const nonce = first.headers.get("x-middleware-request-x-nonce");
    expect(nonce).toBeTruthy();
    expect(second.headers.get("x-middleware-request-x-nonce")).not.toBe(nonce);
    const policy = first.headers.get("Content-Security-Policy");
    expect(policy).toContain(`'nonce-${nonce}'`);
    expect(policy).not.toContain("'unsafe-inline'");
  });
});
