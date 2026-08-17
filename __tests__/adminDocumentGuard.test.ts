import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  ADMIN_SESSION_COOKIE,
  canOpenAdminDocument,
  hashAdminSession,
  requestFromIncomingHeaders,
} from "@/lib/adminAuth";

const ORIGINAL_ADMIN_TOKEN = process.env.ADMIN_TOKEN;

afterEach(() => {
  if (ORIGINAL_ADMIN_TOKEN === undefined) delete process.env.ADMIN_TOKEN;
  else process.env.ADMIN_TOKEN = ORIGINAL_ADMIN_TOKEN;
});

describe("canOpenAdminDocument", () => {
  it("refuses a request with no cookie when ADMIN_TOKEN is set", () => {
    process.env.ADMIN_TOKEN = "test-admin-secret";
    expect(canOpenAdminDocument(new Request("http://localhost/admin"))).toBe(
      false,
    );
  });

  it("admits a request whose cookie is the hashed token", () => {
    process.env.ADMIN_TOKEN = "test-admin-secret";
    const cookie = `${ADMIN_SESSION_COOKIE}=${encodeURIComponent(
      hashAdminSession("test-admin-secret"),
    )}`;
    expect(
      canOpenAdminDocument(
        new Request("http://localhost/admin", { headers: { cookie } }),
      ),
    ).toBe(true);
  });

  it("rebuilds a Request from incoming headers so the page can reuse the gate", () => {
    process.env.ADMIN_TOKEN = "test-admin-secret";
    const cookie = `${ADMIN_SESSION_COOKIE}=${encodeURIComponent(
      hashAdminSession("test-admin-secret"),
    )}`;
    const request = requestFromIncomingHeaders(new Headers({ cookie }));
    expect(canOpenAdminDocument(request)).toBe(true);
  });
});

describe("the admin document", () => {
  it("refuses in the server page before the console mounts", () => {
    const page = readFileSync(join(process.cwd(), "app/admin/page.tsx"), "utf8");
    expect(page).toContain("canOpenAdminDocument");
    expect(page).toContain("unauthorized()");
    expect(page).toContain("headers()");
    expect(page).not.toContain("cookies()");
  });

  it("keeps the token form on the 401 page, not the console", () => {
    const unauthorized = readFileSync(
      join(process.cwd(), "app/admin/unauthorized.tsx"),
      "utf8",
    );
    expect(unauthorized).toContain("AdminTokenForm");
    expect(unauthorized).not.toContain("AdminClient");
  });
});
