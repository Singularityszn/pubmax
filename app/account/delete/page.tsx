import type { Metadata } from "next";
import Link from "next/link";

import Kicker from "@/components/ui/kicker";
import {
  ACCOUNT_DELETION_LEAVES,
  ACCOUNT_DELETION_STAYS,
} from "@/lib/accountDeletion";
import { appPageTitle, metadataSiteName } from "@/lib/brandNaming";
import { CONTACT_EMAIL, CONTACT_MAILTO } from "@/lib/siteContact";

import styles from "../../Legal.module.css";

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
const LAST_UPDATED = "4 September 2026";

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
    <main id="main" className={styles.legalPage}>
      {/* A reference page has no primary action (docs/design/LAUNCH_SCREENS.md),
          so the head is a kicker and the heading, never a Screen. */}
      <header className={styles.legalHead}>
        <Kicker>Your account</Kicker>
        <h1 className={styles.legalTitle}>{PAGE_TITLE}</h1>
        <p className={styles.legalLede}>
          You can delete your PUBMAXX account yourself, from inside the app or
          the site. It takes two taps and it cannot be undone.
        </p>
        <p className={styles.legalUpdated}>Last updated {LAST_UPDATED}</p>
      </header>

      <section className={styles.legalSection} aria-labelledby="how">
        <h2 id="how" className={styles.legalH2}>How to delete it</h2>
        <ol className={styles.legalList}>
          <li>Sign in, then open the You tab.</li>
          <li>
            Go to Account settings and choose <strong>Delete account</strong>.
          </li>
          <li>
            Read what leaves and what stays, then choose{" "}
            <strong>Delete my account</strong>.
          </li>
        </ol>
        <p className={styles.legalBody}>
          You are signed out of the device straight away. The deletion itself is
          immediate, not a queued request.
        </p>
      </section>

      <section className={styles.legalSection} aria-labelledby="leaves">
        <h2 id="leaves" className={styles.legalH2}>What is deleted</h2>
        <ul className={styles.legalList}>
          {ACCOUNT_DELETION_LEAVES.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      </section>

      <section className={styles.legalSection} aria-labelledby="stays">
        <h2 id="stays" className={styles.legalH2}>What stays</h2>
        <ul className={styles.legalList}>
          {ACCOUNT_DELETION_STAYS.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
        <p className={styles.legalBody}>
          A price is an observation other drinkers rely on, so it stays on the
          map under the handle that logged it. The handle itself is reserved for
          good, which is what stops the record naming somebody else later.
        </p>
      </section>

      <section className={styles.legalSection} aria-labelledby="help">
        <h2 id="help" className={styles.legalH2}>If you cannot sign in</h2>
        <p className={styles.legalBody}>
          Email{" "}
          <a href={CONTACT_MAILTO} className={styles.legalLink}>{CONTACT_EMAIL}</a> from
          the address on the account and say you want it deleted. We reply within
          30 days, as the{" "}
          <Link href="/privacy" className={styles.legalLink}>privacy notice</Link> says.
        </p>
      </section>
    </main>
  );
}
