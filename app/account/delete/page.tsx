import type { Metadata } from "next";
import Link from "next/link";

import Kicker from "@/components/ui/kicker";
import {
  ACCOUNT_DELETION_LEAVES,
  ACCOUNT_DELETION_STAYS,
} from "@/lib/accountDeletion";
import { appPageTitle, metadataSiteName } from "@/lib/brandNaming";
import { CONTACT_EMAIL, CONTACT_MAILTO } from "@/lib/siteContact";

import "../../legal.css";

// /account/delete — the PUBLIC account-deletion page.
//
// Play Console asks for a URL anybody can open WITHOUT signing in, so this page
// is a server component with no session read and no client JavaScript. It
// describes the in-app path rather than offering a second delete door: a
// deletion control a stranger can reach is an account-takeover surface however
// it is worded, which is the same reasoning that keeps `SetAccountPassword`
// behind a session.
//
// The two lists are read from `lib/accountDeletion.ts`, the same module the
// in-app confirm step prints, so the public promise and the in-app one cannot
// drift apart.

const PAGE_TITLE = "Delete your account";
const PAGE_DESCRIPTION =
  "How to delete your PUBMAXX account from inside the app, what is removed, and what stays.";
const LAST_UPDATED = "6 October 2026";

export const metadata: Metadata = {
  title: PAGE_TITLE,
  description: PAGE_DESCRIPTION,
  alternates: { canonical: "/account/delete" },
  openGraph: {
    title: appPageTitle(PAGE_TITLE),
    description: PAGE_DESCRIPTION,
    url: "https://pubmaxxing.com/account/delete",
    siteName: metadataSiteName(),
    type: "website",
  },
};

export default function AccountDeletePage() {
  return (
    <main id="main" className="legalPage">
      {/* A reference page has no primary action (docs/design/LAUNCH_SCREENS.md),
          so the head is a kicker and the heading, never a Screen. */}
      <header className="legalHead">
        <Kicker>Your account</Kicker>
        <h1 className="legalTitle">{PAGE_TITLE}</h1>
        <p className="legalLede">
          You can delete your PUBMAXX account yourself, from inside the app or
          the site. It takes two taps and it cannot be undone.
        </p>
        <p className="legalUpdated">Last updated {LAST_UPDATED}</p>
      </header>

      <section className="legalSection" aria-labelledby="how">
        <h2 id="how" className="legalH2">How to delete it</h2>
        <ol className="legalList">
          <li>Sign in, then open the You tab.</li>
          <li>
            Go to Account settings and choose <strong>Delete account</strong>.
          </li>
          <li>
            Read what leaves and what stays, then choose{" "}
            <strong>Delete my account</strong>.
          </li>
        </ol>
        <p className="legalBody">
          You are signed out of the device straight away. The deletion itself is
          immediate, not a queued request.
        </p>
      </section>

      <section className="legalSection" aria-labelledby="leaves">
        <h2 id="leaves" className="legalH2">What is deleted</h2>
        <ul className="legalList">
          {ACCOUNT_DELETION_LEAVES.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      </section>

      <section className="legalSection" aria-labelledby="stays">
        <h2 id="stays" className="legalH2">What stays</h2>
        <ul className="legalList">
          {ACCOUNT_DELETION_STAYS.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
        <p className="legalBody">
          A price is an observation other drinkers rely on, so it stays when its
          author goes. Only the name leaves it.
        </p>
      </section>

      <section className="legalSection" aria-labelledby="help">
        <h2 id="help" className="legalH2">If you cannot sign in</h2>
        <p className="legalBody">
          Email{" "}
          <a href={CONTACT_MAILTO} className="legalLink">{CONTACT_EMAIL}</a> from
          the address on the account and say you want it deleted. We reply within
          30 days, as the{" "}
          <Link href="/privacy" className="legalLink">privacy notice</Link> says.
        </p>
      </section>
    </main>
  );
}
