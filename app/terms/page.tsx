import type { Metadata } from "next";
import Link from "next/link";

import { CONTACT_EMAIL, CONTACT_MAILTO } from "@/lib/siteContact";

import "../legal.css";

// /terms — plain-language terms of use. Server component, zero client JS.
// Sibling of /privacy: that page says what we do with data, this one says what
// each side is agreeing to. Same rule applies — describe the real product (free,
// no ads, over-18s, community-sourced prices that are observations rather than
// offers), never invent guarantees or a company that doesn't exist yet.

const PAGE_TITLE = "Terms of use";
const PAGE_DESCRIPTION =
  "The deal in plain language: what PUBMAXX is, what you can post, what prices on the map do and don't promise, and where our responsibility ends.";
const LAST_UPDATED = "29 July 2026";

export const metadata: Metadata = {
  title: PAGE_TITLE,
  description: PAGE_DESCRIPTION,
  alternates: { canonical: "/terms" },
  openGraph: {
    title: `${PAGE_TITLE} · PUBMAXXING`,
    description: PAGE_DESCRIPTION,
    url: "https://pubmaxxing.com/terms",
    siteName: "PUBMAXXING",
    type: "website",
  },
};

export default function TermsPage() {
  return (
    <main className="legalPage">
      <header className="legalHead">
        <p className="legalEyebrow">Terms of use</p>
        <h1 className="legalTitle">The deal, in plain English</h1>
        <p className="legalLede">
          PUBMAXX is free, carries no ads, and nobody can pay to rank. In return
          we ask you to use it honestly and not to treat a price on the map as a
          promise from the pub. That&rsquo;s most of it. The rest is below.
        </p>
        <p className="legalUpdated">Last updated {LAST_UPDATED}</p>
      </header>

      <section className="legalSection" aria-labelledby="who">
        <h2 id="who" className="legalH2">Who you&rsquo;re agreeing with</h2>
        <p className="legalBody">
          These terms are between you and Karan Manoharan, an individual based in
          London, UK, who runs pubmaxxing.com. Using the site means you accept
          them. If you don&rsquo;t, don&rsquo;t use it. Questions go to{" "}
          <a href={CONTACT_MAILTO} className="legalLink">{CONTACT_EMAIL}</a>.
        </p>
      </section>

      <section className="legalSection" aria-labelledby="what">
        <h2 id="what" className="legalH2">What PUBMAXX is</h2>
        <p className="legalBody">
          A map of pubs with prices on it, plus tools to plan a night with your
          mates. Prices come from three places: public sources we cite with a
          date, prices logged by people standing in the pub, and old prices read
          out of dated, sourced archives. That last lot is history. It is what a
          pint cost years ago, never a price for tonight, and it never moves the
          map. Heritage facts are cited, never invented. Nothing here is a
          booking service, and we are not the pub. We don&rsquo;t sell you
          drinks, take payment, or hold a table for you.
        </p>
      </section>

      <section className="legalSection" aria-labelledby="age">
        <h2 id="age" className="legalH2">Over-18s</h2>
        <p className="legalBody">
          The pub-crawl side of PUBMAXX is for adults. Don&rsquo;t use it if
          you&rsquo;re under 18. Nothing in the app is designed to encourage you
          to drink more. Know your limits, and know the facts at{" "}
          <a
            href="https://www.drinkaware.co.uk"
            target="_blank"
            rel="noreferrer"
            className="legalLink"
          >
            drinkaware.co.uk
          </a>
          . Getting home safely, and how much you drink on the way, is your call
          and your responsibility.
        </p>
      </section>

      <section className="legalSection" aria-labelledby="account">
        <h2 id="account" className="legalH2">Your account</h2>
        <p className="legalBody">
          Browsing does not require an account or analytics. First visit asks
          you to tap Allow or No thanks for optional anonymous analytics. You
          get the same app either way. If you allow them, we use a persistent
          device identifier and collect browser, operating system and device type,
          screen size, referrer and campaign details, plus app performance and
          the closed product events described in our privacy notice. PostHog
          deletes analytics events 12 months after collection and pseudonymous
          person and device records 12 months after their last activity. If you
          make an account, keep your sign-in to yourself, use a handle that
          isn&rsquo;t someone else&rsquo;s identity, and don&rsquo;t hand the
          account to anyone else. You can stop using it whenever you like, and
          ask us to delete it. See the{" "}
          <Link href="/privacy" className="legalLink">privacy notice</Link>.
        </p>
      </section>

      <section className="legalSection" aria-labelledby="posts">
        <h2 id="posts" className="legalH2">What you post</h2>
        <p className="legalBody">
          Prices, notes, photos, plans, stories: you keep ownership of all
          of it. By posting it you give us permission to store it, show it in the
          app, and use it as part of the price and heritage data the map is built
          from, including in aggregate figures like the Pint Index. That
          permission is free of charge, worldwide, and lasts as long as the
          content is up; delete the content, or ask us to, and it ends, except
          for anonymous aggregate figures already published and copies other
          people saved.
        </p>
        <p className="legalBody">
          When you post, you&rsquo;re telling us that:
        </p>
        <ul className="legalList">
          <li>It&rsquo;s yours to post, or you have permission to post it.</li>
          <li>
            The price is one you actually saw, at that pub, for that drink,
            around now, not a guess, a memory from last year, or a joke.
          </li>
          <li>
            Photos don&rsquo;t show people who&rsquo;d rather not be on a public
            map.
          </li>
        </ul>
      </section>

      <section className="legalSection" aria-labelledby="use">
        <h2 id="use" className="legalH2">Using it fairly</h2>
        <p className="legalBody">Don&rsquo;t:</p>
        <ul className="legalList">
          <li>
            Log prices you didn&rsquo;t see, or spray a figure across venues to
            move the map. Submissions are rate-limited and a price only reaches
            the map once a second, independent person backs it up.
          </li>
          <li>
            Post anything illegal, hateful, harassing, or that exposes
            someone&rsquo;s private details.
          </li>
          <li>
            Scrape at a volume that costs us money, hammer the API, or try to get
            around rate limits, sign-in, or moderation.
          </li>
          <li>
            Use the app to advertise, spam, or push a venue up the list. Nobody
            pays to rank, and that includes doing it by hand.
          </li>
          <li>Impersonate someone else, or pretend to be us.</li>
        </ul>
        <p className="legalBody">
          We can hide or remove content, and suspend an account, when
          something&rsquo;s clearly broken these rules. If you think we&rsquo;ve
          got it wrong, email us and say so. We&rsquo;d rather fix it than
          argue about it.
        </p>
      </section>

      <section className="legalSection" aria-labelledby="referrals">
        <h2 id="referrals" className="legalH2">Invites and referral milestones</h2>
        <p className="legalBody">
          You can share one account invite link. A referral counts only when
          someone follows it, signs up and makes a first accepted contribution.
          Self-referrals, second accounts made for yourself and circular
          referrals between two accounts do not count.
        </p>
        <p className="legalBody">
          Referral rewards are not active. We can record private edges and
          milestones, but those records do not grant access to paid features
          while we cannot reliably tie a contribution to a signed-in person and
          stop one person using several accounts. If that changes, these terms
          and the account surface will say what is granted before any reward
          goes live.
        </p>
      </section>

      <section className="legalSection" aria-labelledby="prices">
        <h2 id="prices" className="legalH2">Prices are observations, not offers</h2>
        <p className="legalBody">
          Every price on PUBMAXX is what someone saw, on a date we show you. Pubs
          change prices, run happy hours, charge differently on a match day, and
          make mistakes. So does everyone logging prices. A figure here is a good
          steer, not a quote, and the pub is under no obligation to honour it.
          <strong> Check at the bar.</strong>
        </p>
        <p className="legalBody">
          All of that is about the price a pub is charging now. Where we show
          what a pint used to cost, that figure is a dated record of the past,
          taken from a source we name and link. It says nothing about tonight,
          and we never let it stand in for the current price.
        </p>
        <p className="legalBody">
          Opening hours, transport times, heritage facts and weather come from
          third-party sources. We cite them and we don&rsquo;t make them up, but
          we can&rsquo;t promise they&rsquo;re current or complete.
        </p>
      </section>

      <section className="legalSection" aria-labelledby="asis">
        <h2 id="asis" className="legalH2">The app is provided as-is</h2>
        <p className="legalBody">
          PUBMAXX is free and is provided as-is. We work on it constantly, which
          means features change, move, or disappear, and the site will sometimes
          be down. We don&rsquo;t promise it will be available, uninterrupted,
          error-free, or that any particular pub, price or feature will still be
          there tomorrow.
        </p>
      </section>

      <section className="legalSection" aria-labelledby="liability">
        <h2 id="liability" className="legalH2">Where our responsibility ends</h2>
        <p className="legalBody">
          To the extent the law allows, we&rsquo;re not liable for what happens
          when you act on something you read here: a price that had changed, a
          pub that was shut, a route that took longer than you thought, or a
          night that went sideways. That includes lost money, lost time, and
          anything indirect.
        </p>
        <p className="legalBody">
          Nothing in these terms limits liability for death or personal injury
          caused by our negligence, for fraud, or for anything else the law
          doesn&rsquo;t let us exclude. If you&rsquo;re a consumer, your
          statutory rights under UK consumer law stand whatever this page says.
        </p>
      </section>

      <section className="legalSection" aria-labelledby="changes">
        <h2 id="changes" className="legalH2">Changes and endings</h2>
        <p className="legalBody">
          We may update these terms as the app changes; the date at the top moves
          when we do, and carrying on using the site means you accept the update.
          You can stop using PUBMAXX at any time. We may suspend or end access
          where these terms are being broken, or if we stop running the service.
        </p>
        <p className="legalBody">
          These terms are governed by the law of England and Wales, and the
          courts of England and Wales have jurisdiction.
        </p>
      </section>

      <section className="legalSection legalContact" aria-labelledby="contact">
        <h2 id="contact" className="legalH2">Get in touch</h2>
        <p className="legalBody">
          Anything about these terms, a takedown, or a moderation decision:
        </p>
        <p className="legalBody">
          <a href={CONTACT_MAILTO} className="legalLink legalContactEmail">
            {CONTACT_EMAIL}
          </a>
        </p>
        <p className="legalBody">
          See also our{" "}
          <Link href="/privacy" className="legalLink">privacy notice</Link> and{" "}
          <Link href="/about" className="legalLink">our story</Link>.
        </p>
      </section>
    </main>
  );
}
