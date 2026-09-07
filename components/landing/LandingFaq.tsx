"use client";

import { useState, type FormEvent } from "react";

import { CONTACT_EMAIL } from "@/lib/siteContact";
import { trackEvent } from "@/lib/analytics";

// Six questions and one paragraph each, in the words a person would use at the
// bar (docs/VOICE.md).
//
// Captain 7 Sep 2026: "There should be an FAQ section where people understand
// how the app works and everything." Every answer here states a fact the code
// or the dataset already backs: the two price lanes, the composer's own photo
// rule, what /today and /tonight read, that every listed price we hold is a
// London one, and that the web app installs to a home screen today.
// __tests__/landingFaq.test.ts holds the count at six and the copy to the
// voice rules.
//
// THE PRO LINE STORES NOTHING. A drinker pays for nothing today (AGENTS.md,
// "first revenue comes from venues"), so the waitlist is a single field that
// opens the reader's own mail app addressed to the support inbox. There is no
// endpoint, no table and no payment path behind it.

/** The one price a Pro subscription is expected to carry, when there is one. */
export const PRO_PRICE_LINE = "Pro is coming, at about £9.99 a month.";

type Question = { id: string; question: string; answer: string };

export const LANDING_FAQ: readonly Question[] = [
  {
    id: "how-it-works",
    question: "How does PUBMAXXING work?",
    answer:
      "Say where you are and we show what a pint costs at the pubs around you, cheapest first. Each figure carries the day it was collected, and names the publisher when the record has one. Nothing else sets the order, and no pub can pay to sit higher.",
  },
  {
    id: "prices",
    question: "Where do the prices come from?",
    answer:
      "Two places. A pub's own published price list, which we name and link beside the figure. And drinkers, who log what they paid on the day they paid it. When no publisher is recorded for a price, the price says so. We would rather leave a gap than invent a figure.",
  },
  {
    id: "log-a-price",
    question: "How do I log a price?",
    answer:
      "Open a pub on the map and press the price door. Type what you paid and which drink it was, then press Log it. A photo of the bill or the pint is optional. Photos and notes are public and can show people, so only add one you are happy to share.",
  },
  {
    id: "today-tonight",
    question: "What is on today and tonight?",
    answer:
      "Today reads the London weather and says what sort of drinking day it is. Tonight lists what is on across the city through the evening, from published listings. Both cards near the top of this page stamp the day they speak for, so you can tell a fresh answer from a held one.",
  },
  {
    id: "outside-london",
    question: "Does it work outside London?",
    answer:
      "Not for prices yet. Every listed price we hold today is a London one. The map opens in eleven other UK cities, and a pub there stays without a price until somebody logs the first one.",
  },
  {
    id: "app",
    question: "Is there an app?",
    answer:
      "This site installs to your home screen today. Open it in your phone browser and choose Add to Home Screen, and it opens full screen from then on. We are building the App Store and Play Store versions now.",
  },
];

export default function LandingFaq() {
  const [email, setEmail] = useState("");

  function joinWaitlist(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const address = email.trim();
    if (!address) return;
    trackEvent("landing_cta_clicked", { target: "pro-waitlist" });
    // No endpoint and no table: the reader's own mail app carries the address.
    const subject = encodeURIComponent("Pro waitlist");
    const body = encodeURIComponent(`Put ${address} on the Pro waitlist.`);
    window.location.href = `mailto:${CONTACT_EMAIL}?subject=${subject}&body=${body}`;
  }

  return (
    <section className="lpFaq" id="faq" aria-labelledby="lp-faq-title">
      <h2 className="lpFaqTitle" id="lp-faq-title">
        Questions people ask
      </h2>
      <dl className="lpFaqList">
        {LANDING_FAQ.map((entry) => (
          <div key={entry.id} className="lpFaqRow">
            <dt className="lpFaqQuestion">{entry.question}</dt>
            <dd className="lpFaqAnswer">{entry.answer}</dd>
          </div>
        ))}
      </dl>

      <div className="lpPro">
        <p className="lpProLine">
          {PRO_PRICE_LINE} Everything on this page stays free, and a drinker pays
          for nothing today.
        </p>
        <form className="lpProForm" onSubmit={joinWaitlist}>
          <label className="lpProLabel" htmlFor="lp-pro-email">
            Email
          </label>
          <input
            id="lp-pro-email"
            className="lpProInput"
            type="email"
            name="email"
            autoComplete="email"
            placeholder="you@example.com"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
          />
          <button className="lpProSubmit" type="submit">
            Tell me when Pro lands
          </button>
        </form>
      </div>
    </section>
  );
}
