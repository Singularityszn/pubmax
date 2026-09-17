"use client";

import type { SocialCrewPublicPreviewDTO } from "@/lib/socialCrew";
import { displayHandle } from "@/lib/handleDisplay";
import { crewStartsCaption } from "@/lib/socialCrewsUi";
import styles from "./crews.module.css";

export type PublicCrewJoinState = "none" | "pending" | "declined";

export default function PublicCrewPreview({
  preview,
  joinState,
  busy,
  problem,
  onAskToJoin,
}: {
  preview: SocialCrewPublicPreviewDTO;
  joinState: PublicCrewJoinState;
  busy: boolean;
  problem: string;
  onAskToJoin: () => void;
}) {
  const starts = crewStartsCaption(preview.startsAt);
  return (
    <>
      <header className={styles.crewPageHead}>
        <h1>{preview.title}</h1>
        <p className={styles.crewPageMeta}>
          <span>{displayHandle(preview.hostHandle)}</span>
          {starts ? <time dateTime={preview.startsAt}>{starts}</time> : null}
        </p>
      </header>

      <section aria-labelledby="public-crew-meeting-point">
        <h2 id="public-crew-meeting-point" className={styles.crewsTitle}>
          Meet at
        </h2>
        <p className={styles.crewsNote}>{preview.meetingPoint.name}</p>
      </section>

      {problem ? (
        <p className={styles.crewsProblem} role="alert">
          {problem}
        </p>
      ) : null}

      {joinState === "pending" ? (
        <p className={styles.crewsMuted} role="status">
          Request sent. The host decides.
        </p>
      ) : joinState === "declined" ? (
        <p className={styles.crewsMuted} role="status">
          The host said no to this one.
        </p>
      ) : (
        <section className={styles.crewsNotice}>
          <button
            type="button"
            className={`${styles.crewsButton} ${styles.crewsButtonPrimary}`}
            disabled={busy}
            onClick={onAskToJoin}
          >
            {busy ? "Working…" : "Ask to join"}
          </button>
        </section>
      )}
    </>
  );
}
