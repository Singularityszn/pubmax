import type { Metadata } from "next";
import Link from "next/link";

import SiteNav from "@/components/nav/SiteNav";
import Screen from "@/components/ui/screen";
import { CONTACT_EMAIL, CONTACT_MAILTO } from "@/lib/siteContact";

import "./feedback.css";

const FEEDBACK_SUBJECT = "PUBMAXX feedback";
const FEEDBACK_MAILTO = `${CONTACT_MAILTO}?subject=${encodeURIComponent(FEEDBACK_SUBJECT)}`;

export const metadata: Metadata = {
  title: "Send feedback",
  description: "Tell us what needs fixing or what would make PUBMAXX more useful.",
  alternates: { canonical: "/feedback" },
};

export default function FeedbackPage() {
  return (
    <>
      <SiteNav />
      <Screen
        as="main"
        id="main"
        className="feedbackPage"
        kicker="Feedback"
        title="Tell us what needs a fix."
        titleId="feedback-title"
        lede="Something broken, missing or getting in your way? Tell us."
        primary={<a href={FEEDBACK_MAILTO}>Open email draft</a>}
        secondary={<Link href="/u/you">Back to You</Link>}
      >
        <p className="feedbackNote">
          You choose what to write and when to send it. We don&rsquo;t add your
          account details, location or page address to the draft.
        </p>
        <section className="feedbackFallback" aria-labelledby="feedback-fallback-title">
          <h2 id="feedback-fallback-title">No email app?</h2>
          <p>
            Copy this address into the email service you use, with the subject
            &ldquo;{FEEDBACK_SUBJECT}&rdquo;.
          </p>
          <p className="feedbackEmail">{CONTACT_EMAIL}</p>
          <p>
            Say what you tried and what happened. If it helps, name the page,
            such as Map or Plan. Leave out passwords and private details.
          </p>
        </section>
      </Screen>
    </>
  );
}
