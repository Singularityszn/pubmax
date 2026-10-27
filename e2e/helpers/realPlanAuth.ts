import { randomBytes } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { expect, type Page } from "@playwright/test";

/** A genuine GoTrue session in the runner's private, disposable project. */
export async function seedRealPlanHost(page: Page): Promise<{ cleanup: () => Promise<void>; signOut: () => Promise<void> }> {
  const url = process.env.PW_DISPOSABLE_SUPABASE_URL;
  const publicKey = process.env.PW_DISPOSABLE_PUBLISHABLE_KEY;
  const serviceKey = process.env.PW_DISPOSABLE_SERVICE_ROLE_KEY;
  if (process.env.PW_DISPOSABLE_PLAN_AUTH !== "1" || !url || !publicKey || !serviceKey ||
    new URL(url).hostname !== "127.0.0.1") {
    throw new Error("Real Plan auth requires the disposable loopback runner.");
  }
  const options = { auth: { persistSession: false, autoRefreshToken: false } };
  const admin = createClient(url, serviceKey, options);
  const client = createClient(url, publicKey, options);
  const email = `plan-recovery-${randomBytes(12).toString("hex")}@example.test`;
  const password = randomBytes(32).toString("base64url");
  const created = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (created.error || !created.data.user) throw new Error("Disposable host creation failed.");
  const userId = created.data.user.id;
  const cleanup = async () => {
    const deleted = await admin.auth.admin.deleteUser(userId);
    if (deleted.error) throw new Error("Disposable host cleanup failed.");
  };
  try {
    const signedIn = await client.auth.signInWithPassword({ email, password });
    if (signedIn.error || !signedIn.data.session) throw new Error("Disposable host sign-in failed.");
    const verified = await admin.auth.getUser(signedIn.data.session.access_token);
    if (verified.error || verified.data.user?.id !== userId) {
      throw new Error("GoTrue did not verify the disposable host token.");
    }
    const storageKey = `sb-${new URL(url).hostname.split(".")[0]}-auth-token`;
    await page.addInitScript(({ storageKey, session }) => {
      // Seed only the first document. A later sign-out must remain signed out.
      if (!sessionStorage.getItem("plan-real-auth-seeded")) {
        localStorage.setItem(storageKey, JSON.stringify(session));
        sessionStorage.setItem("plan-real-auth-seeded", "1");
      }
    }, { storageKey, session: signedIn.data.session });
    return {
      cleanup,
      signOut: async () => {
        const result = await client.auth.signOut({ scope: "global" });
        if (result.error) throw new Error("Disposable host sign-out failed.");
        // The fixture signs out through real GoTrue, then removes this browser's
        // local and durable resume state. This is not UI sign-out acceptance.
        await page.evaluate(() => window.localStorage.clear());
        await page.context().clearCookies({ name: "pubmax_session_resume" });
      },
    };
  } catch (error) {
    await cleanup();
    throw error;
  }
}

/** A new real account must claim its handle before using the Plan composer. */
export async function completeRealPlanHostOnboarding(page: Page): Promise<void> {
  await page.goto("/plan");
  await expect(page.getByRole("button", { name: /^Account options for / })).toBeVisible();
  // Every account from seedRealPlanHost is new. Require the real prerequisite,
  // rather than racing an isVisible probe that could skip a late modal.
  const dialog = page.getByRole("dialog", { name: "Let's get you in", exact: true });
  await expect(dialog).toBeVisible();
  await dialog.getByRole("textbox", { name: "Your handle", exact: true })
    .fill(`plan_test_${randomBytes(6).toString("hex")}`);
  await expect(dialog.getByText("Handle available.", { exact: true })).toBeVisible();
  const claimButton = dialog.getByRole("button", { name: "Claim handle", exact: true });
  await expect(claimButton).toBeEnabled();
  const [claimed] = await Promise.all([
    page.waitForResponse((response) => response.request().method() === "POST"
      && new URL(response.url()).pathname === "/api/identity/onboarding"),
    claimButton.click(),
  ]);
  expect(claimed.ok(), "the genuine account claims its public handle").toBe(true);
  await expect(dialog).toBeHidden();
}
