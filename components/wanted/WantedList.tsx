"use client";

import dynamic from "next/dynamic";

import { WantedPanelIntro } from "./WantedPanelIntro";
import styles from "./wanted.module.css";

// Capture, sign-in copy, and the ukBasePubs graph behind lib/wanted used to
// ship on /u/you's identity-loading paint because this module was in the SSR
// tree. Mounting a dynamic component starts its fetch immediately, so the body
// stays unmounted until the session has answered (body=true).
const WantedListBody = dynamic(() => import("./WantedListBody"), { ssr: false });

export default function WantedList({
  body = true,
}: {
  /** False holds the identity-neutral head while the session is still answering. */
  body?: boolean;
} = {}): React.JSX.Element {
  return (
    <section className={styles.wantedPanel} id="wanted" aria-labelledby="wanted-heading">
      <WantedPanelIntro />
      {body ? <WantedListBody /> : null}
    </section>
  );
}
