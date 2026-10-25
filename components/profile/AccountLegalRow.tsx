// The legal and support row on the account surface.
//
// Keep privacy, terms and support available on the account surface. A person
// can open the app through an explicit link without seeing the Home footer.
// Store reviewers also need these links beside the account controls.
// The Drinkaware link explains responsible drinking in the UK.
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
          <Link href="/feedback">Send feedback</Link>
        </li>
        <li>
          <Link href="/updates">Updates</Link>
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
