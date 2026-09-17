import Link from "next/link";
import type { ReactNode } from "react";

import styles from "./socialViewerState.module.css";

export type SocialViewerPhase = "unresolved" | "signed-out" | "resolved";

/** The one door a stranger is offered on Social, and where it lands them back. */
export const SOCIAL_SIGN_IN_HREF = "/login?mode=signin&from=%2Fsocial";

export function SocialViewerState({
  phase,
  loadingLabel,
  inviteMessage,
  children,
}: {
  phase: SocialViewerPhase;
  loadingLabel: string;
  inviteMessage: string;
  children?: ReactNode;
}) {
  if (phase === "unresolved") {
    return (
      <div
        className={styles.socialIdentitySkeletons}
        role="status"
        aria-busy="true"
        aria-label={loadingLabel}
      >
        <span />
        <span />
      </div>
    );
  }

  if (phase === "signed-out") {
    return (
      <p className={styles.socialIdentityInvite}>
        {inviteMessage} <Link href={SOCIAL_SIGN_IN_HREF}>Sign in</Link>
      </p>
    );
  }

  return children;
}
