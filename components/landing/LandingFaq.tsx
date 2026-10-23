// Three questions, two short sentences each at most, in the words a person
// would use at the bar (docs/VOICE.md).
//
// Captain 7 Sep 2026: "There should be an FAQ section where people understand
// how the app works and everything." The UX audit (16 Oct 2026) cut it from six
// to the three a stranger needs before a first tap: how it works, where the
// prices come from, and how to log one. Every answer states a fact the code or
// the dataset already backs, and the log answer names the button by the label
// the venue sheet really prints (`LOG_PRICE_DOOR_LABEL`, lib/pintTrust.ts), so
// the two cannot drift apart. __tests__/landingFaq.test.ts holds the count at
// three and the copy to the voice rules. The landing ships no FAQPage JSON-LD,
// so there is no second copy of these questions to keep in step.
//
// NOTHING HERE IS FOR SALE. First revenue comes from venues, never drinkers
// (AGENTS.md anti-goals), so the front door names no price a drinker would pay
// and collects no address for one.

import { BRAND_NAME } from "@/lib/brandNaming";
import { RECEIPT_REQUIRED_LINE } from "@/lib/pintDropReceipt";
import { LOG_PRICE_DOOR_LABEL } from "@/lib/pintTrust";

type Question = { id: string; question: string; answer: string };

export const LANDING_FAQ: readonly Question[] = [
  {
    id: "how-it-works",
    question: `How does ${BRAND_NAME} work?`,
    answer:
      "Find nearby pubs, compare listed pint prices and share a plan. Prices can change, so check at the bar.",
  },
  {
    id: "prices",
    question: "Where do the prices come from?",
    answer:
      "From published listings and drinkers logging what they paid. Each price names its publisher when recorded, or says one is missing, and drinker reports show their date.",
  },
  {
    id: "log-a-price",
    question: "How do I log a price?",
    answer:
      `Open a pub on the map, tap ${LOG_PRICE_DOOR_LABEL}, type what you paid and press Log it. ${RECEIPT_REQUIRED_LINE}`,
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
