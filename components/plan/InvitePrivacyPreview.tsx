"use client";

import type { InvitePrivacyPreviewDTO } from "@/lib/invitePrivacyPreview";
import planStyles from "@/app/plan/Plan.module.css";

/**
 * Pre-acceptance plan privacy preview (Wayfinder 4.2).
 *
 * Shown to any viewer who does not yet hold a member capability for this plan.
 * Contains NO venue names or ids -- the route stop list and mini-map are
 * withheld until the viewer joins the crew.
 */
export default function InvitePrivacyPreview({ preview }: { preview: InvitePrivacyPreviewDTO }) {
  const { hostName, areaName, startLabel, stopCount, vibeLabel, accessibilitySummary } = preview;

  return (
    <div className={planStyles.invitePreview} aria-labelledby="invite-preview-title">
      <p className={planStyles.planPage__eyebrow}>You&rsquo;ve been invited</p>
      <h2 id="invite-preview-title">
        {hostName} is planning a night out
      </h2>

      <dl className={planStyles.invitePreview__details}>
        <div className={planStyles.invitePreview__detail}>
          <dt>First pint</dt>
          <dd>{startLabel}</dd>
        </div>
        {areaName ? (
          <div className={planStyles.invitePreview__detail}>
            <dt>Area</dt>
            <dd>{areaName}</dd>
          </div>
        ) : null}
        <div className={planStyles.invitePreview__detail}>
          <dt>Stops</dt>
          <dd>{stopCount} {stopCount === 1 ? "pub" : "pubs"}</dd>
        </div>
        {vibeLabel ? (
          <div className={planStyles.invitePreview__detail}>
            <dt>Vibe</dt>
            <dd>{vibeLabel}</dd>
          </div>
        ) : null}
        {accessibilitySummary ? (
          <div className={planStyles.invitePreview__detail}>
            <dt>Accessibility</dt>
            <dd>{accessibilitySummary}</dd>
          </div>
        ) : null}
      </dl>

      <p className={planStyles.invitePreview__hint}>
        The full route reveals once you join the crew. No account needed.
      </p>

      <a href="#plan-crew-title" className={planStyles.invitePreview__join}>
        Join the crew to see the route
      </a>
    </div>
  );
}
