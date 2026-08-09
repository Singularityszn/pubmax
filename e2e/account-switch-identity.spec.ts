import { expect, test, type Page } from "@playwright/test";

// The signed-in account is the ONLY identity authority.
//
// DEFECT: a drinker signed out of account A (@karan) and created account B
// (@karansznx) in the same browser. Sign-out never cleared the device identity
// artifacts, and nothing on an account CHANGE cleared them either, so A's
// `pubmax_handle` outlived A's session and every surface reading it - the You
// tab, the profile route, the follow actor - still answered "@karan".
//
// The keyless Playwright server has no Supabase, so the session and the
// owner-only reads are browser route doubles. Every surface under test is the
// real shipped UI, and the durable resume cookie is the REAL route.

const ACCOUNTS = {
  A: {
    id: "00000000-0000-4000-8000-0000000000a1",
    handle: "karan",
    email: "karan@example.test",
    name: "Karan",
    refreshToken: "pubmaxx-e2e-refresh-token-a",
  },
  B: {
    id: "00000000-0000-4000-8000-0000000000b2",
    handle: "karansznx",
    email: "karanmanoharann@example.test",
    name: "Karan M",
    refreshToken: "pubmaxx-e2e-refresh-token-b",
  },
} as const;

type AccountKey = keyof typeof ACCOUNTS;
type Account = (typeof ACCOUNTS)[AccountKey];

const AUTH_STORAGE_KEY = "sb-pubmaxx-e2e-auth-token";
const WHICH_ACCOUNT_KEY = "__e2e_signed_in_account";
const DEVICE_HANDLE_KEY = "pubmax_handle";
const RESUME_COOKIE = "pubmax_session_resume";
const SHOTS = "/tmp/pubmax-account-switch";

type Stub = {
  /** Whose session the init script installs, and whom the doubles answer for. */
  signedInAs: (account: AccountKey | null) => Promise<void>;
  /** The claimed handle the server owns for the signed-in account, or null. */
  setServerHandle: (handle: string | null) => void;
};

async function installAuthDoubles(page: Page): Promise<Stub> {
  let current: Account | null = ACCOUNTS.A;
  let serverHandle: string | null = ACCOUNTS.A.handle;

  await page.addInitScript(
    ({ accounts, authStorageKey, whichKey }) => {
      window.localStorage.setItem("pubmaxx:analytics-consent:v1", "denied");
      const which = window.localStorage.getItem(whichKey);
      const account = which ? accounts[which as "A" | "B"] : null;
      if (!account) {
        window.localStorage.removeItem(authStorageKey);
        return;
      }
      window.localStorage.setItem(
        authStorageKey,
        JSON.stringify({
          access_token: `pubmaxx-e2e-access-token-${which}`,
          refresh_token: account.refreshToken,
          expires_at: Math.floor(Date.now() / 1000) + 86_400,
          expires_in: 86_400,
          token_type: "bearer",
          user: {
            id: account.id,
            aud: "authenticated",
            role: "authenticated",
            email: account.email,
            app_metadata: {},
            user_metadata: { full_name: account.name },
            created_at: "2026-07-29T00:00:00.000Z",
          },
        }),
      );
    },
    {
      accounts: ACCOUNTS,
      authStorageKey: AUTH_STORAGE_KEY,
      whichKey: WHICH_ACCOUNT_KEY,
    },
  );

  // GoTrue double: /auth/v1/user answers with whoever is signed in; logout and
  // everything else answer plainly so sign-out completes locally.
  await page.route("https://pubmaxx-e2e.supabase.co/**", async (route) => {
    const url = route.request().url();
    const body = url.includes("/auth/v1/user") && current
      ? {
          id: current.id,
          aud: "authenticated",
          role: "authenticated",
          email: current.email,
          user_metadata: { full_name: current.name },
        }
      : {};
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      headers: { "access-control-allow-origin": "*" },
      body: JSON.stringify(body),
    });
  });

  await page.route("**/api/identity/handle/current", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ handle: serverHandle }),
    });
  });
  await page.route("**/api/identity/onboarding", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(
        serverHandle ? { complete: false, handle: serverHandle } : { complete: false },
      ),
    });
  });

  return {
    async signedInAs(key) {
      current = key ? ACCOUNTS[key] : null;
      serverHandle = current ? current.handle : null;
      await page.evaluate(
        ({ whichKey, value }) => {
          if (value) window.localStorage.setItem(whichKey, value);
          else window.localStorage.removeItem(whichKey);
        },
        { whichKey: WHICH_ACCOUNT_KEY, value: key ?? "" },
      );
    },
    setServerHandle(handle) {
      serverHandle = handle;
    },
  };
}

/** Seed the browser as if the account key had signed in before the first load. */
async function seedSignedIn(page: Page, key: AccountKey): Promise<void> {
  await page.goto("/today");
  await page.evaluate(
    ({ whichKey, value }) => window.localStorage.setItem(whichKey, value),
    { whichKey: WHICH_ACCOUNT_KEY, value: key },
  );
}

async function readDeviceIdentity(page: Page): Promise<Record<string, string | null>> {
  return page.evaluate((handleKey) => {
    const read = (key: string) => {
      try {
        return window.localStorage.getItem(key);
      } catch {
        return null;
      }
    };
    return {
      handle: read(handleKey),
      nightProfile: read("pubmaxx.night-profile.v1:device"),
      roundAnonymous: read("pubmax_round_anonymous_identity_v1"),
      nudgePending: read("pubmax:identityNudge:pending:v1"),
    };
  }, DEVICE_HANDLE_KEY);
}

async function resumeCookie(page: Page): Promise<string | null> {
  const cookies = await page.context().cookies();
  return cookies.find((cookie) => cookie.name === RESUME_COOKIE)?.value ?? null;
}

function decodeResumeCookie(value: string | null): { rt?: string; em?: string } | null {
  if (!value) return null;
  try {
    return JSON.parse(
      Buffer.from(decodeURIComponent(value), "base64url").toString("utf8"),
    ) as { rt?: string; em?: string };
  } catch {
    return null;
  }
}

function youLink(page: Page) {
  return page.getByRole("link", { name: "You", exact: true }).first();
}

test.use({
  viewport: { width: 390, height: 844 },
  storageState: { cookies: [], origins: [] },
});

test.describe("account switch on one device", () => {
  test("a second account owns the device the moment it signs in", async ({ page }) => {
    const stub = await installAuthDoubles(page);
    await seedSignedIn(page, "A");

    await page.goto("/today");
    await expect
      .poll(async () => (await readDeviceIdentity(page)).handle, { timeout: 10_000 })
      .toBe(ACCOUNTS.A.handle);
    await expect
      .poll(async () => youLink(page).getAttribute("href"), { timeout: 10_000 })
      .toBe(`/u/${ACCOUNTS.A.handle}`);
    // The durable resume cookie is written by the real route, off the render
    // path, so poll rather than assume it landed with the first paint.
    await expect
      .poll(async () => decodeResumeCookie(await resumeCookie(page))?.rt, {
        timeout: 10_000,
      })
      .toBe(ACCOUNTS.A.refreshToken);

    // The founder's flow: sign out, then sign up as a second account in the
    // same browser. A's device artifacts must not survive B's arrival.
    await stub.signedInAs("B");
    await page.goto("/today");
    await page.waitForLoadState("domcontentloaded");

    await expect
      .poll(async () => (await readDeviceIdentity(page)).handle, { timeout: 10_000 })
      .toBe(ACCOUNTS.B.handle);
    await expect
      .poll(async () => youLink(page).getAttribute("href"), { timeout: 10_000 })
      .toBe(`/u/${ACCOUNTS.B.handle}`);
    await page.screenshot({ path: `${SHOTS}/3-switched-to-b.png` });

    // B's durable resume cookie replaced A's.
    await expect
      .poll(async () => decodeResumeCookie(await resumeCookie(page))?.rt, {
        timeout: 10_000,
      })
      .toBe(ACCOUNTS.B.refreshToken);
  });

  test("a second account with no handle yet is never called by the first one's name", async ({
    page,
  }) => {
    const stub = await installAuthDoubles(page);
    await seedSignedIn(page, "A");
    await page.goto("/today");
    await expect
      .poll(async () => (await readDeviceIdentity(page)).handle, { timeout: 10_000 })
      .toBe(ACCOUNTS.A.handle);

    // B exists but has claimed nothing. The stale handle must go anyway - an
    // unclaimed account owed a claim step is the case the old short-circuit
    // silently skipped.
    await stub.signedInAs("B");
    stub.setServerHandle(null);
    await page.goto("/today");
    await page.waitForLoadState("domcontentloaded");

    await expect
      .poll(async () => (await readDeviceIdentity(page)).handle, { timeout: 10_000 })
      .toBeNull();
    await expect
      .poll(async () => youLink(page).getAttribute("href"), { timeout: 10_000 })
      .toBe("/u/you");
    await page.screenshot({ path: `${SHOTS}/5-unclaimed-b.png` });
  });
});

test.describe("account switch on a desktop viewport", () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test("sign-out clears every device identity artifact", async ({ page }) => {
    const stub = await installAuthDoubles(page);
    await seedSignedIn(page, "A");

    // /social rather than /today: a Today card holds `opacity` below 1 while its
    // reveal animation runs, which makes that card a stacking context painting
    // over the nav popover. That is a real defect on /today and its own repair;
    // it is not the identity contract this spec is about.
    await page.goto("/social");
    await page.waitForLoadState("domcontentloaded");
    // The canonical read lands and owns the device handle.
    await expect
      .poll(async () => (await readDeviceIdentity(page)).handle, { timeout: 10_000 })
      .toBe(ACCOUNTS.A.handle);

    // Device-only artifacts the previous account left behind.
    await page.evaluate(() => {
      window.localStorage.setItem("pubmax_round_anonymous_identity_v1", "karan");
      window.localStorage.setItem("pubmax:identityNudge:pending:v1", "plan");
    });

    await page.screenshot({ path: `${SHOTS}/1-signed-in-as-a.png` });

    await stub.signedInAs(null);
    await page.getByRole("button", { name: /Account options/ }).first().click();
    await page
      .locator(".authAccountMenu")
      .getByRole("button", { name: "Sign out", exact: true })
      .click();

    await expect
      .poll(async () => (await readDeviceIdentity(page)).handle, { timeout: 10_000 })
      .toBeNull();
    const after = await readDeviceIdentity(page);
    expect(after.roundAnonymous).toBeNull();
    expect(after.nudgePending).toBeNull();
    await expect.poll(() => resumeCookie(page), { timeout: 10_000 }).toBeFalsy();
    await page.screenshot({ path: `${SHOTS}/2-signed-out.png` });
  });

  test("the desktop account menu follows the live session", async ({ page }) => {
    const stub = await installAuthDoubles(page);
    await seedSignedIn(page, "A");
    await page.goto("/today");
    await expect
      .poll(async () => (await readDeviceIdentity(page)).handle, { timeout: 10_000 })
      .toBe(ACCOUNTS.A.handle);

    await stub.signedInAs("B");
    await page.goto("/today");
    await page.waitForLoadState("domcontentloaded");

    await expect
      .poll(async () => (await readDeviceIdentity(page)).handle, { timeout: 10_000 })
      .toBe(ACCOUNTS.B.handle);
    await page.screenshot({ path: `${SHOTS}/6-desktop-switched.png` });

    // The account card names B, never A.
    await page.getByRole("button", { name: /Account options/ }).first().click();
    await expect(page.getByText(`@${ACCOUNTS.B.handle}`).first()).toBeVisible();
    await expect(page.getByText(`@${ACCOUNTS.A.handle}`, { exact: true })).toHaveCount(0);
    await page.screenshot({ path: `${SHOTS}/7-desktop-account-card-b.png` });

    // No link on the page still points at the previous account's profile.
    const hrefs = await page
      .locator('a[href^="/u/"]')
      .evaluateAll((nodes) => nodes.map((node) => node.getAttribute("href") ?? ""));
    expect(
      hrefs.filter((href) => href.split(/[?#]/)[0] === `/u/${ACCOUNTS.A.handle}`),
    ).toEqual([]);
  });
});
