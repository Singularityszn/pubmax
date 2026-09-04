// The legal and support row on the account surface.
//
// WHY IT IS HERE AND NOT ONLY IN THE FOOTER: the native shell starts on
// `/tonight` (`SHELL_START_PATH` in `lib/entryDecision.ts`) and the phone nav
// carries no More menu, so a person can use the app for weeks and never open
// `/`, which is the one page that holds these links. Play requires the privacy
// notice to be reachable inside the app, Apple expects a reviewer to find it,
// and for a product about alcohol in the UK the Drinkaware link is owed on its
// own merits.
//
// The address is `lib/siteContact.ts` and is never typed here, so moving to a
// company inbox stays the one-line change that module is built for.

import Link from "next/link";

import { CONTACT_EMAIL, CONTACT_MAILTO } from "@/lib/siteContact";

export default function AccountLegalRow(): React.JSX.Element {
  return (
    <section className="accountLegalRow" aria-labelledby="account-legal-title">
      <h3 id="account-legal-title">Privacy, terms and support</h3>
      <ul className="accountLegalLinks">
        <li>
          <Link href="/privacy">Privacy notice</Link>
        </li>
        <li>
          <Link href="/terms">Terms of use</Link>
        </li>
        <li>
          <Link href="/account/delete">Deleting your account</Link>
        </li>
        <li>
          <a href={CONTACT_MAILTO}>{CONTACT_EMAIL}</a>
        </li>
        <li>
          <a href="https://www.drinkaware.co.uk" rel="noreferrer">
            drinkaware.co.uk
          </a>
        </li>
      </ul>
      <p className="accountLegalNote">
        PUBMAXX is for over-18s. Drink responsibly.
      </p>
    </section>
  );
}
