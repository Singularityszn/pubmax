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
// NOTHING HERE IS FOR SALE. First revenue comes from venues, never drinkers
// (AGENTS.md anti-goals), so the front door names no price a drinker would pay
// and collects no address for one.

import { RECEIPT_REQUIRED_LINE } from "@/lib/pintDropReceipt";

type Question = { id: string; question: string; answer: string };

export const LANDING_FAQ: readonly Question[] = [
  {
    id: "how-it-works",
    question: "How does PUBMAXXING work?",
    answer:
      "Say where you are and we show what a pint costs at the pubs around you, cheapest first. Each figure shows the day it was collected, and names the publisher when the record has one. Nothing else sets the order, and no pub can pay to sit higher.",
  },
  {
    id: "prices",
    question: "Where do the prices come from?",
    answer:
      "Two places. A pub's own published price list, which we name and link beside the figure. And drinkers, who log what they paid on the day they paid it. When no publisher is recorded for a price, the price says so. We'd rather leave a gap than invent a figure.",
  },
  {
    id: "log-a-price",
    question: "How do I log a price?",
    answer:
      `Open a pub on the map and press the price door. Type what you paid and which drink it was, then press Log it. ${RECEIPT_REQUIRED_LINE} A photo of the pint is optional. Photos and notes are public and can show people, so only add one you're happy to share.`,
  },
  {
    id: "today-tonight",
    question: "What's on today and tonight?",
    answer:
      "Today reads the London weather and says what sort of drinking day it is. Tonight lists what is on across the city through the evening, from published listings. Both cards near the top of this page show the day they cover, so you can tell a fresh answer from an old one.",
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
      "This site installs to your home screen today. Open it in your phone browser and choose Add to Home Screen, and it opens full screen from then on. We're building the App Store and Play Store versions now.",
  },
];

export default function LandingFaq() {
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
    </section>
  );
}
