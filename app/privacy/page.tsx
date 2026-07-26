import type { Metadata } from "next";
import Link from "next/link";

import { CONTACT_EMAIL, CONTACT_MAILTO } from "@/lib/siteContact";

import "../legal.css";

// /privacy — the public privacy notice. Server component, zero client JS.
//
// HOUSE RULE, same as every other surface: this page describes what the code
// actually does, and nothing else. Every claim below is checkable in the repo —
// the consent toggle (components/profile/PubmaxxAccountHub.tsx), the event
// registry and its gates (lib/analyticsEvents.ts, app/api/events/route.ts),
// the browser SDK config (lib/posthogClient.ts), the first-party ingest proxy
// (app/ingest/[...path]/route.ts), the hashed-actor derivation (lib/supabase.ts
// hashIp/hashActor) used by app/api/price-submit/route.ts, and the sign-in
// paths in components/auth/AuthProvider.tsx. If one of those changes, this page
// changes in the same commit. Do NOT add practices we don't have, certifications
// we don't hold, or a DPO we haven't appointed.

const PAGE_TITLE = "Privacy";
const PAGE_DESCRIPTION =
  "What PUBMAXX collects, why, who else sees it, how long we keep it, and how to get it deleted. Written against what the app actually does.";
const LAST_UPDATED = "26 July 2026";

export const metadata: Metadata = {
  title: PAGE_TITLE,
  description: PAGE_DESCRIPTION,
  alternates: { canonical: "/privacy" },
  openGraph: {
    title: `${PAGE_TITLE} · PUBMAXXING`,
    description: PAGE_DESCRIPTION,
    url: "https://pubmaxxing.com/privacy",
    siteName: "PUBMAXXING",
    type: "website",
  },
};

export default function PrivacyPage() {
  return (
    <main className="legalPage">
      <header className="legalHead">
        <p className="legalEyebrow">Privacy</p>
        <h1 className="legalTitle">What we collect, and what we don&rsquo;t</h1>
        <p className="legalLede">
          You can browse the whole map, every price and every historic pub,
          without an account and without telling us anything about yourself.
          Everything below is what happens when you go further than that.
        </p>
        <p className="legalUpdated">Last updated {LAST_UPDATED}</p>
      </header>

      <section className="legalSection" aria-labelledby="short">
        <h2 id="short" className="legalH2">The short version</h2>
        <ul className="legalPanelList">
          <li>
            <strong>No account needed to look.</strong>{" "}Browsing is anonymous.
            We don&rsquo;t ask who you are to show you the price of a pint.
          </li>
          <li>
            <strong>Analytics are off until you switch them on.</strong>{" "}Nothing
            is measured about your usage unless you tap Allow in your account
            settings, and you can turn it back off in the same place.
          </li>
          <li>
            <strong>We never store your IP address.</strong>{" "}Where we need to
            tell one device from another (rate limits, stopping one person
            logging the same price twice) we store a salted hash of it, never
            the address itself.
          </li>
          <li>
            <strong>We don&rsquo;t sell anything to anyone.</strong>{" "}No ads, no
            data sales, no ad networks, no advertising trackers on the site.
          </li>
          <li>
            <strong>Your nights are yours.</strong>{" "}Night Memories and private
            plans are not public unless you choose to share them.
          </li>
        </ul>
      </section>

      <section className="legalSection" aria-labelledby="who">
        <h2 id="who" className="legalH2">Who&rsquo;s responsible</h2>
        <p className="legalBody">
          PUBMAXXING is run by Karan Manoharan, an individual based in London,
          UK. There is no company behind it yet, so for UK GDPR purposes the
          data controller is that individual, reachable at{" "}
          <a href={CONTACT_MAILTO} className="legalLink">{CONTACT_EMAIL}</a>. We
          have not appointed a Data Protection Officer, because at this size the
          law doesn&rsquo;t require one. Mail to that address reaches a person,
          not a queue.
        </p>
      </section>

      <section className="legalSection" aria-labelledby="collect">
        <h2 id="collect" className="legalH2">What we collect</h2>

        <h3 className="legalH3">If you just browse</h3>
        <p className="legalBody">
          Nothing you type, and no account. Our hosting provider records the
          ordinary technical detail every web server sees when it serves a page:
          the request, the time, the browser type and the IP address it came
          from. That is how the site gets served and how abuse gets stopped.
          Map tiles are fetched by your browser directly from the tile hosts
          named below, so those hosts see your IP address the same way any
          website you visit does.
        </p>

        <h3 className="legalH3">If you make an account</h3>
        <p className="legalBody">
          Sign-in is handled by Supabase, using either an emailed magic link or
          Google or Microsoft sign-in. That means we hold your email address,
          plus whatever you choose to put on your profile: a handle, a display
          name, an avatar, a home city, a short bio. If you connect an external
          social profile (X, Instagram, TikTok) we store the account details you
          connected and any provider tokens encrypted at rest.
        </p>

        <h3 className="legalH3">What you post</h3>
        <p className="legalBody">
          Pint Drops (a price, a note, sometimes a photo), plans and crawl
          routes, presence taps (&ldquo;I&rsquo;m here tonight&rdquo;), ratings,
          messages to other people, and Night Memories. We keep these because
          they are the product. A price with no date and no source is worth
          nothing. Presence is always a deliberate tap; the app never
          tracks your location in the background.
        </p>

        <h3 className="legalH3">Community price submissions</h3>
        <p className="legalBody">
          Anyone can log tonight&rsquo;s price without an account. We store the
          venue, the drink category, the price and the time. We also store an
          opaque device token derived server-side by salted SHA-256 hashing of
          your IP address, never the address itself. That token exists so
          one device can replace its own earlier entry instead of stacking
          duplicates, and so a single device can&rsquo;t repaint the map on its
          own. It can&rsquo;t be reversed back into an IP address, and we
          don&rsquo;t use it to build a profile of you.
        </p>

        <h3 className="legalH3">Location</h3>
        <p className="legalBody">
          &ldquo;Find my pint&rdquo; asks your browser for your location. The
          coordinates are used in your browser to rank nearby pubs and are not
          sent to us or stored anywhere. Say no and the app falls back to
          picking an area.
        </p>

        <h3 className="legalH3">Analytics, only with consent</h3>
        <p className="legalBody">
          Usage analytics are off by default. Turning them on is an explicit tap
          under <strong>Anonymous usage analytics</strong>{" "}in your PUBMAXX
          account settings, and the same control turns them back off. While
          they&rsquo;re on:
        </p>
        <ul className="legalList">
          <li>
            We send a closed, named list of product events (things like
            &ldquo;a plan was accepted&rdquo;) with allow-listed simple values.
            The server re-checks every event against the same list and drops
            anything it doesn&rsquo;t recognise.
          </li>
          <li>
            Events carry a random identifier generated in your browser and a
            coarse page path with no query string. No account, handle, email,
            message content, free text, or precise location is attached, and
            person profiles are switched off on the analytics provider.
          </li>
          <li>
            The browser analytics SDK is limited to counting anonymous crash
            types: the error message itself is redacted before it leaves your
            browser. Session recording, autocapture, heatmaps, click tracking
            and surveys are all disabled.
          </li>
          <li>
            Analytics requests go through pubmaxxing.com rather than straight to
            the provider, and that proxy forwards only the request body and
            content type: no cookies, no sign-in headers, no referrer,
            and no forwarded IP address.
          </li>
          <li>
            If your browser sends a Do Not Track signal we skip analytics
            regardless, and the server honours the same signal.
          </li>
          <li>
            Turning consent off deletes the browser analytics identifier and
            stops both the product events and the hosting provider&rsquo;s
            pageview counter.
          </li>
        </ul>

        <h3 className="legalH3">Things that aren&rsquo;t about you</h3>
        <p className="legalBody">
          Pub locations, opening hours, heritage facts, scraped and sourced
          prices, and the weather all come from public data. None of it is
          personal data, and requests for it are made by our server, not by
          your browser.
        </p>
      </section>

      <section className="legalSection" aria-labelledby="why">
        <h2 id="why" className="legalH2">Why we&rsquo;re allowed to</h2>
        <p className="legalBody">
          In UK GDPR terms, in plain language:
        </p>
        <ul className="legalList">
          <li>
            <strong>Because you asked us to (contract).</strong>{" "}Holding your
            account, your plans, your messages and your saved nights is the
            service you signed up for.
          </li>
          <li>
            <strong>Because it&rsquo;s a fair thing to do (legitimate
            interests).</strong>{" "}Keeping community prices with their dates and
            device tokens, rate-limiting writes, and keeping server logs is how
            the map stays honest and the site stays up. We&rsquo;ve kept it to
            the minimum that works.
          </li>
          <li>
            <strong>Because you said yes (consent).</strong>{" "}Usage analytics,
            push notifications and the email digest are consent-only, and you
            can withdraw consent at any time without losing the rest of the
            app.
          </li>
        </ul>
      </section>

      <section className="legalSection" aria-labelledby="cookies">
        <h2 id="cookies" className="legalH2">Cookies and what sits on your device</h2>
        <p className="legalBody">
          We don&rsquo;t use advertising or cross-site tracking cookies, and
          there is no ad network on the site. What we do keep in your own
          browser storage:
        </p>
        <ul className="legalList">
          <li>
            A sign-in session, if you signed in, so you stay signed in. It lives
            in your browser and refreshes in the background.
          </li>
          <li>
            Your analytics choice. Until you tap Allow, no analytics identifier
            exists at all; withdrawing consent removes it again.
          </li>
          <li>
            Preferences and app state: theme, your device night profile,
            what you&rsquo;ve already been shown once. These never leave your
            device unless you sign in and choose to bring them to your account.
          </li>
        </ul>
        <p className="legalBody">
          Because nothing non-essential is set before you agree to it, the
          consent control is a normal setting in your account rather than a
          banner in front of the map.
        </p>
      </section>

      <section className="legalSection" aria-labelledby="third">
        <h2 id="third" className="legalH2">Who else touches it</h2>
        <p className="legalBody">
          We keep the list short on purpose. Each of these acts as a processor
          for us, or is only reached when you actively use the feature.
        </p>
        <dl className="legalRows">
          <div className="legalRow">
            <dt>Supabase</dt>
            <dd>
              Database, sign-in and file storage, on their EU region. Holds your
              account, your posts and your community price rows.
            </dd>
          </div>
          <div className="legalRow">
            <dt>Vercel</dt>
            <dd>
              Hosting and CDN. Serves every page, and keeps short-lived request
              logs that include IP addresses. Also provides the pageview counter
              that stays disabled until you consent to analytics.
            </dd>
          </div>
          <div className="legalRow">
            <dt>PostHog (EU)</dt>
            <dd>
              Product analytics, EU project, consent-gated, anonymous only. No
              person profiles, no session recordings, and no identify calls tying
              events to your account.
            </dd>
          </div>
          <div className="legalRow">
            <dt>Map tile hosts</dt>
            <dd>
              OpenFreeMap and CARTO serve the base map straight to your browser,
              so they see your IP address while you pan the map. Map data is
              &copy; OpenStreetMap contributors.
            </dd>
          </div>
          <div className="legalRow">
            <dt>AI features</dt>
            <dd>
              If you ask The Landlord about a pub, or talk to Pub Pal, the text
              or audio of that request goes to the model provider that answers
              it (OpenRouter, and ElevenLabs for voice) and nothing else about
              you goes with it.
            </dd>
          </div>
          <div className="legalRow">
            <dt>Email and push</dt>
            <dd>
              If you opt in to the weekly digest or to notifications, your email
              address goes to our email provider, and a push subscription is held
              by your own browser&rsquo;s push service.
            </dd>
          </div>
        </dl>
        <p className="legalBody">
          We don&rsquo;t sell personal data, and we don&rsquo;t share it with
          advertisers or data brokers. We&rsquo;ll only hand something over to
          authorities if we&rsquo;re legally required to.
        </p>
      </section>

      <section className="legalSection" aria-labelledby="keep">
        <h2 id="keep" className="legalH2">How long we keep it</h2>
        <ul className="legalList">
          <li>
            <strong>Your account and what you posted:</strong>{" "}until you delete
            it, or ask us to. Ask, and we&rsquo;ll delete the account and the
            personal content attached to it within 30 days.
          </li>
          <li>
            <strong>Community prices:</strong>{" "}the observation itself stays, so
            the price history stays honest, but it is already anonymous:
            a venue, a drink, a figure, a date and an unreversible device token.
          </li>
          <li>
            <strong>Hidden or reported content:</strong>{" "}photos attached to a
            removed post are purged from storage when the post is taken down.
          </li>
          <li>
            <strong>Analytics events:</strong>{" "}held by PostHog under their EU
            project retention. They carry no account identity, so they
            can&rsquo;t be traced back to you after the fact, which also
            means we can&rsquo;t pick your events out to delete them
            individually.
          </li>
          <li>
            <strong>Server and rate-limit records:</strong>{" "}short-lived, and
            keyed to hashes rather than IP addresses.
          </li>
        </ul>
      </section>

      <section className="legalSection" aria-labelledby="rights">
        <h2 id="rights" className="legalH2">Your rights</h2>
        <p className="legalBody">
          Under UK GDPR you can ask us to show you what we hold about you,
          correct it, delete it, hand it over in a portable form, restrict what
          we do with it, or object to it. You can also withdraw analytics
          consent whenever you like, in the app, without asking us.
        </p>
        <p className="legalBody">
          Email{" "}
          <a href={CONTACT_MAILTO} className="legalLink">{CONTACT_EMAIL}</a>{" "}
          and say what you want. We&rsquo;ll reply within 30 days, and it
          doesn&rsquo;t cost anything. If we can&rsquo;t verify that the account
          is yours we&rsquo;ll say so rather than hand your data to someone else.
        </p>
        <p className="legalBody">
          If you think we&rsquo;ve got it wrong, you can complain to the
          Information Commissioner&rsquo;s Office at{" "}
          <a
            href="https://ico.org.uk"
            target="_blank"
            rel="noreferrer"
            className="legalLink"
          >
            ico.org.uk
          </a>
          . We&rsquo;d rather you told us first so we can fix it.
        </p>
      </section>

      <section className="legalSection" aria-labelledby="age">
        <h2 id="age" className="legalH2">Age</h2>
        <p className="legalBody">
          PUBMAXX is for over-18s. We don&rsquo;t knowingly hold data about
          anyone younger, and if you tell us we have, we&rsquo;ll delete it.
        </p>
      </section>

      <section className="legalSection" aria-labelledby="changes">
        <h2 id="changes" className="legalH2">If this changes</h2>
        <p className="legalBody">
          When what the app does changes, this page changes with it and the date
          at the top moves. If a change is significant, like a new processor or a
          new category of data, we&rsquo;ll say so in the app rather than
          quietly editing the text.
        </p>
      </section>

      <section className="legalSection legalContact" aria-labelledby="contact">
        <h2 id="contact" className="legalH2">Get in touch</h2>
        <p className="legalBody">
          Privacy questions, data requests, or anything you think this page gets
          wrong:
        </p>
        <p className="legalBody">
          <a href={CONTACT_MAILTO} className="legalLink legalContactEmail">
            {CONTACT_EMAIL}
          </a>
        </p>
        <p className="legalBody">
          See also our <Link href="/terms" className="legalLink">terms of use</Link>{" "}
          and <Link href="/about" className="legalLink">our story</Link>.
        </p>
      </section>
    </main>
  );
}
