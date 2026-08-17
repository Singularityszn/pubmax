import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  ADMIN_SESSION_COOKIE,
  canOpenAdminDocument,
  hashAdminSession,
  requestFromIncomingHeaders,
} from "@/lib/adminAuth";

const incoming = vi.hoisted(() => ({ headers: new Headers() }));
const navigation = vi.hoisted(() => ({
  unauthorized: vi.fn(() => {
    throw new Error("NEXT_HTTP_ERROR_FALLBACK;401");
  }),
}));

vi.mock("next/headers", () => ({
  headers: async () => incoming.headers,
}));

vi.mock("next/navigation", () => ({
  unauthorized: navigation.unauthorized,
}));

vi.mock("@/app/admin/AdminClient", () => ({
  default: () => createElement("div", null, "moderator console"),
}));

const ORIGINAL_ADMIN_TOKEN = process.env.ADMIN_TOKEN;

beforeEach(() => {
  navigation.unauthorized.mockClear();
  incoming.headers = new Headers();
});

afterEach(() => {
  if (ORIGINAL_ADMIN_TOKEN === undefined) delete process.env.ADMIN_TOKEN;
  else process.env.ADMIN_TOKEN = ORIGINAL_ADMIN_TOKEN;
});

function moderatorCookie(token: string): string {
  return `${ADMIN_SESSION_COOKIE}=${encodeURIComponent(hashAdminSession(token))}`;
}

describe("canOpenAdminDocument", () => {
  it("refuses a request with no cookie when ADMIN_TOKEN is set", () => {
    process.env.ADMIN_TOKEN = "test-admin-secret";
    expect(canOpenAdminDocument(new Request("http://localhost/admin"))).toBe(
      false,
    );
  });

  it("admits a request whose cookie is the hashed token", () => {
    process.env.ADMIN_TOKEN = "test-admin-secret";
    expect(
      canOpenAdminDocument(
        new Request("http://localhost/admin", {
          headers: { cookie: moderatorCookie("test-admin-secret") },
        }),
      ),
    ).toBe(true);
  });

  it("rebuilds a Request from incoming headers so the page can reuse the gate", () => {
    process.env.ADMIN_TOKEN = "test-admin-secret";
    const request = requestFromIncomingHeaders(
      new Headers({ cookie: moderatorCookie("test-admin-secret") }),
    );
    expect(canOpenAdminDocument(request)).toBe(true);
  });
});

describe("the admin document", () => {
  it("refuses an anonymous request before the console mounts", async () => {
    process.env.ADMIN_TOKEN = "test-admin-secret";
    const { default: AdminPage } = await import("@/app/admin/page");
    await expect(AdminPage()).rejects.toThrow(/401/);
    expect(navigation.unauthorized).toHaveBeenCalledTimes(1);
  });

  it("renders the console for a moderator session cookie", async () => {
    process.env.ADMIN_TOKEN = "test-admin-secret";
    incoming.headers = new Headers({
      cookie: moderatorCookie("test-admin-secret"),
    });
    const { default: AdminPage } = await import("@/app/admin/page");
    const html = renderToStaticMarkup(await AdminPage());
    expect(navigation.unauthorized).not.toHaveBeenCalled();
    expect(html).toContain("moderator console");
  });

  it("keeps the token form on the 401 body, not the console", async () => {
    const { default: AdminUnauthorized } = await import(
      "@/app/admin/unauthorized"
    );
    const html = renderToStaticMarkup(createElement(AdminUnauthorized));
    expect(html).toContain("Moderator sign-in");
    expect(html).toContain('aria-label="Admin token"');
    expect(html).not.toContain("moderator console");
  });
});
