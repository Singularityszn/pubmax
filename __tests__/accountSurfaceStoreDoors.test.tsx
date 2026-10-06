import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

// The three store-required doors on the account surface, held as rendered
// output rather than as a file list.
//
// GAP 1 — an in-app deletion control that states what leaves and what stays.
// GAP 3 — privacy, terms and the support contact reachable from INSIDE the
//         shell, which starts on /tonight and need never open `/`.
// GAP 4 — the You tab, signed out, offering ONE sign-in action that is a real
//         link, rather than three sentences and an in-page anchor onto itself.
//
// All three are what a store reviewer opens the account tab to find, and none of
// them is visible to a route test.

vi.mock("@/components/profile/PubmaxxAccountHub", () => ({
  default: () => createElement("div", null, "account hub"),
}));
vi.mock("@/components/wanted/WantedList", () => ({
  default: () => createElement("div", null, "wanted list"),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: () => undefined, push: () => undefined }),
}));

const sessionState = vi.hoisted(() => ({
  user: null as { id: string } | null,
  unresolved: false,
}));
vi.mock("@/components/auth/AuthProvider", () => ({
  useAuth: () => ({ user: sessionState.user, signOut: async () => undefined }),
}));
vi.mock("@/components/auth/useViewerSession", () => ({
  useViewerSession: () => ({
    phase: sessionState.unresolved
      ? "unresolved"
      : sessionState.user
        ? "signed-in"
        : "signed-out",
    signedIn: Boolean(sessionState.user),
    signedOut: !sessionState.user && !sessionState.unresolved,
    unresolved: sessionState.unresolved,
  }),
}));

import {
  YouSignedOutSurface,
  YOU_SIGN_IN_HREF,
} from "@/app/u/[handle]/ProfilePageClient";
import AccountExportCard from "@/components/profile/AccountExportCard";
import AccountLegalRow from "@/components/profile/AccountLegalRow";
import DeleteAccountCard from "@/components/profile/DeleteAccountCard";
import { ACCOUNT_EXPORT_LABEL, ACCOUNT_EXPORT_TITLE } from "@/lib/accountExport";
import {
  ACCOUNT_DELETION_CONFIRM_LABEL,
  ACCOUNT_DELETION_LEAVES,
  ACCOUNT_DELETION_OPEN_LABEL,
  ACCOUNT_DELETION_STAYS,
} from "@/lib/accountDeletion";
import { ANON_HANDLE_LABEL } from "@/lib/pintDropShared";
import { CONTACT_EMAIL } from "@/lib/siteContact";

beforeEach(() => {
  sessionState.user = null;
  sessionState.unresolved = false;
});

describe("the You tab's one sign-in action", () => {
  it("points the claim at /login rather than at an in-page anchor", () => {
    const html = renderToStaticMarkup(
      createElement(YouSignedOutSurface, { nightMemoriesInvite: false }),
    );

    // The anchor scrolled the reader to a restatement of the same invitation,
    // and the phone nav's own Sign in is hidden at 640px, so this link was the
    // only door and it led nowhere.
    expect(html).not.toContain('href="#account-settings"');
    expect(html).toContain("/login?mode=signin&amp;from=%2Fu%2Fyou");
    expect(html).toContain("Claim your @handle");
  });

  it("returns the reader to the You tab after signing in", () => {
    expect(YOU_SIGN_IN_HREF).toContain("from=%2Fu%2Fyou");
    expect(YOU_SIGN_IN_HREF).toContain("mode=signin");
  });

  it("keeps exactly one primary action on the surface", () => {
    const html = renderToStaticMarkup(
      createElement(YouSignedOutSurface, { nightMemoriesInvite: false }),
    );

    expect(html.match(/data-primary-action/g) ?? []).toHaveLength(1);
  });
});

describe("privacy, terms and support inside the shell", () => {
  it("carries every link the native shell can otherwise never reach", () => {
    const html = renderToStaticMarkup(createElement(AccountLegalRow));

    expect(html).toContain('href="/privacy"');
    expect(html).toContain('href="/terms"');
    expect(html).toContain('href="/account/delete"');
    expect(html).toContain("drinkaware.co.uk");
  });

  it("takes the address from the one contact module and never types it", () => {
    const html = renderToStaticMarkup(createElement(AccountLegalRow));

    expect(html).toContain(`mailto:${CONTACT_EMAIL}`);
  });
});

describe("the in-app account-deletion control", () => {
  it("says nothing at all until the live session answers", () => {
    sessionState.user = null;
    sessionState.unresolved = true;

    expect(renderToStaticMarkup(createElement(DeleteAccountCard))).toBe("");
  });

  it("offers nothing to a signed-out reader", () => {
    sessionState.user = null;

    expect(renderToStaticMarkup(createElement(DeleteAccountCard))).toBe("");
  });

  it("opens as one quiet control, not as the confirm step", () => {
    sessionState.user = { id: "user-1" };

    const html = renderToStaticMarkup(createElement(DeleteAccountCard));

    expect(html).toContain(ACCOUNT_DELETION_OPEN_LABEL);
    // The account of what happens belongs to the second beat.
    expect(html).not.toContain(ACCOUNT_DELETION_CONFIRM_LABEL);
    expect(html).not.toContain(ACCOUNT_DELETION_LEAVES[0]);
  });
});

describe("the account's own export door", () => {
  it("says nothing at all until the live session answers, and nothing to a stranger", () => {
    sessionState.user = null;
    sessionState.unresolved = true;
    expect(renderToStaticMarkup(createElement(AccountExportCard))).toBe("");

    sessionState.unresolved = false;
    expect(renderToStaticMarkup(createElement(AccountExportCard))).toBe("");
  });

  it("is one quiet control that names the file it prepares", () => {
    sessionState.user = { id: "user-1" };

    const html = renderToStaticMarkup(createElement(AccountExportCard));

    expect(html).toContain(ACCOUNT_EXPORT_TITLE);
    expect(html).toContain(ACCOUNT_EXPORT_LABEL);
    expect(html).toContain('id="export-account"');
    // It is a signed request the browser sends, never a bare link a stranger
    // could open: an <a href> cannot carry the bearer.
    expect(html).not.toContain('href="/api/account/export"');
  });
});

describe("what the deletion copy promises", () => {
  it("names both sides, because a person deleting an account is owed both", () => {
    expect(ACCOUNT_DELETION_LEAVES.length).toBeGreaterThan(0);
    expect(ACCOUNT_DELETION_STAYS.length).toBeGreaterThan(0);
  });

  it("keeps the handle reserved rather than promising it back", () => {
    // Migration 0078 leaves the profile row in place, so a promise that the
    // handle frees up would be a promise the database does not keep.
    expect(ACCOUNT_DELETION_STAYS.join(" ")).toContain("reserved");
  });

  it("says the name comes off the prices that stay, as migration 0150 does", () => {
    // `lib/retiredContributor.ts` swaps the handle for ANON_HANDLE_LABEL on
    // every public read, so a promise of attribution would be false.
    const stays = ACCOUNT_DELETION_STAYS.join(" ");
    expect(stays).not.toMatch(/attributed/i);
    expect(stays).toContain("comes off");
    expect(stays).toContain(ANON_HANDLE_LABEL);
  });
});
